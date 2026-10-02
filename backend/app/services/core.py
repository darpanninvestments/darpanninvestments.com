"""Cross-cutting services: audit, timeline, notifications, settings, assignment, duplicates."""
import html
import logging
import re
from typing import Any

from fastapi import Request
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..db import M, utcnow
from .email import send_email_async

log = logging.getLogger("crm")


# ── Audit ──────────────────────────────────────────────────────────────────────
def audit(db: Session, ctx, action: str, entity: str, entity_id: int | None = None, summary: str = "",
          changes: Any = None, company_id: int | None = None, request: Request | None = None,
          user_id: int | None = None):
    db.add(M.AuditLog(
        company_id=company_id if company_id is not None else (ctx.company_id if ctx else None),
        user_id=ctx.id if ctx else user_id, action=action, entity=entity, entity_id=entity_id,
        summary=summary[:500] if summary else None, changes=changes,
        ip=request.client.host if request and request.client else None,
    ))


def diff(obj, data: dict) -> dict:
    out = {}
    for k, v in data.items():
        old = getattr(obj, k, None)
        if str(old) != str(v):
            out[k] = {"from": None if old is None else str(old), "to": None if v is None else str(v)}
    return out


# ── Timeline ───────────────────────────────────────────────────────────────────
def activity(db: Session, ctx, *, company_id: int, type: str, title: str, lead_id: int | None = None,
             client_id: int | None = None, description: str | None = None, meta: Any = None,
             is_internal: bool = True):
    db.add(M.Activity(company_id=company_id, lead_id=lead_id, client_id=client_id,
                      user_id=ctx.id if ctx else None, type=type, title=title[:255],
                      description=description, meta=meta, is_internal=is_internal))
    now = utcnow()
    if lead_id:
        lead = db.get(M.Lead, lead_id)
        if lead:
            lead.last_activity_at = now


# ── Notifications ──────────────────────────────────────────────────────────────
def notify(db: Session, user_id: int | None, title: str, body: str = "", *, type: str = "info",
           link: str | None = None, company_id: int | None = None, email: bool = False):
    if not user_id:
        return
    n = M.Notification(user_id=user_id, company_id=company_id, type=type, title=title[:255], body=body,
                       link=link)
    db.add(n)
    if email or user_wants_email(db, user_id, type):
        user = db.get(M.User, user_id)
        if user and user.email and user.is_active:
            n.emailed_at = utcnow()
            send_email_async(user.email, title, notification_html(user.name, title, body, link))


def user_wants_email(db: Session, user_id: int, type: str) -> bool:
    user = db.get(M.User, user_id)
    prefs = (user.preferences or {}) if user else {}
    email_types = prefs.get("email_notifications")
    if email_types is None:  # sensible default
        email_types = ["assignment", "followup_reminder", "escalation", "visit_reminder", "meeting_reminder"]
    return type in email_types


def notification_html(name: str, title: str, body: str, link: str | None) -> str:
    from ..config import settings
    btn = ""
    if link:
        url = link if link.startswith("http") else f"{settings.app_url}{link}"
        btn = (f'<p style="margin:24px 0"><a href="{html.escape(url, quote=True)}" style="background:#1e3a8a;color:#fff;'
               f'padding:10px 18px;border-radius:6px;text-decoration:none">Open in CRM</a></p>')
    return f"""<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111">
<p>Hi {html.escape(name or "")},</p><h3 style="margin:12px 0 6px">{html.escape(title)}</h3>
<p style="white-space:pre-line;color:#333">{html.escape(body or "")}</p>{btn}
<p style="color:#888;font-size:12px">You are receiving this because of your CRM notification preferences.</p></div>"""


# ── Settings ───────────────────────────────────────────────────────────────────
def get_setting(db: Session, company_id: int | None, key: str, default: Any = None) -> Any:
    row = db.scalar(select(M.Setting).where(M.Setting.company_id == company_id, M.Setting.key == key))
    if row is None and company_id is not None:
        row = db.scalar(select(M.Setting).where(M.Setting.company_id.is_(None), M.Setting.key == key))
    return row.value if row and row.value is not None else default


