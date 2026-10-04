#!/usr/bin/env python3
"""Install prompts and .env access without evaluating user-provided shell text."""
import argparse
import base64
import getpass
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import shlex
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

ROOT = Path(__file__).resolve().parent.parent


def read_env():
    values = {}
    for line in (ROOT / ".env").read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator or not re.fullmatch(r"[A-Z_]+", key):
            raise SystemExit("Недопустимая строка в .env")
        parsed = shlex.split(value, comments=True)
        values[key] = " ".join(parsed)
    return values


def write_private(path, content):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        stream.write(content)


def prompt(label, default=""):
    value = input(f"{label}" + (f" [{default}]" if default else "") + ": ").strip()
    return value or default


def directory(value):
    if any(character in value for character in "$\r\n\x00\\\"'"):
        raise SystemExit("Путь не должен содержать $, кавычки, обратный слеш или переносы строк.")
    return Path(value).expanduser().resolve()


def install():
    if (ROOT / ".env").exists():
        raise SystemExit(".env уже существует. Для запуска: docker compose up -d; для обновления: ./update.sh")
    print("Config Vault — первичная настройка. Docker должен быть уже установлен.")
    port = int(prompt("HTTP-порт", "8080"))
    if not 1 <= port <= 65535:
        raise SystemExit("HTTP-порт должен быть от 1 до 65535")
    bind = prompt("Адрес привязки (127.0.0.1 для reverse proxy; 0.0.0.0 для LAN)", "127.0.0.1")
    ipaddress.IPv4Address(bind)
    data = directory(prompt("Каталог данных", str(ROOT / "data")))
    imports = directory(prompt("Каталог для локального импорта (доступ только на чтение)", str(ROOT / "imports")))
    domain = prompt("Домен HTTPS (необязательно)")
    if domain and not re.fullmatch(r"[a-zA-Z0-9.-]+", domain):
        raise SystemExit("Укажите только доменное имя без схемы, пути или порта")
    username = prompt("Имя администратора", "admin")
    if not re.fullmatch(r"[a-zA-Z0-9_.-]{3,64}", username):
        raise SystemExit("Имя: 3–64 латинских символа, цифры, _, . или -")
    password = getpass.getpass("Пароль администратора (минимум 12 символов): ")
    if len(password) < 12 or password != getpass.getpass("Повтор пароля: "):
        raise SystemExit("Пароли должны совпадать и содержать минимум 12 символов")
    instance = prompt("Название хранилища", "Config Vault")
    timezone = prompt("Часовой пояс", "Europe/Moscow")
    try:
        ZoneInfo(timezone)
    except ZoneInfoNotFoundError:
        raise SystemExit("Неизвестный часовой пояс") from None
    secret_dir = ROOT / ".secrets"
    if data.exists() and any(data.iterdir()):
        raise SystemExit("Каталог данных не пуст. Выберите пустой каталог; существующий экземпляр запускается с его прежними .env и ключом.")
    if data == secret_dir or imports == secret_dir or secret_dir in data.parents or secret_dir in imports.parents:
        raise SystemExit("Каталог .secrets нельзя использовать как каталог данных или импорта.")
    if data == imports or data in imports.parents or imports in data.parents:
        raise SystemExit("Каталоги данных и локального импорта должны быть отдельными, не вложенными друг в друга.")
    secret_dir.mkdir(mode=0o700, exist_ok=False)
    os.chmod(secret_dir, 0o700)
    data.mkdir(parents=True, mode=0o700, exist_ok=True)
    imports.mkdir(parents=True, mode=0o755, exist_ok=True)
    write_private(secret_dir / "db_password", secrets.token_urlsafe(36) + "\n")
    write_private(secret_dir / "vault_key", base64.urlsafe_b64encode(secrets.token_bytes(32)).decode() + "\n")
    write_private(secret_dir / "bootstrap.json", json.dumps({"username": username, "password": password, "instance_name": instance, "timezone": timezone}, ensure_ascii=False) + "\n")
    values = {"HTTP_PORT": str(port), "BIND_ADDRESS": bind, "DATA_DIRECTORY": str(data), "LOCAL_IMPORT_DIRECTORY": str(imports), "SECRETS_DIRECTORY": str(secret_dir), "DOMAIN": domain, "TZ": timezone, "COOKIE_SECURE": "true" if domain else "false"}
    env = "# Создано install.sh; файл содержит пути к защищённым секретам.\n"
    env += "".join(f"{key}={json.dumps(value)}\n" for key, value in values.items())
    write_private(ROOT / ".env", env)
    print(f"Настройки записаны. HTTP: {bind}:{port}. Администратор: {username}.")
    if domain:
        print(f"Для входа требуется HTTPS reverse proxy: https://{domain}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("install", "get", "clear-bootstrap"))
    parser.add_argument("key", nargs="?")
    args = parser.parse_args()
    if args.action == "install":
        install()
    elif args.action == "get":
        values = read_env()
        if args.key not in values:
            raise SystemExit("Неизвестный параметр .env")
        print(values[args.key])
    else:
        values = read_env()
        path = Path(values["SECRETS_DIRECTORY"]) / "bootstrap.json"
        with path.open("w") as stream:
            stream.write("{}\n")
        os.chmod(path, 0o600)


if __name__ == "__main__":
    main()
