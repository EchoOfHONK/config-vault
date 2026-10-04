"""Authenticated encrypted logical backup. API and offline CLI share these functions."""
import argparse
import base64
import io
import json
import os
from pathlib import Path
import secrets
import shutil
import tempfile
import zipfile
from datetime import datetime

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import DateTime, Integer, create_engine, delete, event, insert, select, text

from .db import Base, DATA_DIR, SessionLocal, engine, get_db
from . import models
from .models import Backup, Config, Setting, Version, now
from .core import audit, git_mirror
from .security import current_user, require_admin, vault_key

router = APIRouter(prefix='/api')
MAGIC = b'CONFIGVAULT-BACKUP-1\n'
MAX_BACKUP_SIZE = 256 * 1024 * 1024


def backup_key(password, salt):
    if password:
        if len(password) < 12 or len(password) > 4096:
            raise ValueError('Backup password must contain 12–4096 characters')
        return base64.urlsafe_b64encode(Scrypt(salt=salt, length=32, n=32768, r=8, p=1).derive(password.encode()))
    return vault_key()


def export_database():
    with SessionLocal() as db:
        if engine.dialect.name == 'postgresql':
            db.connection(execution_options={'isolation_level': 'REPEATABLE READ'})
        result = {}
        for table in Base.metadata.sorted_tables:
            if table.name == 'sessions':
                result[table.name] = []
                continue
            records = []
            for row in db.execute(select(table)).mappings():
                records.append({key: value.isoformat() if isinstance(value, datetime) else value for key, value in row.items()})
            result[table.name] = records
        return result


def create_backup(db, actor='Scheduler', password=None, output=None):
    DATA_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    folder = DATA_DIR / 'backups'
    folder.mkdir(exist_ok=True, mode=0o700)
    name = Path(output).name if output else f"config-vault-{now().strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(4)}.cvbackup"
    record = Backup(name=name, status='Pending')
    db.add(record)
    db.commit()
    target = Path(output) if output else folder / name
    temporary = target.with_name(target.name + '.tmp')
    try:
        data = {'schema_version': 1, 'created_at': now().isoformat(), 'vault_key': vault_key().decode(), 'database': export_database()}
        bundle = io.BytesIO()
        with zipfile.ZipFile(bundle, 'w', zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('database.json', json.dumps(data, ensure_ascii=False))
            git = DATA_DIR / 'git'
            if git.exists():
                for file in git.rglob('*'):
                    if file.is_file() and not file.is_symlink() and file.stat().st_size < MAX_BACKUP_SIZE:
                        archive.write(file, 'git/' + str(file.relative_to(git)))
        if bundle.tell() > MAX_BACKUP_SIZE:
            raise ValueError('Backup exceeds the configured 256 MiB limit')
        salt = os.urandom(16)
        header = json.dumps({'mode': 'password' if password else 'vault', 'salt': base64.b64encode(salt).decode()}).encode() + b'\n'
        encrypted = Fernet(backup_key(password, salt)).encrypt(bundle.getvalue())
        target.parent.mkdir(parents=True, exist_ok=True)
        with temporary.open('wb') as handle:
            os.chmod(temporary, 0o600)
            handle.write(MAGIC + header + encrypted)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, target)
        record.status = 'Completed'
        record.size = target.stat().st_size
        audit(db, actor, 'backup created', f'backup:{record.id}', 'Portable password encryption' if password else 'Vault key encryption')
        db.commit()
        return record
    except Exception:
        temporary.unlink(missing_ok=True)
        db.rollback()
        record = db.get(Backup, record.id)
        record.status = 'Failed'
        record.error = 'Backup failed; check storage and instance logs'
        audit(db, actor, 'backup failed', f'backup:{record.id}')
        db.commit()
        raise


