"""Observe pinctrl input levels without changing mode, pulls or outputs."""
import asyncio
from datetime import datetime,timezone
import os
import re
import subprocess
from collector.api_client import get_data,get_devices,post_data
from collector.runtime_config import assigned_devices

def read_pins(pins,runner=subprocess.run):
 result=runner(['pinctrl','get',','.join(map(str,sorted(pins)))],capture_output=True,text=True,timeout=3,check=True)
 readings={}
 for line in result.stdout.splitlines():
  m=re.match(r'\s*(\d+):\s+(\S+).*?\|\s*(hi|lo)\b',line)
  if m:
   pin,mode=int(m[1]),m[2]
   readings[pin]={'pin':pin,'mode':mode,'value':int(m[3]=='hi') if mode=='ip' else None,'quality':'GOOD' if mode=='ip' else 'NOT_INPUT'}
 return [readings.get(p,{'pin':p,'mode':'unknown','value':None,'quality':'BAD'}) for p in sorted(pins)]

async def input_loop():
 if os.getenv('SCADA_ENABLE_GPIO_INPUTS')!='1':return
 worker=os.getenv('SCADA_WORKER_ID','').strip()
 try:
  pins={int(p.strip()) for p in os.getenv('SCADA_GPIO_INPUT_PINS','').split(',') if p.strip()}
  outputs={int(p.strip()) for p in os.getenv('SCADA_GPIO_PINS','').split(',') if p.strip()} if os.getenv('SCADA_ENABLE_GPIO')=='1' else set()
 except ValueError:
  print('GPIO_INPUT_CONFIG_ERROR | Pin listeleri tam sayı olmalı.',flush=True);return
 if not worker or not pins or not pins<=set(range(28)):
  print('GPIO_INPUT_CONFIG_ERROR | Master adı ve BCM 0–27 giriş listesi gerekli.',flush=True);return
 if pins&outputs:
  print(f'GPIO_INPUT_CONFIG_ERROR | Giriş / çıkış çakışması: BCM {sorted(pins&outputs)}. Ortam değişkenleri JSON ayarlarından önceliklidir.',flush=True);return
 print(f'GPIO_INPUT_START | {worker} | {sorted(pins)} | salt okuma',flush=True)
 channels=[];cycle=0
 while True:
  try:
   if cycle%5==0:
    devices={d['id'] for d in assigned_devices(await asyncio.to_thread(get_devices)) if d.get('aktif',True) and not d.get('bakim_modu',False)}
    channels=[r for r in await asyncio.to_thread(get_data,'gpio-inputs/channels') if r['enabled'] and r['worker']==worker and r['device_id'] in devices and r['pin'] in pins]
   wanted={r['pin'] for r in channels}
   if not wanted and cycle%30==0:print('GPIO_INPUT_WAIT | Bu master, cihaz kapsamı ve pin izin listesi için etkin giriş eşleştirmesi yok.',flush=True)
   if wanted:
    try:rows=await asyncio.to_thread(read_pins,wanted)
    except (OSError,subprocess.SubprocessError) as e:
     print(f'GPIO_INPUT_READ_ERROR | {e}',flush=True)
     rows=[{'pin':p,'mode':'unknown','value':None,'quality':'BAD'} for p in sorted(wanted)]
    body={'worker':worker,'sampled_at':datetime.now(timezone.utc).isoformat(),'rows':rows}
    result=await asyncio.to_thread(post_data,'gpio-inputs/samples',body)
    if cycle%30==0:print(f'GPIO_INPUT_CYCLE | accepted={result["accepted"]} | '+', '.join(f'{r["pin"]}:{r["value"]}/{r["quality"]}' for r in rows),flush=True)
  except Exception as e:print(f'GPIO_INPUT_API_ERROR | {e}',flush=True)
  cycle+=1
  await asyncio.sleep(1)