def set_setting(db: Session, company_id: int | None, key: str, value: Any):
    q = select(M.Setting).where(M.Setting.key == key)
    q = q.where(M.Setting.company_id.is_(None)) if company_id is None else q.where(M.Setting.company_id == company_id)
    row = db.scalar(q)
    if row:
        row.value = value
    else:
        db.add(M.Setting(company_id=company_id, key=key, value=value))


# ── Codes ──────────────────────────────────────────────────────────────────────
def assign_code(obj, prefix: str):
    obj.code = f"{prefix}-{obj.id:06d}"


# ── Phone normalisation & duplicates ──────────────────────────────────────────
def norm_phone(p: str | None) -> str:
    digits = re.sub(r"\D", "", p or "")
    return digits[-10:] if len(digits) >= 10 else digits


def find_duplicates(db: Session, company_id: int, mobile: str | None, email: str | None,
                    exclude_id: int | None = None, limit: int = 5):
    rules = get_setting(db, company_id, "duplicate_rules", {"mobile": True, "email": True})
    conds = []
    ph = norm_phone(mobile)
    if rules.get("mobile", True) and len(ph) >= 7:
        conds.append(M.Lead.mobile.like(f"%{ph}"))
        conds.append(M.Lead.alt_mobile.like(f"%{ph}"))
    if rules.get("email", True) and email:
        conds.append(func.lower(M.Lead.email) == email.strip().lower())
    if not conds:
        return []
    q = select(M.Lead).where(M.Lead.company_id == company_id, M.Lead.deleted_at.is_(None), or_(*conds))
    if exclude_id:
        q = q.where(M.Lead.id != exclude_id)
    return list(db.scalars(q.order_by(M.Lead.id).limit(limit)))


# ── Auto-assignment ────────────────────────────────────────────────────────────
def auto_assign(db: Session, company_id: int, lead=None) -> int | None:
    """Assignment rules (settings key 'assignment_rules'):
       {"mode": "round_robin"|"least_load"|"manual", "user_ids": [...],
        "rules": [{"field": "source_id"|"project_id"|"city", "value": "...", "user_ids": [...]}]}"""
    cfg = get_setting(db, company_id, "assignment_rules", {"mode": "round_robin", "user_ids": []})
    mode = cfg.get("mode", "round_robin")
    if mode == "manual":
        return None
    pool: list[int] = []
    if lead is not None:
        for r in cfg.get("rules") or []:
            val = getattr(lead, r.get("field", ""), None)
            if val is not None and str(val).lower() == str(r.get("value", "")).lower() and r.get("user_ids"):
                pool = [int(x) for x in r["user_ids"]]
                break
    if not pool:
        pool = [int(x) for x in cfg.get("user_ids") or []]
    active = select(M.User.id).join(M.Role, M.Role.id == M.User.role_id).where(
        M.User.company_id == company_id, M.User.is_active.is_(True), M.User.deleted_at.is_(None))
    if pool:
        active = active.where(M.User.id.in_(pool))
    else:
        active = active.where(M.Role.key == "agent")
    candidates = sorted(db.scalars(active))
    if not candidates:
        return None
    if mode == "least_load":
        loads = dict(db.execute(
            select(M.Lead.assigned_to_id, func.count()).where(
                M.Lead.assigned_to_id.in_(candidates), M.Lead.deleted_at.is_(None), M.Lead.converted_at.is_(None)
            ).group_by(M.Lead.assigned_to_id)).all())
        return min(candidates, key=lambda u: (loads.get(u, 0), u))
    last = get_setting(db, company_id, "assignment_pointer", None)
    nxt = next((u for u in candidates if last is None or u > last), candidates[0])
    set_setting(db, company_id, "assignment_pointer", nxt)
    return nxt


def default_status(db: Session, company_id: int):
    """First active open status (e.g. 'Fresh Lead')."""
    return db.scalar(select(M.LeadStatus).where(
        M.LeadStatus.is_active.is_(True), or_(M.LeadStatus.company_id.is_(None), M.LeadStatus.company_id == company_id)
    ).order_by(M.LeadStatus.sort_order, M.LeadStatus.id))


def name_map(db: Session, model, ids, attr: str = "name") -> dict[int, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {r.id: getattr(r, attr) for r in db.scalars(select(model).where(model.id.in_(ids)))}
