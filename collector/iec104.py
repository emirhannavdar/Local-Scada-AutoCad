"""Persistent IEC104 sessions. Command acknowledgement is never breaker feedback."""
import asyncio,json,os,threading,time,math
from datetime import datetime,timezone
from zoneinfo import ZoneInfo
from pathlib import Path
from collector.api_client import get_data,get_devices
from collector.runtime_config import assigned_devices

_sessions={};_registry=threading.RLock()
def utcnow():return datetime.now(timezone.utc)
def security(c104,name):
 if not name:return None
 path=os.getenv('SCADA_IEC104_TLS_CONFIG','')
 if not path:raise ValueError('TLS profili için SCADA_IEC104_TLS_CONFIG gerekli; düz bağlantıya düşülmez.')
 profile=json.loads(Path(path).read_text())[name]
 tls=c104.TransportSecurity(validate=True,only_known=True)
 tls.set_version(min=c104.TlsVersion.TLS_1_2)
 tls.set_ca_certificate(cert=profile['ca_file'])
 tls.set_certificate(cert=profile['certificate_file'],key=profile['key_file'],passphrase=profile.get('key_password',''))
 tls.add_allowed_remote_certificate(cert=profile['peer_certificate_file'])
 return tls
def quality(code):
 if code & (0x80|0x10|0x01|0x08):return 'BAD'
 if code & 0x40:return 'STALE'
 if code & 0x20:return 'SUBSTITUTED'
 return 'GOOD'
def feedback_matches(observation,expected,since,sequence,connection_active):
 return bool(connection_active and observation and observation['sequence']>sequence and observation['received_monotonic']>=since and observation['quality']=='GOOD' and observation['value']==expected and observation['event_at']>=observation['sent_at_floor'])

