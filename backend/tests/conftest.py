import os
from pathlib import Path
import tempfile
import sys
import shutil

import pytest
from cryptography.fernet import Fernet
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

_test_root = Path(tempfile.mkdtemp(prefix='config-vault-tests-'))
test_url = os.environ.get('CONFIG_VAULT_TEST_DATABASE_URL')
if test_url:
    from sqlalchemy.engine import make_url
    if not (make_url(test_url).database or '').endswith('_test'):
        raise RuntimeError('CONFIG_VAULT_TEST_DATABASE_URL database name must end in _test; tests drop application tables')
os.environ['DATABASE_URL'] = test_url or 'sqlite:///' + str(_test_root / 'test.db')
os.environ['DATA_DIR'] = str(_test_root / 'data')
os.environ['VAULT_KEY'] = Fernet.generate_key().decode()
os.environ['COOKIE_SECURE'] = 'false'
os.environ['DISABLE_SCHEDULER'] = 'true'
os.environ.pop('BOOTSTRAP_CONFIG_FILE', None)
os.environ.pop('BOOTSTRAP_ADMIN_USERNAME', None)

from fastapi.testclient import TestClient
from app.db import Base, engine
from app.main import app


@pytest.fixture
def client():
    shutil.rmtree(_test_root / 'data', ignore_errors=True)
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    from app.main import _attempts, _requests
    _attempts.clear()
    _requests.clear()
    with TestClient(app) as browser:
        result = browser.post('/api/setup', json={'username': 'admin', 'password': 'Admin-password-2026', 'instance_name': 'Test Vault', 'timezone': 'Europe/Moscow'})
        assert result.status_code == 200, result.text
        browser.headers['X-CSRF-Token'] = result.json()['csrf']
        yield browser
