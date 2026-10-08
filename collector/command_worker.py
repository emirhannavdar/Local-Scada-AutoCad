"""API-only command queue consumer; UI has no link to this module."""
import asyncio
import os
import time
import socket
from collector.api_client import get_devices, get_serial_lines, post_data
from collector.runtime_config import assigned_devices
from collector.modbus_client import create_client, ModbusDeviceError

def feedback(client,device,cfg):
 fc=cfg['feedback_fc'];name={1:'read_coils',2:'read_discrete_inputs',3:'read_holding_registers',4:'read_input_registers'}[fc]
 r=getattr(client,name)(address=cfg['feedback_address'],count=1,device_id=device['slave_id'])
 if r.isError():raise RuntimeError('Kesici geri bildirimi okunamadı.')
 return int(r.bits[0]) if fc in (1,2) else r.registers[0]

def execute(q,device,serial_lines=None,client_factory=create_client):
 cfg=q['config'];client=client_factory(device,serial_lines);attempted=False
 try:
  if not device.get('aktif',True) or device.get('bakim_modu'):return {'status':'FAILED','detail':'Cihaz pasif veya bakımda.'}
  if not client.connect():return {'status':'FAILED','detail':'Komut gönderilmeden bağlantı kurulamadı.'}
  value=cfg['open_value'] if q['desired']=='open' else cfg['close_value']
  expected=cfg['feedback_open'] if q['desired']=='open' else cfg['feedback_closed']
  # Never reissue a write after a timeout. Protocol retries must be disabled.
  attempted=True
  if cfg['write_fc']==6:r=client.write_register(address=cfg['write_address'],value=value,device_id=device['slave_id'])
  else:r=client.write_coil(address=cfg['write_address'],value=bool(value),device_id=device['slave_id'])
  if r.isError():return {'status':'UNKNOWN','detail':'Yazma doğrulanamadı; otomatik tekrar gönderilmeyecek.'}
  deadline=time.monotonic()+cfg['verify_seconds'];last=None
  while time.monotonic()<deadline:
   last=feedback(client,device,cfg)
   if last==expected:return {'status':'CONFIRMED','feedback':last,'detail':'Durum registerı doğrulandı.'}
   time.sleep(.2)
  return {'status':'UNKNOWN','feedback':last,'detail':'Beklenen kesici durumu süre içinde okunamadı.'}
 except Exception as e:return {'status':'UNKNOWN' if attempted else 'FAILED','detail':str(e)[:1000]}
 finally:client.close()

async def gpio_execute(gpio,q,device):
 task=asyncio.create_task(asyncio.to_thread(gpio.execute,q,device))
 try:return await asyncio.shield(task)
 except asyncio.CancelledError:
  await task
  raise

async def command_loop():
 if os.getenv('SCADA_COMMAND_WORKER')!='1':return
 from collector.gpio_output import configured_outputs
 worker=os.getenv('SCADA_WORKER_ID',socket.gethostname());pending=None;gpio=None;gpio_error=None
 try:
  try:gpio=configured_outputs(worker)
  except Exception as e:
   gpio_error=str(e);print(f'GPIO_CONFIG_ERROR | {gpio_error}')
  while True:
   try:
    if pending:
     await asyncio.to_thread(post_data,f"control/commands/{pending[0]}/result",pending[1]);pending=None
    devices=assigned_devices(await asyncio.to_thread(get_devices))
    if gpio:
     await asyncio.to_thread(post_data,'control/gpio-state',{'worker':worker,'device_ids':[d['id'] for d in devices], 'outputs':gpio.snapshot()})
    if devices:
     q=await asyncio.to_thread(post_data,'control/claim',{'worker':worker,'device_ids':[d['id'] for d in devices]})
     if q:
      dev=next((d for d in devices if d['id']==q['config']['device_id']),None)
      if q['config'].get('kind')=='GPIO':
       result=await gpio_execute(gpio,q,dev) if gpio else {'status':'FAILED','detail':gpio_error or 'GPIO bu master üzerinde etkin değil.'}
      elif q['config'].get('kind')=='IEC104':
       from collector.iec104 import execute as iec104_execute
       result=await asyncio.to_thread(iec104_execute,q,dev)
      else:
       lines=await asyncio.to_thread(get_serial_lines) if dev and dev['protokol']=='MODBUS_RTU' else []
       result=await asyncio.to_thread(execute,q,dev,lines) if dev else {'status':'FAILED','detail':'Atanmış cihaz bulunamadı.'}
      print(f"COMMAND | {q['id']} | {result['status']} | {result['detail']}")
      pending=(str(q['id']),{'worker':worker,**result})
   except Exception as e:print(f'COMMAND_API_ERROR | {e}')
   await asyncio.sleep(1)
 finally:
  if gpio:gpio.close()
