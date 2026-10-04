#!/bin/sh
set -eu
# shellcheck source=scripts/common.sh
. "$(dirname "$0")/scripts/common.sh"
portable_file=""
if [ "${1:-}" = "--portable" ]; then
    portable_file="${2:-}"
    if [ "$#" -ne 2 ] || [ ! -f "$portable_file" ]; then
        printf '%s\n' 'Использование: ./backup.sh [--portable /путь/к/файлу-пароля]' >&2
        exit 1
    fi
elif [ "$#" -ne 0 ]; then
    printf '%s\n' 'Использование: ./backup.sh [--portable /путь/к/файлу-пароля]' >&2
    exit 1
fi
filename="config-vault-$(date -u +%Y%m%dT%H%M%SZ)-$$.cvbackup"
previous_running=$(docker_compose ps --status running --services)
restore_services() {
    backup_status=$?
    trap - EXIT HUP INT TERM
    set --
    for service in backend frontend; do
        if printf '%s\n' "$previous_running" | grep -qx "$service"; then
            set -- "$@" "$service"
        fi
    done
    if [ "$#" -gt 0 ]; then
        if ! docker_compose up -d --no-deps --wait --wait-timeout 180 "$@" >&2; then
            printf '%s\n' 'Backup завершён, но не удалось возобновить ранее работавшие сервисы. Проверьте docker compose ps/logs.' >&2
            if [ "$backup_status" -eq 0 ]; then backup_status=1; fi
        fi
    fi
    exit "$backup_status"
}
trap restore_services EXIT
trap 'exit 130' HUP INT TERM
# Stop all writers for a consistent logical DB/Git backup; PostgreSQL stays online.
docker_compose stop frontend backend
if [ -n "$portable_file" ]; then
    portable_file=$(python3 -c 'from pathlib import Path; import sys; print(Path(sys.argv[1]).resolve())' "$portable_file")
    docker_compose run --rm --no-deps --volume "$portable_file:/run/secrets/backup_password:ro" backend \
        python -m app.backup create --output "/data/backups/$filename" --password-file /run/secrets/backup_password
else
    docker_compose run --rm --no-deps backend python -m app.backup create --output "/data/backups/$filename"
fi
host_backup_directory="$(env_get DATA_DIRECTORY)/backups"
mkdir -p "$host_backup_directory"
chmod 700 "$host_backup_directory"
docker_compose cp "backend:/data/backups/$filename" "$host_backup_directory/$filename"
chmod 600 "$host_backup_directory/$filename"
printf '%s\n' "Backup: $host_backup_directory/$filename"
