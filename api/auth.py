"""Single administrator bootstrap and ten-day signed API sessions."""
import base64
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from ipaddress import ip_address
from urllib.parse import urlsplit
from contextlib import contextmanager
import psycopg
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

SESSION_SECONDS = 10 * 24 * 60 * 60

router = APIRouter()
_attempts = {}
_lock = threading.Lock()

@contextmanager
def account_cursor():
    from database.database import get_connection
    try:
        with get_connection() as db, db.cursor() as cursor:
            yield cursor
    except psycopg.errors.UndefinedTable:
        raise HTTPException(503, 'Hesap tablosu eksik. SCADA veritabanında sql/002_auth.sql ve sql/003_users_workspaces.sql dosyalarını çalıştır.') from None
    except psycopg.Error:
        raise HTTPException(503, 'Hesap veritabanına ulaşılamadı. PostgreSQL bağlantısını ve API veritabanı yetkilerini kontrol et.') from None

class Credentials(BaseModel):
    username: str = Field(min_length=3, max_length=80, pattern=r'^[a-zA-Z0-9_.@-]+$')
    password: str = Field(min_length=12, max_length=128)

def encode(value):
    return base64.urlsafe_b64encode(value).decode().rstrip('=')

def issue_token(username, key, now=None, role="root", version=1, user_id=None):
    now = int(time.time() if now is None else now)
    payload = encode(json.dumps({'sub': username, 'uid': user_id, 'role': role, 'ver': version, 'iat': now,
                                'exp': now + SESSION_SECONDS, 'aud': 'scadawatt-api'}, separators=(',', ':')).encode())
    header = encode(b'{"alg":"HS256","typ":"JWT"}')
    unsigned = header + '.' + payload
    return unsigned + '.' + encode(hmac.new(key.encode(), unsigned.encode(), hashlib.sha256).digest())

def session_claims(token, key, now=None):
    try:
        header, payload, signature = token.split('.')
        unsigned = header + '.' + payload
        if not key or not hmac.compare_digest(signature, encode(hmac.new(key.encode(), unsigned.encode(), hashlib.sha256).digest())):
            return None
        head = json.loads(base64.urlsafe_b64decode(header + '=' * (-len(header) % 4)))
        body = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
        now = time.time() if now is None else now
        if head.get('alg') != 'HS256' or body.get('aud') != 'scadawatt-api' or body.get('role') not in ('admin','root','operator','viewer'):
            return None
        return body if body['iat'] <= now < body['exp'] and body.get('sub') else None
    except (ValueError, KeyError, TypeError):
        return None

def session_role(token,key,now=None):
    claims=session_claims(token,key,now)
    return ('admin' if claims['role'] in ('root','admin') else claims['role']) if claims else None

def password_hash(password, salt):
    return hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 600000).hex()

def local_setup_request(request):
    try:
        if not request.client or not ip_address(request.client.host).is_loopback:
            return False
    except ValueError:
        return False
    if request.url.hostname not in ('localhost', '127.0.0.1', '::1'):
        return False
    if any(h in request.headers for h in ('forwarded', 'x-forwarded-for', 'x-forwarded-host')):
        return False
    origin = request.headers.get('origin')
    if not origin:
        return True
    if urlsplit(origin).hostname not in ('localhost', '127.0.0.1', '::1'):
        return False
    allowed = set(os.getenv('SCADA_CORS_ORIGINS', 'http://localhost:5500,http://127.0.0.1:5500').split(','))
    allowed = {x.strip().rstrip('/') for x in allowed}
    allowed.add(str(request.base_url).rstrip('/'))
    return origin.rstrip('/') in allowed

@router.get('/status')
def setup_status(request: Request, response: Response):
    response.headers['Cache-Control'] = 'no-store'
    with account_cursor() as cursor:
        cursor.execute('SELECT EXISTS(SELECT 1 FROM scada_user)')
        exists = cursor.fetchone()[0]
    return {'success': True, 'data': {'account_exists': exists, 'setup_allowed': not exists and local_setup_request(request)}}

