"""Authenticated historical analytics, alarms, worker health and configuration audit."""
from datetime import datetime, date, time, timezone, timedelta
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from fastapi import APIRouter, HTTPException, Request, Query
from pydantic import BaseModel, Field, ConfigDict, model_validator
import psycopg
from psycopg.rows import dict_row
from database.database import get_connection
from api.measurement import ScadaMeasurement
from api.telemetry_store import store

router=APIRouter()
def ok(data):return {'success':True,'data':data}
def ready(c):
    c.execute("SELECT to_regclass('scada_ingest_receipt')")
    if c.fetchone()['to_regclass'] is None:raise HTTPException(503,'Operasyon tabloları eksik. sql/008_operations.sql dosyasını mevcut SCADA veritabanında çalıştırın.')

def tags_for(request, tag_ids=None, device_id=None):
    allowed=request.state.allowed
    with get_connection() as db,db.cursor(row_factory=dict_row) as c:
        ready(c)
        c.execute('SELECT t.id AS tag_id,t.cihaz_id AS device_id,c.ad AS device_name,t.sinyal_adi AS signal_name,t.birim AS unit FROM tag t JOIN cihaz c ON c.id=t.cihaz_id WHERE (%s::bigint IS NULL OR c.id=%s) ORDER BY t.id',(device_id,device_id))
        rows=c.fetchall()
    if allowed is not None:rows=[r for r in rows if r['tag_id'] in allowed['tag'] and r['device_id'] in allowed['device']]
    if tag_ids is not None:
        ids=set(tag_ids)
        if not ids<=set(r['tag_id'] for r in rows):raise HTTPException(404,'Tag bulunamadı veya erişim yetkiniz yok.')
        rows=[r for r in rows if r['tag_id'] in ids]
    return rows

def window(start,end):
    if start.tzinfo is None or end.tzinfo is None or end<=start or end-start>timedelta(days=31):raise HTTPException(422,'Saat dilimli başlangıç/bitiş ve en fazla 31 günlük aralık gerekli.')

def parse_ids(value):
    try:ids=[int(x) for x in value.split(',')]
    except (ValueError,AttributeError):raise HTTPException(422,'Tag ID listesi gerekli.')
    if not 1<=len(ids)<=8 or min(ids)<=0 or len(set(ids))!=len(ids):raise HTTPException(422,'1–8 farklı pozitif tag ID seçin.')
    return ids

class Ingest(BaseModel):
    model_config=ConfigDict(extra='forbid')
    batch_id:UUID
    rows:list[ScadaMeasurement]=Field(min_length=1,max_length=2000)
    @model_validator(mode='after')
    def timestamps(self):
        if any(r.sampled_at is None for r in self.rows):raise ValueError('Tampon ölçümlerinin sampled_at değeri gerekli.')
        return self

@router.post('/ingest')
def ingest(body:Ingest,request:Request):
    if request.state.identity['role']!='collector':raise HTTPException(403,'Ölçüm tamponunu yalnızca collector aktarabilir.')
    with get_connection() as db,db.cursor(row_factory=dict_row) as c:ready(c)
    return ok(store(body.rows,body.batch_id))

@router.get('/history')
def history(request:Request,tag_ids:str,start:datetime,end:datetime,points:int=Query(600,ge=20,le=2000)):
    window(start,end);metadata=tags_for(request,parse_ids(tag_ids));ids=[r['tag_id'] for r in metadata]
    seconds=max(1,(end-start).total_seconds()/points)
    with get_connection() as db,db.cursor(row_factory=dict_row) as c:
        c.execute('''SELECT tag_id, floor(extract(epoch FROM zaman)/%s)::bigint AS bucket,
          min(zaman) AS timestamp,max(zaman) AS end_at,
          avg(deger) FILTER(WHERE kalite::text='GOOD') AS value,
          min(deger) FILTER(WHERE kalite::text='GOOD') AS minimum,
          max(deger) FILTER(WHERE kalite::text='GOOD') AS maximum,
          count(*) AS count,count(*) FILTER(WHERE kalite::text='GOOD' AND deger IS NOT NULL) AS good_count
          FROM olcum_gecmis WHERE tag_id=ANY(%s) AND zaman >= %s AND zaman < %s GROUP BY tag_id,bucket ORDER BY tag_id,bucket''',(seconds,ids,start,end))
        rows=c.fetchall()
    for r in rows:r['quality']='GOOD' if r['good_count']==r['count'] else 'PARTIAL' if r['good_count'] else 'BAD'
    return ok({'tags':metadata,'rows':rows,'bucket_seconds':seconds,'start':start,'end':end})

