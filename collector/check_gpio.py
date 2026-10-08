"""Standalone read-only GPIO/configuration diagnostics. Never imports collector startup."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess


def inspect_gpio(text, inputs, outputs):
    states = {}
    for line in text.splitlines():
        match = re.match(r'\s*(\d+):\s+(\S+).*?\|\s*(hi|lo)\b', line)
        if match:
            pin, mode, level = int(match[1]), match[2], match[3]
            states[pin] = (mode, level)
    rows = []
    for pin in sorted(inputs | outputs):
        mode, level = states.get(pin, ('unknown', 'unknown'))
        role = 'INPUT+OUTPUT CONFLICT' if pin in inputs & outputs else 'INPUT' if pin in inputs else 'OUTPUT'
        expected = 'ip' if role == 'INPUT' else 'op'
        status = 'CONFLICT' if 'CONFLICT' in role else 'NOT_READ' if mode == 'unknown' else 'OK' if mode == expected else 'NOT_INPUT' if role == 'INPUT' else 'NOT_OUTPUT'
        rows.append((pin, role, mode, level, status))
    return rows


def main():
    parser = argparse.ArgumentParser(description='Salt okuma: collector ayarı ve BCM pin modu. Pin yönünü, seviyesini veya DB kayıtlarını değiştirmez.')
    parser.add_argument('--config', default=str(Path(__file__).with_name('collector.json')))
    args = parser.parse_args()
    path = Path(args.config)
    try:
        config = json.loads(path.read_text(encoding='utf-8-sig'))
        if not isinstance(config, dict):
            raise ValueError('JSON nesnesi gerekli.')
        def setting(key, default=''):
            return os.environ.get(key, str(config.get(key, default)))
        def pins(key, minimum):
            raw = setting(key)
            if not raw.strip():
                return set()
            parts = raw.split(',')
            if any(not re.fullmatch(r'\s*\d+\s*', p) or not minimum <= int(p) <= 27 for p in parts):
                raise ValueError(key + ' pin listesi geçersiz.')
            return {int(p) for p in parts}
        inputs = pins('SCADA_GPIO_INPUT_PINS', 0) if setting('SCADA_ENABLE_GPIO_INPUTS') == '1' else set()
        outputs = pins('SCADA_GPIO_PINS', 2) if setting('SCADA_ENABLE_GPIO') == '1' else set()
        print('READ_ONLY | master=' + setting('SCADA_WORKER_ID', '(yok)'))
        for key in ('SCADA_WORKER_ID', 'SCADA_ENABLE_GPIO', 'SCADA_GPIO_PINS', 'SCADA_ENABLE_GPIO_INPUTS', 'SCADA_GPIO_INPUT_PINS'):
            print(f'{key} | {setting(key)} | source={"environment" if key in os.environ else "json"}')
        if not inputs and not outputs:
            print('GPIO etkin pin yok.');return 0
        result = subprocess.run(['pinctrl', 'get'], capture_output=True, text=True, check=True, timeout=3)
        for pin, role, mode, level, status in inspect_gpio(result.stdout, inputs, outputs):
            print(f'BCM {pin:2} | {role} | mode={mode} | level={level} | {status}')
        print('NOT_OUTPUT collector henüz komut almamışsa normal olabilir. OK yalnızca pin modudur; terminal bağlantısını veya kesiciyi doğrulamaz.')
        return 1 if inputs & outputs else 0
    except json.JSONDecodeError as error:
        print(f'JSON_ERROR | satır {error.lineno}, sütun {error.colno}');return 2
    except (OSError, ValueError, subprocess.SubprocessError):
        print('CHECK_ERROR | Ayar dosyası/pin listesi veya pinctrl erişimini kontrol et.');return 2


if __name__ == '__main__':
    raise SystemExit(main())
