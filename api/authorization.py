import json
import secrets
from fastapi import HTTPException
from api.auth import account_cursor,session_claims

def identity(header,admin,collector):
 token=header[7:] if header.startswith('Bearer ') else ''
 if token and secrets.compare_digest(token,admin):return {'id':None,'username':'server-root','role':'root','site_ids':[]}
 if token and secrets.compare_digest(token,collector):return {'id':None,'username':'collector','role':'collector','site_ids':[]}
 claims=session_claims(token,admin)
 if not claims:return None
 with account_cursor() as c:
  c.execute('SELECT id,username,role,active,auth_version,permissions FROM scada_user WHERE username=%s',(claims['sub'],));r=c.fetchone()
  if not r or not r[3] or r[4]!=claims.get('ver',1) or claims.get('uid')!=r[0]:return None
  c.execute('SELECT site_id FROM scada_user_site WHERE user_id=%s',(r[0],))
  return {'id':r[0],'username':r[1],'role':r[2],'site_ids':[x[0] for x in c.fetchall()],'permissions':r[5]}

EXTRA_PERMISSIONS = {'diagram_export','diagram_import','inventory_edit','setup_help'}

def has_permission(user, permission):
 return user['role']=='root' or user['role']=='operator' and permission in user.get('permissions',[])

def scope(user):
 if user['role'] in ('root','collector'):return None
 with account_cursor() as c:
  result={'saha':set(user['site_ids'])}
  for table,parent,source in [('dm','saha_id','saha'),('tm','dm_id','dm'),('trafo','tm_id','tm'),('adp','trafo_id','trafo')]:
   c.execute(f'SELECT id FROM {table} WHERE {parent}=ANY(%s)',(list(result[source]),));result[table]={r[0] for r in c.fetchall()}
  c.execute('SELECT id,ust_dugum_tipi,ust_dugum_id,profil_id,seri_hat_id FROM cihaz')
  devices=[r for r in c.fetchall() if r[2] in result.get(r[1].lower(),set())]
  result['device']={r[0] for r in devices};result['device_profile']={r[3] for r in devices};result['serialLine']={r[4] for r in devices if r[4] is not None}
  for route,table in [('readGroup','okuma_grubu'),('register','register'),('tag','tag')]:
   c.execute(f'SELECT id FROM {table} WHERE cihaz_id=ANY(%s)',(list(result['device']),));result[route]={r[0] for r in c.fetchall()}
  c.execute('SELECT id FROM profil_register WHERE profil_id=ANY(%s)',(list(result['device_profile']),));result['profile_register']={r[0] for r in c.fetchall()}
  c.execute('SELECT sinyal_sozlugu_id FROM register WHERE cihaz_id=ANY(%s)',(list(result['device']),));result['signalDict']={r[0] for r in c.fetchall()}
  result['site']=result['saha']
 return result

def require_site(request,site):
 user=request.state.identity
 if user['role']!='root' and site not in user['site_ids']:raise HTTPException(403,'Bu sahaya erişim yetkin yok.')

