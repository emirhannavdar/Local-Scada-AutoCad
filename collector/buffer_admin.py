"""Read stats or retry retained rejects. Never sends a hardware command."""
import argparse
import json
from collector.telemetry import outbox

def main():
    p=argparse.ArgumentParser();p.add_argument('--retry-rejected',action='store_true');args=p.parse_args()
    q=outbox()
    if args.retry_rejected:print('Tekrar denenecek batch:',q.retry_rejected())
    print(json.dumps(q.stats(),indent=2))
if __name__=='__main__':main()
