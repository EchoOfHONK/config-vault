import concurrent.futures
import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.backup import decode_backup, restore_backup
from app.core import add_version
from app.db import DATA_DIR, SessionLocal
from app.main import app
from app.models import Config, Setting, Version
from app.security import decrypt, encrypt, mask, secrets


def device(client, name='Debian'):
    result = client.post('/api/devices', json={'name': name, 'connection': 'manual'})
    assert result.status_code == 201, result.text
    return result.json()['id']


def configuration(client, device_id, content='worker_processes 1;\n', path='/etc/nginx/nginx.conf', project_id=None):
    result = client.post('/api/configs', json={'name': path.rsplit('/', 1)[-1], 'path': path, 'device_id': device_id, 'content': content, 'project_id': project_id})
    assert result.status_code == 201, result.text
    return result.json()


def login(browser, username, password='Admin-password-2026'):
    response = browser.post('/api/auth/login', json={'username': username, 'password': password})
    assert response.status_code == 200, response.text
    browser.headers['X-CSRF-Token'] = response.json()['csrf']


def test_history_diff_restore_optimistic_lock(client):
    cid = configuration(client, device(client))['id']
    saved = client.patch(f'/api/configs/{cid}', json={'content': 'worker_processes 4;\n', 'expected_version': 1, 'message': 'Increase workers'})
    assert saved.status_code == 200, saved.text
    assert saved.json()['version'] == 2
    conflict = client.patch(f'/api/configs/{cid}', json={'content': 'lost update', 'expected_version': 1})
    assert conflict.status_code == 409
    diff = client.get(f'/api/configs/{cid}/diff?left=1&right=2').json()
    assert diff['added'] == 1 and diff['removed'] == 1
    assert '-worker_processes 1;' in diff['unified']
    restored = client.post(f'/api/configs/{cid}/restore', json={'version': 1, 'expected_version': 2})
    assert restored.status_code == 200, restored.text
    assert restored.json()['version'] == 3
    assert client.get(f'/api/configs/{cid}?reveal=true').json()['content'] == 'worker_processes 1;\n'
    assert [v['number'] for v in client.get(f'/api/configs/{cid}/versions').json()] == [3, 2, 1]
    assert client.get(f'/api/configs/{cid}/versions/2').json()['content'] == 'worker_processes 4;\n'
    assert (DATA_DIR / 'git' / 'versions' / str(cid) / '3.enc').is_file()


def test_snapshot_restore_all_or_nothing(client):
    did = device(client)
    first = configuration(client, did, 'A=1\n', '/etc/a.env')
    second = configuration(client, did, 'B=1\n', '/etc/b.env')
    snapshot = client.post('/api/snapshots', json={'name': 'Before upgrade', 'device_id': did})
    assert snapshot.status_code == 201, snapshot.text
    sid = snapshot.json()['id']
    for item, content in ((first, 'A=2\n'), (second, 'B=2\n')):
        assert client.patch(f"/api/configs/{item['id']}", json={'content': content, 'expected_version': 1}).status_code == 200
    failed = client.post(f'/api/snapshots/{sid}/restore', json={'expected_versions': {str(first['id']): 2, str(second['id']): 1}})
    assert failed.status_code == 409
    assert client.get(f"/api/configs/{first['id']}").json()['version'] == 2
    restored = client.post(f'/api/snapshots/{sid}/restore', json={'expected_versions': {str(first['id']): 2, str(second['id']): 2}})
    assert restored.status_code == 200, restored.text
    assert restored.json()['restored'] == 2
    assert client.get(f"/api/configs/{first['id']}").json()['content'] == 'A=1\n'
    assert client.delete(f"/api/configs/{first['id']}").status_code == 409


