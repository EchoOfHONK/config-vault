"""Explicitly scoped local and pinned-key SSH filesystem operations."""
import base64
import hashlib
import io
import json
import os
import posixpath
import shlex
import socket
import stat
import uuid
from contextlib import contextmanager
from pathlib import Path

import paramiko
from fastapi import HTTPException

from . import credentials
from .validation import MAX_CONTENT


def digest(content: str) -> str:
    return hashlib.sha256(content.encode()).hexdigest()


def fingerprint(key):
    return 'SHA256:' + base64.b64encode(hashlib.sha256(key.asbytes()).digest()).decode().rstrip('=')


def probe_host_key(device):
    info = device.connection_data or {}
    with socket.create_connection((info.get('host') or device.host, int(info.get('port', 22))), timeout=8) as sock:
        transport = paramiko.Transport(sock)
        try:
            transport.start_client(timeout=8)
            key = transport.get_remote_server_key()
            return {'host_key': f'{key.get_name()} {key.get_base64()}', 'fingerprint': fingerprint(key), 'verified': False}
        finally: transport.close()


class PinnedKey(paramiko.MissingHostKeyPolicy):
    def __init__(self, expected): self.expected = expected.strip()
    def missing_host_key(self, client, hostname, key):
        actual = f'{key.get_name()} {key.get_base64()}'
        if actual != self.expected: raise paramiko.SSHException('SSH host key mismatch')


@contextmanager
def connect(device):
    info = device.connection_data or {}
    if device.connection != 'ssh': raise HTTPException(400, 'SSH connection required')
    if not info.get('host_key'): raise HTTPException(400, 'Pin the server host key before connecting')
    stored = credentials.provider.read(device)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(PinnedKey(info['host_key']))
    pkey = None
    if stored.get('private_key'):
        for cls in (paramiko.Ed25519Key, paramiko.RSAKey, paramiko.ECDSAKey):
            try:
                pkey = cls.from_private_key(io.StringIO(stored['private_key']), password=stored.get('passphrase'))
                break
            except (paramiko.SSHException, ValueError): pass
        if pkey is None: raise HTTPException(400, 'Private key could not be loaded')
    try:
        client.connect(info.get('host') or device.host, port=int(info.get('port', 22)),
                       username=info.get('username'), password=stored.get('password'), pkey=pkey,
                       look_for_keys=False, allow_agent=False, timeout=8, auth_timeout=8, banner_timeout=8)
        yield client
    finally: client.close()


def allowed_path(device, path: str, local=False):
    if not path.startswith('/') or '\x00' in path or '..' in path.split('/'):
        raise HTTPException(400, 'An absolute path without traversal is required')
    roots = (device.connection_data or {}).get('roots', [])
    if local:
        permitted = [str(Path(p).resolve()) for p in os.getenv('VAULT_LOCAL_ROOTS', '').split(':') if p]
        roots = [r for r in roots if any(r == p or r.startswith(p.rstrip('/') + '/') for p in permitted)]
    path = posixpath.normpath(path)
    if not any(path == r.rstrip('/') or path.startswith(r.rstrip('/') + '/') for r in roots):
        raise HTTPException(403, 'Path is outside the allowed configuration folders')
    return path


class LocalFiles:
    def __init__(self, device): self.device = device
    def checked(self, path):
        original = allowed_path(self.device, path, True)
        resolved = str(Path(original).resolve())
        allowed_path(self.device, resolved, True)
        # Symlinks are never imported or replaced.
        p = Path(original)
        if any(x.is_symlink() for x in [p, *p.parents]): raise HTTPException(400, 'Symlinks are not supported')
        return p
    def read(self, path):
        p = self.checked(path)
        if not p.is_file() or p.stat().st_size > MAX_CONTENT: raise HTTPException(400, 'File missing or exceeds 1 MiB')
        return p.read_text(encoding='utf-8')
    def browse(self, path):
        p = self.checked(path)
        if not p.is_dir(): raise HTTPException(400, 'Folder required')
        children = list(p.iterdir())
        if len(children) > 2000: raise HTTPException(400, 'Folder contains more than 2000 entries')
        return [{'path': str(x), 'name': x.name, 'size': x.stat().st_size, 'is_dir': x.is_dir()} for x in sorted(children) if not x.is_symlink()]
    def write(self, path, content, expected_hash, validator=None):
        p = self.checked(path)
        lock = p.with_name('.' + p.name + '.config-vault.lock')
        try: fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError: raise HTTPException(409, 'Another apply is in progress; inspect a stale lock before removing it')
        temp = p.with_name('.config-vault-' + uuid.uuid4().hex + p.suffix)
        try:
            os.close(fd)
            previous = self.read(path)
            if digest(previous) != expected_hash: raise HTTPException(409, 'Remote file changed; refresh the comparison')
            mode = p.stat().st_mode
            with open(temp, 'x', encoding='utf-8') as out:
                out.write(content); out.flush(); os.fsync(out.fileno())
            os.chmod(temp, stat.S_IMODE(mode))
            attrs=p.stat(); temp_attrs=temp.stat()
            if (attrs.st_uid,attrs.st_gid)!=(temp_attrs.st_uid,temp_attrs.st_gid): os.chown(temp,attrs.st_uid,attrs.st_gid)
            if validator: validator(str(temp), None)
            if digest(self.read(path)) != expected_hash: raise HTTPException(409, 'Remote file changed during validation')
            os.replace(temp, p)
            return previous
        finally:
            temp.unlink(missing_ok=True); lock.unlink(missing_ok=True)


