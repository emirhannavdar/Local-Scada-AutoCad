import argparse
import asyncio
import math
import random
import struct
import time
from dataclasses import dataclass


@dataclass
class RegisterDefinition:
    address: int
    key: str
    name: str
    unit: str
    data_type: str
    word_order: str = "ABCD"
    byte_order: str = "BIG"


REGISTER_MAP = [
    RegisterDefinition(30000, "v_l1n", "Gerilim L1-N", "V", "FLOAT32"),
    RegisterDefinition(30004, "v_l2n", "Gerilim L2-N", "V", "FLOAT32"),
    RegisterDefinition(30008, "v_l3n", "Gerilim L3-N", "V", "FLOAT32"),

    RegisterDefinition(30020, "v_l12", "Gerilim L1-L2", "V", "FLOAT32"),
    RegisterDefinition(30024, "v_l23", "Gerilim L2-L3", "V", "FLOAT32"),
    RegisterDefinition(30028, "v_l31", "Gerilim L3-L1", "V", "FLOAT32"),

    RegisterDefinition(30050, "i_l1", "Akım L1", "A", "FLOAT32"),
    RegisterDefinition(30054, "i_l2", "Akım L2", "A", "FLOAT32"),
    RegisterDefinition(30058, "i_l3", "Akım L3", "A", "FLOAT32"),

    RegisterDefinition(30080, "p_l1", "Aktif Güç L1", "kW", "FLOAT32"),
    RegisterDefinition(30084, "p_l2", "Aktif Güç L2", "kW", "FLOAT32"),
    RegisterDefinition(30088, "p_l3", "Aktif Güç L3", "kW", "FLOAT32"),

    RegisterDefinition(30100, "p_tot", "Aktif Güç Toplam", "kW", "FLOAT32"),

    RegisterDefinition(30120, "q_l1", "Reaktif Güç L1", "kVAr", "FLOAT32"),
    RegisterDefinition(30124, "q_l2", "Reaktif Güç L2", "kVAr", "FLOAT32"),
    RegisterDefinition(30128, "q_l3", "Reaktif Güç L3", "kVAr", "FLOAT32"),

    RegisterDefinition(30140, "q_tot", "Reaktif Güç Toplam", "kVAr", "FLOAT32"),
    RegisterDefinition(30150, "s_tot", "Görünür Güç", "kVA", "FLOAT32"),

    RegisterDefinition(30170, "pf_l1", "Güç Faktörü L1", "", "FLOAT32"),
    RegisterDefinition(30174, "pf_l2", "Güç Faktörü L2", "", "FLOAT32"),
    RegisterDefinition(30178, "pf_l3", "Güç Faktörü L3", "", "FLOAT32"),
    RegisterDefinition(30182, "pf_tot", "Güç Faktörü Toplam", "", "FLOAT32"),

    RegisterDefinition(30200, "freq", "Frekans", "Hz", "FLOAT32"),

    RegisterDefinition(30220, "e_imp", "Aktif Enerji İthal", "kWh", "FLOAT64"),
    RegisterDefinition(30230, "e_exp", "Aktif Enerji İhraç", "kWh", "FLOAT64"),
    RegisterDefinition(30240, "eq_ind", "Reaktif Enerji Endüktif", "kVArh", "FLOAT64"),
    RegisterDefinition(30250, "eq_cap", "Reaktif Enerji Kapasitif", "kVArh", "FLOAT64"),

    RegisterDefinition(30300, "thd_v_l1", "Gerilim THD L1", "%", "FLOAT32"),
    RegisterDefinition(30304, "thd_v_l2", "Gerilim THD L2", "%", "FLOAT32"),
    RegisterDefinition(30308, "thd_v_l3", "Gerilim THD L3", "%", "FLOAT32"),

    RegisterDefinition(30320, "thd_i_l1", "Akım THD L1", "%", "FLOAT32"),
    RegisterDefinition(30324, "thd_i_l2", "Akım THD L2", "%", "FLOAT32"),
    RegisterDefinition(30328, "thd_i_l3", "Akım THD L3", "%", "FLOAT32"),

    RegisterDefinition(30350, "demand", "Demand", "kW", "FLOAT32"),
    RegisterDefinition(30360, "max_demand", "Maksimum Demand", "kW", "FLOAT32"),

    RegisterDefinition(30400, "temperature", "Cihaz Sıcaklığı", "°C", "FLOAT32"),

    RegisterDefinition(30420, "alarm_count", "Alarm Sayacı", "", "UINT16"),
    RegisterDefinition(30425, "status", "Cihaz Durumu", "", "UINT16"),

    RegisterDefinition(30440, "serial", "Seri Numarası", "", "UINT32"),

    RegisterDefinition(30460, "uptime", "Çalışma Süresi", "s", "UINT32"),

    RegisterDefinition(30500, "load_percent", "Yük Oranı", "%", "FLOAT32"),
    RegisterDefinition(30520, "neutral_current", "Nötr Akımı", "A", "FLOAT32"),

    RegisterDefinition(30550, "voltage_unbalance", "Gerilim Dengesizliği", "%", "FLOAT32"),
    RegisterDefinition(30560, "current_unbalance", "Akım Dengesizliği", "%", "FLOAT32"),

    RegisterDefinition(30600, "breaker_status", "Kesici Durumu", "", "UINT16"),
    RegisterDefinition(30610, "remote_mode", "Uzaktan Kontrol", "", "UINT16"),

    RegisterDefinition(30650, "transformer_temp", "Trafo Sıcaklığı", "°C", "FLOAT32"),
    RegisterDefinition(30670, "ambient_temp", "Ortam Sıcaklığı", "°C", "FLOAT32"),

    RegisterDefinition(30700, "frequency_min", "Minimum Frekans", "Hz", "FLOAT32"),
    RegisterDefinition(30704, "frequency_max", "Maksimum Frekans", "Hz", "FLOAT32"),

    RegisterDefinition(30750, "voltage_min", "Minimum Gerilim", "V", "FLOAT32"),
    RegisterDefinition(30754, "voltage_max", "Maksimum Gerilim", "V", "FLOAT32"),

    RegisterDefinition(30800, "power_peak", "Güç Tepe Değeri", "kW", "FLOAT32"),

    RegisterDefinition(30850, "device_error", "Cihaz Hata Kodu", "", "UINT16"),

    RegisterDefinition(30900, "test_counter", "Test Sayacı", "", "UINT32")
]


