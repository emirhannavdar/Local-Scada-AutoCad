import logging
import time

from fastapi.middleware.cors import CORSMiddleware

from fastapi import FastAPI, Request
from datetime import datetime
from api.saha import saha
from api.dm import dm
from api.tm import tm
from api.trafo import trafo
from api.adp import adp
from api.cihaz import device
from api.cihaz_profili import device_profile
from api.profile_register import profile_register
from api.sinyal_sozlugu import signalDict
from api.okuma_grubu import readGroup
from api.register import register
from api.tag import tag
from api.measurement import measurement
from api.serialLine import serialLine
from api.site import site
from api.ui_metadata import ui_metadata
from api.access_guard import install_access_guard
from api.auth import router as auth_router
from api.control import router as control_router
from api.users import router as user_router
from api.workspaces import router as workspace_router
from html import escape
from fastapi.responses import HTMLResponse

app = FastAPI(
    title="Modbus REST API",
    description="",
    version="1.0.0"
)

install_access_guard(app)



logging.basicConfig(
    filename="accsess.log",
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    datefmt="%d-%b-%y %H:%M:%S"
)
logger = logging.getLogger("Modbus REST API")

@app.middleware("http")
async def log_requests(request: Request, call_next):
    start_time = time.time()
    dateTime = time.time()
    response = await call_next(request)
    duration = (time.time() - start_time) * 1000

    process_time_str = f"{duration:.2f}ms"
    process_time = datetime.fromtimestamp(dateTime).strftime('%Y-%m-%d %H:%M:%S')

    log_message = f"{response.status_code} - {process_time_str} - {process_time}"

    logger.info(log_message)

    if 200 <= response.status_code < 300:
        logger.info(log_message)
    else:
        logger.error(log_message)
    return response

app.include_router(
    auth_router,
    prefix='/api/v1/auth',
    tags=['API oturumu']
)

app.include_router(
    user_router,
    prefix='/api/v1/users',
    tags=['Kullanıcılar ve saha yetkileri']
)

app.include_router(
    control_router,
    prefix='/api/v1/control',
    tags=['Kesici komutları']
)



app.include_router(
    workspace_router,
    prefix='/api/v1/workspace',
    tags=['Paylaşılan saha şemaları']
)


app.include_router(
    saha,
    prefix="/api/v1/saha",
    tags=["Saha"]
)

app.include_router(
    dm,
    prefix="/api/v1/dm",
    tags=["dm"]
)

app.include_router(
    tm,
    prefix="/api/v1/tm",
    tags=["tm"],
)

app.include_router(
    trafo,
    prefix="/api/v1/trafo",
    tags=["trafo"]
)

app.include_router(
    adp,
    prefix="/api/v1/adp",
    tags=["adp"]
)

app.include_router(
    device,
    prefix="/api/v1/device",
    tags=["device"]
)

app.include_router(
    device_profile,
    prefix="/api/v1/device_profile",
    tags=["device_profile"]
)

app.include_router(
    profile_register,
    prefix="/api/v1/profile_register",
    tags=["profile_register"]
)

app.include_router(
    signalDict,
    prefix="/api/v1/signalDict",
    tags=["signalDict"]
)

app.include_router(
    readGroup,
    prefix="/api/v1/readGroup",
    tags=["readGroup"]
)

app.include_router(
    register,
    prefix="/api/v1/register",
    tags=["register"]
)

app.include_router(
    tag,
    prefix="/api/v1/tag",
    tags=["tag"]
)

app.include_router(
    measurement,
    prefix="/api/v1/measurement",
    tags=["measurement"]
)

app.include_router(
    serialLine,
    prefix="/api/v1/serialLine",
    tags=["serialLine"]
)

app.include_router(
    site,
    prefix="/api/v1/site",
    tags=["site"]
)

app.include_router(
    ui_metadata,
    prefix="/api/v1/ui",
    tags=["Arayüz seçenekleri"]
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def scadawatt_error_page(request: Request, call_next):
    response = await call_next(request)

    # Yalnızca tarayıcıda açılan gerçek 404 yanıtlarını dönüştür.
    accept = request.headers.get("accept", "")
    if (
        response.status_code != 404
        or request.method != "GET"
        or "text/html" not in accept
    ):
        return response

    path = escape(request.url.path)

    return HTMLResponse(
        status_code=404,
        headers={"Cache-Control": "no-store"},
        content=f"""
            <!DOCTYPE html>
            <html lang="tr">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1">
              <title>Sayfa bulunamadı · ScadaWatt</title>
              <style>
                * {{ box-sizing: border-box; }}
                body {{
                  margin: 0;
                  min-height: 100vh;
                  background: #091713;
                  color: #e6f4ef;
                  font-family: "Segoe UI", sans-serif;
                }}
                header {{
                  padding: 22px 32px;
                  border-bottom: 1px solid #203e32;
                  color: #50ddb0;
                  font-weight: 700;
                  letter-spacing: 2px;
                }}
                main {{
                  min-height: calc(100vh - 72px);
                  display: grid;
                  place-items: center;
                  padding: 32px 20px;
                }}
                article {{ width: 100%; max-width: 580px; }}
                .label {{
                  color: #50ddb0;
                  font-size: 12px;
                  letter-spacing: 3px;
                }}
                .code {{
                  margin: 12px 0;
                  font-size: clamp(90px, 20vw, 150px);
                  font-weight: 800;
                  line-height: 1;
                  color: #50ddb0;
                }}
                h1 {{ margin: 24px 0 12px; font-size: 28px; }}
                p {{ color: #a8bfb4; line-height: 1.7; }}
                .path {{
                  margin: 24px 0;
                  padding: 14px 18px;
                  background: #10271e;
                  border: 1px solid #254638;
                  border-radius: 12px;
                  overflow-wrap: anywhere;
                  color: #b8d8c9;
                  font-family: monospace;
                }}
                button {{
                  padding: 13px 22px;
                  border: none;
                  border-radius: 10px;
                  background: #50ddb0;
                  color: #09251a;
                  font-weight: 700;
                  cursor: pointer;
                }}
                button:hover {{ background: #79e9c4; }}
                button:focus-visible {{ outline: 3px solid white; outline-offset: 4px; }}
              </style>
            </head>
            <body>
              <header>ScadaWatt</header>
              <main>
                <article>
                  <div class="label">SAYFA BULUNAMADI</div>
                  <div class="code" aria-hidden="true">404</div>
                  <h1>Bu adreste bir sayfa bulunamadı.</h1>
                  <p>Adres değişmiş veya yanlış yazılmış olabilir.
                     Adresi kontrol et ya da önceki sayfaya dön.</p>
                  <div class="path">{path}</div>
                  <button onclick="history.back()">← Önceki sayfaya dön</button>
                </article>
              </main>
            </body>
            </html>
            """,
    )


from api.gpio_inputs import router as gpio_input_router
app.include_router(gpio_input_router,prefix="/api/v1/gpio-inputs",tags=["Dijital GPIO girişleri"])

from api.operations import router as operations_router
app.include_router(operations_router, prefix="/api/v1/operations", tags=["Geçmiş, alarm ve işletme"])

from api.iec104 import router as iec104_router
app.include_router(iec104_router,prefix='/api/v1/iec104',tags=['IEC 104'])
