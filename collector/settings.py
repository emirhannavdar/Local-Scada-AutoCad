"""Local master settings. Environment variables take precedence."""
import json
import os
import math
from pathlib import Path
from urllib.parse import urlsplit

KEYS = {"SCADA_API_URL", "SCADA_API_TOKEN", "SCADA_API_TIMEOUT", "SCADA_CONFIG_REFRESH", "SCADA_DEVICE_IDS", "SCADA_COMMAND_WORKER", "SCADA_WORKER_ID", "SCADA_MAX_GAP", "SCADA_AUTO_TAG", "SCADA_SUMMARY_SECONDS", "SCADA_ENABLE_GPIO", "SCADA_GPIO_PINS", "SCADA_ENABLE_GPIO_INPUTS", "SCADA_GPIO_INPUT_PINS"}

def load_settings(path=None):
    path = Path(path or os.getenv("SCADA_COLLECTOR_CONFIG") or Path(__file__).with_name("collector.json"))
    if not path.exists():
        if os.getenv("SCADA_COLLECTOR_CONFIG"):
            raise ValueError("SCADA_COLLECTOR_CONFIG dosyası bulunamadı.")
        return
    try:
        values = json.loads(path.read_text(encoding="utf-8-sig"))
    except json.JSONDecodeError as error:
        raise ValueError(f"Collector JSON hatası: satır {error.lineno}, sütun {error.colno}. Virgül ve çift tırnakları kontrol et.") from None
    except (OSError, UnicodeError):
        raise ValueError("Collector ayar dosyası okunamadı; yol, izin ve UTF-8 kodlamasını kontrol et.") from None
    if not isinstance(values, dict) or set(values) - KEYS:
        raise ValueError("Collector ayar dosyasında desteklenmeyen alan var.")
    combined = {k: os.environ.get(k, str(v)) for k, v in values.items()}
    if "SCADA_API_URL" in combined:
        u = urlsplit(combined["SCADA_API_URL"])
        if u.scheme not in ("http", "https") or not u.hostname or u.username or u.password or u.query or u.fragment or not u.path.rstrip("/").endswith("/api/v1"):
            raise ValueError("SCADA_API_URL http(s) adresi olmalı ve /api/v1 ile bitmeli.")
    for k in ("SCADA_API_TIMEOUT", "SCADA_CONFIG_REFRESH", "SCADA_SUMMARY_SECONDS"):
        if k in combined:
            try: value = float(combined[k])
            except ValueError: raise ValueError(k + " sayısal olmalı.") from None
            if not math.isfinite(value) or not 0 < value <= 3600: raise ValueError(k + " 0 ile 3600 arasında olmalı.")
    for k in ("SCADA_COMMAND_WORKER", "SCADA_AUTO_TAG", "SCADA_ENABLE_GPIO", "SCADA_ENABLE_GPIO_INPUTS"):
        if k in combined and combined[k] not in ("0", "1"): raise ValueError(k + " 0 veya 1 olmalı.")
    if "SCADA_MAX_GAP" in combined and (not combined["SCADA_MAX_GAP"].isdigit() or not 0 <= int(combined["SCADA_MAX_GAP"]) <= 124):
        raise ValueError("SCADA_MAX_GAP 0–124 olmalı.")
    if combined.get("SCADA_DEVICE_IDS"):
        try:
            if any(int(x.strip()) <= 0 for x in combined["SCADA_DEVICE_IDS"].split(",")): raise ValueError()
        except ValueError: raise ValueError("SCADA_DEVICE_IDS pozitif ID listesi olmalı.") from None
    if combined.get("SCADA_GPIO_PINS"):
        try:
            if any(not 2 <= int(x.strip()) <= 27 for x in combined["SCADA_GPIO_PINS"].split(",")): raise ValueError()
        except ValueError: raise ValueError("SCADA_GPIO_PINS BCM 2–27 pin listesi olmalı.") from None
    if combined.get("SCADA_GPIO_INPUT_PINS"):
        try:
            if any(not 0 <= int(x.strip()) <= 27 for x in combined["SCADA_GPIO_INPUT_PINS"].split(",")): raise ValueError()
        except ValueError: raise ValueError("SCADA_GPIO_INPUT_PINS BCM 0–27 giriş listesi olmalı.") from None
    if combined.get('SCADA_ENABLE_GPIO') == '1' and combined.get('SCADA_ENABLE_GPIO_INPUTS') == '1':
        outputs = {int(x.strip()) for x in combined.get('SCADA_GPIO_PINS', '').split(',') if x.strip()}
        inputs = {int(x.strip()) for x in combined.get('SCADA_GPIO_INPUT_PINS', '').split(',') if x.strip()}
        overlap = sorted(outputs & inputs)
        if overlap:
            raise ValueError('GPIO giriş / çıkış çakışması: BCM ' + ', '.join(map(str, overlap)) + '. Ortam değişkenleri JSON ayarlarından önceliklidir.')
    for k,v in values.items():
        os.environ.setdefault(k, str(v))
