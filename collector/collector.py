import asyncio
import json
import math
import os
import time
from datetime import datetime, timezone
from collector.runtime_config import assigned_devices

from collector.api_client import (
    get_devices,
    get_read_groups,
    get_registers,
    get_tags,
    get_serial_lines,
    get_signals,
    post_data,
    post_measurements
)

from collector.modbus_client import (
    create_client,
    read_register_range,
    ModbusDeviceError,
    ModbusLinkError
)

from collector.decoder import (
    decode_register
)


CONFIG_REFRESH_SECONDS = float(
    os.getenv(
        "SCADA_CONFIG_REFRESH",
        "5"
    )
)

# Iki register arasindaki bosluk bu degerden kucukse tek blokta okunur.
# Buyuk bosluklar (tanimsiz adresler) gercek cihazlarda "gecersiz adres"
# hatasi verir; bu yuzden bloklar bosluklarda bolunur.
MAX_GAP = int(
    os.getenv(
        "SCADA_MAX_GAP",
        "8"
    )
)

# Tag'i olmayan aktif registerlar icin otomatik tag olusturur.
AUTO_TAG = os.getenv(
    "SCADA_AUTO_TAG",
    "1"
) != "0"

# Basarisiz olan bir blogu (kismen gecersiz adres) kac saniyede bir
# tekrar bir bütün olarak denemeye calisir.
BLOCK_RETRY_SECONDS = float(
    os.getenv(
        "SCADA_BLOCK_RETRY",
        "60"
    )
)

SUMMARY_SECONDS = float(
    os.getenv(
        "SCADA_SUMMARY_SECONDS",
        "30"
    )
)


# ---------------------------------------------------------------------------
# Yardimcilar
# ---------------------------------------------------------------------------

_log_times = {}


def log_limited(key, message, seconds=None):
    """Ayni mesaji her dongude basma; key basina en fazla periyodik yaz."""

    seconds = SUMMARY_SECONDS if seconds is None else seconds

    now = time.monotonic()

    if now - _log_times.get(key, -1e9) >= seconds:
        _log_times[key] = now
        print(message)


def is_active(row):
    return row.get("aktif", True) not in (False, 0)


def index_tags(tags):
    """register_id -> [aktif tag]"""

    result = {}

    for tag in tags:

        if not is_active(tag):
            continue

        result.setdefault(
            tag["register_id"],
            []
        ).append(tag)

    return result


def get_register_tags(
    register,
    tags
):

    return [
        tag
        for tag in tags
        if tag["aktif"]
        and tag["cihaz_id"]
        == register["cihaz_id"]
        and tag["register_id"]
        == register["id"]
    ]


def get_group_registers(
    device,
    group,
    registers
):

    result = []

    for register in registers:

        if not register["aktif"]:
            continue

        if (
            register["cihaz_id"]
            != device["id"]
        ):
            continue

        if (
            register["okuma_grubu_id"]
            != group["id"]
        ):
            continue

        if (
            register["function_code"]
            != group["function_code"]
        ):
            print(
                f"CONFIG_ERROR | "
                f"{device['ad']} | "
                f"{register['name']} | "
                f"register FC="
                f"{register['function_code']} | "
                f"group FC="
                f"{group['function_code']}"
            )

            continue

        result.append(register)

    return result


def create_read_blocks(
    registers,
    maximum_register,
    max_gap=MAX_GAP
):

    registers = sorted(
        registers,
        key=lambda item:
        item["baslangic_adresi"]
    )

    blocks = []
    current = []
    current_end = None

    for register in registers:

        register_start = (
            register["baslangic_adresi"]
        )

        register_end = (
            register_start
            + register["register_sayisi"]
            - 1
        )

        if (
            register["register_sayisi"]
            > maximum_register
        ):
            print(
                f"CONFIG_ERROR | "
                f"{register['name']} | "
                f"register_sayisi="
                f"{register['register_sayisi']} "
                f"> maximum="
                f"{maximum_register}"
            )

            continue

        if not current:
            current = [register]
            current_end = register_end
            continue

        block_start = (
            current[0][
                "baslangic_adresi"
            ]
        )

        gap = register_start - current_end - 1

        count = (
            max(register_end, current_end)
            - block_start
            + 1
        )

        if (
            count <= maximum_register
            and gap <= max_gap
        ):
            current.append(register)
            current_end = max(
                current_end,
                register_end
            )

        else:
            blocks.append(current)
            current = [register]
            current_end = register_end

    if current:
        blocks.append(current)

    return blocks