class Rule(BaseModel):
    model_config=ConfigDict(extra='forbid',allow_inf_nan=False)
    tag_id:int=Field(gt=0)
    name:str=Field(min_length=1,max_length=150)
    kind:Literal['HIGH','LOW','BAD']='HIGH'
    threshold:float|None=None
    hysteresis:float=Field(default=0,ge=0)
    delay_seconds:int=Field(default=0,ge=0,le=86400)
    max_gap_seconds:int=Field(default=60,ge=1,le=3600)
    severity:Literal['INFO','WARNING','CRITICAL']='WARNING'
    enabled:bool=True
    @model_validator(mode='after')
    def valid(self):
        if self.kind!='BAD' and self.threshold is None:raise ValueError('Sayısal alarm için eşik gerekli.')
        return self
class RuleUpdate(Rule):
    revision:int=Field(ge=1)
class Ack(BaseModel):
    note:str=Field(min_length=1,max_length=2000)

@router.get('/alarm-rules')
def rules(request:Request):
    tags=tags_for(request);ids=[t['tag_id'] for t in tags]
    with get_connection() as db,db.cursor(row_factory=dict_row) as c:
        c.execute('SELECT * FROM scada_alarm_rule WHERE tag_id=ANY(%s) ORDER BY id',(ids,));rows=c.fetchall()
    return ok(rows)

@router.post('/alarm-rules')
def create_rule(body:Rule,request:Request):
    if request.state.identity['role']!='root':raise HTTPException(403,'Alarm kurallarını root düzenleyebilir.')
    tags_for(request,[body.tag_id])
    with get_connection() as db,db.cursor(row_factory=dict_row) as c:
        c.execute('INSERT INTO scada_alarm_rule(tag_id,name,kind,threshold,hysteresis,delay_seconds,max_gap_seconds,severity,enabled) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *',tuple(body.model_dump().values()));row=c.fetchone()
    return ok(row)

@router.put('/alarm-rules/{rule_id}')
def update_rule(rule_id:int,body:RuleUpdate,request:Request):
    if request.state.identity['role']!='root':raise HTTPException(403,'Alarm kurallarını root düzenleyebilir.')
    tags_for(request,[body.tag_id])
    with get_connection() as db,db.cursor(row_factory=dict_row) as c:
        c.execute('SELECT tag_id FROM scada_alarm_rule WHERE id=%s',(rule_id,));previous=c.fetchone()
        if not previous:raise HTTPException(404,'Alarm kuralı yok.')
        # Same tag-before-rule order as ingestion prevents update/ingest deadlocks.
        for tag_id in sorted({previous['tag_id'],body.tag_id}):
            c.execute('SELECT id FROM tag WHERE id=%s FOR UPDATE',(tag_id,))
        c.execute('SELECT * FROM scada_alarm_rule WHERE id=%s FOR UPDATE',(rule_id,));old=c.fetchone()
        if not old:raise HTTPException(404,'Alarm kuralı yok.')
        if old['revision']!=body.revision:raise HTTPException(409,'Kural başka kullanıcı tarafından değişti. Yenileyin.')
        c.execute('UPDATE scada_alarm_event SET cleared_at=now(),clear_reason=%s WHERE rule_id=%s AND cleared_at IS NULL',('RULE_CHANGED' if body.enabled else 'DISABLED',rule_id))
        c.execute('DELETE FROM scada_alarm_state WHERE rule_id=%s',(rule_id,))
        values=body.model_dump(exclude={'revision'})
        c.execute('UPDATE scada_alarm_rule SET tag_id=%s,name=%s,kind=%s,threshold=%s,hysteresis=%s,delay_seconds=%s,max_gap_seconds=%s,severity=%s,enabled=%s,revision=revision+1,updated_at=now() WHERE id=%s RETURNING *',(*values.values(),rule_id));row=c.fetchone()
    return ok(row)

@router.get('/alarms')
def alarms(request:Request,status:Literal['all','active','unacknowledged','cleared']='all',limit:int=Query(200,ge=1,le=1000),before:int|None=None,device_id:int|None=None):
    ids=[t['tag_id'] for t in tags_for(request,device_id=device_id)]
    condition={'all':'TRUE','active':'cleared_at IS NULL','unacknowledged':'acknowledged_at IS NULL','cleared':'cleared_at IS NOT NULL'}[status]
    with get_connection() as db,db.cursor(row_factory=dict_row) as c:
        c.execute(f'SELECT * FROM scada_alarm_event WHERE tag_id=ANY(%s) AND {condition} AND (%s::bigint IS NULL OR id<%s) ORDER BY id DESC LIMIT %s',(ids,before,before,limit+1));rows=c.fetchall()
    return ok({'rows':rows[:limit],'next_before':rows[limit-1]['id'] if len(rows)>limit else None})

