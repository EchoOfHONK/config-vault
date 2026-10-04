"""Real filesystem and SSH protocol workflow tests; no mocked SSH/backup."""
import base64
import io
import json
import os
import tarfile
import zipfile
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.remote_routes import archive_files
from app.validation import detect_format, validate_content


def ok(response, status=200):
    assert response.status_code == status, response.text
    return response.json()


def local_device(client, tmp_path, monkeypatch):
    monkeypatch.setenv('VAULT_LOCAL_ROOTS', str(tmp_path))
    return ok(client.post('/api/devices', json={'name':'Actual local filesystem', 'connection':'local',
        'connection_data':{'roots':[str(tmp_path)],'auto_sync':False}}),201)


def test_scoped_upload_cannot_manufacture_remote_access(client, tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.db import SessionLocal
    from app.models import Device
    from app.remote_routes import sync_device
    device = local_device(client, tmp_path, monkeypatch)
    did = device['id']
    other = ok(client.post('/api/devices', json={'name':'Unassigned device'}),201)['id']
    project = ok(client.post('/api/projects', json={'name':'Scoped app', 'device_id':did}),201)['id']
    path = tmp_path/'private.txt'; path.write_text('administrator-only remote contents')
    ok(client.post('/api/users', json={'username':'project-editor','password':'Editor-password-2026',
        'role':'editor','project_ids':[project]}),201)
    approved = tmp_path/'approved.txt'; approved.write_text('approved source')
    registered = ok(client.post(f'/api/devices/{did}/import', json={'paths':[str(approved)],'policy':'push_pull'}))[0]
    ok(client.patch(f"/api/configs/{registered['id']}",json={'project_id':project}))
    with TestClient(app) as editor:
        auth=ok(editor.post('/api/auth/login',json={'username':'project-editor','password':'Editor-password-2026'}))
        editor.headers['X-CSRF-Token']=auth['csrf']
        assert editor.post('/api/configs',json={'name':'forbidden','device_id':other,'project_id':project,'content':'text'}).status_code==403
        uploaded=ok(editor.post('/api/import/files',data={'device_id':str(did),'project_id':str(project),
            'policy':'watch','base_path':str(tmp_path)},files={'files':('private.txt',b'uploaded contents','text/plain')})) [0]
        cid=uploaded['id']; assert uploaded['remote_hash'] is None
        assert editor.get(f'/api/configs/{cid}/remote?reveal=true').status_code==403
        assert editor.get(f'/api/configs/{cid}/hooks').status_code==403
        assert editor.post(f'/api/configs/{cid}/resolve',json={'strategy':'remote','expected_version':1}).status_code==403
        assert editor.post(f'/api/configs/{cid}/apply',json={'expected_version':1,'expected_remote_hash':'fake'}).status_code==403
        with SessionLocal() as db:
            sync_device(db,db.get(Device,did),automatic=True); db.commit()
        assert ok(editor.get(f'/api/configs/{cid}'))['version']==1
        assert path.read_text()=='administrator-only remote contents'
        # A source approved by a device administrator remains usable by its project editor.
        rid=registered['id']
        assert editor.get(f'/api/devices/{did}/hooks').status_code==403
        assert ok(editor.get(f'/api/configs/{rid}/hooks'))['enabled'] is False
        remote=ok(editor.get(f'/api/configs/{rid}/remote'))
        ok(editor.patch(f'/api/configs/{rid}',json={'content':'project editor change','expected_version':1}))
        ok(editor.post(f'/api/configs/{rid}/apply',json={'expected_version':2,'expected_remote_hash':remote['hash']}))
        assert approved.read_text()=='project editor change'


def test_local_import_versions_conflict_and_safe_apply(client, tmp_path, monkeypatch):
    device=local_device(client,tmp_path,monkeypatch)
    path=tmp_path/'config.json'; path.write_text('{"port": 80}')
    imported=ok(client.post(f"/api/devices/{device['id']}/import",json={'paths':[str(path)],'policy':'push_pull'}))[0]
    ident=imported['id']; assert imported['version']==1
    path.write_text('{"port": 81}')
    sync=ok(client.post(f"/api/devices/{device['id']}/sync")); assert sync['changes']==[ident]
    assert ok(client.get(f'/api/configs/{ident}'))['version']==2
    ok(client.patch(f'/api/configs/{ident}',json={'content':'{"port":82}', 'expected_version':2}))
    path.write_text('{"port": 83}')
    sync=ok(client.post(f"/api/devices/{device['id']}/sync")); assert sync['conflicts']==[ident]
    assert ok(client.get(f'/api/configs/{ident}'))['version']==3
    remote=ok(client.get(f'/api/configs/{ident}/remote'))
    assert client.post(f'/api/configs/{ident}/apply',json={'expected_version':3,'expected_remote_hash':'incorrect'}).status_code==409
    assert json.loads(path.read_text())['port']==83
    assert client.post(f'/api/configs/{ident}/apply',json={'expected_version':3,'expected_remote_hash':remote['hash'],'run_hook':True}).status_code==403
    ok(client.post(f'/api/configs/{ident}/resolve',json={'strategy':'vault','expected_version':3,'expected_remote_hash':remote['hash']}))
    assert json.loads(path.read_text())['port']==82
    versions=ok(client.get(f'/api/configs/{ident}/versions'))
    assert len(versions)==5
    ok(client.patch(f'/api/configs/{ident}',json={'content':'{"port":84}', 'expected_version':5}))
    path.write_text('{"port":85}')
    remote=ok(client.get(f'/api/configs/{ident}/remote'))
    resolved=ok(client.post(f'/api/configs/{ident}/resolve',json={'strategy':'remote','expected_version':6,'expected_remote_hash':remote['hash']}))
    assert resolved['version']==7
    assert json.loads(ok(client.get(f'/api/configs/{ident}?reveal=true'))['content'])['port']==85


def test_local_allowlist_symlinks_and_pull_only(client, tmp_path, monkeypatch):
    device=local_device(client,tmp_path,monkeypatch)
    path=tmp_path/'plain.conf'; path.write_text('initial')
    outside=tmp_path.parent/'outside.json'; outside.write_text('{}')
    link=tmp_path/'link.json'; link.symlink_to(outside)
    assert client.post(f"/api/devices/{device['id']}/import",json={'paths':[str(link)]}).status_code==403
    assert client.get(f"/api/devices/{device['id']}/browse",params={'path':str(tmp_path.parent)}).status_code==403
    conf=ok(client.post(f"/api/devices/{device['id']}/import",json={'paths':[str(path)],'policy':'pull_only'}))[0]
    ok(client.patch(f"/api/configs/{conf['id']}",json={'content':'new', 'expected_version':1}))
    remote=ok(client.get(f"/api/configs/{conf['id']}/remote"))
    assert client.post(f"/api/configs/{conf['id']}/apply",json={'expected_version':2,'expected_remote_hash':remote['hash']}).status_code==403
    assert path.read_text()=='initial'


def test_file_watcher_creates_real_version(client, tmp_path, monkeypatch):
    from app.scheduler import tick
    from app.db import SessionLocal
    from app.models import Device
    device=local_device(client,tmp_path,monkeypatch)
    path=tmp_path/'watched.txt'; path.write_text('before')
    conf=ok(client.post(f"/api/devices/{device['id']}/import",json={'paths':[str(path)],'policy':'watch'}))[0]
    path.write_text('changed outside vault')
    with SessionLocal() as db:
        d=db.get(Device,device['id']); d.last_sync=None; db.commit()
    tick()
    assert ok(client.get(f"/api/configs/{conf['id']}"))['version']==2


def test_sync_preserves_invalid_external_file_for_recovery(client,tmp_path,monkeypatch):
    device=local_device(client,tmp_path,monkeypatch)
    path=tmp_path/'config.json'; path.write_text('{"port":80}')
    conf=ok(client.post(f"/api/devices/{device['id']}/import",json={'paths':[str(path)],'policy':'push_pull'}))[0]
    path.write_text('{broken external file')
    result=ok(client.post(f"/api/devices/{device['id']}/sync"))
    assert result['changes']==[conf['id']]
    assert ok(client.get(f"/api/configs/{conf['id']}?reveal=true"))['content']=='{broken external file'
    remote=ok(client.get(f"/api/configs/{conf['id']}/remote"))
    assert client.post(f"/api/configs/{conf['id']}/apply",json={'expected_version':2,'expected_remote_hash':remote['hash']}).status_code==422
    assert ok(client.get(f"/api/configs/{conf['id']}/versions/1"))['content']=='{"port":80}'


def test_manual_file_archive_import_and_atomic_validation(client, tmp_path, monkeypatch):
    device=local_device(client,tmp_path,monkeypatch)
    bundle=io.BytesIO()
    with zipfile.ZipFile(bundle,'w') as z:
        z.writestr('nginx/nginx.conf','events {}\nhttp { server { listen 8080; } }\n')
        z.writestr('docker/compose.yml','services:\n  web:\n    image: nginx:alpine\n')
        z.writestr('wireguard/wg0.conf','[Interface]\nPrivateKey = '+base64.b64encode(bytes(32)).decode()+'\nAddress = 10.1.0.1/24\n')
        z.writestr('app.service','[Unit]\nDescription=Test\n[Service]\nExecStart=/usr/bin/true\n')
    imported=ok(client.post('/api/import/files',data={'device_id':device['id'],'base_path':'/etc'},files=[('files',('bundle.zip',bundle.getvalue(),'application/zip'))]))
    assert len(imported)==4
    assert {c['format'] for c in imported}=={'nginx','yaml','wireguard','systemd'}
    bad=io.BytesIO()
    with zipfile.ZipFile(bad,'w') as z:
        z.writestr('okay.txt','okay'); z.writestr('bad.json','{broken')
    assert client.post('/api/import/files',data={'device_id':device['id']},files=[('files',('bad.zip',bad.getvalue(),'application/zip'))]).status_code==422
    assert len(ok(client.get('/api/configs',params={'device_id':device['id']})))==4


def test_archive_traversal_and_limits():
    archive=io.BytesIO()
    with zipfile.ZipFile(archive,'w') as z: z.writestr('../escape.txt','secret')
    with pytest.raises(HTTPException): archive_files('test.zip',archive.getvalue())
    archive=io.BytesIO()
    with tarfile.open(fileobj=archive,mode='w') as t:
        link=tarfile.TarInfo('link'); link.type=tarfile.SYMTYPE; link.linkname='/etc/passwd'; t.addfile(link)
    with pytest.raises(HTTPException): archive_files('test.tar',archive.getvalue())
    with pytest.raises(HTTPException): archive_files('binary.txt',b'hello\x00binary')


@pytest.mark.parametrize('fmt,content',[('json','{broken'),('yaml','x: [broken'),('toml','x = [broken'),('xml','<x>'),('wireguard','[Interface]\nPrivateKey=bad'),('nginx','http {'),('systemd','[Service]\nExecStart=/bin/true'),('python','if True')])
def test_parser_rejects_bad_formats_without_disclosing_content(fmt,content):
    result=validate_content(fmt,content)
    assert not result['valid']
    assert 'broken' not in str(result['errors'])


@pytest.mark.skipif(not os.getenv('SSH_TEST_PASSWORD_FILE'),reason='Native Debian SSH fixture is required; run scripts/test-debian.sh')
def test_native_debian_ssh_import_sync_conflict_validation(client):
    from app.remote import filesystem
    from app.db import SessionLocal
    from app.models import Device
    password=Path(os.environ['SSH_TEST_PASSWORD_FILE']).read_text().strip()
    root=os.getenv('SSH_TEST_ROOT','/fixtures')
    dev=ok(client.post('/api/devices',json={'name':'Debian 13 native OpenSSH','connection':'ssh','host':os.getenv('SSH_TEST_HOST','127.0.0.1'),
        'connection_data':{'host':os.getenv('SSH_TEST_HOST','127.0.0.1'),'port':int(os.getenv('SSH_TEST_PORT','22298')),'username':'root','roots':[root]}}),201)
    ident=dev['id']
    hostkey=ok(client.get(f'/api/devices/{ident}/host-key'))
    assert hostkey['fingerprint'].startswith('SHA256:')
    info={**dev['connection_data'],'host_key':hostkey['host_key']}
    ok(client.patch(f'/api/devices/{ident}',json={'connection_data':info}))
    ok(client.put(f'/api/devices/{ident}/credential',json={'password':password}))
    ok(client.post(f'/api/devices/{ident}/test'))
    assert ok(client.get(f'/api/devices/{ident}/browse',params={'path':root}))['files']
    # Create fixture content with actual SFTP, authenticated to the real Debian sshd.
    with SessionLocal() as db:
        with filesystem(db.get(Device,ident)) as fs:
            with fs.sftp.open(root+'/config.json','w') as f: f.write('{"port":80}')
            with fs.sftp.open(root+'/nginx.conf','w') as f: f.write('pid /tmp/config-vault-nginx.pid;\nerror_log /tmp/config-vault-error.log;\nevents {}\nhttp { server { listen 18099; } }\n')
    config=ok(client.post(f'/api/devices/{ident}/import',json={'paths':[root+'/config.json',root+'/nginx.conf'],'policy':'push_pull'}))[0]
    cid=config['id']
    with SessionLocal() as db:
        with filesystem(db.get(Device,ident)) as fs:
            with fs.sftp.open(root+'/config.json','w') as f: f.write('{"port":81}')
    assert cid in ok(client.post(f'/api/devices/{ident}/sync'))['changes']
    ok(client.patch(f'/api/configs/{cid}',json={'content':'{"port":82}','expected_version':2}))
    with SessionLocal() as db:
        with filesystem(db.get(Device,ident)) as fs:
            with fs.sftp.open(root+'/config.json','w') as f: f.write('{"port":83}')
    assert cid in ok(client.post(f'/api/devices/{ident}/sync'))['conflicts']
    remote=ok(client.get(f'/api/configs/{cid}/remote'))
    ok(client.post(f'/api/configs/{cid}/resolve',json={'strategy':'vault','expected_version':3,'expected_remote_hash':remote['hash']}))
    with SessionLocal() as db:
        with filesystem(db.get(Device,ident)) as fs: assert json.loads(fs.read(root+'/config.json'))['port']==82
    nginx=next(c for c in ok(client.get('/api/configs',params={'device_id':ident})) if c['name']=='nginx.conf')
    ok(client.patch(f"/api/configs/{nginx['id']}",json={'content':'events {}\nhttp { nonexistent_directive on; }\n','expected_version':1}))
    remote=ok(client.get(f"/api/configs/{nginx['id']}/remote"))
    assert client.post(f"/api/configs/{nginx['id']}/apply",json={'expected_version':2,'expected_remote_hash':remote['hash']}).status_code==422
    assert 'nonexistent_directive' not in ok(client.get(f"/api/configs/{nginx['id']}/remote"))['content']
    restored=ok(client.post(f"/api/configs/{nginx['id']}/restore",json={'version':1,'expected_version':2}))
    ok(client.put(f'/api/devices/{ident}/hooks',json={'enabled':True,'command':'nginx_reload','config_id':nginx['id']}))
    assert client.put(f'/api/devices/{ident}/hooks',json={'enabled':True,'command':'arbitrary shell'}).status_code==422
    remote=ok(client.get(f"/api/configs/{nginx['id']}/remote"))
    # Debian fixture deliberately has sshd as PID1, so genuine systemctl fails.
    # Apply must report that the file was applied and audit the real failed hook.
    hooked=client.post(f"/api/configs/{nginx['id']}/apply",json={'expected_version':restored['version'],'expected_remote_hash':remote['hash'],'run_hook':True})
    assert hooked.status_code==422 and 'hook failed' in hooked.text
    assert any(a['action']=='remote command failed' for a in ok(client.get('/api/activity')))
    # A wrong stored host key must prevent authentication and data access.
    ok(client.patch(f'/api/devices/{ident}',json={'connection_data':{**info,'host_key':'ssh-ed25519 AAAAinvalid'}}))
    assert client.post(f'/api/devices/{ident}/test').status_code==502
    ok(client.patch(f'/api/devices/{ident}',json={'connection_data':info}))
    # Real public-key authentication, no SSH mocks or mocked credential provider.
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives import serialization
    key=Ed25519PrivateKey.generate()
    public=key.public_key().public_bytes(serialization.Encoding.OpenSSH,serialization.PublicFormat.OpenSSH)
    private=key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.OpenSSH,serialization.NoEncryption()).decode()
    with SessionLocal() as db:
        with filesystem(db.get(Device,ident)) as fs:
            try: fs.sftp.mkdir('/root/.ssh',0o700)
            except IOError: pass
            with fs.sftp.open('/root/.ssh/authorized_keys','w') as f: f.write(public+b'\n')
            fs.sftp.chmod('/root/.ssh/authorized_keys',0o600)
    ok(client.put(f'/api/devices/{ident}/credential',json={'private_key':private}))
    ok(client.post(f'/api/devices/{ident}/test'))
    with SessionLocal() as db:
        assert private not in db.get(Device,ident).credential
