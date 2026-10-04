from datetime import datetime, timezone
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from .db import Base


def now():
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = 'users'
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(100), unique=True)
    password_hash: Mapped[str] = mapped_column(Text)
    role: Mapped[str] = mapped_column(String(20), default='viewer')
    device_ids: Mapped[list] = mapped_column(JSON, default=list)
    project_ids: Mapped[list] = mapped_column(JSON, default=list)
    service_ids: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Session(Base):
    __tablename__ = 'sessions'
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'))
    csrf_hash: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Device(Base):
    __tablename__ = 'devices'
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    type: Mapped[str] = mapped_column(String(40), default='Server')
    host: Mapped[str] = mapped_column(String(255), default='')
    os: Mapped[str] = mapped_column(String(200), default='')
    connection: Mapped[str] = mapped_column(String(20), default='manual')
    connection_data: Mapped[dict] = mapped_column(JSON, default=dict)
    credential: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(40), default='Unknown')
    last_sync: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    @property
    def roots(self):
        return (self.connection_data or {}).get('roots', [])


class Project(Base):
    __tablename__ = 'projects'
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default='')
    device_id: Mapped[int | None] = mapped_column(ForeignKey('devices.id', ondelete='RESTRICT'), nullable=True)


class Service(Base):
    __tablename__ = 'services'
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default='')
    device_id: Mapped[int | None] = mapped_column(ForeignKey('devices.id', ondelete='RESTRICT'), nullable=True)


class Config(Base):
    __tablename__ = 'configs'
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    path: Mapped[str] = mapped_column(Text)
    device_id: Mapped[int] = mapped_column(ForeignKey('devices.id', ondelete='RESTRICT'))
    service_id: Mapped[int | None] = mapped_column(ForeignKey('services.id', ondelete='RESTRICT'), nullable=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey('projects.id', ondelete='RESTRICT'), nullable=True)
    format: Mapped[str] = mapped_column(String(40), default='text')
    tags: Mapped[list] = mapped_column(JSON, default=list)
    policy: Mapped[str] = mapped_column(String(30), default='manual')
    version: Mapped[int] = mapped_column(Integer, default=0)
    current_content: Mapped[str] = mapped_column(Text, default='')
    remote_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    synced_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    conflict: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    __table_args__ = (UniqueConstraint('device_id', 'path', name='unique_device_path'),)


class Version(Base):
    __tablename__ = 'versions'
    id: Mapped[int] = mapped_column(primary_key=True)
    config_id: Mapped[int] = mapped_column(ForeignKey('configs.id', ondelete='CASCADE'))
    number: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text)
    actor: Mapped[str] = mapped_column(String(100))
    message: Mapped[str] = mapped_column(Text, default='')
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    __table_args__ = (UniqueConstraint('config_id', 'number', name='unique_config_version'),)


class Snapshot(Base):
    __tablename__ = 'snapshots'
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default='')
    device_id: Mapped[int | None] = mapped_column(ForeignKey('devices.id', ondelete='RESTRICT'), nullable=True)
    files: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Activity(Base):
    __tablename__ = 'activity'
    id: Mapped[int] = mapped_column(primary_key=True)
    actor: Mapped[str] = mapped_column(String(100))
    action: Mapped[str] = mapped_column(String(80))
    target: Mapped[str] = mapped_column(Text, default='')
    details: Mapped[str] = mapped_column(Text, default='')
    device_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Setting(Base):
    __tablename__ = 'settings'
    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[object] = mapped_column(JSON)


class Backup(Base):
    __tablename__ = 'backups'
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    size: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(30), default='Pending')
    error: Mapped[str] = mapped_column(Text, default='')


class Token(Base):
    __tablename__ = 'tokens'
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'))
    name: Mapped[str] = mapped_column(String(100))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    scopes: Mapped[list] = mapped_column(JSON, default=list)
    device_ids: Mapped[list] = mapped_column(JSON, default=list)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Template(Base):
    __tablename__ = 'templates'
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default='')
    format: Mapped[str] = mapped_column(String(40), default='text')
    content: Mapped[str] = mapped_column(Text)
