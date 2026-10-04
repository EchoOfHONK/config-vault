import io
import json
import os
import posixpath
import tarfile
import zipfile
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select

from .db import get_db
from .models import Config, Device, Setting
from .security import current_user, decrypt, encrypt, mask, require_access, require_admin, require_scope
from .core import add_version, audit, config_json, references
from .remote import connect, digest, filesystem, probe_host_key, run_checked, validator_for
from .validation import MAX_CONTENT, detect_format, validate_content
from . import credentials

router = APIRouter(prefix='/api')
POLICIES = {'manual', 'pull_only', 'push_pull', 'watch', 'backup_only'}


def device_for(db, user, device_id, write=False):
    device = db.get(Device, device_id)
    if not device: raise HTTPException(404, 'Device not found')
    require_access(user, device_id=device_id, write=write)
    return device


def config_for(db, user, config_id, write=False):
    config = db.get(Config, config_id)
    if not config: raise HTTPException(404, 'Configuration not found')
    require_access(user, config.device_id, config.project_id, config.service_id, write)
    return config


def require_source_access(user, config, write=False):
    # Project/service editors may use an approved source, but cannot turn an
    # arbitrary uploaded path into access through an administrator's credential.
    if config.remote_hash is None:
        require_access(user, device_id=config.device_id, write=write)


def policy_check(policy):
    if policy not in POLICIES: raise HTTPException(422, 'Unknown sync policy')


def safe_error(exc):
    if isinstance(exc, HTTPException): raise exc
    raise HTTPException(502, 'Device operation failed. Check credentials, permissions, host key and availability.') from None


@router.post('/validate')
def validate(data: dict = Body(...), user=Depends(current_user)):
    return validate_content(data.get('format', 'text'), data.get('content', ''))


@router.put('/devices/{device_id}/credential')
def credential(device_id: int, data: dict = Body(...), db=Depends(get_db), user=Depends(current_user)):
    require_admin(user)
    device = device_for(db, user, device_id, True)
    credentials.provider.write(device,data)
    audit(db, user.username, 'credential updated', f'device:{device.id}')
    db.commit()
    return {'saved': True}


@router.get('/devices/{device_id}/host-key')
def host_key(device_id: int, db=Depends(get_db), user=Depends(current_user)):
    require_admin(user)
    device = device_for(db, user, device_id)
    try: return probe_host_key(device)
    except Exception as exc: safe_error(exc)


@router.post('/devices/{device_id}/test')
def test_connection(device_id: int, db=Depends(get_db), user=Depends(current_user)):
    device = device_for(db, user, device_id, True)
    try:
        with filesystem(device) as fs:
            roots = device.roots
            if not roots: raise HTTPException(422, 'Configure allowed folders first')
            fs.browse(roots[0])
        device.status = 'Online'
        audit(db, user.username, 'connection tested', f'device:{device.id}')
        db.commit()
        return {'connected': True}
    except Exception as exc:
        device.status = 'Auth Error' if device.connection == 'ssh' else 'Offline'
        db.commit(); safe_error(exc)


@router.get('/devices/{device_id}/browse')
def browse(device_id: int, path: str, db=Depends(get_db), user=Depends(current_user)):
    device = device_for(db, user, device_id)
    try:
        with filesystem(device) as fs: files = fs.browse(path)
        return {'path': path, 'files': files}
    except Exception as exc: safe_error(exc)


def import_one(db, device, path, content, actor, policy='manual', project_id=None, service_id=None, source=False):
    policy_check(policy)
    fmt = detect_format(path, content)
    result = validate_content(fmt, content)
    if not result['valid']: raise HTTPException(422, result['errors'])
    config = db.scalar(select(Config).where(Config.device_id == device.id, Config.path == path))
    if config: raise HTTPException(409, f'A configuration already exists at {path}; use Sync')
    config = Config(name=posixpath.basename(path), path=path, device_id=device.id,
                    format=fmt, policy=policy, tags=[], version=0, current_content='', project_id=project_id, service_id=service_id)
    db.add(config); db.flush()
    add_version(db, config, content, actor, 'Imported configuration')
    if source and device.connection in ('ssh','local'):
        config.remote_hash = digest(content); config.synced_version = config.version
    audit(db, actor, 'config imported', f'config:{config.id}')
    return config