STAGES = [
    ("kosk", 30600, "breaker_status"),
    ("tm", 30612, "tm_breaker_status"),
    ("trafo", 30614, "trafo_breaker_status"),
    ("dm", 30616, "dm_breaker_status"),
]
SWITCHES = {address: True for _, address, _ in STAGES}
for index, (stage, address, status_key) in enumerate(STAGES):
    if address != 30600:
        REGISTER_MAP.append(RegisterDefinition(address, status_key, stage.upper()+" kesici kontağı", "1", "UINT16"))
    base = 31000 + index * 20
    for offset, suffix, label, unit, kind in [
        (0, "input_voltage", "Giriş gerilimi L1-N", "V", "FLOAT32"),
        (2, "output_voltage", "Çıkış gerilimi L1-N", "V", "FLOAT32"),
        (4, "output_current", "Çıkış akımı L1", "A", "FLOAT32"),
        (6, "output_power", "Çıkış aktif güç toplam", "kW", "FLOAT32"),
        (8, "output_energized", "Çıkışta gerilim var", "1", "UINT16"),
    ]:
        REGISTER_MAP.append(RegisterDefinition(base+offset, stage+"_"+suffix, stage.upper()+" "+label, unit, kind))

REGS = {}
VALUES = {}
BREAKER_CLOSED = True
ACTIVE_ANALYZER = None
BREAKER_ADDRESS = 30600

MIN_ADDRESS = min(item.address for item in REGISTER_MAP)

TYPE_REGISTER_COUNT = {
    "UINT16": 1,
    "INT16": 1,
    "UINT32": 2,
    "INT32": 2,
    "FLOAT32": 2,
    "FLOAT64": 4
}

MAX_ADDRESS = max(
    item.address + TYPE_REGISTER_COUNT[item.data_type] - 1
    for item in REGISTER_MAP
)


def walk(value, step, minimum, maximum):
    value += random.uniform(-step, step)
    return min(max(value, minimum), maximum)