@router.post('/alarms/{event_id}/ack')
def acknowledge(event_id:int,body:Ack,request:Request):
    if request.state.identity['role'] not in ('root','operator'):raise HTTPException(403,'İzleyici alarm onaylayamaz.')
    ids=[t['tag_id'] for t in tags_for(request)]
    with get_connection() as db,db.cursor(row_factory=dict_row) as c:
        c.execute('SELECT * FROM scada_alarm_event WHERE id=%s AND tag_id=ANY(%s) FOR UPDATE',(event_id,ids));row=c.fetchone()
        if not row:raise HTTPException(404,'Alarm bulunamadı.')
        if row['acknowledged_at']:return ok(row)
        c.execute('UPDATE scada_alarm_event SET acknowledged_at=now(),acknowledged_by=%s,note=%s WHERE id=%s RETURNING *',(request.state.identity['username'],body.note,event_id));row=c.fetchone()
    return ok(row)

class GroupHealth(BaseModel):
    model_config=ConfigDict(extra='forbid')
    device_id:int=Field(gt=0)
    group_id:int=Field(gt=0)
    cycles:int=Field(ge=0)
    good_register:int=Field(ge=0)
    bad_register:int=Field(ge=0)
    link_failed:bool
    cycle_ms:float=Field(ge=0,le=1e9,allow_inf_nan=False)
    last_at:datetime
class Heartbeat(BaseModel):
    model_config=ConfigDict(extra='forbid')
    worker:str=Field(min_length=1,max_length=100,pattern=r'^\S+$')
    boot_id:UUID
    sampled_at:datetime
    device_ids:list[int]=Field(max_length=2000)
    groups:list[GroupHealth]=Field(max_length=4000)
    queue_batches:int=Field(ge=0)
    queue_rows:int=Field(ge=0)
    queue_bytes:int=Field(ge=0)
    rejected_batches:int=Field(ge=0)
    uptime_seconds:float=Field(ge=0,allow_inf_nan=False)
    last_api_ok:datetime|None=None
    config_stale:bool=False
    @model_validator(mode='after')
    def clock(self):
        now=datetime.now(timezone.utc)
        dates=[self.sampled_at]+[g.last_at for g in self.groups]+([self.last_api_ok] if self.last_api_ok else [])
        if any(t.tzinfo is None or t>now+timedelta(minutes=5) for t in dates):raise ValueError('Saat dilimi ve master saatini kontrol edin.')
        if len(set(self.device_ids))!=len(self.device_ids) or any(x<=0 for x in self.device_ids):raise ValueError('Geçersiz cihaz listesi.')
        if any(g.device_id not in self.device_ids for g in self.groups):raise ValueError('Grup master cihaz listesinde değil.')
        return self

@router.post('/heartbeat')
def heartbeat(body:Heartbeat,request:Request):
    if request.state.identity['role']!='collector':raise HTTPException(403,'Sağlık bildirimi collector içindir.')
    metrics=body.model_dump(mode='json',exclude={'worker','boot_id','sampled_at','device_ids'})
    import json
    with get_connection() as db,db.cursor(row_factory=dict_row) as c:
        ready(c)
        c.execute('INSERT INTO scada_worker_health(worker,boot_id,sampled_at,device_ids,metrics) VALUES(%s,%s,%s,%s,%s::jsonb) ON CONFLICT(worker) DO UPDATE SET boot_id=EXCLUDED.boot_id,sampled_at=EXCLUDED.sampled_at,device_ids=EXCLUDED.device_ids,metrics=EXCLUDED.metrics,received_at=now()', (body.worker,body.boot_id,body.sampled_at,body.device_ids,json.dumps(metrics)))
    return ok(True)

@router.get('/health')
def health(request:Request):
    with get_connection() as db,db.cursor(row_factory=dict_row) as c:
        ready(c)
        c.execute("SELECT *,received_at>now()-interval '45 seconds' AS online FROM scada_worker_health ORDER BY worker");rows=c.fetchall()
    allowed=request.state.allowed
    if allowed is not None:
        filtered=[]
        for r in rows:
            device_ids=[x for x in r['device_ids'] if x in allowed['device']]
            if not device_ids:continue
            m=r['metrics'];r['device_ids']=device_ids;r['metrics']={'groups':[g for g in m.get('groups',[]) if g['device_id'] in allowed['device']], 'config_stale':m.get('config_stale')};filtered.append(r)
        rows=filtered
    return ok({'workers':rows,'server_time':datetime.now(timezone.utc)})