@router.post('/devices/{device_id}/import')
def device_import(device_id: int, data: dict = Body(...), db=Depends(get_db), user=Depends(current_user)):
    device = device_for(db, user, device_id, True)
    require_scope(user, 'write:configs')
    paths = data.get('paths', [])
    if not paths or len(paths) > 500: raise HTTPException(422, 'Choose 1–500 files')
    try:
        with filesystem(device) as fs:
            files = [(path, fs.read(path)) for path in paths]
        configs = [import_one(db,device,path,content,user.username,data.get('policy','pull_only'),source=True) for path,content in files]
        device.status='Online'; device.last_sync=datetime.now(timezone.utc)
        db.commit()
        return [config_json(c,db) for c in configs]
    except Exception as exc:
        db.rollback(); safe_error(exc)


def sync_device(db, device, actor='Auto Sync', automatic=False):
    changes, conflicts = [], []
    query = select(Config).where(Config.device_id == device.id).with_for_update()
    configs = db.scalars(query).all()
    with filesystem(device) as fs:
        for config in configs:
            if automatic and config.remote_hash is None: continue
            if automatic and config.policy not in ('pull_only','push_pull','watch','backup_only'): continue
            if automatic and device.connection=='local' and not (device.connection_data or {}).get('auto_sync') and config.policy!='watch': continue
            content = fs.read(config.path)
            remote_hash = digest(content)
            if remote_hash == config.remote_hash: continue
            if config.synced_version is not None and config.version != config.synced_version:
                config.conflict = True; conflicts.append(config.id)
                audit(db, actor, 'conflict detected', f'config:{config.id}')
                continue
            result = validate_content(config.format, content)
            if not result['valid']:
                audit(db, actor, 'sync validation failed', f'config:{config.id}')
            if content != decrypt(config.current_content):
                add_version(db, config, content, actor, 'External change detected; author unknown' + ('; validation failed' if not result['valid'] else ''))
                changes.append(config.id)
            config.remote_hash=remote_hash; config.synced_version=config.version; config.conflict=False
    device.status = 'Conflict' if conflicts else ('Changes Detected' if changes else 'Online')
    device.last_sync=datetime.now(timezone.utc)
    audit(db, actor, 'remote sync', f'device:{device.id}', f'{len(changes)} changes; {len(conflicts)} conflicts')
    return {'changes': changes, 'conflicts': conflicts, 'status': device.status}


@router.post('/devices/{device_id}/sync')
def sync(device_id: int, db=Depends(get_db), user=Depends(current_user)):
    device = device_for(db, user, device_id, True)
    require_scope(user, 'sync:device')
    try:
        result = sync_device(db, device, user.username)
        db.commit(); return result
    except Exception as exc:
        db.rollback(); safe_error(exc)


@router.get('/configs/{config_id}/remote')
def remote_content(config_id: int, reveal: bool = False, db=Depends(get_db), user=Depends(current_user)):
    config = config_for(db,user,config_id)
    require_source_access(user, config)
    if reveal: require_access(user,config.device_id,config.project_id,config.service_id,True)
    device = db.get(Device,config.device_id)
    try:
        with filesystem(device) as fs: content=fs.read(config.path)
        value=digest(content)
        audit(db,user.username,'remote secrets revealed' if reveal else 'remote viewed',f'config:{config.id}'); db.commit()
        return {'content':content if reveal else mask(content),'hash':value,'conflict':value!=config.remote_hash}
    except Exception as exc: safe_error(exc)


HOOKS = {'nginx_reload':'systemctl reload nginx', 'systemd_reload':'systemctl daemon-reload', 'compose_up':'docker compose -f {path} up -d'}


def hook_setting(db, device_id):
    row = db.get(Setting, 'hooks:' + str(device_id))
    return row.value if row else {'enabled': False, 'command': 'nginx_reload'}


@router.get('/devices/{device_id}/hooks')
def get_hooks(device_id: int, db=Depends(get_db), user=Depends(current_user)):
    device_for(db,user,device_id)
    return {**hook_setting(db,device_id), 'commands':HOOKS}


@router.get('/configs/{config_id}/hooks')
def config_hooks(config_id: int, db=Depends(get_db), user=Depends(current_user)):
    config = config_for(db,user,config_id)
    require_source_access(user, config)
    value = hook_setting(db,config.device_id)
    if value.get('config_id') not in (None,config.id):
        value = {'enabled':False,'command':value.get('command')}
    return {**value,'commands':HOOKS}


