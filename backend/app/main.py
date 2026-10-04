import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
import json
import logging
import os
from pathlib import Path
import secrets
import threading
import time
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import IntegrityError

from .db import Base, DATA_DIR, SessionLocal, engine, get_db
from .models import Activity, Backup, Config, Device, Project, Service, Session, Setting, Snapshot, Token, User, now
from .security import create_session, current_user, digest, ensure_origin, hash_password, require_access, require_admin, user_json, vault_key, verify_password
from .core import activity_json, audit, config_json, device_json, reconcile_git, router as core_router, visible, visible_activity, visible_device
from .backup import router as backup_router

_login_lock = threading.Lock()
_setup_lock = threading.Lock()
_attempts = {}
_requests = {}
PUBLIC_SETTINGS = {'instance_name', 'timezone', 'backup_interval_hours', 'backup_retention'}


def defaults(db, instance_name='Config Vault', timezone_name='UTC'):
    for key, value in {'instance_name': instance_name, 'timezone': timezone_name, 'backup_interval_hours': 24, 'backup_retention': 14}.items():
        if not db.get(Setting, key):
            db.add(Setting(key=key, value=value))


def bootstrap():
    data = {}
    file = os.environ.get('BOOTSTRAP_CONFIG_FILE')
    with SessionLocal() as db:
        if db.scalar(select(User.id).limit(1)):
            defaults(db)
            db.commit()
            return
        if file and Path(file).is_file():
            data = json.loads(Path(file).read_text())
        elif os.environ.get('BOOTSTRAP_ADMIN_USERNAME'):
            password_file = os.environ.get('BOOTSTRAP_ADMIN_PASSWORD_FILE')
            data = {'username': os.environ['BOOTSTRAP_ADMIN_USERNAME'], 'password': Path(password_file).read_text().strip() if password_file else os.environ.get('BOOTSTRAP_ADMIN_PASSWORD', '')}
        if data:
            username = valid_username(data.get('username'))
            timezone_name = valid_timezone(data.get('timezone', 'UTC'))
            user = User(username=username, password_hash=hash_password(data.get('password', '')), role='admin')
            db.add(user)
            defaults(db, data.get('instance_name', 'Config Vault'), timezone_name)
            audit(db, username, 'instance initialized', 'instance')
            db.commit()


@asynccontextmanager
async def lifespan(app):
    vault_key()
    DATA_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    DATA_DIR.chmod(0o700)
    Base.metadata.create_all(engine)
    bootstrap()
    await asyncio.to_thread(reconcile_git)
    task = None
    if os.environ.get('DISABLE_SCHEDULER', '').lower() != 'true':
        from .scheduler import run_scheduler
        task = asyncio.create_task(run_scheduler())
    yield
    if task:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(title='Config Vault', version='1.0.0', lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url='/api/openapi.json')
app.include_router(core_router)
app.include_router(backup_router)
from .remote_routes import router as remote_router
app.include_router(remote_router)


@app.middleware('http')
async def security_headers(request, call_next):
    if request.url.path.startswith('/api/') and request.url.path != '/api/health':
        identity = request.client.host if request.client else 'unknown'
        current = time.monotonic()
        with _login_lock:
            recent = [t for t in _requests.get(identity, []) if current - t < 60]
            if len(recent) >= 300:
                return JSONResponse({'detail': 'Request rate limit exceeded; retry in one minute'}, status_code=429, headers={'Retry-After': '60'})
            recent.append(current)
            _requests[identity] = recent
            if len(_requests) > 10000:
                _requests.clear()
    response = await call_next(request)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['Cache-Control'] = 'no-store'
    response.headers['Content-Security-Policy'] = "default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'"
    return response


@app.exception_handler(IntegrityError)
async def constraint_error(request, exc):
    return JSONResponse(status_code=409, content={'detail': 'Resource conflict or invalid reference; reload and retry'})


def login_limit(request, username):
    key = (request.client.host if request.client else 'unknown', str(username).casefold())
    current = time.monotonic()
    with _login_lock:
        old = [t for t in _attempts.get(key, []) if current - t < 900]
        if len(old) >= 10:
            raise HTTPException(429, 'Too many authentication attempts; retry after 15 minutes')
        old.append(current)
        _attempts[key] = old
        if len(_attempts) > 10000:
            _attempts.clear()
    return key