@router.post('/bootstrap')
def bootstrap(body: Credentials, request: Request, response: Response):
    if getattr(request.state, 'scada_role', None) not in ('admin','root') and not local_setup_request(request):
        raise HTTPException(403, 'İlk hesabı API bilgisayarında http://127.0.0.1:5500 arayüzünü açarak oluştur. Uzaktan anonim yönetici kaydı kapalıdır.')
    if not os.getenv('SCADA_ADMIN_TOKEN') or not os.getenv('SCADA_COLLECTOR_TOKEN'):
        raise HTTPException(503, 'Önce API sunucusunda iki ayrı güvenlik tokenını tanımla.')
    salt = secrets.token_bytes(32)
    hashed = password_hash(body.password, salt)
    with account_cursor() as cursor:
        cursor.execute('SELECT pg_advisory_xact_lock(891231)')
        cursor.execute('SELECT EXISTS(SELECT 1 FROM scada_user)')
        if cursor.fetchone()[0]:
            raise HTTPException(409, 'Hesaplar zaten var. Mevcut hesabınla giriş yap.')
        cursor.execute("INSERT INTO scada_admin_account (id,username,salt,password_hash) VALUES (1,%s,%s,%s) ON CONFLICT (id) DO NOTHING RETURNING id",
                       (body.username, salt.hex(), hashed))
        if not cursor.fetchone():
            raise HTTPException(409, 'Yönetici hesabı zaten var. Giriş yap seçeneğini kullan.')
        cursor.execute("INSERT INTO scada_user(username,salt,password_hash,role) VALUES(%s,%s,%s,'root') RETURNING id",(body.username,salt.hex(),hashed))
        user_id=cursor.fetchone()[0]
    response.headers['Cache-Control'] = 'no-store'
    return {'success': True, 'data': {'username': body.username, 'access_token': issue_token(body.username, os.environ['SCADA_ADMIN_TOKEN'].strip(),user_id=user_id), 'token_type': 'bearer', 'expires_in': SESSION_SECONDS}}

@router.get('/collector-connection')
def collector_connection(request: Request, response: Response):
    if getattr(request.state, 'scada_role', None) not in ('admin','root'):
        raise HTTPException(403, 'Collector bağlantı bilgileri yalnızca yöneticiye verilir.')
    response.headers['Cache-Control'] = 'no-store'
    return {'success': True, 'data': {'collector_token': os.environ['SCADA_COLLECTOR_TOKEN'], 'api_url': str(request.base_url).rstrip('/') + '/api/v1'}}

@router.post('/token')
def token(body: Credentials, request: Request, response: Response):
    key = os.getenv('SCADA_ADMIN_TOKEN', '').strip()
    if not key:
        raise HTTPException(503, 'API güvenlik yapılandırması eksik.')
    client = request.client.host if request.client else 'unknown'
    now = time.time()
    with _lock:
        for address in list(_attempts):
            if now - _attempts[address][0] >= 60:
                del _attempts[address]
        first, count = _attempts.get(client, (now, 0))
        if count >= 5 or len(_attempts) >= 10000:
            raise HTTPException(429, 'Çok fazla giriş denemesi. Bir dakika sonra tekrar dene.')
        _attempts[client] = (first, count + 1)
    with account_cursor() as cursor:
        cursor.execute('SELECT username,salt,password_hash,role,auth_version,id FROM scada_user WHERE username=%s AND active',(body.username,))
        row = cursor.fetchone()
    # Do the same expensive hash even if no account exists.
    hashed = password_hash(body.password, bytes.fromhex(row[1]) if row else bytes(32))
    if not row or not secrets.compare_digest(body.username, row[0]) or not secrets.compare_digest(hashed, row[2]):
        raise HTTPException(401, 'Kullanıcı adı veya şifre yanlış. İlk kurulum yapılmadıysa yönetici hesabı oluştur.')
    with _lock:
        _attempts.pop(client, None)
    response.headers['Cache-Control'] = 'no-store'
    return {'success': True, 'data': {'access_token': issue_token(row[0], key, role=row[3], version=row[4],user_id=row[5]), 'token_type': 'bearer', 'expires_in': SESSION_SECONDS}}

@router.get('/me')
def me(request:Request,response:Response):
    response.headers['Cache-Control']='no-store'
    identity=request.state.identity
    return {'success':True,'data':{k:v for k,v in identity.items() if k in ('id','username','role','site_ids','permissions')}}
