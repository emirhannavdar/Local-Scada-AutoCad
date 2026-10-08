import os
import secrets
from datetime import datetime
from typing import Generic, Optional, TypeVar

from pydantic import BaseModel, Field

from api.auth import session_role
from api.server_secrets import ensure_server_keys
from starlette.responses import JSONResponse
from fastapi.encoders import jsonable_encoder  # DÜZELTME: Datetime ve özel tipleri dönüştürmek için eklendi


def token_role(header, admin, collector):
    if not admin and not collector:
        return 'local'
    if not header.startswith('Bearer '):
        return None
    token = header[7:]
    if admin and secrets.compare_digest(token, admin):
        return 'admin'
    if collector and secrets.compare_digest(token, collector):
        return 'collector'
    return session_role(token, admin)


def permitted(role, method, path):
    if role in ('local', 'admin'):
        return True
    if role != 'collector':
        return False
    return method == 'GET' or method == 'POST' and (
                path in ('/api/v1/operations/ingest', '/api/v1/operations/heartbeat', '/api/v1/control/claim', '/api/v1/control/gpio-state', '/api/v1/gpio-inputs/samples') or path.startswith(
            '/api/v1/control/commands/') and path.endswith('/result')) or method == 'POST' and path.rstrip('/') in (
        '/api/v1/measurement', '/api/v1/measurement/batch')


T = TypeVar("T")


class RestApiAccess(BaseModel, Generic[T]):
    success: bool
    data: Optional[T] = None
    dateTime: datetime = Field(default_factory=datetime.now)
    errorCode: Optional[int] = None
    message: Optional[str] = None

    @classmethod
    def error(cls, message: str, code: Optional[int] = None):
        return cls(success=False, data=None, errorCode=code, message=message)


def install_access_guard(app):
    admin, collector = ensure_server_keys()
    if bool(admin) != bool(collector):
        raise RuntimeError('Token koruması için SCADA_ADMIN_TOKEN ve SCADA_COLLECTOR_TOKEN birlikte gerekli.')
    if admin and (len(admin) < 32 or len(collector) < 32 or admin == collector):
        raise RuntimeError('İki ayrı, en az 32 karakterlik token kullan.')

    original_openapi = app.openapi

    def documented_openapi():
        schema = original_openapi()
        schema.setdefault('components', {}).setdefault('securitySchemes', {})['BearerAuth'] = {
            'type': 'http', 'scheme': 'bearer', 'bearerFormat': 'JWT veya API token'}
        schema['security'] = [{'BearerAuth': []}]
        for path, method in [('/api/v1/auth/token', 'post'), ('/api/v1/auth/bootstrap', 'post'),
                             ('/api/v1/auth/status', 'get')]:
            operation = schema.get('paths', {}).get(path, {}).get(method)
            if operation is not None:
                operation['security'] = []
        return schema

    app.openapi = documented_openapi

    @app.middleware('http')
    async def guard(request, call_next):
        # CORS middleware checks preflight; actual requests still require tokens.
        if request.method == 'OPTIONS':
            return await call_next(request)
        path = request.url.path
        if path == '/api/v1/auth/token' and request.method == 'POST':
            return await call_next(request)
        if path == '/api/v1/auth/status' and request.method == 'GET':
            return await call_next(request)
        if path == '/api/v1/auth/bootstrap' and request.method == 'POST' and not request.headers.get('authorization'):
            # Endpoint itself limits anonymous initial setup to local callers.
            return await call_next(request)
        # Schema contains endpoint definitions only. Swagger can load it and
        # use Authorize; every actual API operation remains guarded below.
        documentation = path in ('/docs', '/redoc', '/openapi.json') or path.startswith('/docs/')
        if not path.startswith('/api/') and not documentation:
            return await call_next(request)

        from api.authorization import identity, scope, check_request, filter_result
        from fastapi import HTTPException
        from starlette.concurrency import run_in_threadpool

        if not request.headers.get('authorization', '').startswith('Bearer ') or not request.headers.get('authorization', '')[7:].strip():
            return JSONResponse({'detail': 'Bearer token gerekli.'}, status_code=401, headers={'WWW-Authenticate': 'Bearer'})

        from api.auth import session_claims
        bearer = request.headers.get('authorization', '')[7:]
        if not secrets.compare_digest(bearer, admin) and not secrets.compare_digest(bearer, collector) and not session_claims(bearer, admin):
            return JSONResponse({'detail': 'Token geçersiz veya süresi dolmuş.'}, status_code=401, headers={'WWW-Authenticate': 'Bearer'})

        db = None
        try:
            if token_role(request.headers.get('authorization', ''), admin, collector) != 'collector':
                from database.database import get_connection
                db = await run_in_threadpool(get_connection)
                await run_in_threadpool(setattr, db, 'autocommit', True)
                lock = 'pg_advisory_lock_shared' if request.method == 'GET' else 'pg_advisory_lock'
                await run_in_threadpool(db.execute, f'SELECT {lock}(891232)')

            user = await run_in_threadpool(identity, request.headers.get('authorization', ''), admin, collector)
            if user is None:
                # Düzeltme 1: Pydantic modeli jsonable_encoder ile güvenli bir şekilde JSON formatına çevrildi
                return JSONResponse({'detail': 'Token geçersiz veya süresi dolmuş.'}, status_code=401, headers={'WWW-Authenticate': 'Bearer'})

            if documentation:
                if user['role'] != 'root':
                    raise HTTPException(403, 'API dokümantasyonu root yetkisi gerektirir.')
                return await call_next(request)

            allowed = await run_in_threadpool(scope, user)
            body = {}
            if request.method not in ('GET', 'DELETE'):
                try:
                    body = await request.json()
                except Exception:
                    raise HTTPException(422, 'Geçerli JSON gövdesi gerekli.')
                if not isinstance(body, dict) and user['role'] not in ('root', 'collector'):
                    raise HTTPException(422, 'JSON nesnesi gerekli.')

            await run_in_threadpool(check_request, user, allowed, path, request.method, body, request.query_params)
            request.state.identity = user
            request.state.allowed = allowed
            request.state.scada_role = user['role']

            from api.request_actor import actor
            actor_token = actor.set(user['username'])
            try:
                response = await call_next(request)
            finally:
                actor.reset(actor_token)

            if allowed is not None and request.method == 'GET' and response.status_code < 400 and 'application/json' in response.headers.get(
                    'content-type', ''):
                import json
                raw = b''.join([chunk async for chunk in response.body_iterator])
                value = filter_result(allowed, path, json.loads(raw), user)
                headers = {k: v for k, v in response.headers.items() if k not in ('content-length', 'content-type')}
                headers['Cache-Control'] = 'no-store'
                return JSONResponse(value, status_code=response.status_code, headers=headers)

            return response

        except HTTPException as e:
            return JSONResponse({'detail': e.detail}, status_code=e.status_code)
        except (ValueError, TypeError):
            # Düzeltme 2: Pydantic modeli jsonable_encoder ile güvenli bir şekilde JSON formatına çevrildi
            error_obj = RestApiAccess.error(message="sayfa bulunamadı", code=404)
            return JSONResponse(content=jsonable_encoder(error_obj), status_code=404)
        finally:
            if db is not None:
                await run_in_threadpool(db.close)
