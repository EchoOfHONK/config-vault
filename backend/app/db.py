import os
from pathlib import Path
from urllib.parse import quote

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DATA_DIR = Path(os.environ.get('DATA_DIR', '/data')).resolve()
DATABASE_URL = os.environ.get('DATABASE_URL', '')
if not DATABASE_URL:
    password_file = os.environ.get('DB_PASSWORD_FILE', os.environ.get('DATABASE_PASSWORD_FILE', ''))
    password = Path(password_file).read_text().strip() if password_file else os.environ.get('DB_PASSWORD', '')
    DATABASE_URL = f"postgresql+psycopg://{quote(os.environ.get('DB_USER', 'configvault'), safe='')}:{quote(password, safe='')}@{os.environ.get('DB_HOST', 'db')}:{os.environ.get('DB_PORT', '5432')}/{os.environ.get('DB_NAME', 'configvault')}"


class Base(DeclarativeBase):
    pass


engine = create_engine(DATABASE_URL, pool_pre_ping=True, connect_args={'check_same_thread': False, 'timeout': 30} if DATABASE_URL.startswith('sqlite') else {})
if DATABASE_URL.startswith('sqlite'):
    @event.listens_for(engine, 'connect')
    def sqlite_options(connection, _):
        connection.execute('PRAGMA foreign_keys=ON')
        connection.execute('PRAGMA journal_mode=WAL')

SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def get_db():
    with SessionLocal() as db:
        try:
            yield db
        except Exception:
            db.rollback()
            raise
