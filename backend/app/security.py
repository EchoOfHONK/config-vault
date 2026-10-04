import hashlib
import hmac
import os
from pathlib import Path
import re
import secrets as random_secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError
from cryptography.fernet import Fernet
from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy import select
from .db import get_db
from .models import Session, Token, User

password_hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)
_fernet = None


def vault_key():
    key_file = os.environ.get('VAULT_KEY_FILE')
    value = Path(key_file).read_text().strip() if key_file else os.environ.get('VAULT_KEY', '')
    if not value:
        raise RuntimeError('VAULT_KEY or VAULT_KEY_FILE must contain a persistent Fernet key')
    Fernet(value.encode())
    return value.encode()


def cipher():
    global _fernet
    if _fernet is None:
        _fernet = Fernet(vault_key())
    return _fernet


def encrypt(value: str) -> str:
    return cipher().encrypt(value.encode('utf-8')).decode('ascii')


def decrypt(value: str) -> str:
    return cipher().decrypt(value.encode('ascii')).decode('utf-8')


_secret_key = r'(?:[\w.-]*(?:password|passwd|token|api[_-]?key|secret|private[_-]?key|preshared[_-]?key|authorization|credential)[\w.-]*)'
_binding = re.compile(r'(?im)((?<![\w.-])[\"\']?(' + _secret_key + r')[\"\']?\s*(?:=|:)\s*)(\"(?:[^\"\\]|\\.)*\"|\'[^\']*\'|[^\r\n,}\]]+)')
_xml = re.compile(r'(?is)(<(' + _secret_key + r')(?:\s+[^>]*)?>)(.*?)(</\2\s*>)')
_yaml_block = re.compile(r'(?im)(^([ \t]*)(?:-\s+)?(' + _secret_key + r')\s*:\s*[|>][-+]?[^\n]*\n)((?:[ \t]+[^\n]*(?:\n|$))+)')
_pem = re.compile(r'-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----')
_url_password = re.compile(r'(\w+://[^\s:/]+:)([^\s@/]+)(@)')
_embedded = re.compile(r'(?i)(authorization\s*[:=]\s*(?:bearer\s+|basic\s+)?)([^\s\"\']+)')


def secrets(value: str) -> list:
    found = sorted(set(match.group(2) for match in _binding.finditer(value)))
    if _pem.search(value):
        found.append('PRIVATE KEY')
    if _url_password.search(value):
        found.append('URL password')
    found.extend(match.group(2) for match in _xml.finditer(value))
    found.extend(match.group(3) for match in _yaml_block.finditer(value))
    if _embedded.search(value):
        found.append('Authorization')
    return sorted(set(found))


def mask(value: str) -> str:
    value = _pem.sub('[PRIVATE KEY HIDDEN]', value)
    value = _xml.sub(lambda m: m.group(1) + '••••••••' + m.group(4), value)
    value = _yaml_block.sub(lambda m: m.group(1) + m.group(2) + '  ••••••••\n', value)
    def replace(match):
        original = match.group(3).strip()
        quote = original[0] if original.startswith(('"', "'")) else ''
        return match.group(1) + quote + '••••••••' + quote
    value = _binding.sub(replace, value)
    value = _url_password.sub(r'\1••••••••\3', value)
    return _embedded.sub(r'\1••••••••', value)


def digest(value: str):
    return hashlib.sha256(value.encode()).hexdigest()


def hash_password(value: str):
    if not isinstance(value, str) or len(value) < 12 or len(value) > 1024:
        raise HTTPException(422, 'Password must contain 12–1024 characters')
    return password_hasher.hash(value)