def valid_username(value):
    if not isinstance(value, str) or not value.strip() or len(value) > 100 or any(ord(ch) < 32 for ch in value):
        raise HTTPException(422, 'Username must contain 1–100 printable characters')
    return value.strip()


def valid_timezone(value):
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError, TypeError):
        raise HTTPException(422, 'Invalid IANA timezone')
    return value


@app.get('/api/health')
def health(db=Depends(get_db)):
    db.execute(text('SELECT 1'))
    return {'status': 'ok', 'version': '1.0.0'}


@app.get('/api/setup/status')
def setup_status(db=Depends(get_db)):
    return {'initialized': bool(db.scalar(select(User.id).limit(1)))}


@app.post('/api/setup')
def setup(body: dict, request: Request, response: Response, db=Depends(get_db)):
    ensure_origin(request)
    login_limit(request, 'setup')
    with _setup_lock:
        if engine.dialect.name == 'postgresql':
            db.execute(text('SELECT pg_advisory_xact_lock(771204915)'))
        if db.scalar(select(User.id).limit(1)):
            raise HTTPException(409, 'Instance already initialized')
        user = User(username=valid_username(body.get('username')), password_hash=hash_password(body.get('password', '')), role='admin')
        db.add(user)
        db.flush()
        defaults(db, str(body.get('instance_name', 'Config Vault'))[:200], valid_timezone(body.get('timezone', 'UTC')))
        result = create_session(db, user, response)
        audit(db, user.username, 'instance initialized', 'instance')
        db.commit()
        return result


@app.post('/api/auth/login')
def login(body: dict, request: Request, response: Response, db=Depends(get_db)):
    ensure_origin(request)
    username = body.get('username', '')
    login_limit(request, username)
    user = db.scalar(select(User).where(User.username == username))
    # Always run Argon2 even for an unknown user to limit username timing disclosure.
    if user:
        verified = verify_password(user.password_hash, str(body.get('password', ''))[:1024])
    else:
        from .security import password_hasher
        verified = False
        password_hasher.hash(str(body.get('password', ''))[:1024])
    if not verified:
        audit(db, 'Anonymous', 'login failed', 'authentication')
        db.commit()
        raise HTTPException(401, 'Incorrect username or password')
    result = create_session(db, user, response)
    audit(db, user.username, 'login', 'authentication')
    db.commit()
    return result


@app.get('/api/auth/me')
def me(user=Depends(current_user)):
    return user_json(user)


@app.post('/api/auth/logout')
def logout(request: Request, response: Response, db=Depends(get_db), user=Depends(current_user)):
    db.execute(delete(Session).where(Session.id == digest(request.cookies.get('cv_session', ''))))
    audit(db, user.username, 'logout', 'authentication')
    db.commit()
    response.delete_cookie('cv_session', path='/')
    response.delete_cookie('cv_csrf', path='/')
    return {'logged_out': True}


@app.get('/api/settings')
def settings(db=Depends(get_db), user=Depends(current_user)):
    require_admin(user)
    return {s.key: s.value for s in db.scalars(select(Setting)) if s.key in PUBLIC_SETTINGS}


@app.patch('/api/settings')
def update_settings(body: dict, db=Depends(get_db), user=Depends(current_user)):
    require_admin(user)
    allowed = PUBLIC_SETTINGS
    if set(body) - allowed:
        raise HTTPException(422, 'Unknown setting')
    for key, value in body.items():
        if key == 'timezone':
            valid_timezone(value)
        if key == 'instance_name' and (not isinstance(value, str) or not value.strip() or len(value) > 200):
            raise HTTPException(422, 'Instance name must contain 1–200 characters')
        if key == 'backup_interval_hours' and (not isinstance(value, int) or value < 0 or value > 8760):
            raise HTTPException(422, 'Backup interval must be 0–8760 hours; 0 disables scheduling')
        if key == 'backup_retention' and (not isinstance(value, int) or value < 1 or value > 3650):
            raise HTTPException(422, 'Backup retention must be 1–3650')
        setting = db.get(Setting, key)
        if setting:
            setting.value = value
        else:
            db.add(Setting(key=key, value=value))
    audit(db, user.username, 'settings updated', 'instance', ', '.join(body))
    db.commit()
    return {s.key: s.value for s in db.scalars(select(Setting)) if s.key in PUBLIC_SETTINGS}