def test_secrets_masked_in_views_search_diff_and_storage(client):
    did = device(client)
    config = configuration(client, did, 'DATABASE_HOST=db\nDATABASE_PASSWORD=never-show-this\nAPI_KEY="sensitive-value"\n', '/srv/app/.env')
    cid = config['id']
    assert config['has_secrets']
    for endpoint in (f'/api/configs/{cid}', f'/api/configs/{cid}/versions/1', f'/api/configs/{cid}/download'):
        assert 'never-show-this' not in client.get(endpoint).text
    assert client.get('/api/configs?q=never-show-this').json() == []
    assert client.get('/api/configs?q=DATABASE_HOST').json()[0]['id'] == cid
    assert 'never-show-this' in client.get(f'/api/configs/{cid}?reveal=true').json()['content']
    client.patch(f'/api/configs/{cid}', json={'content': 'DATABASE_HOST=db\nDATABASE_PASSWORD=another-secret\nAPI_KEY="sensitive-value"\n', 'expected_version': 1})
    diff = client.get(f'/api/configs/{cid}/diff?left=1&right=2').json()
    assert diff['has_hidden_changes'] is True
    assert 'another-secret' not in json.dumps(diff)
    with SessionLocal() as db:
        assert 'never-show-this' not in db.get(Config, cid).current_content
        assert 'never-show-this' not in db.scalar(select(Version).where(Version.config_id == cid)).content
    assert 'foo-password' not in mask('URL=postgres://app:foo-password@db/app')
    assert 'PrivateKey' in secrets('[Interface]\nPrivateKey=ABC\n')


def test_roles_device_scopes_and_token_scopes(client):
    a, b = device(client, 'Game'), device(client, 'VPN')
    first = configuration(client, a)
    second = configuration(client, b)
    response = client.post('/api/users', json={'username': 'game-editor', 'password': 'Editor-password-2026', 'role': 'editor', 'device_ids': [a]})
    assert response.status_code == 201
    with TestClient(app) as editor:
        login(editor, 'game-editor', 'Editor-password-2026')
        assert [c['id'] for c in editor.get('/api/configs').json()] == [first['id']]
        assert editor.get(f"/api/configs/{second['id']}").status_code == 403
        assert editor.post('/api/users', json={}).status_code == 403
        assert editor.patch(f"/api/configs/{first['id']}", json={'content': 'changed', 'expected_version': 1}).status_code == 200
        token = editor.post('/api/tokens', json={'name': 'read-only', 'scopes': ['read:configs'], 'device_ids': [a]}).json()['token']
        assert token.startswith('cv_')
        headers = {'Authorization': 'Bearer ' + token}
        assert editor.get('/api/configs', headers=headers).status_code == 200
        assert editor.patch(f"/api/configs/{first['id']}", json={'content': 'forbidden', 'expected_version': 2}, headers=headers).status_code == 403
        assert editor.get('/api/users', headers=headers).status_code == 403
    response = client.post('/api/users', json={'username': 'reader', 'password': 'Reader-password-2026', 'role': 'viewer'})
    with TestClient(app) as reader:
        login(reader, 'reader', 'Reader-password-2026')
        assert reader.get(f"/api/configs/{first['id']}").status_code == 200
        assert reader.get(f"/api/configs/{first['id']}?reveal=true").status_code == 403
        assert reader.post(f"/api/configs/{first['id']}/restore", json={'version': 1, 'expected_version': 2}).status_code == 403


def test_project_scoped_editor_can_snapshot_project_files(client):
    did = device(client)
    project = client.post('/api/projects', json={'name': 'Minecraft', 'device_id': did}).json()
    config = configuration(client, did, 'max-players=10', '/srv/minecraft/server.properties', project['id'])
    configuration(client, did, 'worker_processes 1;', '/etc/nginx/nginx.conf')
    client.post('/api/users', json={'username': 'project-editor', 'password': 'Editor-password-2026', 'role': 'editor', 'project_ids': [project['id']]})
    with TestClient(app) as editor:
        login(editor, 'project-editor', 'Editor-password-2026')
        devices = editor.get('/api/devices').json()
        assert len(devices) == 1 and devices[0]['config_count'] == 1
        assert editor.get(f'/api/devices/{did}').status_code == 200
        assert editor.get(f'/api/devices/{did}/browse?path=/etc').status_code == 403
        assert editor.get('/api/dashboard').json()['devices'] == 1
        assert any(a['target'] == config['path'] for a in editor.get('/api/activity').json())
        result = editor.post('/api/snapshots', json={'name': 'Game backup', 'config_ids': [config['id']]})
        assert result.status_code == 201, result.text


def test_csrf_and_last_admin(client):
    csrf = client.headers.pop('X-CSRF-Token')
    assert client.post('/api/devices', json={'name': 'bad'}).status_code == 403
    client.headers['X-CSRF-Token'] = csrf
    assert client.post('/api/devices', headers={'Origin': 'https://attacker.example'}, json={'name': 'bad'}).status_code == 403
    admin = client.get('/api/auth/me').json()['id']
    assert client.delete(f'/api/users/{admin}').status_code == 409
    assert client.patch(f'/api/users/{admin}', json={'role': 'viewer'}).status_code == 409


