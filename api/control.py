import json
import os
from uuid import UUID
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, model_validator
from psycopg.rows import dict_row
from database.database import get_connection
router=APIRouter()
class Control(BaseModel):
 node_key:str=Field(min_length=1,max_length=100)
 component:str=Field(default='main',pattern=r'^(main|L1|L2|L3)$')
 name:str=Field(min_length=1,max_length=100)
 device_id:int=Field(gt=0)
 write_fc:int
 write_address:int=Field(ge=0,le=65535)
 open_value:int=Field(ge=0,le=65535)
 close_value:int=Field(ge=0,le=65535)
 feedback_signal:str=Field(default='grid_breaker',min_length=1,max_length=100)
 feedback_fc:int
 feedback_address:int=Field(ge=0,le=65535)
 feedback_open:int=Field(ge=0,le=65535)
 feedback_closed:int=Field(ge=0,le=65535)
 verify_seconds:int=Field(default=5,ge=1,le=30)
 enabled:bool=False
 @model_validator(mode='after')
 def check(self):
  if self.write_fc not in (5,6) or self.feedback_fc not in (1,2,3,4):raise ValueError('Yazma FC05/06, geri bildirim FC01/02/03/04 olmalı.')
  if self.open_value==self.close_value or self.feedback_open==self.feedback_closed:raise ValueError('Açık ve kapalı değerleri farklı olmalı.')
  if self.write_fc==5 and (self.open_value not in (0,1) or self.close_value not in (0,1)):raise ValueError('FC05 değeri 0/1 olmalı.')
  return self
class Command(BaseModel):
 request_id:UUID
 control_id:int=Field(gt=0)
 desired:str=Field(pattern='^(open|closed)$')
class Claim(BaseModel):
 worker:str=Field(min_length=1,max_length=100)
 device_ids:list[int]=Field(min_length=1,max_length=1000)
class Result(BaseModel):
 worker:str
 status:str=Field(pattern='^(CONFIRMED|FAILED|UNKNOWN)$')
 feedback:int|None=None
 detail:str=Field(default='',max_length=1000)
def gate():
 if os.getenv('SCADA_ENABLE_COMMANDS')!='1' or not os.getenv('SCADA_ADMIN_TOKEN') or not os.getenv('SCADA_COLLECTOR_TOKEN'):
  raise HTTPException(503,'Komutlar kapalı. API için tokenlar ve SCADA_ENABLE_COMMANDS=1 gerekli.')
def ok(data):return {'success':True,'data':data}
def sweep(c):
 c.execute("UPDATE scada_command SET status=CASE WHEN status='PENDING' THEN 'EXPIRED' ELSE 'UNKNOWN' END,finished_at=now() WHERE (status='PENDING' AND expires_at<now()) OR (status='EXECUTING' AND started_at<now()-interval '60 seconds') RETURNING log_id,status")
 for row in c.fetchall():c.execute('UPDATE komut_log SET sonuc=%s WHERE id=%s',(row['status'],row['log_id']))
@router.get('/controls')
def controls():
 with get_connection() as db,db.cursor(row_factory=dict_row) as c:
  c.execute('SELECT * FROM scada_control ORDER BY id');return ok(c.fetchall())
@router.post('/controls')
def save_control(body:Control):
 gate();v=body.model_dump()
 with get_connection() as db,db.cursor(row_factory=dict_row) as c:
  sweep(c)
  c.execute('SELECT id FROM scada_control WHERE node_key=%s AND component=%s FOR UPDATE',(body.node_key,body.component));c.fetchone()
  c.execute('SELECT id FROM cihaz WHERE id=%s',(body.device_id,))
  if not c.fetchone():raise HTTPException(400,'Kontrol cihazı ID bulunamadı. Önce cihaz kaydı oluştur.')
  c.execute("SELECT 1 FROM scada_command q JOIN scada_control t ON t.id=q.control_id WHERE t.node_key=%s AND t.component=%s AND q.status IN('PENDING','EXECUTING')",(body.node_key,body.component))
  if c.fetchone():raise HTTPException(409,'Komut sürerken eşleştirme değiştirilemez.')
  columns=','.join(v);assign=','.join(f'{k}=EXCLUDED.{k}' for k in v if k not in ('node_key','component'))
  c.execute(f'INSERT INTO scada_control ({columns}) VALUES ({",".join(["%s"]*len(v))}) ON CONFLICT(node_key,component) DO UPDATE SET {assign} RETURNING *',tuple(v.values()));return ok(c.fetchone())