def check_request(user,allowed,path,method,body,query):
 if user['role']=='root':return
 if user['role']=='collector':
  from api.access_guard import permitted
  if not permitted('collector',method,path) or path.startswith('/api/v1/users') or path.startswith('/api/v1/workspace') or path.startswith('/api/v1/auth/'):
   raise HTTPException(403,'Collector hesabı bu işlemi yapamaz.')
  return
 route=path.removeprefix('/api/v1/').split('/')[0]
 if route in ('users',) or path=='/api/v1/auth/collector-connection':raise HTTPException(403,'Bu işlem root yetkisi gerektirir.')
 if path=='/api/v1/auth/me':return
 if route=='workspace':
  parts=path.split('/');site=int(parts[4])
  if len(parts)>5 and parts[5] in ('export','import') and not has_permission(user,'diagram_'+parts[5]):raise HTTPException(403,'Şema aktarım yetkin yok.')
  if len(parts)>5:
   if parts[5]=='export' and method=='GET' or parts[5]=='import' and method=='POST':
    if site not in user['site_ids']:raise HTTPException(403,'Bu sahaya erişim yetkin yok.')
    return
   raise HTTPException(403,'Şema işlemi desteklenmiyor.')
  if site not in user['site_ids']:raise HTTPException(403,'Bu sahaya erişim yetkin yok.')
  if method not in ('GET','PUT') or method=='PUT' and user['role']!='operator':raise HTTPException(403,'İzleyici şemayı değiştiremez.')
  return
 if route=='control':
  if path=='/api/v1/control/controls' and method=='GET':return
  if method=='POST' and path=='/api/v1/control/commands' and user['role']=='operator':
   with account_cursor() as c:
    c.execute('SELECT device_id FROM scada_control WHERE id=%s',(body.get('control_id'),));r=c.fetchone()
   if not r or r[0] not in allowed['device']:raise HTTPException(403,'Bu kesici atanmış sahanın cihazına bağlı değil.')
   return
  if user['role']=='operator' and method=='GET' and path.startswith('/api/v1/control/commands/'):
   with account_cursor() as c:
    c.execute("SELECT (config->>'device_id')::bigint FROM scada_command WHERE id=%s",(path.rsplit('/',1)[1],));r=c.fetchone()
   if not r or r[0] not in allowed['device']:raise HTTPException(403,'Bu komuta erişim yetkin yok.')
   return
  raise HTTPException(403,'Kesici eşleştirmesini yalnızca root düzenleyebilir. İzleyici komut veremez.')
 if route=='ui':raise HTTPException(403,'API yapılandırma seçenekleri yalnızca root içindir.')
 if route=='measurement' and method=='GET':return
 if route not in allowed:raise HTTPException(403,'Bu endpoint için yetkin yok.')
 tail=path.rstrip('/').split('/')[-1];record=tail if tail.isdigit() else query.get('id')
 if record is not None and int(record) not in allowed[route]:raise HTTPException(404,'Kayıt bulunamadı.')
 if method=='GET':
  if route not in ('saha','site','dm','tm','trafo','adp','device','tag'):raise HTTPException(403,'Yapılandırma kayıtlarına erişim root yetkisi gerektirir.')
  return
 if not has_permission(user,'inventory_edit'):raise HTTPException(403,'Envanter değişikliği için root tarafından ek yetki verilmelidir.')
 if user['role']!='operator' or route not in ('dm','tm','trafo','adp','device') or method not in ('POST','PUT','PATCH'):
  raise HTTPException(403,'Bu yapılandırma işlemi root yetkisi gerektirir.')
 if method!='POST' and record is None:raise HTTPException(403,'Güncellenecek kayıt belirtilmeli.')
 permitted_fields={'dm':{'saha_id','ad','name'},'tm':{'dm_id','ad','name'},'trafo':{'tm_id','ad','name'},'adp':{'trafo_id','ad','name'},'device':{'ust_dugum_tipi','ust_dugum_id','ad','name'}}
 if method=='POST' or any(k not in permitted_fields[route] for k in body):raise HTTPException(403,'Yeni donanım ve IP/port/profil ayarlarını yalnızca root değiştirebilir.')
 parents={'dm':('saha_id','saha'),'tm':('dm_id','dm'),'trafo':('tm_id','tm'),'adp':('trafo_id','trafo')}
 if route in parents:
  field,parent=parents[route]
  if field in body and body[field] not in allowed[parent]:raise HTTPException(403,'Yeni besleyen öğe yetkili sahanın dışında.')
  if method=='POST' and field not in body:raise HTTPException(422,'Besleyen öğeyi seç.')
 else:
  if 'ust_dugum_tipi' in body or 'ust_dugum_id' in body:
   if 'ust_dugum_tipi' not in body or 'ust_dugum_id' not in body:raise HTTPException(422,'Üst öğenin türü ve ID’sini birlikte gönder.')
   if body['ust_dugum_id'] not in allowed.get(str(body['ust_dugum_tipi']).lower(),set()):raise HTTPException(403,'Cihazın yeni üst öğesi yetkili sahanın dışında.')
  if method=='POST' and 'ust_dugum_id' not in body:raise HTTPException(422,'Üst öğeyi seç.')
  if 'profil_id' in body and body['profil_id'] not in allowed['device_profile']:raise HTTPException(403,'Yeni cihaz profillerini root hazırlamalı.')
  if body.get('seri_hat_id') is not None and body['seri_hat_id'] not in allowed['serialLine']:raise HTTPException(403,'Bu seri hatta yetkin yok.')

def filter_result(allowed,path,result,user=None):
 if not allowed or not isinstance(result,dict) or 'data' not in result:return result
 route=path.removeprefix('/api/v1/').split('/')[0]
 data=result['data']
 def visible(r):
  if not isinstance(r,dict):return False
  if route=='measurement':return r.get('device_id',r.get('cihaz_id')) in allowed['device'] and r.get('tag_id') in allowed['tag']
  if route=='control':return r.get('device_id') in allowed['device']
  return r.get('id') in allowed.get(route,set())
 if route in allowed or route=='measurement' or path=='/api/v1/control/controls':
  if isinstance(data,list):result['data']=[r for r in data if visible(r)]
  elif isinstance(data,dict) and not visible(data):raise HTTPException(404,'Kayıt bulunamadı.')
 if user and user['role'] in ('viewer','operator'):
  # Telemetry/topology are necessary for viewing; network/configuration secrets are not.
  permitted={'device':{'id','ad','name','ust_dugum_tipi','ust_dugum_id','aktif','bakim_modu'},'tag':{'id','cihaz_id','device_id','register_id','sinyal_adi','tag_adi','birim','aktif'},'control':{'id','node_key','component','name','device_id','feedback_signal','feedback_open','feedback_closed','enabled','kind','gpio_output_active','gpio_online','gpio_seen_at'}}
  if route=='control' and '/commands/' in path and isinstance(result['data'],dict):
   result['data']={k:v for k,v in result['data'].items() if k in {'id','control_id','desired','status','result','created_at','started_at','finished_at'}}
   return result
  if route in permitted:
   def clean(row):return {k:v for k,v in row.items() if k in permitted[route]}
   if isinstance(result['data'],list):result['data']=[clean(r) for r in result['data']]
   elif isinstance(result['data'],dict):result['data']=clean(result['data'])
 return result