def test_encrypted_backup_full_recovery_and_prevalidation(client):
    did = device(client)
    config = configuration(client, did, 'PASSWORD=backup-sensitive\nA=1\n', '/srv/.env')
    cid = config['id']
    client.patch(f'/api/configs/{cid}', json={'content': 'PASSWORD=backup-sensitive\nA=2\n', 'expected_version': 1})
    client.post('/api/snapshots', json={'name': 'Full snapshot', 'device_id': did})
    with SessionLocal() as db:
        db.add(Setting(key='preapply:test', value=encrypt('previous remote contents')))
        db.commit()
    result = client.post('/api/backups', json={'password': 'Portable-password-2026'})
    assert result.status_code == 201, result.text
    backup = client.get(f"/api/backups/{result.json()['id']}/download").content
    assert b'backup-sensitive' not in backup
    assert b'users' not in backup
    with pytest.raises(ValueError):
        restore_backup(backup[:-100], 'Portable-password-2026')
    assert client.get(f'/api/configs/{cid}').status_code == 200
    client.patch(f'/api/configs/{cid}', json={'content': 'later value', 'expected_version': 2})
    restored = restore_backup(backup, 'Portable-password-2026')
    assert restored['configs'] == 1 and restored['versions'] == 2
    assert client.get('/api/auth/me').status_code == 401
    login(client, 'admin')
    assert client.get(f'/api/configs/{cid}?reveal=true').json()['content'] == 'PASSWORD=backup-sensitive\nA=2\n'
    assert len(client.get('/api/snapshots').json()) == 1
    assert len(client.get('/api/devices').json()) == 1
    assert len(client.get('/api/users').json()) == 1
    assert any(a['action'] == 'backup restored' for a in client.get('/api/activity').json())
    assert all(b['status'] != 'Pending' for b in client.get('/api/backups').json())
    with SessionLocal() as db:
        assert decrypt(db.get(Setting, 'preapply:test').value) == 'previous remote contents'


def test_concurrent_version_updates_never_lose_history(client):
    config = configuration(client, device(client))
    def edit(content):
        with SessionLocal() as db:
            row = db.get(Config, config['id'])
            try:
                add_version(db, row, content, 'Concurrent editor', 'Parallel save', 1)
                db.commit()
                return 'saved'
            except Exception:
                db.rollback()
                return 'conflict'
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as workers:
        results = list(workers.map(edit, ('worker_processes 2;\n', 'worker_processes 3;\n')))
    assert sorted(results) == ['conflict', 'saved']
    assert [v['number'] for v in client.get(f"/api/configs/{config['id']}/versions").json()] == [2, 1]


def test_portable_backup_reencrypts_under_a_new_master_key(client, monkeypatch):
    from cryptography.fernet import Fernet
    from app import security
    import os
    did = device(client)
    config = configuration(client, did, 'PASSWORD=old-key-secret\n', '/srv/.env')
    with SessionLocal() as db:
        db.add(Setting(key='preapply:new-key-test', value=encrypt('remote recovery plaintext')))
        db.commit()
    result = client.post('/api/backups', json={'password': 'Portable-password-2026'}).json()
    blob = client.get(f"/api/backups/{result['id']}/download").content
    previous = security._fernet
    new_key = Fernet.generate_key()
    monkeypatch.setenv('VAULT_KEY', new_key.decode())
    monkeypatch.delenv('VAULT_KEY_FILE', raising=False)
    monkeypatch.setattr(security, '_fernet', Fernet(new_key))
    restored = restore_backup(blob, 'Portable-password-2026')
    assert restored['configs'] == 1
    with SessionLocal() as db:
        row = db.get(Config, config['id'])
        assert Fernet(new_key).decrypt(row.current_content.encode()).decode() == 'PASSWORD=old-key-secret\n'
        assert decrypt(db.get(Setting, 'preapply:new-key-test').value) == 'remote recovery plaintext'
        with pytest.raises(Exception):
            previous.decrypt(row.current_content.encode())


def test_sanitized_git_export_omits_secret_files(client):
    import io
    import zipfile
    did = device(client)
    project = client.post('/api/projects', json={'name': 'Export project', 'device_id': did}).json()['id']
    configuration(client, did, 'PASSWORD=never-export\n', '/srv/.env', project)
    configuration(client, did, 'worker_processes 1;\n', '/etc/nginx/nginx.conf', project)
    response = client.get(f'/api/projects/{project}/export')
    assert response.status_code == 200, response.text
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert '.gitignore' in archive.namelist()
        assert '.git/HEAD' in archive.namelist()
        assert not any(path.endswith('/.env') for path in archive.namelist())
        assert b'never-export' not in b''.join(archive.read(i) for i in archive.namelist())


