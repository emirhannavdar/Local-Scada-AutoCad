"""Read-only physical GPIO observations; never writes a GPIO or confirms a breaker."""
from datetime import datetime, timezone, timedelta
from typing import Literal
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, ConfigDict, model_validator
from psycopg.rows import dict_row
from database.database import get_connection

router=APIRouter()
def ok(data): return {"success":True,"data":data}
class Channel(BaseModel):
 model_config=ConfigDict(extra='forbid')
 device_id:int=Field(gt=0)
 worker:str=Field(min_length=1,max_length=100,pattern=r'^\S+$')
 pin:int=Field(ge=0,le=27)
 signal:str=Field(min_length=1,max_length=100,pattern=r'^[A-Za-z][A-Za-z0-9_]*$')
 enabled:bool=True
class Channels(BaseModel):
 rows:list[Channel]=Field(min_length=1,max_length=28)
class Sample(BaseModel):
 pin:int=Field(ge=0,le=27)
 value:Literal[0,1]|None=None
 mode:str=Field(max_length=20)
 quality:Literal['GOOD','BAD','NOT_INPUT']
 @model_validator(mode='after')
 def validate_sample(self):
  if self.quality=='GOOD' and (self.mode!='ip' or self.value is None):raise ValueError('GOOD yalnızca giriş modu ve 0/1 değeri için geçerli.')
  if self.quality!='GOOD' and self.value is not None:raise ValueError('Geçersiz girişte değer null olmalı.')
  return self
class Samples(BaseModel):
 worker:str=Field(min_length=1,max_length=100)
 sampled_at:datetime
 rows:list[Sample]=Field(max_length=28)

@router.get('/channels')
def channels(request:Request):
 user=request.state.identity;allowed=request.state.allowed
 with get_connection() as db,db.cursor(row_factory=dict_row) as c:
  c.execute("SELECT i.*,s.value,s.mode,s.sampled_at,s.received_at,CASE WHEN s.received_at IS NULL THEN 'NOT_CONFIGURED' WHEN s.received_at < now()-interval '15 seconds' THEN 'STALE' ELSE s.quality END AS quality,'BOOL' AS data_type FROM scada_gpio_input i LEFT JOIN scada_gpio_input_state s ON s.input_id=i.id ORDER BY i.device_id,i.id")
  rows=c.fetchall()
 if allowed is not None:rows=[r for r in rows if r['device_id'] in allowed['device']]
 if user['role'] in ('viewer','operator'):
  rows=[{k:v for k,v in r.items() if k not in ('worker','pin')} for r in rows]
 return ok(rows)

@router.post('/channels')
def configure(body:Channels,request:Request):
 if request.state.identity['role']!='root':raise HTTPException(403,'Giriş eşleştirmesini yalnızca root düzenleyebilir.')
 if len({(r.worker,r.pin) for r in body.rows})!=len(body.rows):raise HTTPException(422,'Aynı master/pin birden fazla tanımlanamaz.')
 with get_connection() as db,db.cursor(row_factory=dict_row) as c:
  c.execute('SELECT pg_advisory_xact_lock(891233)')
  for r in body.rows:
   c.execute('SELECT id FROM cihaz WHERE id=%s',(r.device_id,))
   if not c.fetchone():raise HTTPException(404,'Önce cihazı oluştur veya mevcut cihazı seç.')
   c.execute("SELECT id FROM scada_control WHERE kind='GPIO' AND enabled AND gpio_worker=%s AND gpio_pin=%s",(r.worker,r.pin))
   if r.enabled and c.fetchone():raise HTTPException(409,f'BCM {r.pin} röle çıkışına atanmış. Giriş ve çıkış aynı pin olamaz.')
   c.execute('SELECT device_id,signal FROM scada_gpio_input WHERE worker=%s AND pin=%s',(r.worker,r.pin));old=c.fetchone()
   if old and (old['device_id']!=r.device_id or old['signal']!=r.signal):raise HTTPException(409,f'BCM {r.pin} başka sinyale atanmış. Mevcut eşleştirmeyi kullan.')
   c.execute('SELECT id FROM scada_gpio_input WHERE device_id=%s AND signal=%s AND (worker<>%s OR pin<>%s)',(r.device_id,r.signal,r.worker,r.pin))
   if c.fetchone():raise HTTPException(409,'Bu sinyal başka pine atanmış; ayrı sinyal adı kullan.')
   c.execute('INSERT INTO scada_gpio_input(device_id,worker,pin,signal,enabled) VALUES(%s,%s,%s,%s,%s) ON CONFLICT(worker,pin) DO UPDATE SET enabled=EXCLUDED.enabled RETURNING id',(r.device_id,r.worker,r.pin,r.signal,r.enabled))
   input_id=c.fetchone()['id']
   if not r.enabled:c.execute('DELETE FROM scada_gpio_input_state WHERE input_id=%s',(input_id,))
 return ok(True)

@router.post('/samples')
def ingest(body:Samples,request:Request):
 if request.state.identity['role']!='collector':raise HTTPException(403,'Yalnızca collector gerçek giriş ölçümü gönderebilir.')
 now=datetime.now(timezone.utc)
 if body.sampled_at.tzinfo is None or abs((now-body.sampled_at).total_seconds())>300:raise HTTPException(422,'Master saati veya ölçüm zaman damgası hatalı.')
 if len({r.pin for r in body.rows})!=len(body.rows):raise HTTPException(422,'Tekrarlanan GPIO pini.')
 count=0
 with get_connection() as db,db.cursor(row_factory=dict_row) as c:
  for s in body.rows:
   c.execute('SELECT i.id FROM scada_gpio_input i JOIN cihaz d ON d.id=i.device_id WHERE i.worker=%s AND i.pin=%s AND i.enabled AND d.aktif AND NOT d.bakim_modu FOR UPDATE OF i',(body.worker,s.pin));channel=c.fetchone()
   if not channel:continue
   input_id=channel['id']
   c.execute('SELECT * FROM scada_gpio_input_state WHERE input_id=%s',(input_id,));old=c.fetchone()
   if old and body.sampled_at<=old['sampled_at']:continue
   c.execute('SELECT received_at FROM scada_gpio_input_history WHERE input_id=%s ORDER BY id DESC LIMIT 1',(input_id,));last=c.fetchone()
   if not old or (old['value'],old['mode'],old['quality'])!=(s.value,s.mode,s.quality) or not last or last['received_at']<now-timedelta(seconds=60):
    c.execute('INSERT INTO scada_gpio_input_history(input_id,value,mode,quality,sampled_at) VALUES(%s,%s,%s,%s,%s)',(input_id,s.value,s.mode,s.quality,body.sampled_at))
   c.execute('INSERT INTO scada_gpio_input_state(input_id,value,mode,quality,sampled_at) VALUES(%s,%s,%s,%s,%s) ON CONFLICT(input_id) DO UPDATE SET value=EXCLUDED.value,mode=EXCLUDED.mode,quality=EXCLUDED.quality,sampled_at=EXCLUDED.sampled_at,received_at=now()',(input_id,s.value,s.mode,s.quality,body.sampled_at));count+=1
 return ok({'accepted':count})
