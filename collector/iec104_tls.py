"""Verified mutual TLS transport for c104. Plaintext listener is loopback only.

c104 2.2.1 has no hostname-verification setter and fails validated TLS client
handshakes with its bundled Mbed TLS. Use Python's verified TLS transport,
including exact leaf-certificate pinning; never downgrade the remote link.
"""
import hashlib,json,os,socket,ssl,threading,secrets
from pathlib import Path
class TLSBridge:
 def __init__(self,host,port,profile_name,timeout):
  path=os.getenv('SCADA_IEC104_TLS_CONFIG','')
  if not path:raise ValueError('SCADA_IEC104_TLS_CONFIG gerekli.')
  profile=json.loads(Path(path).read_text())[profile_name]
  self.hostname=profile['server_name']
  if not self.hostname:raise ValueError('TLS server_name gerekli.')
  self.context=ssl.create_default_context(ssl.Purpose.SERVER_AUTH,cafile=profile['ca_file'])
  self.context.minimum_version=ssl.TLSVersion.TLSv1_2
  self.context.load_cert_chain(profile['certificate_file'],profile['key_file'],password=profile.get('key_password') or None)
  der=ssl.PEM_cert_to_DER_cert(Path(profile['peer_certificate_file']).read_text())
  self.pin=hashlib.sha256(der).digest();self.host=host;self.remote_port=port;self.timeout=timeout
  self.closed=threading.Event();self.lock=threading.Lock();self.sockets=set()
  self.listener=socket.socket();self.listener.bind(('127.0.0.1',0));self.port=self.listener.getsockname()[1]
  self.listener.listen(2);self.listener.settimeout(.2)
  self.thread=threading.Thread(target=self.accept,daemon=True);self.thread.start()
 def track(self,s):
  with self.lock:self.sockets.add(s)
 def drop(self,s):
  with self.lock:self.sockets.discard(s)
  try:s.shutdown(socket.SHUT_RDWR)
  except OSError:pass
  s.close()
 def accept(self):
  while not self.closed.is_set():
   try:local,_=self.listener.accept()
   except socket.timeout:continue
   except OSError:return
   self.track(local);threading.Thread(target=self.tunnel,args=(local,),daemon=True).start()
 def tunnel(self,local):
  remote=None;raw=None
  try:
   raw=socket.create_connection((self.host,self.remote_port),self.timeout)
   remote=self.context.wrap_socket(raw,server_hostname=self.hostname,do_handshake_on_connect=False)
   self.track(remote);remote.do_handshake()
   if not secrets.compare_digest(hashlib.sha256(remote.getpeercert(binary_form=True)).digest(),self.pin):raise ssl.SSLError('TLS peer certificate pin mismatch')
   local.settimeout(.5);remote.settimeout(.5)
   def copy(source,target):
    try:
     while not self.closed.is_set():
      try:data=source.recv(16384)
      except socket.timeout:continue
      if not data:break
      target.sendall(data)
    except (OSError,ssl.SSLError):pass
    finally:self.drop(source);self.drop(target)
   incoming=threading.Thread(target=copy,args=(remote,local),daemon=True);incoming.start();copy(local,remote);incoming.join(2)
  except (OSError,ssl.SSLError) as error:
   # Never print certificate/key content or silently reconnect without TLS.
   print(f'IEC104_TLS_REJECTED | {type(error).__name__}',flush=True)
  finally:
   self.drop(local)
   if remote is not None:self.drop(remote)
   elif raw is not None:raw.close()
 def close(self):
  self.closed.set();self.listener.close()
  with self.lock:sockets=list(self.sockets)
  for s in sockets:self.drop(s)
  self.thread.join(1)