def get_block_range(block):

    start = min(
        item["baslangic_adresi"]
        for item in block
    )

    end = max(
        item["baslangic_adresi"]
        + item["register_sayisi"]
        - 1
        for item in block
    )

    return (
        start,
        end - start + 1
    )


# ---------------------------------------------------------------------------
# Olcum uretimi
# ---------------------------------------------------------------------------

def make_row(tag, value=None, text=None, quality="GOOD"):

    return {
        "tag_id": tag["id"],
        "sampled_at": datetime.now(timezone.utc).isoformat(),
        "deger": value,
        "deger_text": text,
        "kalite": quality
    }


def rows_for_register(register, register_tags, raw, device):
    """Tek registerin ham verisini cozer; cikti: olcum satirlari + durum."""

    try:

        value = decode_register(
            raw,
            register
        )

    except Exception as e:

        log_limited(
            ("decode", device["id"], register["id"]),
            f"BAD | "
            f"{device['ad']} | "
            f"{register['name']} | "
            f"{e}"
        )

        return [
            make_row(tag, quality="BAD")
            for tag in register_tags
        ], False

    if isinstance(value, str):

        measurement_value = None
        measurement_text = value

    elif isinstance(value, bool):

        measurement_value = 1 if value else 0
        measurement_text = None

    else:

        measurement_value = value
        measurement_text = None

    # NaN / Infinity cihazlarda "veri yok" anlamina gelir (ornegin
    # 0x7FC00000). API bunu reddeder ve butun batch'i dusurur.
    if (
        isinstance(measurement_value, float)
        and not math.isfinite(measurement_value)
    ):

        return [
            make_row(tag, quality="BAD")
            for tag in register_tags
        ], False

    return [
        make_row(
            tag,
            measurement_value,
            measurement_text,
            "GOOD"
        )
        for tag in register_tags
    ], True


def decode_block(
    device,
    block,
    tag_index,
    raw_registers,
    block_start
):

    rows = []
    good = 0
    bad = 0

    for register in block:

        register_tags = tag_index.get(
            register["id"],
            []
        )

        if not register_tags:
            continue

        offset = (
            register["baslangic_adresi"]
            - block_start
        )

        count = register["register_sayisi"]

        raw = raw_registers[
            offset:
            offset + count
        ]

        if len(raw) != count:

            rows.extend(
                make_row(tag, quality="BAD")
                for tag in register_tags
            )

            bad += 1
            continue

        register_rows, ok = rows_for_register(
            register,
            register_tags,
            raw,
            device
        )

        rows.extend(register_rows)

        if ok:
            good += 1
        else:
            bad += 1

    return rows, good, bad


def read_block(
    client,
    device,
    group,
    block,
    tag_index,
    split_blocks
):
    """Bir blogu okur.

    Cihaz blogun tamamini reddederse (gecersiz adres) blok tek tek
    registerlara bolunur; boylece tek bir kotu adres tum blogu
    COMM_FAIL yapmaz.

    ModbusLinkError (baglanti sorunu) yukari firlatilir.
    """

    start, count = get_block_range(block)

    key = (
        group["id"],
        start,
        count
    )

    function_code = group["function_code"]

    failed_at = split_blocks.get(key)

    use_split = (
        failed_at is not None
        and time.monotonic() - failed_at
        < BLOCK_RETRY_SECONDS
    )

    if not use_split:

        try:

            raw = read_register_range(
                client,
                device,
                function_code,
                start,
                count
            )

            split_blocks.pop(key, None)

            return decode_block(
                device,
                block,
                tag_index,
                raw,
                start
            )

        except ModbusDeviceError as e:

            if key not in split_blocks:
                print(
                    f"SPLIT | "
                    f"{device['ad']} | "
                    f"{group['name']} | "
                    f"PDU {start}+{count} | "
                    f"{e} | registerlar tek tek okunacak"
                )

            split_blocks[key] = time.monotonic()

    rows = []
    good = 0
    bad = 0

    for register in block:

        register_tags = tag_index.get(
            register["id"],
            []
        )

        if not register_tags:
            continue

        try:

            raw = read_register_range(
                client,
                device,
                function_code,
                register["baslangic_adresi"],
                register["register_sayisi"]
            )

        except ModbusDeviceError as e:

            log_limited(
                ("read", device["id"], register["id"]),
                f"BAD | "
                f"{device['ad']} | "
                f"{register['name']} | "
                f"PDU {register['baslangic_adresi']} | "
                f"{e}"
            )

            rows.extend(
                make_row(tag, quality="BAD")
                for tag in register_tags
            )

            bad += 1
            continue

        register_rows, ok = rows_for_register(
            register,
            register_tags,
            raw,
            device
        )

        rows.extend(register_rows)

        if ok:
            good += 1
        else:
            bad += 1

    return rows, good, bad


