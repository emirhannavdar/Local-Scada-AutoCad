"""ScadaWatt arayuzunu yalnizca bu bilgisayarda, port 5500'de sunar."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse
import sys
import threading
import webbrowser

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        if args and str(args[1] if len(args) > 1 else '').startswith(('4', '5')):
            super().log_message(fmt, *args)

def main():
    parser = argparse.ArgumentParser(description='ScadaWatt yerel arayuz sunucusu')
    parser.add_argument('--port', type=int, default=5500)
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error('Port 1 ile 65535 arasinda olmali.')
    directory = Path(__file__).resolve().parent
    try:
        server = ThreadingHTTPServer(('127.0.0.1', args.port), partial(Handler, directory=str(directory)))
    except OSError as exc:
        print(f'Port {args.port} acilamadi: {exc}\nBu porttaki eski frontend sunucusunu kapatip tekrar deneyin.', file=sys.stderr)
        return 1
    url = f'http://127.0.0.1:{args.port}/'
    print(f'ScadaWatt: {url}\nAPI: http://127.0.0.1:8000/api/v1 (arayuz ayarlarindan degistirilebilir)\nDurdurmak icin Ctrl+C.', flush=True)
    if not args.no_browser:
        threading.Timer(.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nArayuz sunucusu durduruldu.')
    finally:
        server.server_close()
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
