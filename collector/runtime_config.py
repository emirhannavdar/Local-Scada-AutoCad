import os

def assigned_devices(devices):
    """Empty assignment preserves one-collector operation; explicit IDs isolate masters."""
    raw = os.getenv('SCADA_DEVICE_IDS', '').strip()
    if not raw:
        return devices
    try:
        ids = {int(x.strip()) for x in raw.split(',')}
        if not ids or any(x <= 0 for x in ids):
            raise ValueError()
    except ValueError:
        raise ValueError('SCADA_DEVICE_IDS pozitif cihaz ID listesi olmalı: örn. 42,43') from None
    return [d for d in devices if d['id'] in ids]