class Analyzer:
    def __init__(self, seed_offset=0):
        random.seed(time.time_ns() + seed_offset)

        self.v = [
            random.uniform(227, 233),
            random.uniform(227, 233),
            random.uniform(227, 233)
        ]

        self.current = random.uniform(60, 170)
        self.pf = random.uniform(0.93, 0.99)
        self.freq = random.uniform(49.97, 50.03)

        self.e_imp = random.uniform(100000, 400000)
        self.e_exp = random.uniform(1000, 30000)
        self.eq_ind = random.uniform(10000, 50000)
        self.eq_cap = random.uniform(1000, 10000)

        self.max_demand = 0.0

        self.temperature = random.uniform(28, 42)
        self.transformer_temp = random.uniform(40, 65)
        self.ambient_temp = random.uniform(18, 35)

        self.alarm_count = 0
        self.serial = random.randint(
            10000000,
            99999999
        )

        self.start_time = time.time()
        self.last = time.time()

        self.frequency_min = self.freq
        self.frequency_max = self.freq

        self.voltage_min = min(self.v)
        self.voltage_max = max(self.v)

        self.power_peak = 0.0

    def step(self):
        now = time.time()
        dt = max(now - self.last, 0)
        self.last = now

        self.v = [
            walk(value, 0.7, 215, 245)
            for value in self.v
        ]

        voltage = [
            value + random.gauss(0, 0.12)
            for value in self.v
        ]

        angle = [
            0,
            -2 * math.pi / 3,
            2 * math.pi / 3
        ]

        phases = [
            (
                voltage[index] * math.cos(angle[index]),
                voltage[index] * math.sin(angle[index])
            )
            for index in range(3)
        ]

        def line_voltage(a, b):
            return math.hypot(
                phases[a][0] - phases[b][0],
                phases[a][1] - phases[b][1]
            )

        v12 = line_voltage(0, 1)
        v23 = line_voltage(1, 2)
        v31 = line_voltage(2, 0)

        self.current = walk(
            self.current,
            5,
            10,
            300
        )

        imbalance = [
            random.uniform(0.92, 1.08)
            for _ in range(3)
        ]

        current = [
            max(
                0,
                self.current * imbalance[index]
                + random.gauss(0, 0.5)
            )
            for index in range(3)
        ]

        self.pf = walk(
            self.pf,
            0.006,
            0.82,
            0.999
        )

        pf_phase = [
            min(
                0.999,
                max(
                    0.80,
                    self.pf + random.gauss(0, 0.008)
                )
            )
            for _ in range(3)
        ]

        source_voltage = list(voltage)
        circuit_live = all(SWITCHES.values())
        if not circuit_live:
            current = [0.0, 0.0, 0.0]
            voltage = [0.0, 0.0, 0.0]
            v12 = v23 = v31 = 0.0

        active_power = [
            voltage[index]
            * current[index]
            * pf_phase[index]
            / 1000
            for index in range(3)
        ]

        reactive_power = [
            voltage[index]
            * current[index]
            * math.sin(
                math.acos(pf_phase[index])
            )
            / 1000
            for index in range(3)
        ]

        p_total = sum(active_power)
        q_total = sum(reactive_power)

        s_total = math.hypot(
            p_total,
            q_total
        )

        pf_total = (
            p_total / s_total
            if s_total > 0
            else 1
        )

        self.freq = walk(
            self.freq,
            0.015,
            49.80,
            50.20
        )

        self.frequency_min = min(
            self.frequency_min,
            self.freq
        )

        self.frequency_max = max(
            self.frequency_max,
            self.freq
        )

        self.voltage_min = min(
            self.voltage_min,
            *voltage
        )

        self.voltage_max = max(
            self.voltage_max,
            *voltage
        )

        self.e_imp += (
            max(p_total, 0)
            * dt
            / 3600
        )

        self.eq_ind += (
            max(q_total, 0)
            * dt
            / 3600
        )

        if circuit_live and random.random() < 0.05:
            self.e_exp += (
                random.uniform(0, 3)
                * dt
                / 3600
            )

        self.eq_cap += (
            (random.uniform(0, 0.1) if circuit_live else 0)
            * dt
            / 3600
        )

        demand = p_total * random.uniform(
            0.92,
            1.04
        )

        self.max_demand = max(
            self.max_demand,
            demand
        )

        self.power_peak = max(
            self.power_peak,
            p_total
        )

        self.temperature = walk(
            self.temperature,
            0.15,
            20,
            75
        )

        self.transformer_temp = walk(
            self.transformer_temp,
            0.2,
            30,
            100
        )

        self.ambient_temp = walk(
            self.ambient_temp,
            0.1,
            5,
            50
        )

        if random.random() < 0.002:
            self.alarm_count += 1

        status = 1
        breaker_status = int(SWITCHES[30600])
        remote_mode = 1
        device_error = 0

        if self.temperature > 70:
            status = 2
            device_error = 101

        load_percent = min(
            100,
            max(
                0,
                p_total / 120 * 100
            )
        )

        voltage_average = (
            sum(voltage) / 3
        )

        current_average = (
            sum(current) / 3
        )

        voltage_unbalance = (
            max(
                abs(value - voltage_average)
                for value in voltage
            )
            / voltage_average
            * 100
            if voltage_average > 0 else 0
        )

        current_unbalance = (
            max(
                abs(value - current_average)
                for value in current
            )
            / current_average
            * 100
            if current_average > 0
            else 0
        )

        neutral_current = abs(
            current[0]
            + current[1]
            - 2 * current[2]
        ) * 0.08

        uptime = int(
            now - self.start_time
        )

        result = {
            "v_l1n": voltage[0],
            "v_l2n": voltage[1],
            "v_l3n": voltage[2],

            "v_l12": v12,
            "v_l23": v23,
            "v_l31": v31,

            "i_l1": current[0],
            "i_l2": current[1],
            "i_l3": current[2],

            "p_l1": active_power[0],
            "p_l2": active_power[1],
            "p_l3": active_power[2],
            "p_tot": p_total,

            "q_l1": reactive_power[0],
            "q_l2": reactive_power[1],
            "q_l3": reactive_power[2],
            "q_tot": q_total,

            "s_tot": s_total,

            "pf_l1": pf_phase[0],
            "pf_l2": pf_phase[1],
            "pf_l3": pf_phase[2],
            "pf_tot": pf_total,

            "freq": self.freq,

            "e_imp": self.e_imp,
            "e_exp": self.e_exp,
            "eq_ind": self.eq_ind,
            "eq_cap": self.eq_cap,

            "thd_v_l1": random.uniform(1, 4),
            "thd_v_l2": random.uniform(1, 4),
            "thd_v_l3": random.uniform(1, 4),

            "thd_i_l1": random.uniform(2, 8),
            "thd_i_l2": random.uniform(2, 8),
            "thd_i_l3": random.uniform(2, 8),

            "demand": demand,
            "max_demand": self.max_demand,

            "temperature": self.temperature,

            "alarm_count": self.alarm_count,
            "status": status,

            "serial": self.serial,

            "uptime": uptime,

            "load_percent": load_percent,
            "neutral_current": neutral_current,

            "voltage_unbalance": voltage_unbalance,
            "current_unbalance": current_unbalance,

            "breaker_status": breaker_status,
            "remote_mode": remote_mode,

            "transformer_temp": self.transformer_temp,
            "ambient_temp": self.ambient_temp,

            "frequency_min": self.frequency_min,
            "frequency_max": self.frequency_max,

            "voltage_min": self.voltage_min,
            "voltage_max": self.voltage_max,

            "power_peak": self.power_peak,

            "device_error": device_error,

            "test_counter": uptime
        }

        input_live = True
        for stage, address, status_key in STAGES:
            output_live = input_live and SWITCHES[address]
            result[status_key] = int(SWITCHES[address])
            result[stage+"_input_voltage"] = source_voltage[0] if input_live else 0.0
            result[stage+"_output_voltage"] = source_voltage[0] if output_live else 0.0
            result[stage+"_output_current"] = current[0]
            result[stage+"_output_power"] = p_total
            result[stage+"_output_energized"] = int(output_live)
            input_live = output_live
        return result


