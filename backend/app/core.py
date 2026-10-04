import difflib
import fcntl
import io
import json
import logging
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import threading
import zipfile
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import event, func, select, update
from sqlalchemy.orm import Session as SASession
from .db import DATA_DIR, SessionLocal, get_db
from .models import Activity, Backup, Config, Device, Project, Service, Snapshot, Template, User, Version, now
from .security import current_user, decrypt, encrypt, mask, require_access, require_admin, require_scope, secrets

router = APIRouter(prefix='/api')
POLICIES = {'manual', 'pull_only', 'push_pull', 'watch', 'backup_only'}
_git_lock = threading.Lock()
MAX_CONTENT = 1024 * 1024


def audit(db, actor, action, target, details=''):
    # Audit contains identifiers and fixed descriptions only, never configuration values.
    device_id = None
    if str(target).startswith('config:'):
        try:
            config = db.get(Config, int(str(target).split(':', 1)[1]))
            device_id = config.device_id if config else None
        except ValueError:
            pass
    elif str(target).startswith('device:'):
        try:
            device_id = int(str(target).split(':', 1)[1])
        except ValueError:
            pass
    db.add(Activity(actor=actor, action=action, target=str(target), details=mask(str(details))[:2000], device_id=device_id))


def visible(user, device_id=None, project_id=None, service_id=None):
    try:
        require_access(user, device_id=device_id, project_id=project_id, service_id=service_id)
        return True
    except HTTPException:
        return False


def visible_device(db, user, device):
    if visible(user, device.id):
        return True
    for config in db.scalars(select(Config).where(Config.device_id == device.id)):
        if visible(user, config.device_id, config.project_id, config.service_id):
            return True
    for cls in (Project, Service):
        for group in db.scalars(select(cls).where(cls.device_id == device.id)):
            if visible(user, device.id, group.id if cls is Project else None, group.id if cls is Service else None):
                return True
    return False


def get_config(db, user, config_id, write=False):
    config = db.get(Config, config_id)
    if not config:
        raise HTTPException(404, 'Configuration not found')
    require_access(user, config.device_id, config.project_id, config.service_id, write=write)
    return config


def get_version(db, config_id, number):
    version = db.scalar(select(Version).where(Version.config_id == config_id, Version.number == number))
    if not version:
        raise HTTPException(404, 'Version not found')
    return version


def validate_text(content):
    if not isinstance(content, str) or len(content.encode('utf-8')) > MAX_CONTENT or '\0' in content:
        raise HTTPException(422, 'Configuration must be UTF-8 text no larger than 1 MiB')


def detect_format(name):
    from .validation import detect_format as detect
    return detect(name)


def add_version(db, config, content, actor, message, expected_version=None):
    validate_text(content)
    if config.id is None:
        db.add(config)
        db.flush()
    expected = config.version if expected_version is None else expected_version
    row = db.execute(select(Config).where(Config.id == config.id).with_for_update()).scalar_one()
    # refresh reads the committed row and CAS still protects SQLite, which ignores FOR UPDATE.
    db.refresh(row)
    if row.version != expected:
        raise HTTPException(409, {'message': 'Configuration changed; reload and compare before saving', 'current_version': row.version})
    encrypted = encrypt(content)
    timestamp = now()
    result = db.execute(update(Config).where(Config.id == config.id, Config.version == expected).values(version=expected + 1, current_content=encrypted, updated_at=timestamp), execution_options={'synchronize_session': False})
    if result.rowcount != 1:
        raise HTTPException(409, 'Concurrent update detected')
    config.version = expected + 1
    config.current_content = encrypted
    config.updated_at = timestamp
    db.add(Version(config_id=config.id, number=config.version, content=encrypted, actor=actor, message=mask(str(message))[:2000], created_at=timestamp))
    db.flush()
    db.info.setdefault('git_pending', []).append({'config_id': config.id, 'number': config.version, 'content': encrypted, 'actor': actor, 'message': mask(str(message))[:2000], 'created_at': timestamp.isoformat()})
    return config.version


