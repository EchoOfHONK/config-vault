#!/bin/sh
set -eu
ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
if [ ! -f "$ROOT/docker-compose.yml" ]; then
    ROOT=$(CDPATH='' cd -- "$ROOT/.." && pwd)
fi
cd "$ROOT"
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-config-vault}"
if ! command -v docker >/dev/null 2>&1; then
    printf '%s\n' 'Docker не найден. Установите Docker Engine и Compose plugin.' >&2
    exit 1
fi
if docker compose version >/dev/null 2>&1; then
    docker_compose() { docker compose "$@"; }
elif command -v docker-compose >/dev/null 2>&1; then
    docker_compose() { docker-compose "$@"; }
else
    printf '%s\n' 'Docker Compose не найден.' >&2
    exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
    printf '%s\n' 'Нужен Python 3.9+ для безопасного чтения настроек.' >&2
    exit 1
fi
env_get() { python3 "$ROOT/scripts/config.py" get "$1"; }
verify_health() {
    docker_compose exec -T backend python -c "import json, urllib.request; r=json.load(urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=10)); print(r)"
    docker_compose exec -T frontend wget -q --spider http://127.0.0.1:8080/healthz
}
