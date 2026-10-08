"""Background outbox replay and non-secret worker telemetry."""
import asyncio
import hashlib
import os
import threading
import time
import uuid
from datetime import datetime,timezone
from pathlib import Path
from collector.buffer import Outbox
from collector.api_client import API_BASE_URL,_post,TIMEOUT,post_data

_started=time.monotonic()
_boot=str(uuid.uuid4())
_worker=os.getenv('SCADA_WORKER_ID','').strip() or 'collector-local'
_scope=hashlib.sha256((API_BASE_URL.rstrip('/')+'|'+_worker+'|'+os.getenv('SCADA_DEVICE_IDS','')).encode()).hexdigest()
_outbox=None
_lock=threading.Lock()
_groups={}
_last_api_ok=None
_config_stale=True

def now():return datetime.now(timezone.utc).isoformat()
def outbox():
    global _outbox
    with _lock:
        if _outbox is None:
            _outbox=Outbox(os.getenv('SCADA_BUFFER_PATH') or Path(__file__).with_name('measurements.sqlite3'),_scope,int(os.getenv('SCADA_BUFFER_MAX_ROWS','250000')))
    return _outbox

def submit(rows):
    stamp=now()
    return outbox().enqueue([{**r,'sampled_at':r.get('sampled_at') or stamp} for r in rows])

def group_cycle(device,group,good,bad,failed,elapsed):
    key=(device,group)
    with _lock:
        old=_groups.get(key,{})
        _groups[key]={'device_id':device,'group_id':group,'cycles':old.get('cycles',0)+1,'good_register':good,'bad_register':bad,'link_failed':bool(failed),'cycle_ms':round(elapsed*1000,2),'last_at':now()}

def forget_group(device,group):
    with _lock:_groups.pop((device,group),None)

def configuration(configs=None,stale=False):
    global _config_stale
    _config_stale=stale
    if configs is not None:
        keys=set(configs)
        with _lock:
            for key in list(_groups):
                if key not in keys and key[1]<1000000000:del _groups[key]

def replay_once():
    global _last_api_ok
    q=outbox().peek()
    if not q:return False
    import json
    response=_post(f'{API_BASE_URL}/operations/ingest',json=json.loads(q['payload']),timeout=TIMEOUT)
    if response.status_code in (409,422):
        outbox().reject(q['id'],f'HTTP {response.status_code}. Tag, zaman ve batch içeriğini kontrol edin.')
        print(f"BUFFER_REJECTED | {q['id']} | HTTP {response.status_code} | kayıt korundu")
        return True
    response.raise_for_status()
    if not response.json().get('success'):raise RuntimeError('Tampon aktarımı doğrulanamadı.')
    outbox().delivered(q['id']);_last_api_ok=now()
    return True

async def delivery_loop():
    delay=1;last_log=0
    while True:
        try:
            sent=await asyncio.to_thread(replay_once)
            delay=1
            await asyncio.sleep(.05 if sent else 1)
        except asyncio.CancelledError:raise
        except Exception as e:
            if time.monotonic()-last_log>=30:
                print(f'BUFFER_WAIT | {type(e).__name__} | ölçümler yerelde korunuyor');last_log=time.monotonic()
            await asyncio.sleep(delay);delay=min(delay*2,30)

async def health_loop():
    last_log=0
    while True:
        try:
            with _lock:groups=list(_groups.values())
            body={'worker':_worker,'boot_id':_boot,'sampled_at':now(),'device_ids':sorted({g['device_id'] for g in groups}),'groups':groups,**outbox().stats(),'uptime_seconds':time.monotonic()-_started,'last_api_ok':_last_api_ok,'config_stale':_config_stale}
            await asyncio.to_thread(post_data,'operations/heartbeat',body)
        except asyncio.CancelledError:raise
        except Exception as e:
            if time.monotonic()-last_log>=60:
                print(f'HEALTH_WAIT | {type(e).__name__}');last_log=time.monotonic()
        await asyncio.sleep(10)
