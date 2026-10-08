from datetime import datetime
from typing import TypeVar, Generic, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field
from database.database import get_connection
# Psycopg kütüphanesinden spesifik veritabanı hatalarını yakalamak için ekledik
import psycopg

device = APIRouter()

T = TypeVar("T")


class RestApiDevices(BaseModel, Generic[T]):
    success: bool
    data: Optional[T] = None
    dateTime: datetime = Field(default_factory=datetime.now)
    errorCode: Optional[int] = None
    message: Optional[str] = None

    @classmethod
    def ok(cls, data: T, message: Optional[str]):
        return cls(success=True, data=data, message=message)

    @classmethod
    def error(cls, message: str, code: Optional[int] = None):
        return cls(success=False, data=None, errorCode=code, message=message)


class ScadaDevice(BaseModel):
    ust_dugum_tipi: str
    ust_dugum_id: int
    name: str
    profil_id: int
    profil_surum: str
    protokol: str
    ip: str | None = None
    port: int | None = None
    slave_id: int | None = None
    seri_hat_id: int | None = None
    aktif: bool = True
    bakim_modu: bool = False
    durum: str = "UNKNOWN"

class ScadaDevicePatch(BaseModel):
    ust_dugum_tipi: str | None = None
    ust_dugum_id: int | None = None
    name: str | None = None
    profil_id: int | None = None
    profil_surum: str | None = None
    protokol: str | None = None
    ip: str | None = None
    port: int | None = None
    slave_id: int | None = None
    seri_hat_id: int | None = None
    aktif: bool | None = None
    bakim_modu: bool | None = None
    durum: str | None = None

def postDevice(raw: ScadaDevice):
    with get_connection() as connection:
        try:
            cursor = connection.cursor()

            cursor.execute(
                """
                INSERT INTO cihaz (ust_dugum_tipi,
                                   ust_dugum_id,
                                   ad,
                                   profil_id,
                                   profil_surum,
                                   protokol,
                                   ip,
                                   port,
                                   slave_id,
                                   seri_hat_id,
                                   aktif,
                                   bakim_modu,
                                   durum)
                VALUES (%s, %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s, %s) RETURNING id;
                """,
                (
                    raw.ust_dugum_tipi,
                    raw.ust_dugum_id,
                    raw.name,
                    raw.profil_id,
                    raw.profil_surum,
                    raw.protokol,
                    raw.ip,
                    raw.port,
                    raw.slave_id,
                    raw.seri_hat_id,
                    raw.aktif,
                    raw.bakim_modu,
                    raw.durum
                )
            )

            device_id = cursor.fetchone()[0]
            connection.commit()
            return device_id

        except Exception:
            connection.rollback()
            raise


def getDevice():
    connection = get_connection()
    try:
        cursor = connection.cursor()
        cursor.execute(
            """
            SELECT id,
                   ust_dugum_tipi,
                   ust_dugum_id,
                   ad,
                   profil_id,
                   profil_surum,
                   protokol,
                   ip,
                   port,
                   slave_id,
                   seri_hat_id,
                   aktif,
                   bakim_modu,
                   durum

            FROM cihaz
            ORDER BY id;
            """
        )

        rows = cursor.fetchall()
        columns = [desc[0] for desc in cursor.description]
        result = [dict(zip(columns, row)) for row in rows]

        cursor.execute("SELECT to_regclass('scada_iec104_config')")
        if cursor.fetchone()[0] is not None:
            cursor.execute('SELECT device_id,config FROM scada_iec104_config')
            overlays={did:cfg for did,cfg in cursor.fetchall() if cfg['enabled']}
            for row in result:
                cfg=overlays.get(row.get('id'))
                row['effective_protocol']='IEC104' if cfg else row['protokol']
                if cfg:row.update(effective_ip=cfg['host'],effective_port=cfg['port'])
        return result

    finally:
        connection.close()


def getDeviceId(id):
    connection = get_connection()
    try:
        cursor = connection.cursor()
        cursor.execute(
            """
            SELECT ust_dugum_tipi,
                   ust_dugum_id,
                   ad,
                   profil_id,
                   profil_surum,
                   protokol,
                   ip,
                   port,
                   slave_id,
                   seri_hat_id,
                   aktif,
                   bakim_modu,
                   durum
            FROM cihaz
            WHERE id = %s
            ORDER BY id;
            """, (id,)
        )
        rows = cursor.fetchall()
        columns = [desc[0] for desc in cursor.description]
        result = [dict(zip(columns, row)) for row in rows]

        return result
    finally:
        connection.close()


def putDevice(id, raw):
    connection = get_connection()
    try:
        cursor = connection.cursor()
        cursor.execute(
            """
            UPDATE cihaz
            SET ust_dugum_tipi = %s,
                ust_dugum_id   = %s,
                ad             = %s,
                profil_id      = %s,
                profil_surum   = %s,
                protokol       = %s,
                ip             = %s,
                port           = %s,
                slave_id       = %s,
                seri_hat_id    = %s,
                aktif          = %s,
                bakim_modu     = %s,
                durum          = %s
            WHERE id = %s RETURNING id;
            """, (raw.ust_dugum_tipi,
                  raw.ust_dugum_id,
                  raw.name,
                  raw.profil_id,
                  raw.profil_surum,
                  raw.protokol,
                  raw.ip,
                  raw.port,
                  raw.slave_id,
                  raw.seri_hat_id,
                  raw.aktif,
                  raw.bakim_modu,
                  raw.durum,
                  id
                  )
        )
        connection.commit()
        rows = cursor.fetchall()
        columns = [desc[0] for desc in cursor.description]
        result = [dict(zip(columns, row)) for row in rows]
        return result
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def delDevice(id):
    connection = get_connection()
    try:
        cursor = connection.cursor()
        kontrol = getDeviceId(id)

        if not kontrol:
            error_res = RestApiDevices.error(f"Cihaz silinirken hata oluştu: Cihaz bulunamadı", 404)
            raise HTTPException(status_code=404, detail=jsonable_encoder(error_res))

        cursor.execute(
            """
            DELETE
            FROM cihaz
            WHERE id = %s
            """, (id,)
        )

        connection.commit()

        return {
            "success": True
        }

    finally:
        connection.close()


