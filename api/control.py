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
 kind:str=Field(default="MODBUS",pattern="^(MODBUS|GPIO|IEC104)$")
 gpio_pin:int|None=Field(default=None,ge=2,le=27)
 gpio_worker:str|None=Field(default=None,max_length=100)
 gpio_active_high:bool=True
 write_fc:int=6
 write_address:int=Field(default=0,ge=0,le=65535)
 open_value:int=Field(default=0,ge=0,le=65535)
 close_value:int=Field(default=1,ge=0,le=65535)
 feedback_signal:str=Field(default='grid_breaker',min_length=1,max_length=100)
 feedback_fc:int=3
 feedback_address:int=Field(default=0,ge=0,le=65535)
 feedback_open:int=Field(default=0,ge=0,le=65535)
 feedback_closed:int=Field(default=1,ge=0,le=65535)
 verify_seconds:int=Field(default=5,ge=1,le=30)
 iec_ca:int|None=Field(default=None,ge=1,le=65534)
 iec_command_ioa:int|None=Field(default=None,ge=0,le=16777215)
 iec_command_type:int|None=None
 iec_feedback_ioa:int|None=Field(default=None,ge=0,le=16777215)
 iec_feedback_type:int|None=None
 iec_command_mode:str|None=None
 iec_cot:int|None=None
 enabled:bool=False
 @model_validator(mode='after')
 def check(self):
  if self.kind=='IEC104':
   if any(v is None for v in (self.iec_ca,self.iec_command_ioa,self.iec_command_type,self.iec_feedback_ioa,self.iec_feedback_type,self.iec_command_mode,self.iec_cot)):raise ValueError('IEC104 CA, komut/geri bildirim IOA ve Type ID, komut modu ve COT gerekli.')
   if self.iec_command_type not in (45,46) or self.iec_feedback_type not in (1,3,30,31):raise ValueError('Komut Type ID 45/46; geri bildirim 1/3/30/31 olmalı.')
   if self.iec_command_mode not in ('DIRECT','SELECT_AND_EXECUTE') or self.iec_cot!=6:raise ValueError('IEC104 komut modu ve ACTIVATION COT=6 gerekli.')
   values={0,1} if self.iec_command_type==45 else {1,2}
   fb={0,1} if self.iec_feedback_type in (1,30) else {1,2}
   if {self.open_value,self.close_value}!=values or {self.feedback_open,self.feedback_closed}!=fb:raise ValueError('Tekli değerler 0/1, çiftli değerler 1/2 olmalı.')
   if self.iec_command_ioa==self.iec_feedback_ioa:raise ValueError('Komut ve geri bildirim IOA ayrı olmalı.')
   self.gpio_pin,self.gpio_worker=None,None
   return self
  if self.kind=='GPIO':
   if self.gpio_pin is None or not self.gpio_worker or not self.gpio_worker.strip():raise ValueError('GPIO BCM pini ve master adı zorunlu.')
   self.gpio_worker=self.gpio_worker.strip()
   self.open_value,self.close_value=0,1
   self.write_fc,self.feedback_fc=6,3
   self.write_address,self.feedback_address=0,0
   self.feedback_open,self.feedback_closed=0,1
   return self
  required={'write_fc','write_address','open_value','close_value','feedback_fc','feedback_address','feedback_open','feedback_closed'}
  if not required <= self.model_fields_set:raise ValueError('Modbus komut ve geri bildirim alanlarını doldur.')
  self.gpio_pin,self.gpio_worker=None,None
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
 status:str=Field(pattern='^(CONFIRMED|APPLIED|FAILED|UNKNOWN)$')
 feedback:int|None=None
 output_active:bool|None=None
 feedback_ca:int|None=None
 feedback_ioa:int|None=None
 feedback_type_id:int|None=None
 physical_confirmed:bool=False
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
  c.execute("""SELECT t.*, CASE WHEN s.seen_at>now()-interval '20 seconds' THEN s.active END AS gpio_output_active,
    s.seen_at AS gpio_seen_at, COALESCE(s.seen_at>now()-interval '20 seconds',false) AS gpio_online
    FROM scada_control t LEFT JOIN scada_gpio_state s ON s.control_id=t.id ORDER BY t.id""")
  return ok(c.fetchall())