def decode_backup(blob, password=None):
    if len(blob) > MAX_BACKUP_SIZE * 2 or not blob.startswith(MAGIC):
        raise ValueError('Invalid or oversized Config Vault backup')
    header_raw, encrypted = blob[len(MAGIC):].split(b'\n', 1)
    if len(header_raw) > 4096:
        raise ValueError('Invalid backup header')
    header = json.loads(header_raw)
    if header.get('mode') not in ('password', 'vault'):
        raise ValueError('Unsupported backup encryption')
    if header['mode'] == 'password' and not password:
        raise ValueError('This portable backup requires its password')
    salt = base64.b64decode(header['salt'], validate=True)
    if len(salt) != 16:
        raise ValueError('Invalid backup salt')
    key = backup_key(password, salt) if header['mode'] == 'password' else vault_key()
    try:
        decrypted = Fernet(key).decrypt(encrypted)
    except InvalidToken as error:
        raise ValueError('Backup authentication failed: incorrect key/password or corrupted file') from error
    if len(decrypted) > MAX_BACKUP_SIZE:
        raise ValueError('Decrypted backup exceeds size limit')
    with zipfile.ZipFile(io.BytesIO(decrypted)) as archive:
        info = archive.getinfo('database.json')
        if info.file_size > MAX_BACKUP_SIZE or sum(i.file_size for i in archive.infolist()) > MAX_BACKUP_SIZE * 4:
            raise ValueError('Backup archive exceeds size limit')
        data = json.loads(archive.read(info))
    if data.get('schema_version') != 1 or not isinstance(data.get('database'), dict):
        raise ValueError('Unsupported database schema')
    source_cipher = Fernet(data['vault_key'].encode())
    destination_cipher = Fernet(vault_key())
    tables = data['database']
    if set(tables) != set(Base.metadata.tables):
        raise ValueError('Backup database schema does not match this application version')
    encrypted_fields = {'configs': ['current_content'], 'versions': ['content'], 'devices': ['credential'], 'templates': ['content']}
    for table in Base.metadata.sorted_tables:
        if not isinstance(tables[table.name], list):
            raise ValueError('Invalid database table')
        if len(tables[table.name]) > 500000:
            raise ValueError('Backup row limit exceeded')
        for row in tables[table.name]:
            if set(row) != set(table.columns.keys()):
                raise ValueError('Backup row schema does not match')
            for column in table.columns:
                if isinstance(column.type, DateTime) and row[column.name] is not None:
                    row[column.name] = datetime.fromisoformat(row[column.name])
            for field in encrypted_fields.get(table.name, []):
                if row[field]:
                    plain = source_cipher.decrypt(row[field].encode())
                    if len(plain) > 2 * 1024 * 1024:
                        raise ValueError('Backup contains an oversized configuration')
                    row[field] = destination_cipher.encrypt(plain).decode()
            if table.name == 'settings' and row['key'].startswith('preapply:'):
                plain = source_cipher.decrypt(str(row['value']).encode())
                row['value'] = destination_cipher.encrypt(plain).decode()
            if table.name == 'backups':
                if Path(row['name']).name != row['name']:
                    raise ValueError('Invalid backup filename')
                if row['status'] in ('Pending', 'Completed'):
                    row['status'] = 'Archived'
                    row['error'] = 'Archive history restored; original backup files are stored separately'
    tables['sessions'] = []
    # A full foreign-key/uniqueness validation runs before the live database is touched.
    test_engine = create_engine('sqlite://')
    @event.listens_for(test_engine, 'connect')
    def enable_constraints(connection, _):
        connection.execute('PRAGMA foreign_keys=ON')
    try:
        Base.metadata.create_all(test_engine)
        with test_engine.begin() as connection:
            for table in Base.metadata.sorted_tables:
                if tables[table.name]:
                    connection.execute(insert(table), tables[table.name])
        versions = {(v['config_id'], v['number']): v for v in tables['versions']}
        for config in tables['configs']:
            version = versions.get((config['id'], config['version']))
            if not version or destination_cipher.decrypt(version['content'].encode()) != destination_cipher.decrypt(config['current_content'].encode()):
                raise ValueError('Backup current version integrity check failed')
        for snapshot in tables['snapshots']:
            if any((f['config_id'], f['version']) not in versions for f in snapshot['files']):
                raise ValueError('Backup snapshot integrity check failed')
        if not any(u['role'] == 'admin' for u in tables['users']):
            raise ValueError('Backup has no administrator')
    finally:
        test_engine.dispose()
    return tables