class Session:
 def __init__(self,device,cfg,sink=None):
  import c104
  self.c104=c104;self.device=device;self.cfg=cfg;self.sink=sink
  self.lock=threading.Condition();self.command_lock=threading.Lock();self.observations={};self.points={};self.commands={};self.callbacks=[];self.sequence=0;self.error=None;self.stopping=False
  self.bridge=None
  host,port=cfg['host'],cfg['port']
  if cfg.get('tls_profile'):
   from collector.iec104_tls import TLSBridge
   self.bridge=TLSBridge(host,port,cfg['tls_profile'],cfg['connect_timeout_seconds'])
   host,port='127.0.0.1',self.bridge.port
  self.client=c104.Client(tick_rate_ms=100,command_timeout_ms=cfg['command_timeout_seconds']*1000)
  self.client.originator_address=cfg.get('originator',0)
  # GI on each reconnect; clock synchronisation is deliberately not automatic.
  self.connection=self.client.add_connection(ip=host,port=port,init=c104.Init.INTERROGATION)
  self.connection.protocol_parameters.connection_timeout=cfg['connect_timeout_seconds']
  def unexpected(connection:c104.Connection,message:c104.IncomingMessage,cause:c104.Umc)->None:
   print(f'IEC104_UNMAPPED | device={device["id"]} CA={message.common_address} IOA={message.io_address} TYPE={int(message.type)} COT={int(message.cot)} | {cause}')
  self.callbacks.append(unexpected);self.connection.on_unexpected_message(callable=unexpected)
  self.stations={}
  for p in cfg['points']:
   st=self.stations.setdefault(p['ca'],self.connection.get_station(common_address=p['ca']) or self.connection.add_station(common_address=p['ca']))
   point=st.add_point(io_address=p['ioa'],type=c104.Type(p['type_id']))
   def on_receive(point:c104.Point,previous_info:c104.Information,message:c104.IncomingMessage)->c104.ResponseState:
    try:self.receive(point,message)
    except Exception as error:
     self.error=type(error).__name__;print(f'IEC104_RECEIVE_ERROR | device={device["id"]} | {self.error}')
     return c104.ResponseState.FAILURE
    return c104.ResponseState.SUCCESS
   self.callbacks.append(on_receive);point.on_receive(callable=on_receive);self.points[(p['ca'],p['ioa'])]=(point,p)
  try:self.client.start()
  except Exception:
   self.client.stop();raise
 def active(self):return self.connection.is_connected and not self.connection.is_muted and not self.stopping
 def receive(self,point,message):
  key=(message.common_address,message.io_address);item=self.points.get(key)
  if not item:return
  mapping=item[1];cot=int(message.cot)
  if int(message.type)!=mapping['type_id'] or cot not in mapping['allowed_cot'] or message.is_test or message.is_negative:return
  raw=point.value
  try:value=float(raw)
  except TypeError:value=float(int(raw))
  if not math.isfinite(value):return
  code=int(point.quality) if point.quality is not None else 0
  q=quality(code)
  if mapping['type_id'] in (15,37) and code:q='BAD'
  if mapping['type_id'] in (3,31) and value in (0,3):q='BAD'
  received=utcnow();recorded=point.recorded_at
  if recorded is None:event_at=received
  elif recorded.tzinfo is None:event_at=recorded.replace(tzinfo=ZoneInfo(self.cfg['timezone'])).astimezone(timezone.utc)
  else:event_at=recorded.astimezone(timezone.utc)
  if event_at.timestamp()>received.timestamp()+300:q='BAD';event_at=received
  # Store provenance with each buffered/history row; ignore test and negative ASDUs.
  row={'tag_id':mapping['tag_id'],'deger':value*mapping['scale']+mapping['offset'],'kalite':q,'sampled_at':received.isoformat(),
   'protocol_meta':{'protocol':'IEC104','ca':key[0],'ioa':key[1],'type_id':int(message.type),'cot':cot,'quality_bits':code,'originator':message.originator_address,'recorded_at':recorded.isoformat() if recorded else None,'event_at':event_at.isoformat(),'timestamp_source':'device' if recorded else 'collector','received_at':received.isoformat()}}
  if self.sink:self.sink([row])
  else:
   from collector.telemetry import submit
   submit([row])
  with self.lock:
   self.sequence+=1;self.observations[key]={'sequence':self.sequence,'received_monotonic':time.monotonic(),'event_at':event_at,'sent_at_floor':datetime.min.replace(tzinfo=timezone.utc),'quality':q,'value':value,'row':row};self.lock.notify_all()
 def execute(self,q):
  cfg=q['config'];attempted=False
  with self.command_lock:
   try:
    if not self.device.get('aktif',True) or self.device.get('bakim_modu') or not self.active():return {'status':'FAILED','detail':'IEC104 veri bağlantısı aktif değil veya cihaz bakımda.'}
    ca=cfg['iec_ca'];key=(ca,cfg['iec_feedback_ioa']);item=self.points.get(key)
    if not item or item[1]['type_id']!=cfg['iec_feedback_type']:raise ValueError('Geri bildirim nokta listesi ile eşleşmiyor.')
    if ca not in self.stations:raise ValueError('Komut CA tanımlı değil.')
    ck=(ca,cfg['iec_command_ioa']);command=self.commands.get(ck)
    if command is None:
     if ck in self.points:raise ValueError('Komut IOA izleme IOA ile aynı olamaz.')
     command=self.stations[ca].add_point(io_address=ck[1],type=self.c104.Type(cfg['iec_command_type']))
     self.commands[ck]=command
    if int(command.type)!=cfg['iec_command_type']:raise ValueError('Komut Type ID değişti; yapılandırmayı yeniden yükleyin.')
    command.command_mode=getattr(self.c104.CommandMode,cfg['iec_command_mode'])
    value=cfg['open_value'] if q['desired']=='open' else cfg['close_value']
    expected=cfg['feedback_open'] if q['desired']=='open' else cfg['feedback_closed']
    command.value=bool(value) if cfg['iec_command_type']==45 else self.c104.Double(value)
    with self.lock:baseline=self.sequence
    sent=time.monotonic();sent_at=utcnow();attempted=True
    accepted=command.transmit(cause=self.c104.Cot(cfg['iec_cot']))
    if not accepted:return {'status':'UNKNOWN','detail':'IEC104 komut onayı alınamadı; komut tekrar gönderilmez.'}
    deadline=sent+cfg['verify_seconds']
    with self.lock:
     while time.monotonic()<deadline:
      observation=self.observations.get(key)
      if observation:
       check={**observation,'sent_at_floor':sent_at}
       if feedback_matches(check,expected,sent,baseline,self.active()):
        return {'status':'CONFIRMED','feedback':int(expected),'physical_confirmed':True,'feedback_ca':ca,'feedback_ioa':key[1],'feedback_type_id':cfg['iec_feedback_type'],'detail':'Komut sonrası GOOD kesici durum mesajı alındı.'}
      self.lock.wait(min(.2,max(0,deadline-time.monotonic())))
    return {'status':'UNKNOWN','detail':'Komut kabul edildi; süre içinde geçerli kesici geri bildirimi gelmedi.'}
   except Exception as error:return {'status':'UNKNOWN' if attempted else 'FAILED','detail':str(error)[:500]}
 def stale(self):
  now=time.monotonic();rows=[]
  with self.lock:
   for key,(_,mapping) in self.points.items():
    obs=self.observations.get(key)
    if not self.active() or not obs or now-obs['received_monotonic']>mapping['stale_seconds']:
     rows.append({'tag_id':mapping['tag_id'],'deger':None,'kalite':'COMM_FAIL' if not self.active() else 'STALE','sampled_at':utcnow().isoformat()})
  if rows:
   if self.sink:self.sink(rows)
   else:
    from collector.telemetry import submit
    submit(rows)
 def close(self):
  self.stopping=True
  with self.lock:self.lock.notify_all()
  with self.command_lock:
   self.client.stop();self.client.disconnect_all()
   if self.bridge:self.bridge.close()