def flush(rows):
    if not rows:
        return
    from collector.telemetry import submit
    # SQLite errors/full disk are raised; unpersisted measurements are not acknowledged.
    submit(rows)


def comm_fail_rows(tag_index, registers, exclude=()):

    rows = []

    for register in registers:

        for tag in tag_index.get(
            register["id"],
            []
        ):

            if tag["id"] in exclude:
                continue

            rows.append(
                make_row(
                    tag,
                    quality="COMM_FAIL"
                )
            )

    return rows


def send_quality(
    device,
    registers,
    tags,
    quality
):
    """Geriye donuk uyumluluk icin korundu."""

    tag_index = index_tags(tags)

    rows = []

    for register in registers:
        for tag in tag_index.get(register["id"], []):
            rows.append(make_row(tag, quality=quality))

    flush(rows)


async def read_group_loop(
    device,
    group,
    registers,
    tags,
    serial_lines
):

    group_registers = (
        get_group_registers(
            device,
            group,
            registers
        )
    )

    if not group_registers:

        print(
            f"CONFIG | "
            f"{device['ad']} | "
            f"{group['name']} | "
            f"aktif register yok"
        )

        return

    maximum_register = min(
        group["maksimum_register"] or 125,
        125
    )

    blocks = create_read_blocks(
        group_registers,
        maximum_register
    )

    if not blocks:
        return

    tag_index = index_tags(tags)

    tagged = sum(
        1
        for register in group_registers
        if register["id"] in tag_index
    )

    period = max(
        group["okuma_periyodu_ms"]
        / 1000,
        0.1
    )

    print(
        f"START | "
        f"{device['ad']} | "
        f"{group['name']} | "
        f"{period}s | "
        f"{len(blocks)} block | "
        f"{len(group_registers)} register | "
        f"{tagged} tag'li register"
    )

    if tagged < len(group_registers):

        print(
            f"UYARI | "
            f"{device['ad']} | "
            f"{group['name']} | "
            f"{len(group_registers) - tagged} registerin aktif "
            f"tag'i yok; bu registerlar yazilmaz "
            f"(SCADA_AUTO_TAG=1 ile otomatik olusturulur)"
        )

    split_blocks = {}
    last_summary = 0.0
    last_state = None

    while True:

        cycle_start = (
            asyncio.get_running_loop()
            .time()
        )

        client = None

        rows = []
        done_tags = set()
        good = 0
        bad = 0
        link_error = None

        try:

            client = create_client(
                device,
                serial_lines
            )

            connected = (
                await asyncio.to_thread(
                    client.connect
                )
            )

            if not connected:

                raise ModbusLinkError(
                    "Modbus bağlantısı "
                    "kurulamadı"
                )

            for block in blocks:

                block_rows, block_good, block_bad = (
                    await asyncio.to_thread(
                        read_block,
                        client,
                        device,
                        group,
                        block,
                        tag_index,
                        split_blocks
                    )
                )

                rows.extend(block_rows)
                good += block_good
                bad += block_bad

                done_tags.update(
                    row["tag_id"]
                    for row in block_rows
                )

        except asyncio.CancelledError:
            raise

        except Exception as e:

            link_error = e

        finally:

            if client is not None:

                try:
                    client.close()
                except Exception:
                    pass

        if link_error is not None:

            # Baglanti sorunu: okunamayan butun tag'ler COMM_FAIL.
            rows.extend(
                comm_fail_rows(
                    tag_index,
                    group_registers,
                    exclude=done_tags
                )
            )

            state = f"COMM_FAIL:{link_error}"

        else:

            state = f"OK:{bad > 0}"

        from collector.telemetry import group_cycle
        group_cycle(device['id'], group['id'], good, bad, link_error is not None,
                    asyncio.get_running_loop().time()-cycle_start)

        # Durum degistiginde veya periyodik olarak ozet yaz.
        now = time.monotonic()

        if (
            state != last_state
            or now - last_summary >= SUMMARY_SECONDS
        ):

            if link_error is not None:

                print(
                    f"COMM_FAIL | "
                    f"{device['ad']} | "
                    f"{group['name']} | "
                    f"{link_error}"
                )

            else:

                print(
                    f"CYCLE | "
                    f"{device['ad']} | "
                    f"{group['name']} | "
                    f"good_register={good} "
                    f"bad_register={bad} "
                    f"olcum={len(rows)}"
                )

            last_summary = now
            last_state = state

        await asyncio.to_thread(
            flush,
            rows
        )

        elapsed = (
            asyncio.get_running_loop()
            .time()
            - cycle_start
        )

        sleep_time = max(
            period - elapsed,
            0
        )

        await asyncio.sleep(
            sleep_time
        )