def encode_value(value, data_type):
    if data_type == "UINT16":
        return [
            int(value) & 0xFFFF
        ]

    if data_type == "INT16":
        raw = struct.pack(
            ">h",
            int(value)
        )

    elif data_type == "UINT32":
        raw = struct.pack(
            ">I",
            int(value)
        )

    elif data_type == "INT32":
        raw = struct.pack(
            ">i",
            int(value)
        )

    elif data_type == "FLOAT32":
        raw = struct.pack(
            ">f",
            float(value)
        )

    elif data_type == "FLOAT64":
        raw = struct.pack(
            ">d",
            float(value)
        )

    else:
        raise ValueError(
            f"Desteklenmeyen veri tipi: {data_type}"
        )

    return [
        struct.unpack(
            ">H",
            raw[index:index + 2]
        )[0]
        for index in range(
            0,
            len(raw),
            2
        )
    ]


def apply_word_order(registers, order):
    if order == "ABCD":
        return registers

    if order == "CDAB" and len(registers) == 2:
        return [
            registers[1],
            registers[0]
        ]

    if order == "REVERSE":
        return list(
            reversed(registers)
        )

    return registers


def initialise_register_space(strict=False):
    """strict=False: araliktaki tum adresler 0 ile doldurulur (eski davranis).
    strict=True: yalnizca tanimli registerlar vardir; bosluklar gercek
    cihazlardaki gibi 'gecersiz adres' (istisna 02) dondurur."""

    if strict:
        return

    for address in range(
        MIN_ADDRESS,
        MAX_ADDRESS + 1
    ):
        REGS[address] = 0


