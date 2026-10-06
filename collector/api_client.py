import os

import requests


API_BASE_URL: str = os.getenv(
    "SCADA_API_URL",
    "http://127.0.0.1:8000/api/v1"
)

def _headers():
    token = os.getenv("SCADA_API_TOKEN", "").strip()
    return {"Authorization": f"Bearer {token}"} if token else {}


def _get(url, **kwargs):
    return requests.get(url, headers=_headers(), **kwargs)


def _post(url, **kwargs):
    return requests.post(url, headers=_headers(), **kwargs)


TIMEOUT = float(
    os.getenv(
        "SCADA_API_TIMEOUT",
        "10"
    )
)


def get_data(path):

    response = _get(
        f"{API_BASE_URL}/{path}",
        timeout=TIMEOUT
    )

    response.raise_for_status()

    result = response.json()

    if not result.get("success"):
        # Existing collection endpoints return success=false/errorCode=404
        # for an empty table. A genuinely missing HTTP endpoint still fails
        # at raise_for_status() above.
        if result.get("errorCode") == 404 and result.get("data") is None:
            return []
        raise Exception(
            result.get(
                "message",
                "API isteği başarısız"
            )
        )

    return result["data"]


def get_devices():
    return get_data("device")


def get_read_groups():
    return get_data("readGroup")


def get_registers():
    return get_data("register")


def get_tags():
    return get_data("tag")

def get_serial_lines():
    return get_data("serialLine")

def post_measurement(
    tag_id,
    value=None,
    value_text=None,
    quality="GOOD"
):

    data = {
        "tag_id": tag_id,
        "deger": value,
        "deger_text": value_text,
        "kalite": quality
    }

    response = _post(
        f"{API_BASE_URL}/measurement",
        json=data,
        timeout=TIMEOUT
    )

    response.raise_for_status()

    result = response.json()

    if not result.get("success"):
        raise Exception(
            result.get(
                "message",
                "Measurement kaydedilemedi"
            )
        )

    return result


_BATCH_SUPPORTED = True


def post_data(path, body):

    response = _post(
        f"{API_BASE_URL}/{path}",
        json=body,
        timeout=TIMEOUT
    )

    if response.status_code >= 400:
        try:
            detail = response.json().get("detail")
        except Exception:
            detail = response.text[:300]

        raise Exception(
            f"HTTP {response.status_code} /{path}: {detail}"
        )

    result = response.json()

    if not result.get("success"):
        raise Exception(
            result.get(
                "message",
                f"/{path} isteği başarısız"
            )
        )

    return result.get("data")


def post_measurements(rows):
    """rows: [{tag_id, deger, deger_text, kalite}, ...]

    Tek HTTP istegiyle toplu yazim. Eski API (batch endpoint'i yok)
    ile calisirken tek tek yazima doner."""

    global _BATCH_SUPPORTED

    if not rows:
        return 0

    if _BATCH_SUPPORTED:

        response = _post(
            f"{API_BASE_URL}/measurement/batch",
            json=rows,
            timeout=TIMEOUT
        )

        if response.status_code in (404, 405):
            _BATCH_SUPPORTED = False
            print(
                "API | /measurement/batch yok; tek tek yazima "
                "geciliyor (API'yi yeniden baslat)"
            )

        else:
            response.raise_for_status()

            result = response.json()

            if not result.get("success"):
                raise Exception(
                    result.get(
                        "message",
                        "Toplu ölçüm kaydedilemedi"
                    )
                )

            return len(rows)

    for row in rows:
        post_measurement(
            tag_id=row["tag_id"],
            value=row.get("deger"),
            value_text=row.get("deger_text"),
            quality=row.get("kalite", "GOOD")
        )

    return len(rows)


def get_signals():
    return get_data("signalDict")


def get_profile_registers():
    return get_data("profile_register")
