from datetime import datetime, timezone, timedelta
from typing import Generic, TypeVar, Literal

from fastapi import APIRouter, HTTPException
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field, model_validator, ConfigDict

from database.database import get_connection


measurement = APIRouter()

T = TypeVar("T")


class RestApiMeasurement(BaseModel, Generic[T]):
    success: bool
    data: T | None = None
    dateTime: datetime = Field(default_factory=datetime.now)
    errorCode: int = 0
    message: str = ""

    @classmethod
    def ok(cls, data: T):
        return cls(
            success=True,
            data=data,
            message="İşlem başarılı"
        )

    @classmethod
    def error(cls, errorCode: int, message: str):
        return cls(
            success=False,
            data=None,
            errorCode=errorCode,
            message=message
        )


class ScadaMeasurement(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    tag_id: int = Field(gt=0)
    protocol_meta: dict | None = None
    sampled_at: datetime | None = None
    deger: float | None = None
    deger_text: str | None = None
    kalite: Literal["GOOD", "STALE", "BAD", "COMM_FAIL", "SUBSTITUTED", "NOT_CONFIGURED"] = "GOOD"

    @model_validator(mode="after")
    def require_good_value(self):
        if self.sampled_at is not None:
            now = datetime.now(timezone.utc)
            if self.sampled_at.tzinfo is None or self.sampled_at > now + timedelta(minutes=5):
                raise ValueError('sampled_at saat dilimi içermeli ve gelecek zaman olmamalı.')
        if self.kalite in ("GOOD", "SUBSTITUTED") and self.deger is None and self.deger_text is None:
            raise ValueError("GOOD/SUBSTITUTED olcum bir sayisal veya metin degeri icermeli")
        return self

def _aware(value):
    """UI zaman damgasini yalnizca saat dilimi (offset) iceriyorsa kabul eder.
    DB sutunu 'timestamp without time zone' ise offset'siz gelir ve tum
    olcumler 'eski' gorunur; burada yerel saat dilimi eklenir."""
    if isinstance(value, datetime) and value.tzinfo is None:
        return value.astimezone()
    return value


def getLiveMeasurements(
    device_id: int | None = None,
    site_id: int | None = None
):
    connection = get_connection()

    try:
        cursor = connection.cursor()

        query = """
            SELECT
                oa.tag_id,
                t.cihaz_id,
                c.ad AS cihaz_adi,
                t.sinyal_adi,
                t.tag_adi,
                t.birim,
                oa.deger,
                oa.deger_text,
                oa.kalite,
                oa.zaman,
                oa.updated_at
            FROM olcum_anlik oa
            INNER JOIN tag t
                ON t.id = oa.tag_id
            INNER JOIN cihaz c
                ON c.id = t.cihaz_id
            WHERE t.aktif = TRUE
              AND c.aktif = TRUE
        """

        params = []

        if device_id is not None:
            query += """
                AND c.id = %s
            """
            params.append(device_id)

        if site_id is not None:
            query += """
                AND c.ust_dugum_tipi = 'SAHA'
                AND c.ust_dugum_id = %s
            """
            params.append(site_id)

        query += """
            ORDER BY
                c.id,
                t.id
        """

        cursor.execute(
            query,
            tuple(params)
        )

        rows = cursor.fetchall()

        return [
            {
                "tag_id": row[0],
                "device_id": row[1],
                "device_name": row[2],
                "signal_name": row[3],
                "tag_name": row[4],
                "unit": row[5],
                "value": (
                    float(row[6])
                    if row[6] is not None
                    else None
                ),
                "value_text": row[7],
                "quality": row[8],
                "timestamp": _aware(row[9]),
                "updated_at": _aware(row[10])
            }
            for row in rows
        ]

    finally:
        connection.close()

def postMeasurement(raw: ScadaMeasurement):
    from api.telemetry_store import store
    store([raw])
    return raw.model_dump()

def postMeasurementsBatch(rows: list[ScadaMeasurement]):
    from api.telemetry_store import store
    return store(rows)

@measurement.get("")
def Measurements(
    device_id: int | None = None,
    site_id: int | None = None
):
    try:
        data = getLiveMeasurements(
            device_id=device_id,
            site_id=site_id
        )

        return RestApiMeasurement(
            success=True,
            data=data,
            message="İşlem başarılı"
        )

    except Exception as e:
        return RestApiMeasurement(
            success=False,
            errorCode=500,
            message=str(e)
        )

@measurement.post('/batch')
def create_measurement_batch(rows: list[ScadaMeasurement]):

    try:
        data = postMeasurementsBatch(rows)

        return RestApiMeasurement.ok(data)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=jsonable_encoder(
                RestApiMeasurement.error(
                    500,
                    f"Toplu ölçüm kaydedilirken hata oluştu: {str(e)}"
                )
            )
        )

@measurement.post('')
def create_measurement(raw: ScadaMeasurement):

    try:
        data = postMeasurement(raw)

        return RestApiMeasurement.ok(data)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=jsonable_encoder(
                RestApiMeasurement.error(
                    500,
                    f"Ölçüm kaydedilirken hata oluştu: {str(e)}"
                )
            )
        )
