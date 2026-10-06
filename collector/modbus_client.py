from pymodbus.client import (
    ModbusTcpClient,
    ModbusSerialClient
)
from pymodbus.pdu import ExceptionResponse


class ModbusDeviceError(Exception):
    """Cihaz yanit verdi ama istegi reddetti (ornegin 02 = gecersiz adres).
    Baglanti saglam; sorun yalnizca istenen adres araliginda."""

    def __init__(self, message, code=None):
        super().__init__(message)
        self.code = code


class ModbusLinkError(Exception):
    """Cihaza ulasilamadi / yanit gelmedi (baglanti, timeout, unit id)."""


def get_serial_line(
    device,
    serial_lines
):

    serial_id = device.get(
        "seri_hat_id"
    )

    if serial_id is None:
        raise Exception(
            "Cihaz için seri_hat_id tanımlı değil"
        )

    serial_line = next(
        (
            line
            for line in serial_lines
            if line["id"] == serial_id
            and line["aktif"]
        ),
        None
    )

    if serial_line is None:
        raise Exception(
            f"Aktif seri hat bulunamadı: "
            f"{serial_id}"
        )

    return serial_line


def create_client(
    device,
    serial_lines=None
):

    protocol = device[
        "protokol"
    ].upper()

    if protocol == "MODBUS_TCP":

        return ModbusTcpClient(
            host=device["ip"],
            port=device["port"],
            timeout=3,
            retries=0
        )

    if protocol == "MODBUS_RTU":

        if serial_lines is None:
            raise Exception(
                "Seri hat konfigürasyonu yok"
            )

        line = get_serial_line(
            device,
            serial_lines
        )

        parity_map = {
            "NONE": "N",
            "N": "N",
            "EVEN": "E",
            "E": "E",
            "ODD": "O",
            "O": "O"
        }

        parity = parity_map.get(
            str(
                line["parity"]
            ).upper()
        )

        if parity is None:
            raise Exception(
                f"Geçersiz parity: "
                f"{line['parity']}"
            )

        return ModbusSerialClient(
            port=line["port"],
            baudrate=line["baudrate"],
            bytesize=line["databits"],
            stopbits=line["stopbits"],
            parity=parity,
            timeout=3,
            retries=0
        )

    if protocol == "IEC_61850":

        raise Exception(
            "IEC_61850 ayrı protocol "
            "adapterı gerektiriyor"
        )

    raise Exception(
        f"Desteklenmeyen protokol: "
        f"{protocol}"
    )


def read_register_range(
    client,
    device,
    function_code,
    start_address,
    count
):

    if function_code == 3:

        result = client.read_holding_registers(
            address=start_address,
            count=count,
            device_id=device["slave_id"]
        )

    elif function_code == 4:

        result = client.read_input_registers(
            address=start_address,
            count=count,
            device_id=device["slave_id"]
        )

    else:

        raise Exception(
            f"Desteklenmeyen function code: "
            f"{function_code}"
        )

    if isinstance(result, ExceptionResponse):

        raise ModbusDeviceError(
            f"Modbus istisna kodu "
            f"{result.exception_code} "
            f"(adres {start_address}, adet {count})",
            result.exception_code
        )

    if result.isError():

        raise ModbusLinkError(
            f"Modbus okuma hatası: "
            f"{result}"
        )

    return result.registers