# ---------------------------------------------------------------------------
# Otomatik tag
# ---------------------------------------------------------------------------

_auto_tag_failed = set()
_auto_tag_warned = False

TAG_TEMPLATE_FIELDS = (
    "tip",
    "okuma_sinifi",
    "arsiv_kurali",
    "alarm_sinifi",
    "deadband",
    "olcek"
)


def ensure_tags(
    devices,
    registers,
    tags,
    signals=None
):
    """Aktif ama tag'i olmayan registerlar icin tag olusturur.

    Enum alanlari (tip, okuma_sinifi, arsiv_kurali, alarm_sinifi) icin
    veritabanindaki mevcut bir tag sablon alinir; deger tahmin edilmez.
    Registerin pasif tag'i varsa kullanici bilerek kapatmistir, dokunulmaz.
    """

    global _auto_tag_warned

    active_devices = {
        device["id"]: device
        for device in devices
        if is_active(device)
        and not device.get("bakim_modu")
    }

    has_any_tag = {}

    for tag in tags:
        has_any_tag[tag["register_id"]] = True

    missing = [
        register
        for register in registers
        if is_active(register)
        and register["cihaz_id"] in active_devices
        and register["id"] not in has_any_tag
        and register["id"] not in _auto_tag_failed
    ]

    if not missing:
        return 0

    if not tags:

        if not _auto_tag_warned:

            print(
                "AUTO_TAG | Sablon olarak kullanilacak hic tag yok; "
                "tip / okuma_sinifi / arsiv_kurali / alarm_sinifi "
                "degerleri tahmin edilmez. Arayuzden en az bir tag'i "
                "elle olustur, ardindan collector otomatik devam eder."
            )

            _auto_tag_warned = True

        return 0

    signal_names = {
        signal["id"]: signal.get("sinyal_adi")
        for signal in (signals or [])
    }

    created = 0

    for register in missing:

        template = next(
            (
                tag
                for tag in tags
                if tag["cihaz_id"]
                == register["cihaz_id"]
            ),
            tags[0]
        )

        signal_name = (
            signal_names.get(
                register["sinyal_sozlugu_id"]
            )
            or register["name"]
        )

        base_tag_name = (
            f"device_{register['cihaz_id']}"
            f"_pr{register['profil_register_id']}"
            f"_{signal_name}"
        )

        same_name = next(
            (
                tag
                for tag in tags
                if tag["cihaz_id"] == register["cihaz_id"]
                and tag["tag_adi"] == base_tag_name
            ),
            None
        )

        if same_name and same_name.get("register_id") != register["id"]:
            tag_name = f"{base_tag_name}_r{register['id']}"
        else:
            tag_name = base_tag_name

        body = {
            "cihaz_id": register["cihaz_id"],
            "sinyal_sozlugu_id":
                register["sinyal_sozlugu_id"],
            "profil_register_id":
                register["profil_register_id"],
            "sinyal_adi": signal_name,
            "tag_adi": tag_name,
            "birim": register.get("birim") or "",
            "aktif": True,
            "register_id": register["id"]
        }

        for field in TAG_TEMPLATE_FIELDS:
            body[field] = template.get(field)

        try:

            post_data("tag", body)

            created += 1

            print(
                f"AUTO_TAG | olusturuldu | "
                f"{active_devices[register['cihaz_id']]['ad']} | "
                f"{tag_name}"
            )

        except Exception as e:

            log_limited(
                ("auto_tag", register["id"]),
                f"AUTO_TAG | HATA | register #{register['id']} | {e}"
            )

    return created