def restore_backup(blob, password=None, actor='Recovery'):
    tables = decode_backup(blob, password)
    DATA_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    stage = Path(tempfile.mkdtemp(prefix='restore-git-', dir=DATA_DIR))
    versions = [{'config_id': row['config_id'], 'number': row['number'], 'content': row['content'], 'actor': row['actor'], 'message': row['message'], 'created_at': row['created_at'].isoformat()} for row in sorted(tables['versions'], key=lambda v: v['id'])]
    try:
        # Prepare the complete encrypted version repository before replacing any live data.
        git_mirror(versions, stage)
        with SessionLocal() as db:
            if engine.dialect.name == 'postgresql':
                db.execute(text('SELECT pg_advisory_xact_lock(771204916)'))
                for table in Base.metadata.sorted_tables:
                    db.execute(text(f'LOCK TABLE "{table.name}" IN ACCESS EXCLUSIVE MODE'))
            for table in reversed(Base.metadata.sorted_tables):
                db.execute(delete(table))
            for table in Base.metadata.sorted_tables:
                if tables[table.name]:
                    db.execute(insert(table), tables[table.name])
                if engine.dialect.name == 'postgresql' and 'id' in table.c and isinstance(table.c.id.type, Integer):
                    db.execute(text('SELECT setval(pg_get_serial_sequence(:table, \'id\'), COALESCE((SELECT MAX(id) FROM "' + table.name + '"), 1), EXISTS(SELECT 1 FROM "' + table.name + '"))'), {'table': table.name})
            audit(db, actor, 'backup restored', 'instance', 'All browser sessions revoked; encrypted contents restored')
            db.commit()
        live = DATA_DIR / 'git'
        previous = DATA_DIR / ('git-before-restore-' + secrets.token_hex(4))
        if live.exists():
            os.replace(live, previous)
        os.replace(stage, live)
        shutil.rmtree(previous, ignore_errors=True)
        return {'restored': True, 'configs': len(tables['configs']), 'versions': len(tables['versions']), 'snapshots': len(tables['snapshots']), 'devices': len(tables['devices']), 'users': len(tables['users']), 'sessions_revoked': True}
    finally:
        shutil.rmtree(stage, ignore_errors=True)


def backup_json(record):
    return {**{key: getattr(record, key) for key in ('id', 'name', 'created_at', 'size', 'status', 'error')}, 'available': record.status == 'Completed' and (DATA_DIR / 'backups' / record.name).is_file()}


@router.get('/backups')
def list_backups(db=Depends(get_db), user=Depends(current_user)):
    require_admin(user)
    return [backup_json(b) for b in db.scalars(select(Backup).order_by(Backup.created_at.desc()))]


@router.post('/backups', status_code=201)
def backup_endpoint(body: dict, db=Depends(get_db), user=Depends(current_user)):
    require_admin(user)
    try:
        return backup_json(create_backup(db, user.username, body.get('password')))
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


@router.get('/backups/{backup_id}/download')
def backup_download(backup_id: int, db=Depends(get_db), user=Depends(current_user)):
    require_admin(user)
    record = db.get(Backup, backup_id)
    if not record or record.status != 'Completed':
        raise HTTPException(404, 'Backup not found')
    path = DATA_DIR / 'backups' / record.name
    if not path.is_file():
        raise HTTPException(404, 'Backup file not available on this instance')
    audit(db, user.username, 'backup downloaded', f'backup:{backup_id}')
    db.commit()
    return FileResponse(path, filename=record.name, media_type='application/octet-stream')


@router.post('/backups/restore')
async def backup_restore(file: UploadFile = File(...), password: str = Form(''), confirm: bool = Form(False), db=Depends(get_db), user=Depends(current_user)):
    require_admin(user)
    if not confirm:
        raise HTTPException(422, 'Explicit restore confirmation is required')
    blob = await file.read(MAX_BACKUP_SIZE * 2 + 1)
    db.rollback()  # release the authenticating transaction before exclusive restore
    try:
        return restore_backup(blob, password or None, user.username)
    except (ValueError, KeyError, InvalidToken, zipfile.BadZipFile) as error:
        raise HTTPException(422, 'Backup restore validation failed; check key/password and archive integrity') from error


def cli():
    parser = argparse.ArgumentParser(description='Config Vault encrypted backup and atomic offline recovery')
    subcommands = parser.add_subparsers(dest='command', required=True)
    create = subcommands.add_parser('create')
    create.add_argument('--output', required=True)
    create.add_argument('--password-file')
    restore = subcommands.add_parser('restore')
    restore.add_argument('--input', required=True)
    restore.add_argument('--password-file')
    restore.add_argument('--confirm', action='store_true', required=True)
    args = parser.parse_args()
    password = Path(args.password_file).read_text().strip() if args.password_file else None
    Base.metadata.create_all(engine)
    if args.command == 'create':
        with SessionLocal() as db:
            record = create_backup(db, 'Recovery CLI', password, Path(args.output))
            print(json.dumps({'backup': args.output, 'size': record.size}))
    else:
        print(json.dumps(restore_backup(Path(args.input).read_bytes(), password)))


if __name__ == '__main__':
    cli()
