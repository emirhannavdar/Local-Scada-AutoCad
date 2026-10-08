"""Lab-only IEC104 server. Acknowledgement and delayed feedback are separate."""
import argparse,time,threading
import c104
from datetime import datetime,timezone
def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--host',default='0.0.0.0');parser.add_argument('--port',type=int,default=2404)
 parser.add_argument('--ca',type=int,default=1);parser.add_argument('--feedback-delay',type=float,default=1)
 parser.add_argument('--no-feedback',action='store_true');parser.add_argument('--select-execute',action='store_true')
 parser.add_argument('--tls-profile');args=parser.parse_args()
 tls=None
 if args.tls_profile:
  from collector.iec104 import security
  tls=security(c104,args.tls_profile)
 server=c104.Server(ip=args.host,port=args.port,transport_security=tls)
 station=server.add_station(common_address=args.ca)
 voltage=station.add_point(io_address=1001,type=c104.Type.M_ME_NC_1,report_ms=1000);voltage.value=230.0
 breaker=station.add_point(io_address=2001,type=c104.Type.M_DP_NA_1,report_ms=0);breaker.value=c104.Double.OFF
 command=station.add_point(io_address=3001,type=c104.Type.C_DC_NA_1,command_mode=c104.CommandMode.SELECT_AND_EXECUTE if args.select_execute else c104.CommandMode.DIRECT)
 def receive(point:c104.Point,previous_info:c104.Information,message:c104.IncomingMessage)->c104.ResponseState:
  print(f'COMMAND | CA={message.common_address} IOA={message.io_address} COT={int(message.cot)} | {point.value}',flush=True)
  desired=point.value
  if not args.no_feedback:
   def complete():
    time.sleep(args.feedback_delay);breaker.value=desired
    breaker.transmit(cause=c104.Cot.SPONTANEOUS)
    print(f'FEEDBACK | IOA=2001 | {breaker.value}',flush=True)
   threading.Thread(target=complete,daemon=True).start()
  return c104.ResponseState.SUCCESS
 command.on_receive(callable=receive);server.start()
 print(f'IEC104 simulator {args.host}:{args.port} CA={args.ca}; analog1001, feedback2001(Type3), command3001(Type46)',flush=True)
 try:
  while True:time.sleep(1)
 except KeyboardInterrupt:pass
 finally:server.stop()
if __name__=='__main__':main()