@router.put('/devices/{device_id}/hooks')
def set_hooks(device_id: int, data: dict = Body(...), db=Depends(get_db), user=Depends(current_user)):
    require_admin(user); device_for(db,user,device_id,True)
    if data.get('command') not in HOOKS: raise HTTPException(422, 'Select an approved hook command')
    config_id = data.get('config_id')
    if config_id and config_for(db,user,int(config_id)).device_id != device_id: raise HTTPException(422,'Hook file must belong to device')
    value={'enabled':bool(data.get('enabled')), 'command':data['command'], 'config_id':config_id}
    row=db.get(Setting,'hooks:'+str(device_id))
    if row: row.value=value
    else: db.add(Setting(key='hooks:'+str(device_id),value=value))
    audit(db,user.username,'hook settings changed',f'device:{device_id}',data['command'])
    db.commit(); return value


def apply_config(db,user,config,data):
    require_source_access(user, config, write=True)
    if config.policy != 'push_pull': raise HTTPException(403, 'Apply requires an explicitly enabled Push/Pull policy')
    if data.get('expected_version') != config.version: raise HTTPException(409,'Vault version changed; reload first')
    if not data.get('expected_remote_hash'): raise HTTPException(422,'Refresh remote comparison before Apply')
    content=decrypt(config.current_content)
    if '••••••••' in content: raise HTTPException(422,'Masked placeholders cannot be applied. Reveal and enter the actual values first.')
    result=validate_content(config.format,content)
    if not result['valid']: raise HTTPException(422,result['errors'])
    device=db.get(Device,config.device_id)
    hook=hook_setting(db,device.id)
    if data.get('run_hook') and not hook.get('enabled'): raise HTTPException(403,'Hooks are disabled')
    if data.get('run_hook') and hook.get('config_id') not in (None,config.id): raise HTTPException(403,'Hook is scoped to another configuration')
    with filesystem(device) as fs:
        old=fs.read(config.path)
        if digest(old) != data['expected_remote_hash']: raise HTTPException(409,'Remote file changed; refresh the comparison')
        # Preserve remote pre-apply content inside authenticated encrypted storage, even during conflict resolution.
        db.add(Setting(key='preapply:'+str(config.id)+':'+datetime.now(timezone.utc).isoformat(),value=encrypt(old)))
        audit(db,user.username,'apply prepared',f'config:{config.id}')
        db.commit()
        config = db.scalar(select(Config).where(Config.id == config.id).with_for_update().execution_options(populate_existing=True))
        if data.get('expected_version') != config.version: raise HTTPException(409,'Vault version changed during preparation')
        from .models import Version
        # A conflicting external state must remain accessible through ordinary history.
        if old!=content and not any(decrypt(v.content)==old for v in db.scalars(select(Version).where(Version.config_id==config.id))):
            add_version(db,config,old,user.username,'Captured remote configuration before Apply',config.version)
            add_version(db,config,content,user.username,'Applied Vault configuration after capturing remote',config.version)
        fs.write(config.path,content,data['expected_remote_hash'],validator_for(config))
        config.remote_hash=digest(content); config.synced_version=config.version; config.conflict=False
        audit(db,user.username,'push',f'config:{config.id}'); db.commit()
        if data.get('run_hook'):
            import shlex
            command=HOOKS[hook['command']].format(path=shlex.quote(config.path))
            audit(db,user.username,'remote command started',f'config:{config.id}',command); db.commit()
            try: run_checked(command,getattr(fs,'client',None))
            except Exception:
                audit(db,user.username,'remote command failed',f'config:{config.id}',hook['command']); db.commit()
                raise HTTPException(422,'Configuration applied, but hook failed. Inspect the service locally.')
            audit(db,user.username,'remote command completed',f'config:{config.id}',hook['command']); db.commit()
    return config_json(config,db)


@router.post('/configs/{config_id}/apply')
def apply(config_id: int, data: dict = Body(...), db=Depends(get_db), user=Depends(current_user)):
    config=config_for(db,user,config_id,True)
    require_scope(user,'sync:device')
    try: return apply_config(db,user,config,data)
    except Exception as exc: safe_error(exc)