def git_mirror(versions, repository_path=None):
    if not versions:
        return
    DATA_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    repository = repository_path or DATA_DIR / 'git'
    repository.mkdir(mode=0o700, exist_ok=True)
    git = os.environ.get('GIT_BINARY') or shutil.which('git')
    if not git:
        raise RuntimeError('Git executable is required')
    def run(*args):
        return subprocess.run([git, '-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Config Vault', '-c', 'user.email=vault@localhost', *args], cwd=repository, check=True, capture_output=True, timeout=30)
    with _git_lock, (DATA_DIR / 'git.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if not (repository / '.git').exists():
            run('init', '--initial-branch=main')
        for version in versions:
            folder = repository / 'versions' / str(version['config_id'])
            folder.mkdir(parents=True, exist_ok=True, mode=0o700)
            file = folder / f"{version['number']}.enc"
            if file.exists() and file.read_text() == version['content']:
                continue
            file.write_text(version['content'])
            file.chmod(0o600)
            (folder / f"{version['number']}.json").write_text(json.dumps({k: v for k, v in version.items() if k != 'content'}, ensure_ascii=False))
            run('add', '--', str(folder.relative_to(repository)))
            run('commit', '-m', f"Configuration {version['config_id']}: version {version['number']}")


@event.listens_for(SASession, 'after_commit')
def after_commit(session):
    pending = session.info.pop('git_pending', [])
    if pending:
        try:
            git_mirror(pending)
        except Exception:
            logging.getLogger('configvault').exception('Encrypted Git mirror requires reconciliation')


@event.listens_for(SASession, 'after_rollback')
def after_rollback(session):
    session.info.pop('git_pending', None)


def reconcile_git():
    with SessionLocal() as db:
        git_mirror([{'config_id': v.config_id, 'number': v.number, 'content': v.content, 'actor': v.actor, 'message': v.message, 'created_at': v.created_at.isoformat()} for v in db.scalars(select(Version).order_by(Version.id))])


def config_json(config, db):
    device = db.get(Device, config.device_id)
    return {'id': config.id, 'name': config.name, 'path': config.path, 'device_id': config.device_id, 'device_name': device.name if device else '', 'service_id': config.service_id, 'project_id': config.project_id, 'format': config.format, 'tags': config.tags, 'policy': config.policy, 'version': config.version, 'updated_at': config.updated_at, 'has_secrets': bool(secrets(decrypt(config.current_content))), 'remote_hash': config.remote_hash, 'conflict': config.conflict}


def device_json(device, db, user=None):
    data = {k: v for k, v in (device.connection_data or {}).items() if k not in ('password', 'private_key', 'passphrase', 'credential')}
    count = db.scalar(select(func.count(Config.id)).where(Config.device_id == device.id)) if user is None else sum(visible(user, c.device_id, c.project_id, c.service_id) for c in db.scalars(select(Config).where(Config.device_id == device.id)))
    if user is not None and not visible(user, device.id):
        data = {}
    return {'id': device.id, 'name': device.name, 'type': device.type, 'host': device.host, 'os': device.os, 'connection': device.connection, 'connection_data': data, 'status': device.status, 'last_sync': device.last_sync, 'config_count': count, 'has_credential': bool(device.credential) if user is None or visible(user, device.id) else False}


def activity_json(item, db=None):
    result = {k: getattr(item, k) for k in ('id', 'actor', 'action', 'target', 'details', 'created_at')}
    if db is not None and ':' in item.target:
        kind, identifier = item.target.split(':', 1)
        classes = {'config': Config, 'device': Device, 'project': Project, 'service': Service, 'snapshot': Snapshot, 'user': User, 'backup': Backup}
        try:
            resource = db.get(classes[kind], int(identifier)) if kind in classes else None
        except ValueError:
            resource = None
        if resource:
            result['resource'] = item.target
            result['target'] = resource.path if kind == 'config' else resource.username if kind == 'user' else resource.name
            device = db.get(Device, resource.device_id) if hasattr(resource, 'device_id') and resource.device_id else resource if kind == 'device' else None
            result['device_name'] = device.name if device else ''
    return result


def visible_activity(db, user, item):
    if user.role == 'admin' or item.actor == user.username:
        return True
    if item.target.startswith('config:'):
        try:
            config = db.get(Config, int(item.target.split(':', 1)[1]))
        except ValueError:
            config = None
        if config:
            return visible(user, config.device_id, config.project_id, config.service_id)
    return bool(item.device_id and visible(user, item.device_id))


def version_json(version):
    return {'number': version.number, 'actor': version.actor, 'message': version.message, 'created_at': version.created_at}


def name_value(body):
    name = str(body.get('name', '')).strip()
    if not name or len(name) > 200:
        raise HTTPException(422, 'Name is required and must be no longer than 200 characters')
    return name


def references(db, user, device_id, project_id=None, service_id=None, write=True):
    device = db.get(Device, device_id)
    if not device:
        raise HTTPException(404, 'Device not found')
    if not visible_device(db, user, device):
        raise HTTPException(403, 'Device is outside your assigned scope')
    require_access(user, device_id, project_id, service_id, write=write)
    for cls, value in ((Project, project_id), (Service, service_id)):
        if value:
            item = db.get(cls, value)
            if not item:
                raise HTTPException(404, f'{cls.__name__} not found')
            require_access(user, item.device_id, value if cls is Project else None, value if cls is Service else None, write=write)


@router.get('/devices')
def devices(db=Depends(get_db), user=Depends(current_user)):
    return [device_json(d, db, user) for d in db.scalars(select(Device).order_by(Device.name)) if visible_device(db, user, d)]


def validate_device_body(body):
    if body.get('connection', 'manual') not in ('manual', 'local', 'ssh'):
        raise HTTPException(422, 'Unsupported device connection')
    data = body.get('connection_data', {})
    if not isinstance(data, dict) or any(k in data for k in ('password', 'private_key', 'passphrase', 'credential')):
        raise HTTPException(422, 'Use the encrypted credential endpoint for credentials')
    if not isinstance(data.get('roots', []), list):
        raise HTTPException(422, 'roots must be a list')
    if data.get('auto_sync') and int(data.get('sync_interval', 900)) < 30:
        raise HTTPException(422, 'Sync interval must be at least 30 seconds')
    return data


@router.post('/devices', status_code=201)
def create_device(body: dict, db=Depends(get_db), user=Depends(current_user)):
    require_admin(user)
    data = validate_device_body(body)
    device = Device(name=name_value(body), type=str(body.get('type', 'Server'))[:40], host=str(body.get('host', ''))[:255], os=str(body.get('os', ''))[:200], connection=body.get('connection', 'manual'), connection_data=data)
    db.add(device)
    db.flush()
    audit(db, user.username, 'device created', f'device:{device.id}')
    db.commit()
    return device_json(device, db)


@router.get('/devices/{device_id}')
def device_detail(device_id: int, db=Depends(get_db), user=Depends(current_user)):
    device = db.get(Device, device_id)
    if not device:
        raise HTTPException(404, 'Device not found')
    if not visible_device(db, user, device):
        raise HTTPException(403, 'Device is outside your permissions')
    return device_json(device, db, user)


@router.patch('/devices/{device_id}')
def update_device(device_id: int, body: dict, db=Depends(get_db), user=Depends(current_user)):
    require_admin(user)
    device = db.get(Device, device_id)
    if not device:
        raise HTTPException(404, 'Device not found')
    merged = {'connection': device.connection, 'connection_data': device.connection_data, **body}
    validate_device_body(merged)
    for field in ('name', 'type', 'host', 'os', 'connection', 'connection_data'):
        if field in body:
            setattr(device, field, name_value(body) if field == 'name' else body[field])
    audit(db, user.username, 'device updated', f'device:{device.id}')
    db.commit()
    return device_json(device, db)


@router.delete('/devices/{device_id}')
def delete_device(device_id: int, db=Depends(get_db), user=Depends(current_user)):
    require_admin(user)
    device = db.get(Device, device_id)
    if not device:
        raise HTTPException(404, 'Device not found')
    if db.scalar(select(Config.id).where(Config.device_id == device_id).limit(1)) or db.scalar(select(Snapshot.id).where(Snapshot.device_id == device_id).limit(1)) or db.scalar(select(Service.id).where(Service.device_id == device_id).limit(1)) or db.scalar(select(Project.id).where(Project.device_id == device_id).limit(1)):
        raise HTTPException(409, 'Remove associated configurations, snapshots, projects and services first')
    audit(db, user.username, 'device deleted', f'device:{device.id}')
    db.delete(device)
    db.commit()
    return {'deleted': True}


@router.get('/configs')
def configs(q: str = '', device_id: int | None = None, project_id: int | None = None, service_id: int | None = None, db=Depends(get_db), user=Depends(current_user)):
    require_scope(user, 'read:configs')
    query = select(Config).order_by(Config.updated_at.desc())
    for field, value in ((Config.device_id, device_id), (Config.project_id, project_id), (Config.service_id, service_id)):
        if value is not None:
            query = query.where(field == value)
    result = []
    for config in db.scalars(query):
        if not visible(user, config.device_id, config.project_id, config.service_id):
            continue
        item = config_json(config, db)
        project = db.get(Project, config.project_id) if config.project_id else None
        service = db.get(Service, config.service_id) if config.service_id else None
        search = ' '.join([config.name, config.path, item['device_name'], project.name if project else '', service.name if service else '', ' '.join(config.tags), mask(decrypt(config.current_content))])
        if not q or q.casefold() in search.casefold():
            result.append(item)
    return result


@router.post('/configs', status_code=201)
def create_config(body: dict, db=Depends(get_db), user=Depends(current_user)):
    require_scope(user, 'write:configs')
    device_id = body.get('device_id')
    references(db, user, device_id, body.get('project_id'), body.get('service_id'))
    name = name_value(body)
    path = str(body.get('path', name))
    if not path or '\0' in path or len(path) > 4096:
        raise HTTPException(422, 'Invalid source path')
    if db.scalar(select(Config.id).where(Config.device_id == device_id, Config.path == path)):
        raise HTTPException(409, 'This device path is already stored')
    policy = body.get('policy', 'manual')
    if policy not in POLICIES:
        raise HTTPException(422, 'Unsupported sync policy')
    tags = body.get('tags', [])
    if not isinstance(tags, list) or len(tags) > 50 or any(not isinstance(t, str) or len(t) > 80 for t in tags):
        raise HTTPException(422, 'Invalid tags')
    config = Config(name=name, path=path, device_id=device_id, project_id=body.get('project_id'), service_id=body.get('service_id'), format=body.get('format') or detect_format(path), tags=tags, policy=policy, version=0)
    add_version(db, config, body.get('content', ''), user.username, body.get('message', 'Configuration imported'), 0)
    audit(db, user.username, 'config created', f'config:{config.id}', 'Version 1')
    db.commit()
    return config_json(config, db)


def config_content(db, user, config, content, reveal, action='config viewed'):
    if reveal:
        require_access(user, config.device_id, config.project_id, config.service_id, write=True)
    audit(db, user.username, 'secret revealed' if reveal and secrets(content) else action, f'config:{config.id}')
    return content if reveal else mask(content)


@router.get('/configs/{config_id}')
def config_detail(config_id: int, reveal: bool = False, db=Depends(get_db), user=Depends(current_user)):
    config = get_config(db, user, config_id)
    item = config_json(config, db)
    item['content'] = config_content(db, user, config, decrypt(config.current_content), reveal)
    db.commit()
    return item


@router.patch('/configs/{config_id}')
def update_config(config_id: int, body: dict, db=Depends(get_db), user=Depends(current_user)):
    config = get_config(db, user, config_id, write=True)
    require_scope(user, 'write:configs')
    references(db, user, config.device_id, body.get('project_id', config.project_id), body.get('service_id', config.service_id))
    if 'content' in body:
        if not isinstance(body.get('expected_version'), int):
            raise HTTPException(422, 'expected_version is required when saving content')
        add_version(db, config, body['content'], user.username, body.get('message', 'Configuration edited'), body['expected_version'])
    if 'tags' in body:
        if not isinstance(body['tags'], list) or len(body['tags']) > 50 or any(not isinstance(t, str) or len(t) > 80 for t in body['tags']):
            raise HTTPException(422, 'Invalid tags')
        config.tags = body['tags']
    if 'policy' in body:
        if body['policy'] not in POLICIES:
            raise HTTPException(422, 'Unsupported sync policy')
        config.policy = body['policy']
    for field in ('project_id', 'service_id'):
        if field in body:
            setattr(config, field, body[field])
    audit(db, user.username, 'config edited', f'config:{config.id}', f'Version {config.version}')
    db.commit()
    return config_json(config, db)


@router.delete('/configs/{config_id}')
def delete_config(config_id: int, db=Depends(get_db), user=Depends(current_user)):
    config = get_config(db, user, config_id, write=True)
    for snapshot in db.scalars(select(Snapshot)):
        if any(f['config_id'] == config_id for f in snapshot.files):
            raise HTTPException(409, 'A snapshot references this configuration; delete the snapshot first')
    audit(db, user.username, 'config deleted', f'config:{config.id}')
    db.delete(config)
    db.commit()
    return {'deleted': True}


@router.get('/configs/{config_id}/versions')
def versions(config_id: int, db=Depends(get_db), user=Depends(current_user)):
    get_config(db, user, config_id)
    return [version_json(v) for v in db.scalars(select(Version).where(Version.config_id == config_id).order_by(Version.number.desc()))]


@router.get('/configs/{config_id}/versions/{number}')
def version_detail(config_id: int, number: int, reveal: bool = False, db=Depends(get_db), user=Depends(current_user)):
    config = get_config(db, user, config_id)
    version = get_version(db, config_id, number)
    item = version_json(version)
    item['content'] = config_content(db, user, config, decrypt(version.content), reveal, 'version viewed')
    db.commit()
    return item


@router.get('/configs/{config_id}/diff')
def config_diff(config_id: int, left: int, right: int, db=Depends(get_db), user=Depends(current_user)):
    get_config(db, user, config_id)
    raw_a = decrypt(get_version(db, config_id, left).content)
    raw_b = decrypt(get_version(db, config_id, right).content)
    a, b = mask(raw_a), mask(raw_b)
    a_lines, b_lines = a.splitlines(keepends=True), b.splitlines(keepends=True)
    added = removed = 0
    for operation, i, j, k, l in difflib.SequenceMatcher(None, a_lines, b_lines).get_opcodes():
        if operation in ('replace', 'delete'):
            removed += j - i
        if operation in ('replace', 'insert'):
            added += l - k
    audit(db, user.username, 'diff viewed', f'config:{config_id}', f'Versions {left} → {right}')
    db.commit()
    return {'left': left, 'right': right, 'left_content': a, 'right_content': b, 'unified': ''.join(difflib.unified_diff(a_lines, b_lines, fromfile=f'Version {left}', tofile=f'Version {right}')), 'added': added, 'removed': removed, 'has_hidden_changes': raw_a != raw_b and a == b}


@router.post('/configs/{config_id}/restore')
def restore_config(config_id: int, body: dict, db=Depends(get_db), user=Depends(current_user)):
    config = get_config(db, user, config_id, write=True)
    if not isinstance(body.get('expected_version'), int):
        raise HTTPException(422, 'expected_version is required')
    version = get_version(db, config_id, body.get('version'))
    add_version(db, config, decrypt(version.content), user.username, f'Restored from version {version.number}', body['expected_version'])
    audit(db, user.username, 'config restored', f'config:{config.id}', f'Restored version {version.number}; new version {config.version}')
    db.commit()
    return config_json(config, db)


@router.get('/configs/{config_id}/download')
def download_config(config_id: int, reveal: bool = False, db=Depends(get_db), user=Depends(current_user)):
    config = get_config(db, user, config_id)
    text = config_content(db, user, config, decrypt(config.current_content), reveal, 'config downloaded')
    db.commit()
    safe_name = ''.join(ch for ch in config.name if ch.isascii() and (ch.isalnum() or ch in '._-')) or 'config.txt'
    return Response(text, media_type='text/plain', headers={'Content-Disposition': f'attachment; filename="{safe_name}"'})


def snapshot_json(snapshot, db, user):
    files = []
    for item in snapshot.files:
        config = db.get(Config, item['config_id'])
        if not config or not visible(user, config.device_id, config.project_id, config.service_id):
            continue
        files.append({**item, 'name': config.name, 'path': config.path})
    return {'id': snapshot.id, 'name': snapshot.name, 'description': snapshot.description, 'device_id': snapshot.device_id, 'created_at': snapshot.created_at, 'files': files}


@router.get('/snapshots')
def snapshots(db=Depends(get_db), user=Depends(current_user)):
    return [snapshot_json(s, db, user) for s in db.scalars(select(Snapshot).order_by(Snapshot.created_at.desc())) if any(visible(user, c.device_id, c.project_id, c.service_id) for f in s.files if (c := db.get(Config, f['config_id'])))]


@router.post('/snapshots', status_code=201)
def create_snapshot(body: dict, db=Depends(get_db), user=Depends(current_user)):
    require_scope(user, 'create:snapshot')
    if user.role not in ('admin', 'editor'):
        raise HTTPException(403, 'Editing permission required')
    ids = body.get('config_ids')
    query = select(Config).order_by(Config.id).with_for_update()
    if ids:
        if not isinstance(ids, list):
            raise HTTPException(422, 'config_ids must be a list')
        query = query.where(Config.id.in_(ids))
    elif body.get('device_id'):
        query = query.where(Config.device_id == body['device_id'])
    selected = list(db.scalars(query))
    if not selected or (ids and len(selected) != len(set(ids))):
        raise HTTPException(422, 'Select existing configurations for the snapshot')
    for config in selected:
        require_access(user, config.device_id, config.project_id, config.service_id, write=True)
    snapshot = Snapshot(name=name_value(body), description=str(body.get('description', ''))[:5000], device_id=body.get('device_id'), files=[{'config_id': c.id, 'version': c.version} for c in selected])
    db.add(snapshot)
    db.flush()
    audit(db, user.username, 'snapshot created', f'snapshot:{snapshot.id}', f'{len(selected)} configurations')
    db.commit()
    return snapshot_json(snapshot, db, user)


@router.get('/snapshots/{snapshot_id}')
def snapshot_detail(snapshot_id: int, db=Depends(get_db), user=Depends(current_user)):
    snapshot = db.get(Snapshot, snapshot_id)
    if not snapshot:
        raise HTTPException(404, 'Snapshot not found')
    item = snapshot_json(snapshot, db, user)
    if not item['files']:
        raise HTTPException(403, 'Snapshot is outside your permissions')
    return item


@router.post('/snapshots/{snapshot_id}/restore')
def restore_snapshot(snapshot_id: int, body: dict, db=Depends(get_db), user=Depends(current_user)):
    require_scope(user, 'write:configs')
    snapshot = db.get(Snapshot, snapshot_id)
    if not snapshot:
        raise HTTPException(404, 'Snapshot not found')
    selected_ids = body.get('config_ids')
    selected = [f for f in snapshot.files if not selected_ids or f['config_id'] in selected_ids]
    if not selected or (selected_ids and len(selected) != len(set(selected_ids))):
        raise HTTPException(422, 'Choose files belonging to this snapshot')
    expected = body.get('expected_versions', {})
    # All permissions, expected versions and encrypted blobs are checked before any write.
    pending = []
    for item in sorted(selected, key=lambda f: f['config_id']):
        config = get_config(db, user, item['config_id'], write=True)
        number = expected.get(str(config.id), expected.get(config.id))
        if not isinstance(number, int):
            raise HTTPException(422, 'expected_versions must contain every selected configuration')
        if config.version != number:
            raise HTTPException(409, 'A configuration changed; reload the snapshot comparison')
        pending.append((config, decrypt(get_version(db, config.id, item['version']).content), number, item['version']))
    for config, content, expected_number, original in pending:
        add_version(db, config, content, user.username, f'Restored snapshot {snapshot.name}, version {original}', expected_number)
        audit(db, user.username, 'snapshot file restored', f'config:{config.id}', f'Snapshot {snapshot.id}')
    audit(db, user.username, 'snapshot restored', f'snapshot:{snapshot.id}', f'{len(pending)} configurations')
    db.commit()
    return {'restored': len(pending), 'configs': [config_json(c, db) for c, *_ in pending]}


@router.delete('/snapshots/{snapshot_id}')
def delete_snapshot(snapshot_id: int, db=Depends(get_db), user=Depends(current_user)):
    require_admin(user)
    snapshot = db.get(Snapshot, snapshot_id)
    if not snapshot:
        raise HTTPException(404, 'Snapshot not found')
    db.delete(snapshot)
    audit(db, user.username, 'snapshot deleted', f'snapshot:{snapshot_id}')
    db.commit()
    return {'deleted': True}


def group_json(group, db, cls):
    field = Config.project_id if cls is Project else Config.service_id
    return {'id': group.id, 'name': group.name, 'description': group.description, 'device_id': group.device_id, 'config_count': db.scalar(select(func.count(Config.id)).where(field == group.id))}


def register_group_routes(cls, path):
    def list_groups(db=Depends(get_db), user=Depends(current_user)):
        return [group_json(g, db, cls) for g in db.scalars(select(cls).order_by(cls.name)) if visible(user, g.device_id, g.id if cls is Project else None, g.id if cls is Service else None)]
    def create_group(body: dict, db=Depends(get_db), user=Depends(current_user)):
        require_access(user, body.get('device_id'), write=True)
        if body.get('device_id') and not db.get(Device, body['device_id']):
            raise HTTPException(404, 'Device not found')
        group = cls(name=name_value(body), description=str(body.get('description', ''))[:5000], device_id=body.get('device_id'))
        db.add(group)
        db.flush()
        audit(db, user.username, f'{cls.__name__.lower()} created', f'{path}:{group.id}')
        db.commit()
        return group_json(group, db, cls)
    def update_group(group_id: int, body: dict, db=Depends(get_db), user=Depends(current_user)):
        group = db.get(cls, group_id)
        if not group:
            raise HTTPException(404, 'Group not found')
        require_access(user, group.device_id, group.id if cls is Project else None, group.id if cls is Service else None, write=True)
        if 'device_id' in body:
            destination = body['device_id']
            if destination is not None:
                if not isinstance(destination, int) or not db.get(Device, destination):
                    raise HTTPException(404, 'Destination device not found')
                require_access(user, destination, write=True)
            group.device_id = destination
        for field in ('name', 'description'):
            if field in body:
                setattr(group, field, name_value(body) if field == 'name' else str(body[field])[:5000])
        audit(db, user.username, f'{cls.__name__.lower()} updated', f'{path}:{group.id}')
        db.commit()
        return group_json(group, db, cls)
    def delete_group(group_id: int, db=Depends(get_db), user=Depends(current_user)):
        group = db.get(cls, group_id)
        if not group:
            raise HTTPException(404, 'Group not found')
        require_access(user, group.device_id, group.id if cls is Project else None, group.id if cls is Service else None, write=True)
        field = Config.project_id if cls is Project else Config.service_id
        if db.scalar(select(Config.id).where(field == group_id).limit(1)):
            raise HTTPException(409, 'Unassign configurations first')
        db.delete(group)
        audit(db, user.username, f'{cls.__name__.lower()} deleted', f'{path}:{group_id}')
        db.commit()
        return {'deleted': True}
    router.add_api_route(f'/{path}', list_groups, methods=['GET'], name=f'list_{path}')
    router.add_api_route(f'/{path}', create_group, methods=['POST'], status_code=201, name=f'create_{path}')
    router.add_api_route(f'/{path}/{{group_id}}', update_group, methods=['PATCH'], name=f'update_{path}')
    router.add_api_route(f'/{path}/{{group_id}}', delete_group, methods=['DELETE'], name=f'delete_{path}')


register_group_routes(Project, 'projects')
register_group_routes(Service, 'services')


@router.get('/activity')
def activity(limit: int = 100, db=Depends(get_db), user=Depends(current_user)):
    if user.role != 'admin':
        records = [a for a in db.scalars(select(Activity).order_by(Activity.id.desc())) if visible_activity(db, user, a)]
    else:
        records = list(db.scalars(select(Activity).order_by(Activity.id.desc()).limit(min(max(limit, 1), 500))))
    return [activity_json(a, db) for a in records[:min(max(limit, 1), 500)]]


@router.get('/templates')
def templates(db=Depends(get_db), user=Depends(current_user)):
    return [{'id': t.id, 'name': t.name, 'description': t.description, 'format': t.format, 'content': mask(decrypt(t.content)), 'has_secrets': bool(secrets(decrypt(t.content)))} for t in db.scalars(select(Template).order_by(Template.name))]


@router.get('/templates/{template_id}')
def template_detail(template_id: int, reveal: bool = False, db=Depends(get_db), user=Depends(current_user)):
    template = db.get(Template, template_id)
    if not template:
        raise HTTPException(404, 'Template not found')
    if reveal and user.role not in ('admin', 'editor'):
        raise HTTPException(403, 'Editing permission required to reveal template values')
    content = decrypt(template.content)
    if reveal and secrets(content):
        require_admin(user)
    audit(db, user.username, 'template secrets revealed' if reveal and secrets(content) else 'template viewed', f'template:{template.id}')
    db.commit()
    return {'id': template.id, 'name': template.name, 'description': template.description, 'format': template.format, 'content': content if reveal else mask(content), 'has_secrets': bool(secrets(content))}


@router.post('/templates', status_code=201)
def create_template(body: dict, db=Depends(get_db), user=Depends(current_user)):
    require_admin(user)
    validate_text(body.get('content', ''))
    template = Template(name=name_value(body), description=str(body.get('description', ''))[:5000], format=body.get('format', 'text'), content=encrypt(body.get('content', '')))
    db.add(template)
    db.flush()
    audit(db, user.username, 'template created', f'template:{template.id}')
    db.commit()
    return {'id': template.id, 'name': template.name}


@router.patch('/templates/{template_id}')
def update_template(template_id: int, body: dict, db=Depends(get_db), user=Depends(current_user)):
    require_admin(user)
    template = db.get(Template, template_id)
    if not template:
        raise HTTPException(404, 'Template not found')
    if 'name' in body:
        template.name = name_value(body)
    if 'description' in body:
        template.description = str(body['description'])[:5000]
    if 'format' in body:
        if not isinstance(body['format'], str) or not body['format'] or len(body['format']) > 40:
            raise HTTPException(422, 'Invalid template format')
        template.format = body['format']
    if 'content' in body:
        validate_text(body['content'])
        template.content = encrypt(body['content'])
    audit(db, user.username, 'template updated', f'template:{template.id}')
    db.commit()
    return {'id': template.id, 'name': template.name, 'description': template.description, 'format': template.format, 'content': mask(decrypt(template.content)), 'has_secrets': bool(secrets(decrypt(template.content)))}


@router.delete('/templates/{template_id}')
def delete_template(template_id: int, db=Depends(get_db), user=Depends(current_user)):
    require_admin(user)
    item = db.get(Template, template_id)
    if not item:
        raise HTTPException(404, 'Template not found')
    db.delete(item)
    audit(db, user.username, 'template deleted', f'template:{template_id}')
    db.commit()
    return {'deleted': True}


@router.get('/compare')
def compare_devices(left_device: int, right_device: int, db=Depends(get_db), user=Depends(current_user)):
    require_access(user, left_device)
    require_access(user, right_device)
    left = {c.path: c for c in db.scalars(select(Config).where(Config.device_id == left_device)) if visible(user, c.device_id, c.project_id, c.service_id)}
    right = {c.path: c for c in db.scalars(select(Config).where(Config.device_id == right_device)) if visible(user, c.device_id, c.project_id, c.service_id)}
    result = []
    for path in sorted(left.keys() | right.keys()):
        a, b = left.get(path), right.get(path)
        status = 'only_right' if not a else 'only_left' if not b else 'same' if decrypt(a.current_content) == decrypt(b.current_content) else 'different'
        result.append({'path': path, 'left_id': a.id if a else None, 'right_id': b.id if b else None, 'status': status})
    return result


@router.get('/projects/{project_id}/export')
def export_project(project_id: int, db=Depends(get_db), user=Depends(current_user)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404, 'Project not found')
    require_access(user, project.device_id, project_id)
    # Export includes a usable plain Git repository and omits every file containing secrets.
    import tempfile
    with tempfile.TemporaryDirectory(dir=DATA_DIR) as temporary:
        folder = Path(temporary)
        included, excluded = [], []
        for config in db.scalars(select(Config).where(Config.project_id == project_id)):
            require_access(user, config.device_id, config.project_id, config.service_id)
            content = decrypt(config.current_content)
            safe_path = Path('devices') / str(config.device_id) / str(config.id) / config.name.replace('/', '_').replace('\\', '_')
            if secrets(content) or config.name.startswith('.env'):
                excluded.append(str(safe_path))
                continue
            target = folder / safe_path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content)
            included.append(str(safe_path))
        (folder / '.gitignore').write_text('.env\n.env.*\n*.key\n*.pem\n' + '\n'.join(excluded) + '\n')
        (folder / 'EXPORT.json').write_text(json.dumps({'project': project.name, 'included': included, 'excluded_secret_files': excluded}, ensure_ascii=False, indent=2))
        git = os.environ.get('GIT_BINARY') or shutil.which('git')
        for args in (['init', '--initial-branch=main'], ['add', '.'], ['commit', '-m', 'Config Vault sanitized export']):
            subprocess.run([git, '-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Config Vault', '-c', 'user.email=vault@localhost', *args], cwd=folder, check=True, capture_output=True, timeout=30)
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
            for file in folder.rglob('*'):
                if file.is_file() and not file.is_symlink():
                    archive.write(file, str(file.relative_to(folder)))
    audit(db, user.username, 'repository exported', f'project:{project_id}', f'{len(included)} included; {len(excluded)} secret files excluded')
    db.commit()
    return Response(output.getvalue(), media_type='application/zip', headers={'Content-Disposition': f'attachment; filename="project-{project_id}.zip"'})
