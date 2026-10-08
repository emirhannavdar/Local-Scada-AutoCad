"""Explicit IEC104 point lists, independent of legacy Modbus profiles."""
import ipaddress
from typing import Literal
from zoneinfo import ZoneInfo
from fastapi import APIRouter,Request,HTTPException
from pydantic import BaseModel,Field,ConfigDict,model_validator
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from database.database import get_connection
router=APIRouter()
MONITOR_TYPES={1,3,9,11,13,15,30,31,34,35,36,37}
class Point(BaseModel):
 model_config=ConfigDict(extra='forbid',allow_inf_nan=False)
 ca:int=Field(ge=1,le=65534)
 ioa:int=Field(ge=0,le=16777215)
 type_id:int
 tag_id:int=Field(gt=0)
 scale:float=1
 offset:float=0
 allowed_cot:list[int]=Field(default_factory=lambda:[1,2,3,5,11,12,*range(20,37)],min_length=1,max_length=30)
 stale_seconds:int=Field(default=60,ge=5,le=86400)
 @model_validator(mode='after')
 def validate_point(self):
  if self.type_id not in MONITOR_TYPES:raise ValueError('Desteklenen izleme Type ID: '+str(sorted(MONITOR_TYPES)))
  if any(c not in {1,2,3,5,11,12,*range(20,37)} for c in self.allowed_cot):raise ValueError('COT izleme/sorgu cevabı olmalı; komut onayı ölçüm değildir.')
  if self.type_id in (1,3,30,31) and (self.scale!=1 or self.offset!=0):raise ValueError('Durum bilgisinin ölçeği 1 ve offset 0 olmalı.')
  return self
class Configuration(BaseModel):
 model_config=ConfigDict(extra='forbid')
 host:str
 port:int=Field(default=2404,ge=1,le=65535)
 enabled:bool=False
 tls_profile:str|None=Field(default=None,pattern=r'^[A-Za-z0-9_-]{1,64}$')
 timezone:str='UTC'
 originator:int=Field(default=0,ge=0,le=255)
 connect_timeout_seconds:int=Field(default=10,ge=1,le=30)
 command_timeout_seconds:int=Field(default=5,ge=1,le=10)
 revision:int=Field(default=0,ge=0)
 point_list_reference:str=Field(default='',max_length=500)
 interoperability_reference:str=Field(default='',max_length=500)
 points:list[Point]=Field(default_factory=list,max_length=2000)
 @model_validator(mode='after')
 def check(self):
  ipaddress.ip_address(self.host);ZoneInfo(self.timezone)
  if len({(p.ca,p.ioa) for p in self.points})!=len(self.points) or len({p.tag_id for p in self.points})!=len(self.points):raise ValueError('CA/IOA ve tag eşleştirmeleri tekil olmalı.')
  if self.enabled and (not self.points or not self.point_list_reference.strip() or not self.interoperability_reference.strip()):raise ValueError('Etkinleştirmek için nokta listesi, interoperability referansı ve noktalar gerekli.')
  return self
def ready(c):
 c.execute("SELECT to_regclass('scada_iec104_config') AS name")
 if c.fetchone()['name'] is None:raise HTTPException(503,'IEC104 migration eksik. install_iec104.py çalıştırın.')
def root(request):
 if request.state.identity['role']!='root':raise HTTPException(403,'IEC104 yapılandırması root içindir.')
@router.get('/config')
def configs(request:Request):
 if request.state.identity['role'] not in ('root','collector'):raise HTTPException(403,'IEC104 bağlantı ayarlarına erişim yok.')
 with get_connection() as db,db.cursor(row_factory=dict_row) as c:
  ready(c);c.execute('SELECT device_id,revision,config FROM scada_iec104_config ORDER BY device_id');rows=c.fetchall()
 return {'success':True,'data':[{'device_id':r['device_id'],**r['config'],'revision':r['revision']} for r in rows]}
@router.put('/config/{device_id}')
def save(device_id:int,body:Configuration,request:Request):
 root(request)
 with get_connection() as db,db.cursor(row_factory=dict_row) as c:
  ready(c);c.execute('SELECT id FROM cihaz WHERE id=%s FOR UPDATE',(device_id,))
  if not c.fetchone():raise HTTPException(404,'Önce cihaz kaydı oluşturun.')
  c.execute('SELECT * FROM scada_iec104_config WHERE device_id=%s FOR UPDATE',(device_id,));old=c.fetchone()
  if body.revision!=(old['revision'] if old else 0):raise HTTPException(409,'Yapılandırma değişti; yenileyin.')
  c.execute("SELECT 1 FROM scada_command WHERE status IN('PENDING','EXECUTING') AND (config->>'device_id')::bigint=%s",(device_id,))
  if c.fetchone():raise HTTPException(409,'Komut sürerken bağlantı değiştirilemez.')
  for p in sorted(body.points,key=lambda p:p.tag_id):
   c.execute('SELECT id FROM tag WHERE id=%s AND cihaz_id=%s AND aktif FOR UPDATE',(p.tag_id,device_id))
   if not c.fetchone():raise HTTPException(422,f'Tag {p.tag_id} bu cihazın aktif tagi değil.')
  if body.enabled:
   c.execute("SELECT * FROM scada_control WHERE device_id=%s AND kind='IEC104' AND enabled",(device_id,))
   for control in c.fetchall():
    matched=[p for p in body.points if p.ca==control['iec_ca'] and p.ioa==control['iec_feedback_ioa'] and p.type_id==control['iec_feedback_type']]
    if not matched:raise HTTPException(409,'Etkin kesicinin geri bildirim noktası kaldırılamaz. Önce kontrolü pasif yapın.')
  cfg=body.model_dump(exclude={'revision'});rev=(old['revision'] if old else 0)+1
  c.execute('INSERT INTO scada_iec104_config(device_id,revision,config) VALUES(%s,%s,%s) ON CONFLICT(device_id) DO UPDATE SET revision=EXCLUDED.revision,config=EXCLUDED.config,updated_at=now()',(device_id,rev,Jsonb(cfg)))
  c.execute('DELETE FROM scada_iec104_point WHERE device_id=%s',(device_id,))
  if (body.enabled or (old and old['config']['enabled'])) and (not old or old['config']!=cfg):
   c.execute("UPDATE olcum_anlik SET kalite='STALE',updated_at=now() WHERE tag_id IN (SELECT id FROM tag WHERE cihaz_id=%s)",(device_id,))
  for p in body.points:c.execute('INSERT INTO scada_iec104_point(device_id,ca,ioa,tag_id,config) VALUES(%s,%s,%s,%s,%s)',(device_id,p.ca,p.ioa,p.tag_id,Jsonb(p.model_dump())))
 return {'success':True,'data':{'device_id':device_id,**cfg,'revision':rev}}
@router.get('/events/{device_id}')
def events(device_id:int,request:Request):
 from api.operations import tags_for
 ids=[t['tag_id'] for t in tags_for(request,device_id=device_id)]
 with get_connection() as db,db.cursor(row_factory=dict_row) as c:
  ready(c);c.execute('SELECT tag_id,zaman,deger,kalite,protocol_meta FROM olcum_gecmis WHERE tag_id=ANY(%s) AND protocol_meta IS NOT NULL ORDER BY zaman DESC LIMIT 100',(ids,));rows=c.fetchall()
 return {'success':True,'data':rows}