def write_registers(values):
    for definition in REGISTER_MAP:
        registers = encode_value(
            values[definition.key],
            definition.data_type
        )

        registers = apply_word_order(
            registers,
            definition.word_order
        )

        for index, value in enumerate(registers):
            REGS[
                definition.address + index
            ] = value

        VALUES[
            definition.key
        ] = values[definition.key]


def exception(function_code, code):
    return bytes([
        function_code | 0x80,
        code
    ])


def process_pdu(pdu):
    global BREAKER_CLOSED
    if not pdu:
        return b""

    function_code = pdu[0]

    if function_code == 6:
        if len(pdu) != 5:
            return exception(function_code, 3)
        address, value = struct.unpack(">HH", pdu[1:5])
        if address not in SWITCHES:
            return exception(function_code, 2)
        if value not in (0, 1):
            return exception(function_code, 3)
        SWITCHES[address] = bool(value)
        BREAKER_CLOSED = SWITCHES[30600]
        if ACTIVE_ANALYZER is not None:
            write_registers(ACTIVE_ANALYZER.step())
        else:
            REGS[address] = value
            key = next(key for _, addr, key in STAGES if addr == address)
            VALUES[key] = value
        print(f"COMMAND | FC06 | PDU={address} | BREAKER={'CLOSED' if value else 'OPEN'}")
        return pdu

    if function_code not in (
        3,
        4
    ):
        return exception(
            function_code,
            1
        )

    if len(pdu) < 5:
        return exception(
            function_code,
            3
        )

    start, count = struct.unpack(
        ">HH",
        pdu[1:5]
    )

    if count < 1 or count > 125:
        return exception(
            function_code,
            3
        )

    addresses = range(
        start,
        start + count
    )

    if any(
        address not in REGS
        for address in addresses
    ):
        return exception(
            function_code,
            2
        )

    data = b"".join(
        struct.pack(
            ">H",
            REGS[address]
        )
        for address in addresses
    )

    return (
        bytes([
            function_code,
            len(data)
        ])
        + data
    )


