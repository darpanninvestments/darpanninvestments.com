from fastapi import APIRouter, Body, Depends, Request
from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session

from ..crud import build_list_query, paginate
from ..db import M, get_db, to_dict, utcnow
from ..security import Ctx, get_ctx, require, scope_filter
from ..services.core import name_map

router = APIRouter(tags=["system"])


# ── Notifications ──────────────────────────────────────────────────────────────
@router.get("/api/notifications")
def my_notifications(request: Request, db: Session = Depends(get_db), ctx: Ctx = Depends(get_ctx)):
    p = dict(request.query_params)
    stmt = select(M.Notification).where(M.Notification.user_id == ctx.id)
    if p.get("unread") == "1":
        stmt = stmt.where(M.Notification.is_read.is_(False))
    if p.get("type"):
        stmt = stmt.where(M.Notification.type == p["type"])
    rows, meta = paginate(db, stmt, M.Notification, {**p, "page_size": p.get("page_size", 30)}, "-id")
    unread = db.query(M.Notification).filter(M.Notification.user_id == ctx.id,
                                             M.Notification.is_read.is_(False)).count()
    return {"items": [to_dict(r) for r in rows], "unread": unread, **meta}


@router.post("/api/notifications/read")
def mark_read(ids: list[int] | None = Body(None, embed=True), db: Session = Depends(get_db),
              ctx: Ctx = Depends(get_ctx)):
    stmt = update(M.Notification).where(M.Notification.user_id == ctx.id, M.Notification.is_read.is_(False))
    if ids:
        stmt = stmt.where(M.Notification.id.in_(ids))
    db.execute(stmt.values(is_read=True, read_at=utcnow()))
    db.commit()
    return {"ok": True}


@router.get("/api/notifications/unread-count")
def unread_count(db: Session = Depends(get_db), ctx: Ctx = Depends(get_ctx)):
    return {"unread": db.query(M.Notification).filter(M.Notification.user_id == ctx.id,
                                                      M.Notification.is_read.is_(False)).count()}


# ── Audit log ──────────────────────────────────────────────────────────────────
@router.get("/api/audit")
def audit_log(request: Request, db: Session = Depends(get_db), ctx: Ctx = Depends(require("audit"))):
    p = dict(request.query_params)
    stmt = build_list_query(db, ctx, M.AuditLog, "audit", p, search=("summary", "entity", "action"),
                            owner_cols=("user_id",))
    rows, meta = paginate(db, stmt, M.AuditLog, p, "-id")
    users = name_map(db, M.User, [r.user_id for r in rows])
    return {"items": [to_dict(r, {"user_name": users.get(r.user_id, "System")}) for r in rows], **meta}


# ── Global search ──────────────────────────────────────────────────────────────
@router.get("/api/search")
def global_search(q: str, db: Session = Depends(get_db), ctx: Ctx = Depends(get_ctx)):
    q = q.strip()
    if len(q) < 2:
        return []
    like = f"%{q}%"
    out = []
    targets = [
        ("leads", M.Lead, ("name", "mobile", "email", "code"), lambda r: (r.name, f"{r.code} · {r.mobile}"), "/leads/{}"),
        ("clients", M.Client, ("name", "mobile", "email", "code"), lambda r: (r.name, f"{r.code} · {r.mobile}"), "/clients/{}"),
        ("projects", M.Project, ("name", "code", "developer"), lambda r: (r.name, r.developer or r.status), "/projects/{}"),
        ("properties", M.Property, ("code", "unit_no"), lambda r: (r.code, f"{r.property_type or ''} · {r.availability}"), "/properties?q=" + q + "&id={}"),
    ]
    for module, model, cols, label, link in targets:
        if not ctx.can(module, "view"):
            continue
        owner = ("assigned_to_id",) if module in ("leads", "clients") else ()
        stmt = scope_filter(select(model), model, db, ctx, module, "view", owner).where(
            model.deleted_at.is_(None), or_(*[getattr(model, c).like(like) for c in cols])).limit(6)
        for r in db.scalars(stmt):
            title, sub = label(r)
            out.append({"type": module, "id": r.id, "title": title, "subtitle": sub, "link": link.format(r.id)})
    return out
