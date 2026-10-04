"""Single-instance polling watcher and scheduled pull/backup jobs; never pushes."""
import asyncio
import os
from datetime import datetime, timezone
from sqlalchemy import select
from .db import SessionLocal
from .models import Device, Setting, Backup, User, Session


def tick():
    from .remote_routes import sync_device
    from .core import audit
    from .backup import create_backup
    with SessionLocal() as db:
        if not db.scalar(select(User.id).limit(1)): return
        from sqlalchemy import delete
        db.execute(delete(Session).where(Session.expires_at<datetime.now(timezone.utc)))
        db.commit()
        devices=db.scalars(select(Device).where(Device.connection.in_(['local','ssh']))).all()
        for device in devices:
            info=device.connection_data or {}
            if not info.get('auto_sync') and device.connection!='local': continue
            if device.connection=='local' and not info.get('auto_sync'):
                from .models import Config
                if not db.scalar(select(Config).where(Config.device_id==device.id,Config.policy=='watch')): continue
            interval=15 if device.connection=='local' and not info.get('auto_sync') else max(15,int(info.get('sync_interval',900)))
            last=device.last_sync
            if last and (datetime.now(timezone.utc)-last.replace(tzinfo=timezone.utc)).total_seconds()<interval: continue
            try: sync_device(db,device,automatic=True); db.commit()
            except Exception:
                db.rollback(); device=db.get(Device,device.id); device.status='Offline'
                device.last_sync=datetime.now(timezone.utc)
                audit(db,'Auto Sync','remote sync failed',f'device:{device.id}'); db.commit()
        setting=db.get(Setting,'backup_interval_hours')
        hours=float(setting.value) if setting else 0
        if hours>0:
            last=db.scalar(select(Backup).where(Backup.status=='Completed').order_by(Backup.created_at.desc()))
            attempt=db.scalar(select(Backup).order_by(Backup.created_at.desc()))
            recent_failure=attempt and attempt.status in ('Failed','Pending') and (datetime.now(timezone.utc)-attempt.created_at.replace(tzinfo=timezone.utc)).total_seconds()<3600
            if not recent_failure and (not last or (datetime.now(timezone.utc)-last.created_at.replace(tzinfo=timezone.utc)).total_seconds()>=hours*3600):
                try: create_backup(db,actor='Scheduler'); db.commit()
                except Exception:
                    db.rollback(); audit(db,'Scheduler','backup failed','Instance'); db.commit()
        retention=db.get(Setting,'backup_retention')
        keep=max(1,int(retention.value)) if retention else 10
        completed=db.scalars(select(Backup).where(Backup.status=='Completed').order_by(Backup.created_at.desc())).all()
        from .db import DATA_DIR
        for record in completed[keep:]:
            path=DATA_DIR/'backups'/record.name
            if path.parent==DATA_DIR/'backups': path.unlink(missing_ok=True)
            record.status='Expired'
            audit(db,'Scheduler','backup expired',f'backup:{record.id}')
        db.commit()


async def run_scheduler():
    if os.getenv('DISABLE_SCHEDULER','').lower()=='true': return
    while True:
        try: await asyncio.to_thread(tick)
        except asyncio.CancelledError: raise
        except Exception: pass  # Per-operation failures are audited, next polling tick retries.
        await asyncio.sleep(15)
