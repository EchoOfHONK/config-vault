"""Offline parsers; never execute uploaded configuration as code."""
import ast
import base64
import configparser
import json
import re
import tomllib
import xml.etree.ElementTree as ET

import yaml

MAX_CONTENT = 1024 * 1024


def detect_format(name: str, content: str = '') -> str:
    path = name.lower()
    name = path.split('/')[-1]
    if name == 'dockerfile': return 'dockerfile'
    if name.startswith('.env') or name.endswith('.env'): return 'env'
    if 'nginx' in name or '/nginx/' in path: return 'nginx'
    if (name.startswith('wg') or '/wireguard/' in path) and name.endswith('.conf'): return 'wireguard'
    return {'yml': 'yaml', 'conf': 'text', 'cfg': 'ini', 'properties': 'properties',
            'service': 'systemd', 'socket': 'systemd', 'timer': 'systemd',
            'py': 'python', 'js': 'javascript', 'ts': 'typescript', 'sh': 'shell'}.get(name.rsplit('.', 1)[-1], name.rsplit('.', 1)[-1] if '.' in name else 'text')


def validate_content(fmt: str, content: str) -> dict:
    errors = []
    if len(content.encode()) > MAX_CONTENT: errors.append('File exceeds 1 MiB limit')
    if '\x00' in content: errors.append('Binary content is not supported')
    try:
        if fmt == 'json': json.loads(content)
        elif fmt in ('yaml', 'yml'): yaml.safe_load(content)
        elif fmt == 'toml': tomllib.loads(content)
        elif fmt == 'xml': ET.fromstring(content)
        elif fmt == 'python': ast.parse(content)
        elif fmt in ('ini', 'systemd', 'wireguard'):
            parser = configparser.ConfigParser(strict=False, interpolation=None, allow_no_value=fmt != 'wireguard')
            parser.read_string(content)
            if fmt == 'systemd' and 'Unit' not in parser: errors.append('A systemd unit requires [Unit]')
            if fmt == 'wireguard':
                if 'Interface' not in parser: errors.append('WireGuard requires [Interface]')
                allowed={'Interface':{'privatekey','address','listenport','mtu','dns','table','preup','postup','predown','postdown','saveconfig','fwmark'},
                         'Peer':{'publickey','presharedkey','allowedips','endpoint','persistentkeepalive'}}
                for section in parser.sections():
                    if section not in allowed: errors.append('Unsupported WireGuard section')
                    elif set(parser[section])-allowed[section]: errors.append('Unsupported WireGuard field')
                for line in content.splitlines():
                    if re.match(r'\s*(PrivateKey|PublicKey|PresharedKey)\s*=', line):
                        value = line.split('=', 1)[1].strip()
                        try:
                            if len(base64.b64decode(value, validate=True)) != 32: raise ValueError()
                        except Exception: errors.append('WireGuard key must be base64 encoded, 32 bytes')
        elif fmt == 'nginx':
            # Structural check only; real nginx -t is mandatory before remote apply.
            stripped = re.sub(r'#[^\n]*|"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'', '', content)
            depth = 0
            for char in stripped:
                depth += (char == '{') - (char == '}')
                if depth < 0: raise ValueError('Unexpected closing brace')
            if depth: errors.append('Unbalanced nginx braces')
    except Exception as exc:
        # Parser messages can contain a sensitive line. Return location, never content.
        loc = getattr(exc, 'lineno', None)
        if not loc and hasattr(exc, 'problem_mark'): loc = exc.problem_mark.line + 1
        errors.append(f'Invalid {fmt} syntax' + (f' at line {loc}' if loc else ''))
    return {'valid': not errors, 'errors': errors}
