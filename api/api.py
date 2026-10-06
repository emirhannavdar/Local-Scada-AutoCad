import os
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

app = FastAPI(
    title="Modbus REST API",
    description="",
    version="1.0.0"
)

install_access_guard(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[x.strip() for x in os.getenv("SCADA_CORS_ORIGINS", "http://127.0.0.1:5500,http://localhost:5500").split(",") if x.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

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
    tags=["tm"]
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




from api.control import router as control_router
app.include_router(control_router,prefix='/api/v1/control',tags=['Kesici komutları'])
from api.auth import router as auth_router
app.include_router(auth_router, prefix='/api/v1/auth', tags=['API oturumu'])

from api.users import router as user_router
from api.workspaces import router as workspace_router
app.include_router(user_router,prefix='/api/v1/users',tags=['Kullanıcılar ve saha yetkileri'])
app.include_router(workspace_router,prefix='/api/v1/workspace',tags=['Paylaşılan saha şemaları'])