@router.post('/controls')
def save_control(body:Control):
 gate();v=body.model_dump()
 with get_connection() as db,db.cursor(row_factory=dict_row) as c:
  sweep(c)
  c.execute('SELECT * FROM scada_control WHERE node_key=%s AND component=%s FOR UPDATE',(body.node_key,body.component));previous=c.fetchone()
  if previous and previous['enabled'] and previous['kind']=='GPIO' and (not body.enabled or body.kind!='GPIO' or previous['gpio_pin']!=body.gpio_pin or previous['gpio_worker']!=body.gpio_worker or previous['gpio_active_high']!=body.gpio_active_high):
   c.execute('SELECT active FROM scada_gpio_state WHERE control_id=%s',(previous['id'],));state=c.fetchone()
   if not state or state['active'] is not False:raise HTTPException(409,'GPIO eşleştirmesini değiştirmeden önce röle çıkışını pasif yap ve master sonucunu bekle.')
  c.execute('SELECT id FROM cihaz WHERE id=%s',(body.device_id,))
  if not c.fetchone():raise HTTPException(400,'Kontrol cihazı ID bulunamadı. Önce cihaz kaydı oluştur.')
  c.execute("SELECT 1 FROM scada_command q JOIN scada_control t ON t.id=q.control_id WHERE t.node_key=%s AND t.component=%s AND q.status IN('PENDING','EXECUTING')",(body.node_key,body.component))
  if c.fetchone():raise HTTPException(409,'Komut sürerken eşleştirme değiştirilemez.')
  if body.kind=='GPIO' and body.enabled:
   c.execute('SELECT pg_advisory_xact_lock(891233)')
   c.execute("SELECT id FROM scada_control WHERE kind='GPIO' AND enabled AND gpio_worker=%s AND gpio_pin=%s AND NOT(node_key=%s AND component=%s)",(body.gpio_worker,body.gpio_pin,body.node_key,body.component))
   if c.fetchone():raise HTTPException(409,'Bu master üzerindeki GPIO başka bir kontrol için kullanılıyor.')
  if body.kind=='GPIO' and body.enabled:
   c.execute('SELECT pg_advisory_xact_lock(891233)')
   c.execute('SELECT 1 FROM scada_gpio_input WHERE enabled AND worker=%s AND pin=%s',(body.gpio_worker,body.gpio_pin))
   if c.fetchone():raise HTTPException(409,'Bu pin dijital girişe atanmış; röle çıkışı olarak kullanılamaz.')
  if body.kind=='IEC104':
   from api.iec104 import ready
   ready(c);c.execute('SELECT config FROM scada_iec104_config WHERE device_id=%s',(body.device_id,));iec=c.fetchone()
   if not iec or not iec['config']['enabled']:raise HTTPException(409,'Önce IEC104 bağlantısını etkinleştirin.')
   matches=[p for p in iec['config']['points'] if p['ca']==body.iec_ca and p['ioa']==body.iec_feedback_ioa and p['type_id']==body.iec_feedback_type]
   if not matches:raise HTTPException(422,'Geri bildirim nokta listesinde yok.')
   c.execute('SELECT sinyal_adi FROM tag WHERE id=%s',(matches[0]['tag_id'],))
   if c.fetchone()['sinyal_adi']!=body.feedback_signal:raise HTTPException(422,'Geri bildirim sinyali eşleşen tag sinyal_adi olmalı.')
  columns=','.join(v);assign=','.join(f'{k}=EXCLUDED.{k}' for k in v if k not in ('node_key','component'))
  c.execute(f'INSERT INTO scada_control ({columns}) VALUES ({",".join(["%s"]*len(v))}) ON CONFLICT(node_key,component) DO UPDATE SET {assign} RETURNING *',tuple(v.values()))
  saved=c.fetchone()
  c.execute('DELETE FROM scada_gpio_state WHERE control_id=%s',(saved['id'],))
  return ok(saved)
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
  if not dev or ((not dev['aktif'] or dev['bakim_modu']) and not (control['kind']=='GPIO' and body.desired=='open')):raise HTTPException(409,'Cihaz pasif veya bakımda.')
  c.execute("SELECT 1 FROM scada_command WHERE control_id=%s AND status IN('PENDING','EXECUTING')",(body.control_id,))
  if c.fetchone():raise HTTPException(409,'Bu kesicinin önceki komutu sonuçlanmalı.')
  if control['kind']=='MODBUS' and dev['protokol']!='MODBUS_TCP':raise HTTPException(409,'Bu sürümün komut adaptörü yalnızca MODBUS_TCP destekliyor.')
  if control['kind']=='IEC104':
   c.execute('SELECT config FROM scada_iec104_config WHERE device_id=%s',(control['device_id'],));iec=c.fetchone()
   if not iec or not iec['config']['enabled']:raise HTTPException(409,'IEC104 bağlantısı etkin değil.')
  if control['kind']=='GPIO':
   c.execute("SELECT 1 FROM scada_gpio_state WHERE control_id=%s AND seen_at>now()-interval '20 seconds'",(control['id'],))
   if not c.fetchone():raise HTTPException(409,'GPIO master çevrimdışı. Collector’da GPIO ve komut yürütücüsünü etkinleştir; master adı ve pin izin listesini kontrol et.')
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
  c.execute("SELECT q.* FROM scada_command q WHERE status='PENDING' AND (config->>'device_id')::bigint=ANY(%s) AND (COALESCE(config->>'kind','MODBUS') IN ('MODBUS','IEC104') OR config->>'gpio_worker'=%s) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",(body.device_ids,body.worker));q=c.fetchone()
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
  if q['config'].get('kind')=='IEC104' and body.status=='CONFIRMED':
   cfg=q['config'];expected=cfg['feedback_open'] if q['desired']=='open' else cfg['feedback_closed']
   if not body.physical_confirmed or body.feedback!=expected or (body.feedback_ca,body.feedback_ioa,body.feedback_type_id)!=(cfg['iec_ca'],cfg['iec_feedback_ioa'],cfg['iec_feedback_type']):raise HTTPException(422,'IEC104 sonucu doğru fiziksel geri bildirim kanıtı içermeli.')
  gpio=q['config'].get('kind')=='GPIO'
  if gpio and body.status=='CONFIRMED' or not gpio and body.status=='APPLIED':raise HTTPException(422,'Komut türü ve sonuç durumu uyumsuz.')
  if gpio and body.status=='APPLIED':
   if body.output_active is None or body.output_active!=(q['desired']=='closed') or body.physical_confirmed:raise HTTPException(422,'GPIO sonucu fiziksel kesici doğrulaması olamaz; çıkış seviyesi komutla eşleşmeli.')
   c.execute('SELECT * FROM scada_control WHERE id=%s',(q['control_id'],));current=c.fetchone()
   if current and current['enabled'] and current['gpio_worker']==body.worker and current['gpio_pin']==q['config']['gpio_pin']:
    c.execute("INSERT INTO scada_gpio_state(control_id,active,seen_at) VALUES(%s,%s,now()) ON CONFLICT(control_id) DO UPDATE SET active=EXCLUDED.active,seen_at=now()",(q['control_id'],body.output_active))
  c.execute('UPDATE scada_command SET status=%s,result=%s::jsonb,finished_at=now() WHERE id=%s RETURNING *',(body.status,json.dumps(body.model_dump()),request_id));row=c.fetchone()
  c.execute('UPDATE komut_log SET sonuc=%s,geri_okuma=%s WHERE id=%s',('UNKNOWN' if body.status=='APPLIED' else body.status,body.feedback,q['log_id']));return ok(row)

class GPIOState(BaseModel):
 pin:int=Field(ge=2,le=27)
 active:bool|None=None
 active_high:bool|None=None
class GPIOHeartbeat(BaseModel):
 worker:str=Field(min_length=1,max_length=100)
 device_ids:list[int]=Field(max_length=1000)
 outputs:list[GPIOState]=Field(max_length=26)
@router.post('/gpio-state')
def gpio_state(body:GPIOHeartbeat):
 gate()
 with get_connection() as db,db.cursor(row_factory=dict_row) as c:
  for output in body.outputs:
   c.execute("SELECT id,gpio_active_high FROM scada_control WHERE kind='GPIO' AND enabled AND gpio_worker=%s AND gpio_pin=%s AND device_id=ANY(%s)",(body.worker,output.pin,body.device_ids))
   for control in c.fetchall():
    active=output.active if output.active_high==control['gpio_active_high'] else None
    c.execute("INSERT INTO scada_gpio_state(control_id,active,seen_at) VALUES(%s,%s,now()) ON CONFLICT(control_id) DO UPDATE SET active=EXCLUDED.active,seen_at=now()",(control['id'],active))
 return ok(True)