def verify_password(hashed: str, password: str):
    try:
        return password_hasher.verify(hashed, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def user_json(user):
    return {'id': user.id, 'username': user.username, 'role': user.role, 'device_ids': user.device_ids, 'project_ids': user.project_ids, 'service_ids': user.service_ids}


def ensure_origin(request: Request):
    origin = request.headers.get('origin')
    if origin and urlparse(origin).netloc != request.headers.get('host'):
        raise HTTPException(403, 'Cross-origin request rejected')


def utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def create_session(db, user, response: Response):
    raw = random_secrets.token_urlsafe(48)
    csrf = random_secrets.token_urlsafe(32)
    db.add(Session(id=digest(raw), user_id=user.id, csrf_hash=digest(csrf), expires_at=datetime.now(timezone.utc) + timedelta(hours=12)))
    secure = os.environ.get('COOKIE_SECURE', 'true').lower() == 'true'
    response.set_cookie('cv_session', raw, max_age=43200, httponly=True, secure=secure, samesite='strict', path='/')
    response.set_cookie('cv_csrf', csrf, max_age=43200, httponly=False, secure=secure, samesite='strict', path='/')
    return {'user': user_json(user), 'csrf': csrf}


def require_scope(user, scope):
    scopes = getattr(user, '_token_scopes', None)
    if scopes is not None and scope not in scopes:
        raise HTTPException(403, f'API token requires scope {scope}')


def require_admin(user):
    if user.role != 'admin' or getattr(user, '_token_scopes', None) is not None:
        raise HTTPException(403, 'Administrator permission required')


def require_access(user, device_id=None, project_id=None, service_id=None, write=False):
    token_devices = getattr(user, '_token_devices', None)
    if token_devices and device_id not in token_devices:
        raise HTTPException(403, 'Device is outside API token permissions')
    if write and user.role not in ('admin', 'editor'):
        raise HTTPException(403, 'Editing permission required')
    if user.role == 'admin':
        return
    if not (user.device_ids or user.project_ids or user.service_ids):
        return
    if device_id in user.device_ids or project_id in user.project_ids or service_id in user.service_ids:
        return
    raise HTTPException(403, 'Resource is outside your permissions')


def current_user(request: Request, db=Depends(get_db)):
    auth = request.headers.get('authorization', '')
    if auth.startswith('Bearer '):
        token = db.scalar(select(Token).where(Token.token_hash == digest(auth[7:])))
        if not token or (token.expires_at and utc(token.expires_at) <= datetime.now(timezone.utc)):
            raise HTTPException(401, 'Invalid or expired API token')
        user = db.get(User, token.user_id)
        user._token_scopes = token.scopes
        user._token_devices = token.device_ids
        path = request.url.path
        if path.startswith('/api/configs') or path.startswith('/api/compare'):
            require_scope(user, 'read:configs' if request.method == 'GET' else 'write:configs')
        elif path.startswith('/api/snapshots'):
            require_scope(user, 'read:configs' if request.method == 'GET' else 'create:snapshot')
        elif path.startswith('/api/devices'):
            require_scope(user, 'read:configs' if request.method == 'GET' else 'sync:device')
            if request.method != 'GET' and not path.endswith(('/sync', '/import', '/test')):
                raise HTTPException(403, 'API tokens cannot manage devices or credentials')
        elif path == '/api/validate':
            require_scope(user, 'write:configs')
        else:
            raise HTTPException(403, 'This endpoint requires a browser session')
        return user
    raw = request.cookies.get('cv_session', '')
    session = db.get(Session, digest(raw)) if raw else None
    if not session or utc(session.expires_at) <= datetime.now(timezone.utc):
        raise HTTPException(401, 'Authentication required')
    user = db.get(User, session.user_id)
    if not user:
        raise HTTPException(401, 'Authentication required')
    if request.method not in ('GET', 'HEAD', 'OPTIONS'):
        ensure_origin(request)
        csrf = request.headers.get('x-csrf-token', '')
        if not csrf or not hmac.compare_digest(session.csrf_hash, digest(csrf)) or not hmac.compare_digest(csrf, request.cookies.get('cv_csrf', '')):
            raise HTTPException(403, 'Missing or invalid CSRF token')
    return user