def execute(q,device):
 with _registry:s=_sessions.get(device['id']) if device else None
 if s is None:return {'status':'FAILED','detail':'IEC104 oturumu hazır değil; komut gönderilmedi.'}
 return s.execute(q)

async def supervisor():
 from collector.telemetry import group_cycle
 last_ok=0;last_log=0
 try:
  while True:
   try:
    cfgs=await asyncio.to_thread(get_data,'iec104/config')
    devices={d['id']:d for d in assigned_devices(await asyncio.to_thread(get_devices)) if d['aktif'] and not d['bakim_modu']}
    desired={c['device_id']:c for c in cfgs if c['enabled'] and c['device_id'] in devices};last_ok=time.monotonic()
    for did in list(_sessions):
     s=_sessions[did]
     if did not in desired or s.cfg!=desired[did]:
      with _registry:_sessions.pop(did,None)
      from collector.telemetry import forget_group
      forget_group(did,1000000000+did)
      await asyncio.to_thread(s.close)
    for did,cfg in desired.items():
     if did not in _sessions:
      s=await asyncio.to_thread(Session,devices[did],cfg)
      with _registry:_sessions[did]=s
      print(f'IEC104_START | device={did} | {cfg["host"]}:{cfg["port"]} | points={len(cfg["points"])} | TLS={bool(cfg.get("tls_profile"))}')
   except Exception as error:
    if time.monotonic()-last_log>30:print(f'IEC104_CONFIG_WAIT | {type(error).__name__}');last_log=time.monotonic()
    if last_ok and time.monotonic()-last_ok>float(os.getenv('SCADA_CACHE_MAX_AGE','86400')):
     for did,s in list(_sessions.items()):
      with _registry:_sessions.pop(did,None)
      from collector.telemetry import forget_group
      forget_group(did,1000000000+did)
      await asyncio.to_thread(s.close)
   for did,s in list(_sessions.items()):
    try:await asyncio.to_thread(s.stale)
    except Exception as error:
     if time.monotonic()-last_log>30:print(f'IEC104_TELEMETRY_ERROR | device={did} | {type(error).__name__}');last_log=time.monotonic()
    with s.lock:
     bad=sum(o['quality']!='GOOD' or time.monotonic()-o['received_monotonic']>s.points[k][1]['stale_seconds'] for k,o in s.observations.items())
     good=len(s.observations)-bad
    group_cycle(did,1000000000+did,good,bad,not s.active(),0)
   await asyncio.sleep(10)
 finally:
  for did,s in list(_sessions.items()):
   with _registry:_sessions.pop(did,None)
   await asyncio.to_thread(s.close)
