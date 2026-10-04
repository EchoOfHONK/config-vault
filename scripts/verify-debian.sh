#!/bin/sh
# Full destructive recovery is confined to a freshly created test directory.
set -eu
repo=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
parent="${VAULT_TEST_WORK_PARENT:-$repo/work}"
mkdir -p "$parent"
test_root=$(mktemp -d "$parent/config-vault-integration.XXXXXX")
project="cvtest-$(date -u +%s)-$$"
printf '%s\n' "$project" > "$test_root/.config-vault-test-sentinel"
python3 "$repo/scripts/scenario.py" prepare "$test_root"
if docker compose version >/dev/null 2>&1; then
    docker_compose() { docker compose "$@"; }
elif command -v docker-compose >/dev/null 2>&1; then
    docker_compose() { docker-compose "$@"; }
else
    printf '%s\n' 'Docker Compose не найден.' >&2
    exit 1
fi
compose() { docker_compose -p "$project" --env-file "$test_root/.env" -f "$repo/docker-compose.yml" -f "$repo/deploy/testing.yml" "$@"; }
cleanup() {
    compose down --remove-orphans >/dev/null 2>&1 || true
    printf '%s\n' "Тестовый каталог сохранён: $test_root (содержит только тестовые credentials)."
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM
compose up -d --build --wait --wait-timeout 240
port=$(python3 "$repo/scripts/scenario.py" port "$test_root")
ssh_container=$(compose ps -q ssh)
python3 "$repo/scripts/scenario.py" seed "$test_root" "http://127.0.0.1:$port" "$ssh_container"
compose exec -T backend python - <<'PY'
from pathlib import Path
matches = []
for file in Path('/proc').glob('[0-9]*/cmdline'):
    try:
        args = file.read_bytes().split(b'\0')
        if b'app.main:app' in args and b'python' in args[0]:
            uid = next(line for line in (file.parent/'status').read_text().splitlines() if line.startswith('Uid:'))
            assert uid.split()[1:] == ['10001'] * 4
            matches.append(file.parent.name)
    except (FileNotFoundError, ProcessLookupError):
        pass
assert matches
print('PASS actual Uvicorn process uid=10001')
PY
compose stop frontend backend
compose run --rm --no-deps backend python -m app.backup create --output /data/backups/cli-verification.cvbackup
compose cp backend:/data/backups/cli-verification.cvbackup "$test_root/cli-verification.cvbackup"
test -s "$test_root/cli-verification.cvbackup"
printf '%s\n' 'PASS Offline backup CLI and export from stopped service container'
compose down --remove-orphans
# No variable is passed as shell source. Sentinel and exact subpaths are checked
# inside an isolated helper container before removal of TEST application data.
docker run --rm --entrypoint sh \
    --mount "type=bind,src=$test_root,dst=/test" alpine:3.20 -c \
    'test -s /test/.config-vault-test-sentinel && test -s /test/recovery.cvbackup && rm -rf /test/data/postgres /test/data/vault'
python3 "$repo/scripts/scenario.py" rekey "$test_root"
compose up -d --wait --wait-timeout 120 db
compose run --rm --no-deps \
    --volume "$test_root/recovery.cvbackup:/restore/input.cvbackup:ro" \
    --volume "$test_root/backup_password:/run/secrets/backup_password:ro" \
    backend python -m app.backup restore --input /restore/input.cvbackup --password-file /run/secrets/backup_password --confirm
compose up -d --wait --wait-timeout 180
python3 "$repo/scripts/scenario.py" verify "$test_root" "http://127.0.0.1:$port"
printf '%s\n' "Полный сценарий пройден. Отчёт: $test_root/report.json"
