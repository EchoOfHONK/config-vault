#!/bin/sh
# Disposable Debian 13 SSH target. Never mount production paths here.
set -eu
repo=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
fixture_dir="${1:-}"
port="${2:-22298}"
container="${SSH_FIXTURE_NAME:-config-vault-test-ssh}"
if [ -z "$fixture_dir" ]; then
    printf '%s\n' 'Использование: scripts/ssh-fixture.sh /абсолютный/тестовый-каталог [порт]' >&2
    exit 1
fi
mkdir -p "$fixture_dir/configs"
fixture_dir=$(CDPATH='' cd -- "$fixture_dir" && pwd)
python3 - "$fixture_dir" <<'PY'
import os
from pathlib import Path
import secrets
import sys
root = Path(sys.argv[1])
secret = root / 'password'
if not secret.exists():
    fd = os.open(secret, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(secrets.token_urlsafe(32))
(root / 'configs' / 'app.json').write_text('{"port":8080,"mode":"initial"}\n')
(root / 'configs' / 'nginx.conf').write_text('events {}\nhttp { server { listen 8081; } }\n')
PY
docker build -f "$repo/deploy/test-ssh/Dockerfile" -t config-vault-test-ssh:debian13 "$repo"
docker run -d --name "$container" --label config-vault.test=true \
    --publish "127.0.0.1:$port:22" \
    --mount "type=bind,src=$fixture_dir/configs,dst=/fixtures" \
    --mount "type=bind,src=$fixture_dir/password,dst=/run/secrets/ssh_password,readonly" \
    config-vault-test-ssh:debian13
printf '%s\n' "Fixture: $container. SSH host=127.0.0.1 port=$port user=root root=/fixtures password_file=$fixture_dir/password"
printf '%s\n' "Очистка: docker rm -f $container (только после тестов)"
