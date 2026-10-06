"""ScadaWatt ikinci cihaz: dağınık PDU adresleri, Modbus TCP FC03/FC04 okuma ve FC06 kesici yazma.
Yalnızca Python standart kütüphanesi gerekir. OSTIM dosyasından bağımsızdır.
"""
import argparse
import asyncio
import csv
import math
import random
import struct
import time
from dataclasses import dataclass
from pathlib import Path

@dataclass(frozen=True)
class RegisterDefinition:
    address: int
    key: str
    name: str
    unit: str
    data_type: str

TYPE_REGISTER_COUNT = {"FLOAT32": 2, "FLOAT64": 4, "UINT16": 1, "UINT32": 2}
# Bunlar referans numarası değil, TCP isteğine doğrudan yazılan PDU adresleridir.
REGISTER_MAP = [
    RegisterDefinition(31000, "pv_dc_voltage_a", "PV DC Gerilim A", "V", "FLOAT32"),
    RegisterDefinition(31017, "pv_dc_current_a", "PV DC Akım A", "A", "FLOAT32"),
    RegisterDefinition(31043, "pv_dc_voltage_b", "PV DC Gerilim B", "V", "FLOAT32"),
    RegisterDefinition(31078, "pv_dc_current_b", "PV DC Akım B", "A", "FLOAT32"),
    RegisterDefinition(31094, "pv_dc_power", "PV DC Güç", "kW", "FLOAT32"),
    RegisterDefinition(36000, "grid_voltage_avg", "Şebeke Ortalama Gerilim", "V", "FLOAT32"),
    RegisterDefinition(36019, "grid_current_avg", "Şebeke Ortalama Akım", "A", "FLOAT32"),
    RegisterDefinition(36047, "grid_active_power", "Şebeke Aktif Güç", "kW", "FLOAT32"),
    RegisterDefinition(36068, "grid_reactive_power", "Şebeke Reaktif Güç", "kVAr", "FLOAT32"),
    RegisterDefinition(36083, "grid_frequency", "Şebeke Frekansı", "Hz", "FLOAT32"),
    RegisterDefinition(42000, "solar_irradiance", "Güneş Işınımı", "W/m²", "FLOAT32"),
    RegisterDefinition(42027, "panel_temperature", "Panel Sıcaklığı", "°C", "FLOAT32"),
    RegisterDefinition(42045, "inverter_temperature", "İnverter İç Sıcaklığı", "°C", "FLOAT32"),
    RegisterDefinition(42061, "inverter_efficiency", "İnverter Verimi", "%", "FLOAT32"),
    RegisterDefinition(42100, "generation_energy", "Üretim Enerjisi", "kWh", "FLOAT64"),
    RegisterDefinition(48000, "grid_breaker", "Şebeke Kesici Durumu", "", "UINT16"),
    RegisterDefinition(48013, "inverter_running", "İnverter Çalışma Durumu", "", "UINT16"),
    RegisterDefinition(48039, "fault_code", "İnverter Arıza Kodu", "", "UINT16"),
    RegisterDefinition(48063, "cooling_fan_speed", "Soğutma Fanı Hızı", "rpm", "UINT16"),
    RegisterDefinition(55000, "device_runtime", "İkinci Cihaz Çalışma Süresi", "s", "UINT32"),
    RegisterDefinition(55021, "update_sequence", "Ölçüm Güncelleme Sayacı", "", "UINT32"),
]
# Dahil uçlar. Blok içindeki boş adresler 0; bloklar arası boşluk geçersiz.
BLOCKS = [(31000, 31095), (36000, 36084), (42000, 42103),
          (48000, 48064), (55000, 55022)]
REGS = {}
VALUES = {}

def initialise_register_space(strict=False):
    REGS.clear()
    VALUES.clear()
    if not strict:
        for start, end in BLOCKS:
            REGS.update((address, 0) for address in range(start, end + 1))

