"""Persistent BCM outputs. A software level is never physical breaker feedback."""
import os
from pathlib import Path


class GPIOOutputs:
    def __init__(self, worker, pins, factory=None, lock_path='/tmp/scadawatt-gpio.lock'):
        if not worker or not pins:
            raise ValueError('GPIO için master adı ve yerel BCM pin izin listesi gerekli.')
        self.worker, self.pins = worker, set(pins)
        self.outputs = {}
        self.faults = set()
        self.factory = factory
        # A second collector must not reset outputs owned by the first process.
        import fcntl
        self.lock = Path(lock_path).open('a')
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.lock.close()
            raise RuntimeError('GPIO başka collector tarafından kullanılıyor.') from None

    def execute(self, q, device):
        cfg = q['config']
        attempted = False
        pin = cfg.get('gpio_pin')
        try:
            if not device or (q['desired'] != 'open' and (not device.get('aktif', True) or device.get('bakim_modu'))):
                raise ValueError('Atanmış cihaz pasif veya bakımda.')
            if cfg.get('gpio_worker') != self.worker or pin not in self.pins:
                raise ValueError('GPIO bu master veya yerel pin izin listesine ait değil.')
            if q['desired'] not in ('open', 'closed'):
                raise ValueError('Geçersiz çıkış komutu.')
            active_high = cfg.get('gpio_active_high', True)
            current = self.outputs.get(pin)
            if current and current[1] != active_high:
                raise ValueError('Aktif seviye değişti. Önce çıkışı pasif yapıp collector’u yeniden başlat.')
            if current is None:
                if self.factory is None:
                    from gpiozero import OutputDevice
                    self.factory = OutputDevice
                attempted = True
                output = self.factory(pin, active_high=active_high, initial_value=False)
                self.outputs[pin] = (output, active_high)
            output = self.outputs[pin][0]
            attempted = True
            # closed = relay output active; not a claim about a breaker contact.
            output.value = q['desired'] == 'closed'
            active = bool(output.value)
            if active != (q['desired'] == 'closed'):
                raise RuntimeError('GPIO çıkış seviyesi yazılım tarafından doğrulanamadı.')
            self.faults.discard(pin)
            return {'status': 'APPLIED', 'output_active': active,
                    'physical_confirmed': False,
                    'detail': 'GPIO çıkışı aktif.' if active else 'GPIO çıkışı pasif.'}
        except Exception as error:
            if attempted:
                self.faults.add(pin)
            return {'status': 'UNKNOWN' if attempted else 'FAILED',
                    'physical_confirmed': False, 'detail': str(error)[:1000]}

    def snapshot(self):
        rows = []
        for pin in self.pins:
            value = None
            try:
                if pin in self.outputs and pin not in self.faults:
                    value = bool(self.outputs[pin][0].value)
            except Exception:
                self.faults.add(pin)
            rows.append({'pin': pin, 'active': value,
                         'active_high': self.outputs[pin][1] if pin in self.outputs else None})
        return rows

    def close(self):
        for output, _ in self.outputs.values():
            try:
                output.off()
            finally:
                output.close()
        self.outputs.clear()
        self.lock.close()


def configured_outputs(worker):
    if os.getenv('SCADA_ENABLE_GPIO') != '1':
        return None
    if not os.getenv('SCADA_WORKER_ID', '').strip():
        raise ValueError('GPIO için SCADA_WORKER_ID açıkça tanımlanmalı.')
    pins = {int(x) for x in os.getenv('SCADA_GPIO_PINS', '').split(',') if x.strip()}
    if not pins or not pins <= set(range(2, 28)):
        raise ValueError('SCADA_GPIO_PINS BCM 2–27 izin listesi olmalı.')
    return GPIOOutputs(worker, pins)