@router.post('/configs/{config_id}/resolve')
def resolve(config_id: int, data: dict = Body(...), db=Depends(get_db), user=Depends(current_user)):
    config=config_for(db,user,config_id,True)
    require_scope(user,'sync:device')
    if data.get('expected_version') != config.version: raise HTTPException(409,'Vault version changed; refresh comparison')
    require_source_access(user, config, write=True)
    device=db.get(Device,config.device_id)
    try:
        with filesystem(device) as fs: content=fs.read(config.path)
        if digest(content)!=data.get('expected_remote_hash'): raise HTTPException(409,'Remote file changed; refresh comparison')
        if data.get('strategy')=='remote':
            add_version(db,config,content,user.username,'Conflict resolved: kept remote',config.version)
            config.remote_hash=digest(content); config.synced_version=config.version; config.conflict=False
            audit(db,user.username,'conflict resolved',f'config:{config.id}','Kept remote'); db.commit()
            return config_json(config,db)
        if data.get('strategy')=='manual':
            if config.policy!='push_pull': raise HTTPException(403,'Manual merge Apply requires Push/Pull policy')
            merged=data.get('content','')
            result=validate_content(config.format,merged)
            if not result['valid']: raise HTTPException(422,result['errors'])
            add_version(db,config,merged,user.username,'Conflict resolved: manual merge',config.version)
            db.commit(); data={**data,'expected_version':config.version}
        elif data.get('strategy')!='vault': raise HTTPException(422,'Unknown resolution strategy')
        return apply_config(db,user,config,data)
    except Exception as exc: safe_error(exc)


def archive_files(name, raw):
    result=[]; size=0
    def append(path,value):
        nonlocal size
        path=path.replace('\\','/')
        if path.startswith('/') or '..' in path.split('/') or not path: raise HTTPException(422,'Archive contains unsafe path')
        size+=len(value)
        if len(result)>=500 or size>20*MAX_CONTENT or len(value)>MAX_CONTENT: raise HTTPException(413,'Archive exceeds file/count/size limits')
        try: text=value.decode('utf-8')
        except UnicodeDecodeError: raise HTTPException(422,'Only UTF-8 text configurations can be imported')
        if '\x00' in text: raise HTTPException(422,'Binary files cannot be imported')
        result.append((path,text))
    if name.lower().endswith('.zip'):
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            if len(archive.infolist())>1000: raise HTTPException(413,'Too many archive entries')
            for member in archive.infolist():
                if member.is_dir(): continue
                if stat_is_symlink(member.external_attr>>16): raise HTTPException(422,'Archive symlinks are forbidden')
                if member.file_size>MAX_CONTENT: raise HTTPException(413,'File exceeds 1 MiB')
                append(member.filename,archive.read(member))
    elif name.lower().endswith(('.tar','.tar.gz','.tgz','.tar.bz2','.tar.xz')):
        with tarfile.open(fileobj=io.BytesIO(raw),mode='r:*') as archive:
            count=0
            for member in archive:
                count+=1
                if count>1000: raise HTTPException(413,'Too many archive entries')
                if member.isdir(): continue
                if not member.isfile(): raise HTTPException(422,'Only regular files are allowed in archives')
                if member.size>MAX_CONTENT: raise HTTPException(413,'File exceeds 1 MiB')
                append(member.name,archive.extractfile(member).read(MAX_CONTENT+1))
    else: append(name,raw)
    return result


def stat_is_symlink(mode):
    import stat
    return stat.S_ISLNK(mode)


@router.post('/import/files')
async def file_import(files: list[UploadFile] = File(...), device_id: int = Form(...), project_id: int|None = Form(None),
                      service_id: int|None = Form(None), policy: str = Form('manual'), base_path: str = Form('/'),
                      db=Depends(get_db), user=Depends(current_user)):
    references(db,user,device_id,project_id,service_id)
    device=db.get(Device,device_id)
    policy_check(policy)
    if not base_path.startswith('/') or '..' in base_path.split('/'): raise HTTPException(422,'Absolute base path required')
    imported=[]; total=0; expanded=0
    try:
        for upload in files:
            raw=await upload.read(20*MAX_CONTENT+1); total+=len(raw)
            if total>20*MAX_CONTENT: raise HTTPException(413,'Upload exceeds 20 MiB')
            for path,content in archive_files(upload.filename or 'config.txt',raw):
                expanded += len(content.encode())
                if expanded>20*MAX_CONTENT: raise HTTPException(413,'Expanded upload exceeds 20 MiB')
                imported.append(import_one(db,device,posixpath.join(base_path,path),content,user.username,policy,project_id,service_id))
                if len(imported)>500: raise HTTPException(413,'Too many files')
        db.commit(); return [config_json(c,db) for c in imported]
    except HTTPException:
        db.rollback(); raise
    except Exception:
        db.rollback(); raise HTTPException(422,'Import failed: corrupt archive, duplicate paths or invalid metadata') from None