# ---------------------------------------------------------------------------
# Konfigurasyon
# ---------------------------------------------------------------------------

def build_task_configs(
    devices,
    groups,
    registers,
    tags,
    serial_lines
):

    configs = {}

    for device in devices:

        if not device["aktif"]:
            continue

        if device["bakim_modu"]:
            continue

        for group in groups:

            if not group["aktif"]:
                continue

            if (
                group["cihaz_id"]
                != device["id"]
            ):
                continue

            group_registers = [
                register
                for register in registers
                if register["cihaz_id"]
                == device["id"]
                and register[
                    "okuma_grubu_id"
                ]
                == group["id"]
                and register["aktif"]
            ]

            group_register_ids = {
                register["id"]
                for register
                in group_registers
            }

            group_tags = [
                tag
                for tag in tags
                if tag["cihaz_id"]
                == device["id"]
                and tag["register_id"]
                in group_register_ids
                and tag["aktif"]
            ]

            key = (
                device["id"],
                group["id"]
            )

            fingerprint = json.dumps(
                {
                    "device": device,
                    "group": group,
                    "registers":
                        group_registers,
                    "tags": group_tags,
                    "serial_lines": serial_lines
                },
                sort_keys=True,
                default=str
            )

            configs[key] = {
                "device": device,
                "group": group,
                "registers":
                    group_registers,
                "tags": group_tags,
                "fingerprint":
                    fingerprint,
                "serial_lines": serial_lines,
            }

    return configs


async def get_configuration():

    devices = await asyncio.to_thread(
        get_devices
    )

    devices = assigned_devices(devices)
    from collector.api_client import get_data
    try:
        iec_configs = await asyncio.to_thread(get_data, "iec104/config")
    except Exception as error:
        if getattr(getattr(error, "response", None), "status_code", None) not in (404,503):raise
        iec_configs=[]
    iec_ids={c["device_id"] for c in iec_configs if c["enabled"]}
    devices=[d for d in devices if d["id"] not in iec_ids]

    groups = await asyncio.to_thread(
        get_read_groups
    )

    registers = await asyncio.to_thread(
        get_registers
    )

    tags = await asyncio.to_thread(
        get_tags
    )

    if AUTO_TAG:

        try:

            signals = []

            has_missing = any(
                is_active(register)
                and register["id"] not in {
                    tag["register_id"]
                    for tag in tags
                }
                and register["id"]
                not in _auto_tag_failed
                for register in registers
            )

            if has_missing:

                signals = await asyncio.to_thread(
                    get_signals
                )

            created = await asyncio.to_thread(
                ensure_tags,
                devices,
                registers,
                tags,
                signals
            )

            if created:

                tags = await asyncio.to_thread(
                    get_tags
                )

        except Exception as e:

            print(
                f"AUTO_TAG | HATA | {e}"
            )

    has_rtu_device = any(
        device["aktif"]
        and device["protokol"] == "MODBUS_RTU"
        for device in devices
    )

    if has_rtu_device:

        serial_lines = await asyncio.to_thread(
            get_serial_lines
        )

    else:

        serial_lines = []

    return build_task_configs(
        devices,
        groups,
        registers,
        tags,
        serial_lines
    )


