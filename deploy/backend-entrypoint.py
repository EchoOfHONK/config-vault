#!/usr/bin/env python3
"""Prepare volume and isolated secret copies, then run the service as vault."""
import os
from pathlib import Path
import shutil
import sys

UID = GID = 10001
command = sys.argv[1:]
if os.getuid() == 0:
    data = Path(os.environ.get("DATA_DIR", "/data"))
    data.mkdir(parents=True, exist_ok=True)
    os.chown(data, UID, GID)
    os.chmod(data, 0o700)
    for name in ("git", "backups", "tmp"):
        directory = data / name
        directory.mkdir(exist_ok=True)
        os.chown(directory, UID, GID)
        os.chmod(directory, 0o700)
    secrets = Path("/tmp/vault-secrets")
    secrets.mkdir(mode=0o700, exist_ok=True)
    for variable in ("VAULT_KEY_FILE", "DB_PASSWORD_FILE", "BOOTSTRAP_CONFIG_FILE"):
        source = os.environ.get(variable)
        if source and Path(source).is_file():
            destination = secrets / variable.lower()
            shutil.copyfile(source, destination)
            os.chown(destination, UID, GID)
            os.chmod(destination, 0o400)
            os.environ[variable] = str(destination)
    os.chown(secrets, UID, GID)
    # CLI input stays on its read-only mount. Inherited read-only file descriptors
    # let the unprivileged process consume 0600 files without chmod on the host.
    for index, argument in enumerate(command[:-1]):
        if argument in ("--input", "--password-file"):
            descriptor = os.open(command[index + 1], os.O_RDONLY)
            os.set_inheritable(descriptor, True)
            command[index + 1] = f"/proc/self/fd/{descriptor}"
    os.setgroups([])
    os.setgid(GID)
    os.setuid(UID)
if not command:
    raise SystemExit("Missing service command")
os.execvp(command[0], command)
