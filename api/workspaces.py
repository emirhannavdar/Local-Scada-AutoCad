import json
import math
import re
from fastapi import APIRouter,Request,HTTPException
from pydantic import BaseModel,Field
from api.auth import account_cursor
from api.authorization import require_site,has_permission

router=APIRouter()
class Workspace(BaseModel):
 revision:int=Field(ge=0)
 layout:dict

def validate(layout,allowed):
 if len(json.dumps(layout))>5000000:raise HTTPException(422,'Şema en fazla 5 MB olabilir.')
 nodes=layout.get('nodes');edges=layout.get('connections')
 if layout.get('version')!=2 or not isinstance(nodes,list) or not isinstance(edges,list) or len(nodes)>2000 or len(edges)>10000:raise HTTPException(422,'Geçersiz şema.')
 keys=set()
 for n in nodes:
  if not isinstance(n,dict) or not isinstance(n.get('id'),str) or n['id'] in keys:raise HTTPException(422,'Geçersiz veya tekrar eden node ID.')
  keys.add(n['id'])
  if n.get('type') not in ('inverter','transformer','kiosk','meter','panel','group') or not isinstance(n.get('name'),str) or not isinstance(n.get('code'),str):raise HTTPException(422,'Geçersiz node türü veya adı.')
  if not all(isinstance(n.get(k),(int,float)) and not isinstance(n[k],bool) and math.isfinite(n[k]) for k in ('x','y','width','height')):raise HTTPException(422,'Node konumu/boyutu sayısal olmalı.')
  if not 100<=n['width']<=2000 or not 70<=n['height']<=2000 or abs(n['x'])>100000 or abs(n['y'])>100000:raise HTTPException(422,'Geçersiz node boyutu.')
  if not re.fullmatch(r'#[0-9a-fA-F]{6}',n.get('color','')):raise HTTPException(422,'Geçersiz node rengi.')
  if not isinstance(n.get('metricTags',{}),dict):raise HTTPException(422,'Geçersiz register eşleştirmesi.')
  if allowed is not None:
   binding=n.get('binding')
   if binding:
    try:kind,id=binding.split(':');id=int(id)
    except Exception:raise HTTPException(422,'Geçersiz API eşleştirmesi.')
    route={'DEVICE':'device','DM':'dm','TM':'tm','TRAFO':'trafo','ADP':'adp'}.get(kind)
    if id not in allowed.get(route,set()):raise HTTPException(403,'Node yetkili sahanın dışında.')
   source=n.get('measurementDeviceId')
   if source and int(source) not in allowed['device']:raise HTTPException(403,'Ölçüm kaynağı yetkili sahanın dışında.')
   tags=[n.get('displayTag')]+list(n.get('metricTags',{}).values())
   if any(t and t!='none' and int(t) not in allowed['tag'] for t in tags):raise HTTPException(403,'Register yetkili sahanın dışında.')
 adjacency={k:[] for k in keys};edge_ids=set()
 for e in edges:
  if not isinstance(e,dict) or e.get('from') not in keys or e.get('to') not in keys:raise HTTPException(422,'Bağlantı node’u bulunamadı.')
  if not isinstance(e.get('id'),str) or e['id'] in edge_ids or e['from']==e['to']:raise HTTPException(422,'Geçersiz/tekrar eden bağlantı.')
  edge_ids.add(e['id']);adjacency[e['from']].append(e['to'])
 seen=set();visiting=set()
 def visit(start):
  stack=[(start,False)]
  while stack:
   key,done=stack.pop()
   if done:visiting.discard(key);seen.add(key);continue
   if key in visiting:raise HTTPException(422,'Şema döngü içeremez.')
   if key in seen:continue
   visiting.add(key);stack.append((key,True));stack.extend((child,False) for child in adjacency[key])
 for key in keys:visit(key)

@router.get('/{site_id}')
def get(site_id:int,request:Request):
 require_site(request,site_id)
 with account_cursor() as c:
  c.execute('SELECT layout,revision FROM scada_workspace WHERE site_id=%s',(site_id,));r=c.fetchone()
 if not r:return {'success':True,'data':{'layout':None,'revision':0}}
 layout=r[0];allowed=request.state.allowed
 if allowed is not None:
  visible=[]
  for node in layout['nodes']:
   try:validate({'version':2,'nodes':[node],'connections':[]},allowed);visible.append(node)
   except (HTTPException,ValueError,TypeError):pass
  ids={n['id'] for n in visible};layout={**layout,'nodes':visible,'connections':[e for e in layout['connections'] if e['from'] in ids and e['to'] in ids]}
 return {'success':True,'data':{'layout':layout,'revision':r[1]}}

@router.put('/{site_id}')
def put(site_id:int,body:Workspace,request:Request):
 require_site(request,site_id)
 if request.state.identity['role'] not in ('root','operator'):raise HTTPException(403,'İzleyici yerleşimi değiştiremez.')
 validate(body.layout,request.state.allowed)
 with account_cursor() as c:
  c.execute('SELECT pg_advisory_xact_lock(%s)',(site_id,))
  c.execute('SELECT revision FROM scada_workspace WHERE site_id=%s FOR UPDATE',(site_id,));old=c.fetchone()
  if (old[0] if old else 0)!=body.revision:raise HTTPException(409,'Şema başka kullanıcı tarafından değişti. Yenileyip son sürümü al.')
  c.execute('INSERT INTO scada_workspace(site_id,layout,revision) VALUES(%s,%s::jsonb,1) ON CONFLICT(site_id) DO UPDATE SET layout=EXCLUDED.layout,revision=scada_workspace.revision+1,updated_at=now() RETURNING revision',(site_id,json.dumps(body.layout)));revision=c.fetchone()[0]
 return {'success':True,'data':{'revision':revision}}

@router.get('/{site_id}/export')
def export(site_id:int,request:Request):
 if not has_permission(request.state.identity,'diagram_export'):raise HTTPException(403,'Şema dışa aktarım yetkin yok.')
 return get(site_id,request)

@router.post('/{site_id}/import')
def import_layout(site_id:int,body:Workspace,request:Request):
 if not has_permission(request.state.identity,'diagram_import'):raise HTTPException(403,'Şema içe aktarım yetkin yok.')
 return put(site_id,body,request)