def encode_value(value, data_type):
    fmt = {"FLOAT32": ">f", "FLOAT64": ">d", "UINT16": ">H", "UINT32": ">I"}[data_type]
    raw = struct.pack(fmt, float(value) if data_type.startswith("FLOAT") else int(value))
    return list(struct.unpack(">" + "H" * (len(raw) // 2), raw))

def write_registers(values):
    # Bir güncelleme await içermez: istemciler yarım Float32/Float64 okumaz.
    for definition in REGISTER_MAP:
        words = encode_value(values[definition.key], definition.data_type)
        for offset, word in enumerate(words):
            REGS[definition.address + offset] = word
    VALUES.update(values)

class Analyzer:
    def __init__(self, seed=None):
        self.rng = random.Random(seed)
        self.started = self.last = time.monotonic()
        self.energy = 8750.0
        self.sequence = 0

    def step(self, breaker=1):
        now = time.monotonic()
        dt = max(0, now - self.last)
        self.last = now
        elapsed = now - self.started
        irradiance = 680 + 120 * math.sin(elapsed / 35) + self.rng.uniform(-8, 8)
        va = 645 + self.rng.uniform(-4, 4)
        vb = 662 + self.rng.uniform(-4, 4)
        ia = irradiance / 12 if breaker else 0
        ib = irradiance / 13 if breaker else 0
        dc = (va * ia + vb * ib) / 1000
        efficiency = 97.2 + self.rng.uniform(-.3, .3)
        p = dc * efficiency / 100
        q = p * .12
        voltage = 231 + self.rng.uniform(-1.5, 1.5)
        current = math.hypot(p, q) * 1000 / (3 * voltage)
        self.energy += p * dt / 3600
        self.sequence = (self.sequence + 1) & 0xFFFFFFFF
        return dict(
            pv_dc_voltage_a=va, pv_dc_current_a=ia,
            pv_dc_voltage_b=vb, pv_dc_current_b=ib, pv_dc_power=dc,
            grid_voltage_avg=voltage, grid_current_avg=current,
            grid_active_power=p, grid_reactive_power=q,
            grid_frequency=50 + self.rng.uniform(-.025, .025),
            solar_irradiance=irradiance, panel_temperature=25 + irradiance * .032,
            inverter_temperature=32 + dc * .22 + 1.5 * math.sin(elapsed / 60) + self.rng.uniform(-.15, .15),
            inverter_efficiency=efficiency, generation_energy=self.energy,
            grid_breaker=breaker, inverter_running=breaker, fault_code=0,
            cooling_fan_speed=1450 if breaker else 0,
            device_runtime=int(elapsed) & 0xFFFFFFFF, update_sequence=self.sequence)

def exception(fc, code):
    return bytes([fc | 0x80, code])

BREAKER_STATE = 1

def process_pdu(pdu):
    global BREAKER_STATE
    if not pdu:
        return b""
    fc = pdu[0]
    if fc == 6:
        if len(pdu) != 5: return exception(fc, 3)
        address, value = struct.unpack(">HH", pdu[1:])
        if address != 48000: return exception(fc, 2)
        if value not in (0, 1): return exception(fc, 3)
        BREAKER_STATE = value
        REGS[48000] = value
        return pdu
    if fc not in (3, 4):
        return exception(fc, 1)
    if len(pdu) != 5:
        return exception(fc, 3)
    start, count = struct.unpack(">HH", pdu[1:])
    if not 1 <= count <= 125:
        return exception(fc, 3)
    if start + count > 65536 or any(a not in REGS for a in range(start, start + count)):
        return exception(fc, 2)
    data = b"".join(struct.pack(">H", REGS[a]) for a in range(start, start + count))
    return bytes([fc, len(data)]) + data

def make_handler(unit_id, verbose=False):
    async def handle(reader, writer):
        peer = writer.get_extra_info("peername")
        if verbose:
            print(f"CONNECT | {peer}", flush=True)
        try:
            while True:
                header = await reader.readexactly(7)
                transaction, protocol, length, uid = struct.unpack(">HHHB", header)
                if protocol != 0 or not 2 <= length <= 254:
                    break
                pdu = await reader.readexactly(length - 1)
                response = exception(pdu[0], 11) if uid != unit_id else process_pdu(pdu)
                writer.write(struct.pack(">HHHB", transaction, 0, len(response) + 1, uid) + response)
                await writer.drain()
                if verbose:
                    request = struct.unpack(">HH", pdu[1:]) if len(pdu) == 5 else ("?", "?")
                    result = f"EXCEPTION {response[1]}" if response[0] & 0x80 else "OK"
                    print(f"READ | {peer} | Unit={uid} FC={pdu[0]:02d} "
                          f"Adres={request[0]} Adet={request[1]} | {result}", flush=True)
        except (asyncio.IncompleteReadError, ConnectionError):
            pass
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except ConnectionError:
                pass
            if verbose:
                print(f"DISCONNECT | {peer}", flush=True)
    return handle

def print_register_map():
    print("ADDRESS COUNT TYPE     KEY                      NAME / UNIT")
    for d in REGISTER_MAP:
        print(f"{d.address:<7} {TYPE_REGISTER_COUNT[d.data_type]:<5} {d.data_type:<8} "
              f"{d.key:<24} {d.name} [{d.unit}]")
    print("Word order=ABCD, byte order=BIG, çarpan=1; FC03 ve FC04 aynı veriyi verir.")

def export_map(path):
    with Path(path).open("w", newline="", encoding="utf-8-sig") as file:
        writer = csv.writer(file, delimiter=";")
        writer.writerow(["register_adresi", "register_sayisi", "veri_tipi", "sinyal_adi",
                         "aciklama", "birim", "function_code", "word_order", "byte_order", "olcek"])
        for d in REGISTER_MAP:
            writer.writerow([d.address, TYPE_REGISTER_COUNT[d.data_type], d.data_type,
                             d.key, d.name, d.unit, 3, "ABCD", "BIG", 1])

def self_test():
    occupied = set()
    values = Analyzer(seed=42).step()
    initialise_register_space()
    write_registers(values)
    for d in REGISTER_MAP:
        span = set(range(d.address, d.address + TYPE_REGISTER_COUNT[d.data_type]))
        assert not occupied.intersection(span), d.key
        assert not span.intersection(range(30000, 30902)), d.key
        occupied.update(span)
        for fc in (3, 4):
            response = process_pdu(struct.pack(">BHH", fc, d.address, len(span)))
            expected = b"".join(struct.pack(">H", w) for w in encode_value(values[d.key], d.data_type))
            assert response == bytes([fc, len(expected)]) + expected, d.key
    for start, end in BLOCKS:
        assert len(process_pdu(struct.pack(">BHH", 3, start, end-start+1))) == 2+2*(end-start+1)
    assert process_pdu(struct.pack(">BHH", 3, 32000, 2)) == b"\x83\x02"
    assert process_pdu(struct.pack(">BHH", 4, 31094, 3)) == b"\x84\x02"
    assert process_pdu(struct.pack(">BHH", 3, 31000, 126)) == b"\x83\x03"
    assert process_pdu(b"\x06") == b"\x86\x01"
    initialise_register_space(strict=True)
    write_registers(values)
    assert process_pdu(struct.pack(">BHH", 3, 31002, 1)) == b"\x83\x02"
    zero = Analyzer(seed=42).step(breaker=0)
    assert zero["grid_active_power"] == zero["grid_current_avg"] == zero["grid_breaker"] == 0
    print(f"SELF-TEST OK | {len(REGISTER_MAP)} ölçüm, FC03/FC04, 5 blok, adres boşlukları, veri tipleri, kesici açık")

async def run(args):
    global BREAKER_STATE
    BREAKER_STATE = args.breaker
    initialise_register_space(args.strict)
    analyzer = Analyzer(args.seed)
    write_registers(analyzer.step(BREAKER_STATE))
    server = await asyncio.start_server(make_handler(args.unit, args.verbose), args.host, args.port)
    print(f"SCADAWATT DAGINIK REGISTER SIMULATOR | {args.host}:{args.port} | Unit={args.unit}")
    print("Bloklar:", ", ".join(f"{a}-{b}" for a, b in BLOCKS))
    print_register_map()
    print("KONTROL | FC06 PDU 48000 | 0=AC 1=KAPAT | durum FC03/04 PDU 48000", flush=True)
    async def update():
        last_print = time.monotonic()
        while True:
            await asyncio.sleep(args.interval)
            write_registers(analyzer.step(BREAKER_STATE))
            if args.print_every > 0 and time.monotonic() - last_print >= args.print_every:
                last_print = time.monotonic()
                print(f"DATA | P={VALUES['grid_active_power']:.2f} kW | "
                      f"I={VALUES['grid_current_avg']:.2f} A | "
                      f"DC={VALUES['pv_dc_power']:.2f} kW | "
                      f"T={VALUES['inverter_temperature']:.2f} C | "
                      f"ENERGY={VALUES['generation_energy']:.4f} kWh | "
                      f"SEQ={VALUES['update_sequence']}", flush=True)
    task = asyncio.create_task(update())
    try:
        async with server:
            await server.serve_forever()
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5421)
    parser.add_argument("--unit", type=int, default=1)
    parser.add_argument("--interval", type=float, default=1)
    parser.add_argument("--print-every", type=float, default=5)
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--strict", action="store_true", help="Blok içi boşlukları da geçersiz adres say")
    parser.add_argument("--breaker", type=int, choices=(0, 1), default=1, help="1=iletimde, 0=açık / güç sıfır")
    parser.add_argument("--seed", type=int, help="Tekrarlanabilir rastgele değerler")
    parser.add_argument("--export-map", metavar="CSV", help="Haritayı CSV'ye yazıp çık")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    if args.export_map:
        export_map(args.export_map)
        return
    if not 1 <= args.port <= 65535 or not 1 <= args.unit <= 247:
        parser.error("Port 1–65535, Unit 1–247 aralığında olmalı.")
    if not math.isfinite(args.interval) or args.interval <= 0:
        parser.error("Interval pozitif ve sonlu olmalı.")
    if not math.isfinite(args.print_every) or args.print_every < 0:
        parser.error("Print-every sıfır veya pozitif ve sonlu olmalı.")
    try:
        asyncio.run(run(args))
    except KeyboardInterrupt:
        print("\nİkinci simülatör durduruldu.")
    except OSError as error:
        parser.exit(1, f"Dinleme başlatılamadı ({args.host}:{args.port}): {error}\n")

if __name__ == "__main__":
    main()
