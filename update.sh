#!/bin/sh
set -eu
# shellcheck source=scripts/common.sh
. "$(dirname "$0")/scripts/common.sh"
"$ROOT/backup.sh"
git_root=$(git -C "$ROOT" rev-parse --show-toplevel 2>/dev/null || true)
if [ "$git_root" = "$ROOT" ]; then
    if [ -n "$(git -C "$ROOT" status --porcelain --untracked-files=no)" ]; then
        printf '%s\n' 'Есть изменённые файлы. Backup создан; обновление отменено для сохранения ваших изменений.' >&2
        exit 1
    fi
    git -C "$ROOT" pull --ff-only
else
    printf '%s\n' 'Каталог без Git: обновите исходники релиза перед запуском update.sh.'
fi
docker_compose config --quiet
docker_compose build --pull
docker_compose up -d --wait --wait-timeout 180
verify_health
printf '%s\n' 'Обновление завершено; данные и backup сохранены.'