@pytest.mark.parametrize('content', [
    '{"nested":{"password":"never-show"},"token":"never-show"}',
    '- password: never-show\n- API_KEY=never-show\n',
    '<configuration><password>never-show</password><API_KEY>never-show</API_KEY></configuration>',
    'PRIVATE_KEY: |\n  never-show\n  never-show\n',
    'const API_KEY = "never-show";\n',
    '<connection password="never-show"/>',
])
def test_secret_patterns_mask_all_views_and_repository(client, content):
    assert secrets(content)
    assert 'never-show' not in mask(content)
    did = device(client)
    project = client.post('/api/projects', json={'name': 'Secrets', 'device_id': did}).json()['id']
    config = configuration(client, did, content, '/srv/secret.conf', project)
    assert config['has_secrets'] is True
    assert 'never-show' not in client.get(f"/api/configs/{config['id']}").text
    assert client.get('/api/configs?q=never-show').json() == []
    import io
    import zipfile
    with zipfile.ZipFile(io.BytesIO(client.get(f'/api/projects/{project}/export').content)) as archive:
        assert not any(path.endswith('/secret.conf') for path in archive.namelist())


def test_template_edit_reveal_and_reuse_preserve_real_values(client):
    created = client.post('/api/templates', json={'name': 'Application', 'format': 'env', 'content': 'API_TOKEN=actual-template-secret\nPORT=8080\n'})
    assert created.status_code == 201, created.text
    tid = created.json()['id']
    assert 'actual-template-secret' not in client.get('/api/templates').text
    assert 'actual-template-secret' not in client.get(f'/api/templates/{tid}').text
    revealed = client.get(f'/api/templates/{tid}?reveal=true')
    assert revealed.status_code == 200 and 'actual-template-secret' in revealed.json()['content']
    changed = client.patch(f'/api/templates/{tid}', json={'content': 'API_TOKEN=updated-secret\nPORT=8081\n', 'description': 'Updated deployment'})
    assert changed.status_code == 200, changed.text
    assert 'updated-secret' not in changed.text
    source = client.get(f'/api/templates/{tid}?reveal=true').json()['content']
    did = device(client)
    cid = configuration(client, did, source, '/srv/.env')['id']
    assert client.get(f'/api/configs/{cid}?reveal=true').json()['content'] == source
    client.post('/api/users', json={'username': 'template-reader', 'password': 'Reader-password-2026', 'role': 'viewer'})
    assert client.post('/api/users', json={'username': 'template-editor', 'password': 'Editor-password-2026', 'role': 'editor', 'device_ids': [did]}).status_code == 201
    with TestClient(app) as editor:
        login(editor, 'template-editor', 'Editor-password-2026')
        assert editor.get(f'/api/templates/{tid}?reveal=true').status_code == 403
    with TestClient(app) as reader:
        login(reader, 'template-reader', 'Reader-password-2026')
        assert reader.get(f'/api/templates/{tid}').status_code == 200
        assert reader.get(f'/api/templates/{tid}?reveal=true').status_code == 403
        assert reader.patch(f'/api/templates/{tid}', json={'content': 'bad'}).status_code == 403
    assert any(a['action'] == 'template secrets revealed' for a in client.get('/api/activity').json())


def test_project_reassignment_checks_destination_permission(client):
    left, right = device(client, 'Left'), device(client, 'Right')
    project = client.post('/api/projects', json={'name': 'Project', 'device_id': left}).json()['id']
    updated = client.patch(f'/api/projects/{project}', json={'device_id': right})
    assert updated.status_code == 200 and updated.json()['device_id'] == right
    client.patch(f'/api/projects/{project}', json={'device_id': left})
    client.post('/api/users', json={'username': 'limited-editor', 'password': 'Editor-password-2026', 'role': 'editor', 'device_ids': [left]})
    with TestClient(app) as editor:
        login(editor, 'limited-editor', 'Editor-password-2026')
        assert editor.patch(f'/api/projects/{project}', json={'device_id': right}).status_code == 403
        assert editor.get('/api/projects').json()[0]['device_id'] == left