def patchDevice(id: int, raw: ScadaDevicePatch):
    update_data = raw.model_dump(exclude_unset=True)

    if not update_data:
        return id

    if "name" in update_data:
        update_data["ad"] = update_data.pop("name")

    connection = get_connection()
    try:
        cursor = connection.cursor()

        set_clauses = [f"{key} = %s" for key in update_data.keys()]
        values = list(update_data.values())

        query = f"""
            UPDATE cihaz
            SET {', '.join(set_clauses)}
            WHERE id = %s
            RETURNING id;
        """
        values.append(id)

        cursor.execute(query, tuple(values))
        connection.commit()

        row = cursor.fetchone()
        return row[0] if row else None

    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()

@device.get('')
def get_device():
    try:
        data = getDevice()
        if not data:
            return RestApiDevices.error(message="Cihaz bulunamadı", code=404)
        return RestApiDevices.ok(data=data, message="BASARILI")
    except Exception as e:
        error_res = RestApiDevices.error(f"Sistem hatası: {str(e)}", 500)
        raise HTTPException(status_code=500, detail=jsonable_encoder(error_res))


@device.get('/{id}')
def get_device_id(id: int):
    try:
        data = getDeviceId(id)
        if not data:
            return RestApiDevices.error(message="Cihaz bulunamadı", code=404)
        return RestApiDevices.ok(data=data, message="BASARILI")
    except Exception as e:
        error_res = RestApiDevices.error(f"Sistem hatası: {str(e)}", 500)
        raise HTTPException(status_code=500, detail=jsonable_encoder(error_res))


@device.post('')
def create_device(raw: ScadaDevice):
    try:
        data = postDevice(raw)
        return RestApiDevices.ok(data=data, message="BASARILI")

    except psycopg.errors.InvalidTextRepresentation as e:
        # Veritabanındaki ENUM uyumsuzluk hatasını burada yakalıyoruz.
        error_res = RestApiDevices.error(
            message=f"Geçersiz veri formatı veya ENUM değeri: {e.diag.message_primary}",
            code=400
        )
        raise HTTPException(status_code=400, detail=jsonable_encoder(error_res))

    except Exception as e:
        # Genel beklenmeyen diğer hatalar için
        error_res = RestApiDevices.error(message=f"Cihaz kaydedilirken beklenmeyen bir hata oluştu: {str(e)}", code=500)
        raise HTTPException(status_code=500, detail=jsonable_encoder(error_res))


@device.put('/{id}')
def updateDm(id: int, raw: ScadaDevice, request: Request):
    try:
        device_up = putDevice(id, raw)

        if not device_up:
            error_res = RestApiDevices.error(f"{id} numaralı cihaz güncellenemedi veya bulunamadı.", 404)
            raise HTTPException(status_code=404, detail=jsonable_encoder(error_res))

        return RestApiDevices.ok(data=device_up, message="BASARILI")

    except psycopg.errors.InvalidTextRepresentation as e:
        error_res = RestApiDevices.error(
            message=f"Güncelleme sırasında geçersiz veri formatı/ENUM hatası: {e.diag.message_primary}",
            code=400
        )
        raise HTTPException(status_code=400, detail=jsonable_encoder(error_res))
    except Exception as e:
        error_res = RestApiDevices.error(f"Cihaz güncellenirken hata oluştu: {str(e)}", 500)
        raise HTTPException(status_code=500, detail=jsonable_encoder(error_res))


@device.delete('/{id}')
def delete_dm(id: int):
    try:
        dele = delDevice(id)
        return RestApiDevices.ok(data=dele, message="BASARILI")

    except HTTPException as http_ex:
        # delDevice içinden fırlatılan kontrollü 404/500 hatalarını bozmadan ilet
        raise http_ex
    except Exception as e:
        error_res = RestApiDevices.error(f"Cihaz silinirken hata oluştu: {str(e)}", 500)
        raise HTTPException(status_code=500, detail=jsonable_encoder(error_res))


@device.patch('/{id}')
def patch_device(id: int, raw: ScadaDevicePatch):
    try:
        updated_id = patchDevice(id, raw)

        if not updated_id:
            error_res = RestApiDevices.error(message=f"{id} numaralı cihaz bulunamadı veya güncellenemedi.", code=404)
            raise HTTPException(status_code=404, detail=jsonable_encoder(error_res))

        return RestApiDevices.ok(data=updated_id, message="BASARILI")

    except psycopg.errors.InvalidTextRepresentation as e:
        # PATCH isteğinde de geçersiz ENUM veya veri tipi gönderilirse yakalar
        error_res = RestApiDevices.error(
            message=f"Güncelleme sırasında geçersiz veri formatı veya ENUM hatası: {e.diag.message_primary}",
            code=400
        )
        raise HTTPException(status_code=400, detail=jsonable_encoder(error_res))

    except Exception as e:
        error_res = RestApiDevices.error(message=f"Cihaz güncellenirken beklenmeyen bir hata oluştu: {str(e)}",
                                         code=500)
        raise HTTPException(status_code=500, detail=jsonable_encoder(error_res))