class SSHFiles:
    def __init__(self, device, client): self.device, self.client, self.sftp = device, client, client.open_sftp()
    def checked(self, path):
        path = allowed_path(self.device, path)
        resolved = self.sftp.normalize(path)
        allowed_path(self.device, resolved)
        if resolved != path: raise HTTPException(400, 'Symlinks are not supported')
        if stat.S_ISLNK(self.sftp.lstat(path).st_mode): raise HTTPException(400, 'Symlinks are not supported')
        return path
    def read(self, path):
        path = self.checked(path)
        attrs = self.sftp.stat(path)
        if not stat.S_ISREG(attrs.st_mode) or attrs.st_size > MAX_CONTENT: raise HTTPException(400, 'File missing or exceeds 1 MiB')
        with self.sftp.open(path, 'r') as f: return f.read(MAX_CONTENT + 1).decode('utf-8')
    def browse(self, path):
        path = self.checked(path)
        entries = self.sftp.listdir_attr(path)
        if len(entries) > 2000: raise HTTPException(400, 'Folder contains more than 2000 entries')
        return [{'path': posixpath.join(path, x.filename), 'name': x.filename, 'size': x.st_size,
                 'is_dir': stat.S_ISDIR(x.st_mode)} for x in sorted(entries, key=lambda x:x.filename) if not stat.S_ISLNK(x.st_mode)]
    def write(self, path, content, expected_hash, validator=None):
        path = self.checked(path)
        lock = posixpath.join(posixpath.dirname(path), '.' + posixpath.basename(path) + '.config-vault.lock')
        temp = posixpath.join(posixpath.dirname(path), '.config-vault-' + uuid.uuid4().hex + posixpath.splitext(path)[1])
        try:
            with self.sftp.open(lock, 'x'): pass
        except IOError: raise HTTPException(409, 'Another apply is in progress or the directory is not writable')
        try:
            previous = self.read(path)
            if digest(previous) != expected_hash: raise HTTPException(409, 'Remote file changed; refresh the comparison')
            attrs = self.sftp.stat(path)
            with self.sftp.open(temp, 'wx') as f: f.write(content.encode()); f.flush()
            self.sftp.chmod(temp, stat.S_IMODE(attrs.st_mode))
            # Preserve ownership or abort instead of silently changing it.
            actual = self.sftp.stat(temp)
            if (actual.st_uid, actual.st_gid) != (attrs.st_uid, attrs.st_gid): self.sftp.chown(temp, attrs.st_uid, attrs.st_gid)
            if validator: validator(temp, self.client)
            if digest(self.read(path)) != expected_hash: raise HTTPException(409, 'Remote file changed during validation')
            try: self.sftp.posix_rename(temp, path)
            except IOError: raise HTTPException(400, 'Server must support atomic POSIX rename; file was not applied')
            return previous
        finally:
            for x in (temp, lock):
                try: self.sftp.remove(x)
                except IOError: pass


@contextmanager
def filesystem(device):
    if device.connection == 'local': yield LocalFiles(device)
    elif device.connection == 'ssh':
        with connect(device) as client:
            fs = SSHFiles(device, client)
            try: yield fs
            finally: fs.sftp.close()
    else: raise HTTPException(400, 'This device uses manual import')


def run_checked(command: str, client=None):
    if client:
        _, out, err = client.exec_command(command, timeout=30)
        out.channel.settimeout(30)
        # No command output enters logs/API: it can contain configuration secrets.
        out.read(65536); err.read(65536)
        code = out.channel.recv_exit_status()
    else:
        import subprocess
        try: code = subprocess.run(shlex.split(command), capture_output=True, timeout=30).returncode
        except (FileNotFoundError, subprocess.TimeoutExpired): raise HTTPException(422, 'Validator unavailable or timed out')
    if code: raise HTTPException(422, 'Remote validation or hook failed; check the device locally for diagnostics')


def validator_for(config):
    fmt = config.format
    if fmt == 'nginx': return lambda path,client:run_checked('nginx -t -c ' + shlex.quote(path), client)
    if fmt in ('yaml','yml') and 'compose' in config.name.lower():
        return lambda path,client:run_checked('docker compose -f ' + shlex.quote(path) + ' config --quiet', client)
    if fmt == 'systemd': return lambda path,client:run_checked('systemd-analyze verify ' + shlex.quote(path), client)
    return None
