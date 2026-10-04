"""Credential provider boundary, independent of SSH or request handlers."""
import json
from typing import Protocol
from fastapi import HTTPException
from .security import decrypt, encrypt


class CredentialProvider(Protocol):
    def read(self, device) -> dict[str, str]: ...
    def write(self, device, values: dict[str, str]) -> None: ...


class EncryptedDatabaseCredentials:
    def read(self, device):
        return json.loads(decrypt(device.credential)) if device.credential else {}

    def write(self, device, values):
        clean = {}
        for key, limit in (('password',1024),('private_key',32768),('passphrase',1024)):
            value = values.get(key)
            if value:
                if not isinstance(value,str) or len(value)>limit: raise HTTPException(422,'Invalid credential field')
                clean[key]=value
        if not (clean.get('password') or clean.get('private_key')): raise HTTPException(422,'Password or private key required')
        device.credential=encrypt(json.dumps(clean))


provider: CredentialProvider = EncryptedDatabaseCredentials()


def set_provider(value: CredentialProvider):
    """Server-side injection for an external secrets provider; never a browser option."""
    global provider
    provider=value