@router.get('/daily-report')
def report(request:Request,day:date,device_id:int,tz:str='Europe/Istanbul'):
    try:zone=ZoneInfo(tz)
    except ZoneInfoNotFoundError:raise HTTPException(422,'Geçersiz IANA saat dilimi.')
    start=datetime.combine(day,time.min,zone);end=datetime.combine(day+timedelta(days=1),time.min,zone)
    metadata=tags_for(request,device_id=device_id);ids=[t['tag_id'] for t in metadata]
    with get_connection() as db,db.cursor(row_factory=dict_row) as c:
        c.execute('''SELECT tag_id,count(*) AS sample_count,count(*) FILTER(WHERE kalite::text='GOOD' AND deger IS NOT NULL) AS good_count,
        min(deger) FILTER(WHERE kalite::text='GOOD') AS minimum,max(deger) FILTER(WHERE kalite::text='GOOD') AS maximum,
        avg(deger) FILTER(WHERE kalite::text='GOOD') AS average,min(zaman) AS first_at,max(zaman) AS last_at
        FROM olcum_gecmis WHERE tag_id=ANY(%s) AND zaman>=%s AND zaman<%s GROUP BY tag_id''',(ids,start,end));stats={r['tag_id']:r for r in c.fetchall()}
        c.execute('''WITH v AS (SELECT tag_id,zaman,lag(zaman) OVER(PARTITION BY tag_id ORDER BY zaman) AS previous FROM olcum_gecmis WHERE tag_id=ANY(%s) AND zaman>=%s AND zaman<%s)
          SELECT tag_id,max(extract(epoch FROM zaman-previous)) AS max_gap_seconds FROM v GROUP BY tag_id''',(ids,start,end));gaps={r['tag_id']:r['max_gap_seconds'] for r in c.fetchall()}
        c.execute('SELECT * FROM scada_alarm_event WHERE tag_id=ANY(%s) AND started_at<%s AND (cleared_at IS NULL OR cleared_at>=%s) ORDER BY started_at LIMIT 501',(ids,end,start));events=c.fetchall()
        energy={}
        energy_ids=[m['tag_id'] for m in metadata if m['unit'] in ('Wh','kWh','MWh')]
        if energy_ids:
            c.execute('''WITH v AS (SELECT tag_id,zaman,deger,lag(deger) OVER(PARTITION BY tag_id ORDER BY zaman) AS previous FROM olcum_gecmis
              WHERE tag_id=ANY(%s) AND zaman>=%s AND zaman<%s AND kalite::text='GOOD' AND deger IS NOT NULL)
              SELECT tag_id,(array_agg(deger ORDER BY zaman))[1] AS first_value,(array_agg(deger ORDER BY zaman DESC))[1] AS last_value,
              count(*) AS n,bool_or(deger<previous) AS reset_seen FROM v GROUP BY tag_id''',(energy_ids,start,end))
            for r in c.fetchall():energy[r['tag_id']]={'counter_delta':None if r['n']<2 or r['reset_seen'] else r['last_value']-r['first_value'],'reset_seen':bool(r['reset_seen'])}
    summary=[]
    for m in metadata:
        r=stats.get(m['tag_id'],{'sample_count':0,'good_count':0})
        gap=gaps.get(m['tag_id'])
        boundary=max((r['first_at']-start).total_seconds(),(end-r['last_at']).total_seconds()) if r.get('first_at') else (end-start).total_seconds()
        summary.append({**m,**r,'largest_observation_gap_seconds':max(float(gap or 0),boundary),**energy.get(m['tag_id'],{})})
    return ok({'day':day,'timezone':tz,'start':start,'end':end,'generated_at':datetime.now(timezone.utc),'device_id':device_id,'measurements':summary,'alarms':events[:500],'alarms_truncated':len(events)>500,'notes':['Enerji farkı gün içindeki ilk ve son GOOD sayaç örneği arasındadır; tam gün üretimi değildir. Sayaç azaldıysa fark hesaplanmaz.','Örnek aralığı haberleşme kesintisiyle aynı şey değildir. Veri bulunmayan süre sıfır ölçüm sayılmaz.']})

@router.get('/audit')
def audit(request:Request,entity:str|None=None,before:int|None=None,limit:int=Query(100,ge=1,le=500)):
    if request.state.identity['role']!='root':raise HTTPException(403,'Konfigürasyon geçmişi root içindir.')
    with get_connection() as db,db.cursor(row_factory=dict_row) as c:
        ready(c)
        c.execute('SELECT * FROM scada_config_audit WHERE (%s::text IS NULL OR entity=%s) AND (%s::bigint IS NULL OR id<%s) ORDER BY id DESC LIMIT %s',(entity,entity,before,before,limit+1));rows=c.fetchall()
    return ok({'rows':rows[:limit],'next_before':rows[limit-1]['id'] if len(rows)>limit else None})
