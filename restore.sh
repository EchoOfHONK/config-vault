#!/bin/sh
set -eu
# shellcheck source=scripts/common.sh
. "$(dirname "$0")/scripts/common.sh"
input_file="${1:-}"
password_file="${2:-}"
if [ ! -f "$input_file" ] || [ "$#" -gt 2 ]; then
    printf '%s\n' 'Использование: ./restore.sh backup.cvbackup [файл-пароля-portable-backup]' >&2
    exit 1
fi
input_file=$(python3 -c 'from pathlib import Path; import sys; print(Path(sys.argv[1]).resolve())' "$input_file")
if [ -n "$password_file" ]; then
    [ -f "$password_file" ] || { printf '%s\n' 'Файл пароля не найден' >&2; exit 1; }
    password_file=$(python3 -c 'from pathlib import Path; import sys; print(Path(sys.argv[1]).resolve())' "$password_file")
fi
printf '%s\n' 'Восстановление заменит текущее хранилище. Введите RESTORE для подтверждения:'
IFS= read -r answer
[ "$answer" = RESTORE ] || { printf '%s\n' 'Отменено'; exit 1; }
if docker_compose ps --status running --services | grep -q '^backend$'; then
    "$ROOT/backup.sh"
fi
docker_compose stop frontend backend
docker_compose up -d --wait --wait-timeout 180 db
# On failure leave writers stopped: do not run against a partially restored state.
if [ -n "$password_file" ]; then
    docker_compose run --rm --no-deps --volume "$input_file:/restore/input.cvbackup:ro" \
        --volume "$password_file:/run/secrets/backup_password:ro" backend \
        python -m app.backup restore --input /restore/input.cvbackup --password-file /run/secrets/backup_password --confirm
else
    docker_compose run --rm --no-deps --volume "$input_file:/restore/input.cvbackup:ro" backend \
        python -m app.backup restore --input /restore/input.cvbackup --confirm
fi
python3 "$ROOT/scripts/config.py" clear-bootstrap
docker_compose up -d --wait --wait-timeout 180
verify_health
printf '%s\n' 'Хранилище восстановлено. Активные сессии нужно открыть заново.'
