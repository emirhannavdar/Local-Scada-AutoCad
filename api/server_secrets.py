"""Persist server-owned credentials; end users never bootstrap with an API key."""
import json
import os
from pathlib import Path
import secrets
import time

def ensure_server_keys():
    admin = os.getenv('SCADA_ADMIN_TOKEN', '').strip()
    collector = os.getenv('SCADA_COLLECTOR_TOKEN', '').strip()
    if admin or collector:
        if not admin or not collector or min(len(admin), len(collector)) < 32 or admin == collector:
            raise RuntimeError('Mevcut API ve collector anahtarlarını birlikte, farklı ve en az 32 karakter olarak tanımla; otomatik kurulum için ikisini de kaldır.')
        return admin, collector
    path = Path(os.getenv('SCADA_SECRET_FILE') or Path.home() / '.scadawatt' / 'api-secrets.json')
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        # Another worker may still be completing its first write.
        for attempt in range(20):
            try:
                values = json.loads(path.read_text(encoding='utf-8'))
                break
            except (json.JSONDecodeError, OSError):
                if attempt == 19:
                    raise RuntimeError('API anahtar dosyası okunamıyor. SCADA_SECRET_FILE yolunu/izinlerini ve dosyanın yedeğini kontrol et.') from None
                time.sleep(.05)
    else:
        values = {'admin': secrets.token_urlsafe(48), 'collector': secrets.token_urlsafe(48)}
        with os.fdopen(fd, 'w', encoding='utf-8') as out:
            json.dump(values, out)
            out.flush()
            os.fsync(out.fileno())
    if not isinstance(values, dict):
        raise RuntimeError('API anahtar dosyası geçersiz. Dosyanın doğru yedeğini geri yükle.')
    admin, collector = values.get('admin', ''), values.get('collector', '')
    if not isinstance(admin, str) or not isinstance(collector, str) or min(len(admin), len(collector)) < 32 or admin == collector:
        raise RuntimeError('API anahtar dosyası geçersiz. Dosyanın doğru yedeğini geri yükle; anahtarları sessizce yenileme.')
    os.environ['SCADA_ADMIN_TOKEN'] = admin
    os.environ['SCADA_COLLECTOR_TOKEN'] = collector
    return admin, collector
