"""Database access. Tables are owned by Prisma (database/prisma/schema.prisma);
SQLAlchemy reflects them at startup so both layers always agree."""
from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

from sqlalchemy import create_engine, event, inspect as sa_inspect
from sqlalchemy.ext.automap import automap_base
from sqlalchemy.orm import Session, sessionmaker

from .config import settings

_url, _args = settings.sqlalchemy_url
engine = create_engine(
    _url, connect_args=_args, pool_pre_ping=True, pool_recycle=280, pool_size=10, max_overflow=20
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

Base = automap_base()

# Class names used throughout the API -> table names created by Prisma
TABLES = {
    "Company": "companies", "Role": "roles", "RolePermission": "role_permissions", "Team": "teams",
    "User": "users", "UserSession": "user_sessions", "OtpToken": "otp_tokens",
    "LeadStatus": "lead_statuses", "LeadSubStatus": "lead_sub_statuses", "LeadSource": "lead_sources",
    "Lookup": "lookups", "CustomField": "custom_fields", "Setting": "settings",
    "Country": "countries", "State": "states", "City": "cities", "Area": "areas",
    "Process": "processes", "Project": "projects", "Property": "properties",
    "Lead": "leads", "Activity": "activities", "FollowUp": "follow_ups", "Visit": "visits",
    "Meeting": "meetings", "Client": "clients", "Document": "documents", "DocumentShare": "document_shares",
    "Form": "forms", "FormSubmission": "form_submissions", "Notification": "notifications",
    "ImportJob": "import_jobs", "ExportLog": "export_logs", "AuditLog": "audit_logs",
    "SavedView": "saved_views", "DashboardLayout": "dashboard_layouts", "MessageTemplate": "message_templates",
}

M = SimpleNamespace()  # M.Lead, M.User, ...


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def init_models() -> None:
    if getattr(M, "_ready", False):
        return
    Base.prepare(autoload_with=engine)
    for cls_name, table in TABLES.items():
        cls = getattr(Base.classes, table)
        setattr(M, cls_name, cls)
        cols = set(cls.__table__.columns.keys())
        if "updated_at" in cols:
            event.listen(cls, "before_insert", _touch)
            event.listen(cls, "before_update", _touch)
        if "created_at" in cols:
            event.listen(cls, "before_insert", _created)
    M._ready = True


def _touch(_mapper, _conn, target):
    target.updated_at = utcnow()


def _created(_mapper, _conn, target):
    if getattr(target, "created_at", None) is None:
        target.created_at = utcnow()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def columns(model) -> set[str]:
    return set(model.__table__.columns.keys())


def ser(v: Any) -> Any:
    if isinstance(v, datetime):
        return v.isoformat(timespec="seconds") + "Z"
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    return v


HIDDEN = {"password_hash", "code_hash"}


_BOOL_COLS: dict = {}


def _bools(cls) -> set[str]:
    """MySQL stores Prisma Booleans as TINYINT(1); expose them as real booleans."""
    if cls not in _BOOL_COLS:
        _BOOL_COLS[cls] = {c.key for c in cls.__table__.columns if str(c.type).upper().startswith(("TINYINT", "BOOL"))}
    return _BOOL_COLS[cls]


def to_dict(obj, extra: dict | None = None) -> dict | None:
    if obj is None:
        return None
    bools = _bools(type(obj))
    d = {c.key: (bool(v) if c.key in bools and v is not None else ser(v))
         for c in sa_inspect(obj).mapper.column_attrs if c.key not in HIDDEN
         for v in (getattr(obj, c.key),)}
    if extra:
        d.update(extra)
    return d


def parse_dt(v: Any) -> datetime | None:
    """Accept ISO strings (with Z/offset) and return naive UTC."""
    if v in (None, ""):
        return None
    if isinstance(v, datetime):
        dt = v
    else:
        s = str(v).replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def clean_payload(model, data: dict, *, exclude: set[str] = frozenset()) -> dict:
    """Keep only real columns, coerce datetimes and empty strings."""
    cols = model.__table__.columns
    out = {}
    for k, v in data.items():
        if k not in cols or k in exclude or k in ("id", "created_at", "updated_at", "deleted_at"):
            continue
        t = str(cols[k].type).upper()
        if v == "" and not t.startswith(("VARCHAR", "TEXT")):
            v = None
        if v is not None and ("DATETIME" in t or "TIMESTAMP" in t):
            v = parse_dt(v)
        out[k] = v
    return out


def apply(obj, data: dict) -> None:
    for k, v in data.items():
        setattr(obj, k, v)


def commit(db: Session, *objs):
    for o in objs:
        db.add(o)
    db.commit()
    for o in objs:
        db.refresh(o)
    return objs[0] if len(objs) == 1 else objs