@app.get('/api/dashboard')
def dashboard(db=Depends(get_db), user=Depends(current_user)):
    devices = [d for d in db.scalars(select(Device)) if visible_device(db, user, d)]
    configs = [c for c in db.scalars(select(Config)) if visible(user, c.device_id, c.project_id, c.service_id)]
    snapshots = [s for s in db.scalars(select(Snapshot)) if any(f['config_id'] in {c.id for c in configs} for f in s.files)]
    recent = [a for a in db.scalars(select(Activity).order_by(Activity.id.desc()).limit(500)) if visible_activity(db, user, a)]
    timezone_setting = db.get(Setting, 'timezone')
    tz = ZoneInfo(timezone_setting.value if timezone_setting else 'UTC')
    midnight = datetime.now(tz).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
    config_ids = {c.id for c in configs}
    changes = sum(v.created_at.replace(tzinfo=timezone.utc) >= midnight for v in db.scalars(select(Version).where(Version.config_id.in_(config_ids)))) if config_ids else 0
    completed = db.scalar(select(Backup).where(Backup.status == 'Completed').order_by(Backup.created_at.desc()).limit(1)) if user.role == 'admin' else None
    alerts = []
    for d in devices:
        if d.status in ('Offline', 'Auth Error', 'Conflict', 'Changes Detected'):
            alerts.append({'level': 'error' if d.status in ('Offline', 'Auth Error') else 'warning', 'message': f'{d.name}: {d.status}'})
    conflicts = sum(c.conflict for c in configs)
    if conflicts:
        alerts.append({'level': 'warning', 'message': f'{conflicts} configuration conflicts require review'})
    if user.role == 'admin':
        failed = db.scalar(select(Backup).where(Backup.status == 'Failed').order_by(Backup.id.desc()).limit(1))
        if failed and (not completed or failed.created_at > completed.created_at):
            alerts.append({'level': 'error', 'message': 'Last backup failed'})
    return {'devices': len(devices), 'configurations': len(configs), 'changes_today': changes, 'snapshots': len(snapshots), 'last_backup': completed.created_at if completed else None, 'recent_changes': [activity_json(a, db) for a in recent[:10]], 'alerts': alerts, 'device_health': [device_json(d, db, user) for d in devices]}


from .models import Version


def validate_permissions(db, body):
    role = body.get('role', 'viewer')
    if not isinstance(role, str):
        raise HTTPException(422, 'Invalid role')
    role = role.lower()
    if role not in ('admin', 'editor', 'viewer'):
        raise HTTPException(422, 'Role must be admin, editor or viewer')
    result = {'role': role}
    for field, cls in (('device_ids', Device), ('project_ids', Project), ('service_ids', Service)):
        ids = body.get(field, [])
        if not isinstance(ids, list) or any(not isinstance(value, int) or not db.get(cls, value) for value in ids):
            raise HTTPException(422, f'{field} contains invalid references')
        result[field] = list(set(ids))
    return result


@app.get('/api/users')
def users(db=Depends(get_db), user=Depends(current_user)):
    require_admin(user)
    return [user_json(u) for u in db.scalars(select(User).order_by(User.username))]


@app.post('/api/users', status_code=201)
def create_user(body: dict, db=Depends(get_db), user=Depends(current_user)):
    require_admin(user)
    record = User(username=valid_username(body.get('username')), password_hash=hash_password(body.get('password', '')), **validate_permissions(db, body))
    db.add(record)
    db.flush()
    audit(db, user.username, 'user created', f'user:{record.id}')
    db.commit()
    return user_json(record)


