#!/bin/sh
set -eu
mkdir -p /run/sshd
ssh-keygen -A >/dev/null
if [ -f /run/secrets/fixture_ssh_password ]; then
    password=$(cat /run/secrets/fixture_ssh_password)
else
    password=$(cat /run/secrets/ssh_password)
fi
printf 'root:%s\n' "$password" | chpasswd
unset password
nginx
exec /usr/sbin/sshd -D -e -f /opt/fixture-sshd_config