def make_handler(unit_id, verbose):
    async def handle(
        reader,
        writer
    ):
        peer = writer.get_extra_info(
            "peername"
        )

        print(
            f"CONNECT | {peer}"
        )

        try:
            while True:
                header = await reader.readexactly(
                    7
                )

                transaction_id, protocol_id, length, uid = (
                    struct.unpack(
                        ">HHHB",
                        header
                    )
                )

                pdu = await reader.readexactly(
                    length - 1
                )

                if protocol_id != 0:
                    continue

                if (
                    unit_id != 0
                    and uid != unit_id
                ):
                    response = exception(
                        pdu[0],
                        0x0B
                    )
                else:
                    response = process_pdu(
                        pdu
                    )

                if verbose:
                    print(
                        f"READ | "
                        f"{peer} | "
                        f"UID={uid} | "
                        f"FC={pdu[0]}"
                    )

                packet = struct.pack(
                    ">HHHB",
                    transaction_id,
                    0,
                    len(response) + 1,
                    uid
                ) + response

                writer.write(packet)

                await writer.drain()

        except (
            asyncio.IncompleteReadError,
            ConnectionResetError
        ):
            pass

        finally:
            print(
                f"DISCONNECT | {peer}"
            )

            writer.close()

            try:
                await writer.wait_closed()
            except Exception:
                pass

    return handle


async def updater(
    analyzer,
    interval
):
    while True:
        values = analyzer.step()

        write_registers(
            values
        )

        await asyncio.sleep(
            interval
        )


def print_register_map():
    print()
    print(
        "=" * 105
    )

    print(
        f"{'ADDRESS':<10}"
        f"{'COUNT':<8}"
        f"{'TYPE':<12}"
        f"{'KEY':<25}"
        f"{'NAME':<32}"
        f"{'UNIT'}"
    )

    print(
        "-" * 105
    )

    for definition in REGISTER_MAP:
        print(
            f"{definition.address:<10}"
            f"{TYPE_REGISTER_COUNT[definition.data_type]:<8}"
            f"{definition.data_type:<12}"
            f"{definition.key:<25}"
            f"{definition.name:<32}"
            f"{definition.unit}"
        )

    print(
        "=" * 105
    )


async def print_values(interval):
    while True:
        await asyncio.sleep(
            interval
        )

        print(
            "DATA | "
            f"V={VALUES.get('v_l1n', 0):.2f} V | "
            f"I={VALUES.get('i_l1', 0):.2f} A | "
            f"P={VALUES.get('p_tot', 0):.2f} kW | "
            f"PF={VALUES.get('pf_tot', 0):.3f} | "
            f"F={VALUES.get('freq', 0):.3f} Hz | "
            f"T={VALUES.get('temperature', 0):.1f} C | "
            f"BREAKER={VALUES.get('breaker_status', 0)}"
        )


async def main():
    global ACTIVE_ANALYZER
    parser = argparse.ArgumentParser(
        description="SCADA WATT gelişmiş Modbus TCP simulator"
    )

    parser.add_argument(
        "--host",
        default="127.0.0.1"
    )

    parser.add_argument(
        "--port",
        type=int,
        default=5420
    )

    parser.add_argument(
        "--unit",
        type=int,
        default=1
    )

    parser.add_argument(
        "--interval",
        type=float,
        default=1
    )

    parser.add_argument(
        "--print-every",
        type=float,
        default=5
    )

    parser.add_argument(
        "--verbose",
        action="store_true"
    )

    parser.add_argument(
        "--strict",
        action="store_true",
        help="Tanimsiz adresler istisna 02 dondurur (gercek cihaz davranisi)"
    )

    parser.add_argument(
        "--seed-offset",
        type=int,
        default=0
    )

    args = parser.parse_args()

    initialise_register_space(args.strict)

    analyzer = Analyzer(
        seed_offset=args.seed_offset
    )

    ACTIVE_ANALYZER = analyzer

    write_registers(
        analyzer.step()
    )

    server = await asyncio.start_server(
        make_handler(
            args.unit,
            args.verbose
        ),
        args.host,
        args.port
    )

    print()
    print(
        f"SCADA WATT SIMULATOR | "
        f"{args.host}:{args.port} | "
        f"Unit={args.unit}"
    )

    print(
        f"Register space: "
        f"{MIN_ADDRESS}-{MAX_ADDRESS}"
    )

    print(
        f"Defined measurements: "
        f"{len(REGISTER_MAP)}"
    )

    print_register_map()

    asyncio.create_task(
        updater(
            analyzer,
            args.interval
        )
    )

    if args.print_every > 0:
        asyncio.create_task(
            print_values(
                args.print_every
            )
        )

    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    try:
        asyncio.run(
            main()
        )

    except KeyboardInterrupt:
        print(
            "\nSimulator durduruldu."
        )