async def stop_task(task):

    task.cancel()

    try:
        await task

    except asyncio.CancelledError:
        pass


async def main():

    from collector.command_worker import command_loop
    command_task = asyncio.create_task(command_loop())
    from collector.gpio_inputs import input_loop
    input_task = asyncio.create_task(input_loop())

    print(
        "SCADA Collector başlatıldı"
    )

    from collector.telemetry import outbox, delivery_loop, health_loop, configuration
    delivery_task = asyncio.create_task(delivery_loop())
    health_task = asyncio.create_task(health_loop())
    from collector.iec104 import supervisor as iec104_supervisor
    iec104_task=asyncio.create_task(iec104_supervisor())
    running = {}
    last_config_ok = time.monotonic()
    cache_max_age = float(os.getenv('SCADA_CACHE_MAX_AGE', '86400'))

    while True:

        for background_task in (delivery_task, health_task, iec104_task):
            if background_task.done() and not background_task.cancelled():
                raise background_task.exception() or RuntimeError('Collector arka plan görevi durdu.')
        if input_task.done() and input_task.exception():
            raise input_task.exception()
        if command_task.done() and command_task.exception():
            raise command_task.exception()

        try:

            configs = (
                await get_configuration()
            )

            await asyncio.to_thread(outbox().save_cache, configs)
            last_config_ok = time.monotonic()
            configuration(configs, stale=False)
            desired_keys = set(
                configs.keys()
            )

            running_keys = set(
                running.keys()
            )

            removed = (
                running_keys
                - desired_keys
            )

            for key in removed:

                await stop_task(
                    running[key]["task"]
                )

                del running[key]

                print(
                    f"STOP | "
                    f"device={key[0]} | "
                    f"group={key[1]}"
                )

            for key, config in (
                configs.items()
            ):

                existing = running.get(
                    key
                )

                crashed = (
                    existing is not None
                    and existing["task"].done()
                    and not existing["task"].cancelled()
                    and existing["task"].exception()
                    is not None
                )

                if crashed:
                    print(
                        f"TASK_CRASH | "
                        f"device={key[0]} | "
                        f"group={key[1]} | "
                        f"{existing['task'].exception()}"
                    )

                if (
                    existing
                    and not crashed
                    and existing[
                        "fingerprint"
                    ]
                    == config[
                        "fingerprint"
                    ]
                ):
                    continue

                if existing:

                    await stop_task(
                        existing["task"]
                    )

                    print(
                        f"RELOAD | "
                        f"device={key[0]} | "
                        f"group={key[1]}"
                    )

                task = asyncio.create_task(
                    read_group_loop(
                        config["device"],
                        config["group"],
                        config["registers"],
                        config["tags"],
                        config["serial_lines"]
                    )
                )

                running[key] = {
                    "task": task,
                    "fingerprint":
                        config[
                            "fingerprint"
                        ]
                }

        except Exception as e:

            log_limited('config-api', f"CONFIG_API_ERROR | {type(e).__name__} | son doğrulanmış yapılandırma kullanılıyor", 30)
            configuration(stale=True)
            if not running:
                cached = await asyncio.to_thread(outbox().load_cache, cache_max_age)
                if cached:
                    last_config_ok = time.monotonic()-outbox().cache_age()
                    for key, config in cached.items():
                        task = asyncio.create_task(read_group_loop(config['device'],config['group'],config['registers'],config['tags'],config['serial_lines']))
                        running[key]={'task':task,'fingerprint':config['fingerprint']}
                    print('CONFIG_CACHE | son doğrulanmış yapılandırma yüklendi')
            elif time.monotonic()-last_config_ok > cache_max_age:
                for record in running.values():await stop_task(record['task'])
                running.clear()
                configuration({},stale=True)
                print('CONFIG_CACHE_EXPIRED | okuma durduruldu')

        await asyncio.sleep(
            CONFIG_REFRESH_SECONDS
        )


if __name__ == "__main__":

    try:
        asyncio.run(main())

    except KeyboardInterrupt:
        print(
            "SCADA Collector durduruldu"
        )