def protect_last_admin(db, record, role=None):
    if record.role == 'admin' and role != 'admin':
        if engine.dialect.name == 'postgresql':
            db.execute(text('SELECT pg_advisory_xact_lock(771204914)'))
        count = db.scalar(select(func.count(User.id)).where(User.role == 'admin'))
        if count <= 1:
            raise HTTPException(409, 'The last administrator cannot be removed or demoted')


@app.patch('/api/users/{user_id}')
def update_user(user_id: int, body: dict, db=Depends(get_db), user=Depends(current_user)):
    require_admin(user)
    record = db.get(User, user_id)
    if not record:
        raise HTTPException(404, 'User not found')
    merged = {**user_json(record), **body}
    permissions = validate_permissions(db, merged)
    protect_last_admin(db, record, permissions['role'])
    for field, value in permissions.items():
        setattr(record, field, value)
    if 'username' in body:
        record.username = valid_username(body['username'])
    if body.get('password'):
        record.password_hash = hash_password(body['password'])
    # Permission/password changes revoke both sessions and tokens immediately.
    db.execute(delete(Session).where(Session.user_id == user_id))
    db.execute(delete(Token).where(Token.user_id == user_id))
    audit(db, user.username, 'user permissions changed', f'user:{user_id}')
    db.commit()
    return user_json(record)


@app.delete('/api/users/{user_id}')
def delete_user(user_id: int, db=Depends(get_db), user=Depends(current_user)):
    require_admin(user)
    record = db.get(User, user_id)
    if not record:
        raise HTTPException(404, 'User not found')
    protect_last_admin(db, record)
    db.delete(record)
    audit(db, user.username, 'user deleted', f'user:{user_id}')
    db.commit()
    return {'deleted': True}


def token_json(token):
    return {key: getattr(token, key) for key in ('id', 'name', 'scopes', 'device_ids', 'created_at', 'expires_at')}


@app.get('/api/tokens')
def tokens(db=Depends(get_db), user=Depends(current_user)):
    return [token_json(t) for t in db.scalars(select(Token).where(Token.user_id == user.id))]


@app.post('/api/tokens', status_code=201)
def create_token(body: dict, db=Depends(get_db), user=Depends(current_user)):
    scopes = body.get('scopes', [])
    allowed = {'read:configs', 'write:configs', 'sync:device', 'create:snapshot'}
    if not isinstance(scopes, list) or not scopes or any(not isinstance(s, str) for s in scopes) or set(scopes) - allowed:
        raise HTTPException(422, 'Select supported API token scopes')
    if user.role == 'viewer' and any(s != 'read:configs' for s in scopes):
        raise HTTPException(403, 'Viewer tokens can only read configurations')
    device_ids = body.get('device_ids', [])
    if not isinstance(device_ids, list):
        raise HTTPException(422, 'device_ids must be a list')
    for device_id in device_ids:
        if not db.get(Device, device_id):
            raise HTTPException(404, 'Device not found')
        require_access(user, device_id)
    days = body.get('expires_days', 90)
    if not isinstance(days, int) or days < 1 or days > 365:
        raise HTTPException(422, 'Token expiry must be 1–365 days')
    name = str(body.get('name', '')).strip()
    if not name or len(name) > 100:
        raise HTTPException(422, 'Token name is required, maximum 100 characters')
    raw = 'cv_' + secrets.token_urlsafe(48)
    token = Token(user_id=user.id, name=name, token_hash=digest(raw), scopes=list(set(scopes)), device_ids=list(set(device_ids)), expires_at=now() + timedelta(days=days))
    db.add(token)
    db.flush()
    audit(db, user.username, 'API token created', f'token:{token.id}', ', '.join(scopes))
    db.commit()
    return {**token_json(token), 'token': raw}


@app.delete('/api/tokens/{token_id}')
def delete_token(token_id: int, db=Depends(get_db), user=Depends(current_user)):
    token = db.get(Token, token_id)
    if not token or (token.user_id != user.id and user.role != 'admin'):
        raise HTTPException(404, 'API token not found')
    db.delete(token)
    audit(db, user.username, 'API token revoked', f'token:{token_id}')
    db.commit()
    return {'deleted': True}