@router.post('/commands')
def command(body:Command,request:Request):
 gate()
 with get_connection() as db,db.cursor(row_factory=dict_row) as c:
  sweep(c);c.execute('SELECT * FROM scada_command WHERE id=%s',(body.request_id,));old=c.fetchone()
  if old:
   if old['control_id']!=body.control_id or old['desired']!=body.desired:raise HTTPException(409,'İstek ID başka komuta ait.')
   return ok(old)
  c.execute('SELECT * FROM scada_control WHERE id=%s FOR UPDATE',(body.control_id,));control=c.fetchone()
  if not control or not control['enabled']:raise HTTPException(409,'Etkin kesici eşleştirmesi yok.')
  c.execute('SELECT aktif,bakim_modu,protokol FROM cihaz WHERE id=%s',(control['device_id'],));dev=c.fetchone()
  if not dev or not dev['aktif'] or dev['bakim_modu']:raise HTTPException(409,'Cihaz pasif veya bakımda.')
  c.execute("SELECT 1 FROM scada_command WHERE control_id=%s AND status IN('PENDING','EXECUTING')",(body.control_id,))
  if c.fetchone():raise HTTPException(409,'Bu kesicinin önceki komutu sonuçlanmalı.')
  if dev['protokol']!='MODBUS_TCP':raise HTTPException(409,'Bu sürümün komut adaptörü yalnızca MODBUS_TCP destekliyor.')
  value=control['open_value'] if body.desired=='open' else control['close_value']
  c.execute("INSERT INTO komut_log(kullanici,cihaz_id,sinyal,deger,sonuc) VALUES(%s,%s,%s,%s,'PENDING') RETURNING id",(request.state.identity['username'],control['device_id'],control['component'],value));log=c.fetchone()['id']
  c.execute('INSERT INTO scada_command(id,control_id,log_id,desired,config) VALUES(%s,%s,%s,%s,%s::jsonb) RETURNING *',(body.request_id,body.control_id,log,body.desired,json.dumps(control)));return ok(c.fetchone())
@router.get('/commands/{request_id}')
def get_command(request_id:UUID):
 with get_connection() as db,db.cursor(row_factory=dict_row) as c:
  sweep(c);c.execute('SELECT * FROM scada_command WHERE id=%s',(request_id,));row=c.fetchone()
  if not row:raise HTTPException(404,'Komut bulunamadı.')
  return ok(row)
@router.post('/claim')
def claim(body:Claim):
 gate()
 with get_connection() as db,db.cursor(row_factory=dict_row) as c:
  sweep(c)
  c.execute("SELECT q.* FROM scada_command q WHERE status='PENDING' AND (config->>'device_id')::bigint=ANY(%s) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",(body.device_ids,));q=c.fetchone()
  if not q:return ok(None)
  c.execute('SELECT pg_advisory_xact_lock(%s)',(q['config']['device_id'],))
  c.execute("SELECT 1 FROM scada_command WHERE status='EXECUTING' AND (config->>'device_id')::bigint=%s",(q['config']['device_id'],))
  if c.fetchone():return ok(None)
  c.execute("UPDATE scada_command SET status='EXECUTING',worker=%s,started_at=now() WHERE id=%s",(body.worker,q['id']))
  c.execute("UPDATE komut_log SET sonuc='EXECUTING',uygulama_z=now() WHERE id=%s",(q['log_id'],));q['worker']=body.worker;q['status']='EXECUTING';return ok(q)
@router.post('/commands/{request_id}/result')
def report(request_id:UUID,body:Result):
 gate()
 with get_connection() as db,db.cursor(row_factory=dict_row) as c:
  c.execute('SELECT * FROM scada_command WHERE id=%s FOR UPDATE',(request_id,));q=c.fetchone()
  if not q or q['worker']!=body.worker:raise HTTPException(409,'Komut bu yürütücüye ait değil.')
  if q['status']!='EXECUTING':return ok(q)
  c.execute('UPDATE scada_command SET status=%s,result=%s::jsonb,finished_at=now() WHERE id=%s RETURNING *',(body.status,json.dumps(body.model_dump()),request_id));row=c.fetchone()
  c.execute('UPDATE komut_log SET sonuc=%s,geri_okuma=%s WHERE id=%s',(body.status,body.feedback,q['log_id']));return ok(row)
