#!/bin/sh
set -eu
# shellcheck source=scripts/common.sh
. "$(dirname "$0")/scripts/common.sh"
docker info >/dev/null
python3 "$ROOT/scripts/config.py" install
docker_compose config --quiet
docker_compose up -d --build --wait --wait-timeout 180
verify_health
python3 "$ROOT/scripts/config.py" clear-bootstrap
printf '%s\n' 'Config Vault установлен. Одноразовый пароль удалён из bootstrap.json.'
printf '%s\n' 'Сохраните .secrets/vault_key в отдельном защищённом месте и настройте backup.'
