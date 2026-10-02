import html
import secrets

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.orm import Session

from ..config import settings
from ..crud import crud_router, paginate
from ..db import M, clean_payload, get_db, to_dict, utcnow
from ..permissions import ACTIONS, MODULES, SCOPES, default_matrix
from ..security import Ctx, hash_password, require, resolve_company_id, validate_password_strength, visible_user_ids
from ..services.core import audit, diff, name_map
from ..services.email import send_email_async

router = APIRouter(tags=["admin"])


# ── Companies ──────────────────────────────────────────────────────────────────
def _company_enrich(db, items, ctx):
    ids = [i["id"] for i in items]
    if not ids:
        return
    users = dict(db.execute(select(M.User.company_id, func.count()).where(
        M.User.company_id.in_(ids), M.User.deleted_at.is_(None)).group_by(M.User.company_id)).all())
    leads = dict(db.execute(select(M.Lead.company_id, func.count()).where(
        M.Lead.company_id.in_(ids), M.Lead.deleted_at.is_(None)).group_by(M.Lead.company_id)).all())
    for i in items:
        i["user_count"] = users.get(i["id"], 0)
        i["lead_count"] = leads.get(i["id"], 0)


def _company_before(db, ctx, obj, payload):
    if obj is None and not ctx.is_global:
        raise HTTPException(403, "Only CRM admins can create companies")
    if payload.get("code"):
        payload["code"] = payload["code"].upper().strip()
        dup = db.scalar(select(M.Company.id).where(M.Company.code == payload["code"]))
        if dup and (obj is None or dup != obj.id):
            raise HTTPException(409, "Company code already exists")


companies = APIRouter(prefix="/api/companies", tags=["companies"])


@companies.get("")
def list_companies(request: Request, db: Session = Depends(get_db), ctx: Ctx = Depends(require("companies"))):
    params = dict(request.query_params)
    stmt = select(M.Company).where(M.Company.deleted_at.is_(None))
    if ctx.scope("companies", "view") != "all":
        stmt = stmt.where(M.Company.id == ctx.company_id)
    if params.get("q"):
        stmt = stmt.where(or_(M.Company.name.like(f"%{params['q']}%"), M.Company.code.like(f"%{params['q']}%")))
    if params.get("is_active") in ("true", "false", "1", "0"):
        stmt = stmt.where(M.Company.is_active.is_(params["is_active"] in ("true", "1")))
    rows, meta = paginate(db, stmt, M.Company, params, "name")
    items = [to_dict(r) for r in rows]
    _company_enrich(db, items, ctx)
    return {"items": items, **meta}


@companies.get("/{cid}")
def get_company(cid: int, db: Session = Depends(get_db), ctx: Ctx = Depends(require("companies"))):
    if ctx.scope("companies", "view") != "all" and cid != ctx.company_id:
        raise HTTPException(404, "Company not found")
    c = db.get(M.Company, cid)
    if not c or c.deleted_at:
        raise HTTPException(404, "Company not found")
    items = [to_dict(c)]
    _company_enrich(db, items, ctx)
    return items[0]


@companies.post("")
def create_company(request: Request, data: dict = Body(...), db: Session = Depends(get_db),
                   ctx: Ctx = Depends(require("companies", "add"))):
    payload = clean_payload(M.Company, data)
    if not payload.get("name"):
        raise HTTPException(422, "Company name is required")
    payload.setdefault("code", "".join(w[0] for w in payload["name"].split())[:6].upper() + str(secrets.randbelow(900) + 100))
    _company_before(db, ctx, None, payload)
    c = M.Company(**payload)
    db.add(c)
    db.flush()
    audit(db, ctx, "create", "companies", c.id, c.name, company_id=c.id, request=request)
    db.commit()
    return to_dict(c)


@companies.patch("/{cid}")
def update_company(cid: int, request: Request, data: dict = Body(...), db: Session = Depends(get_db),
                   ctx: Ctx = Depends(require("companies", "edit"))):
    if ctx.scope("companies", "edit") != "all" and cid != ctx.company_id:
        raise HTTPException(403, "Not allowed")
    c = db.get(M.Company, cid)
    if not c or c.deleted_at:
        raise HTTPException(404, "Company not found")
    payload = clean_payload(M.Company, data)
    if not ctx.is_global:
        payload.pop("is_active", None)
        payload.pop("code", None)
    _company_before(db, ctx, c, payload)
    ch = diff(c, payload)
    for k, v in payload.items():
        setattr(c, k, v)
    audit(db, ctx, "update", "companies", c.id, c.name, ch, company_id=c.id, request=request)
    db.commit()
    return to_dict(c)


@companies.post("/bulk-delete")
def bulk_delete_companies(request: Request, ids: list[int] = Body(..., embed=True), db: Session = Depends(get_db),
                          ctx: Ctx = Depends(require("companies", "delete"))):
    n = 0
    for c in db.scalars(select(M.Company).where(M.Company.id.in_(ids or [0]), M.Company.deleted_at.is_(None))):
        c.deleted_at, c.is_active = utcnow(), False
        n += 1
    audit(db, ctx, "bulk_delete", "companies", None, f"Deleted {n} companies", {"ids": ids}, request=request)
    db.commit()
    return {"deleted": n}


@companies.delete("/{cid}")
def delete_company(cid: int, request: Request, db: Session = Depends(get_db),
                   ctx: Ctx = Depends(require("companies", "delete"))):
    c = db.get(M.Company, cid)
    if not c or c.deleted_at:
        raise HTTPException(404, "Company not found")
    c.deleted_at = utcnow()
    c.is_active = False
    audit(db, ctx, "delete", "companies", c.id, c.name, company_id=c.id, request=request)
    db.commit()
    return {"ok": True}


# ── Users ──────────────────────────────────────────────────────────────────────
users = APIRouter(prefix="/api/users", tags=["users"])
PROTECTED_USER_FIELDS = {"password_hash", "last_login_at", "last_login_ip", "failed_login_count", "locked_until",
                         "password_changed_at", "must_change_password"}


def _user_enrich(db, items):
    roles = name_map(db, M.Role, [i["role_id"] for i in items])
    comps = name_map(db, M.Company, [i["company_id"] for i in items])
    teams = name_map(db, M.Team, [i["team_id"] for i in items])
    mgrs = name_map(db, M.User, [i["reports_to_id"] for i in items])
    for i in items:
        i["role_name"] = roles.get(i["role_id"])
        i["company_name"] = comps.get(i["company_id"])
        i["team_name"] = teams.get(i["team_id"])
        i["reports_to_name"] = mgrs.get(i["reports_to_id"])


def _user_query(db, ctx, params):
    stmt = select(M.User).where(M.User.deleted_at.is_(None))
    scope = ctx.scope("users", "view")
    if scope != "all":
        stmt = stmt.where(M.User.company_id == ctx.company_id)
        if scope in ("team", "own"):
            stmt = stmt.where(M.User.id.in_(visible_user_ids(db, ctx) if scope == "team" else [ctx.id]))
    if params.get("q"):
        like = f"%{params['q']}%"
        stmt = stmt.where(or_(M.User.name.like(like), M.User.email.like(like), M.User.mobile.like(like)))
    for k in ("company_id", "role_id", "team_id", "reports_to_id"):
        if params.get(k):
            stmt = stmt.where(getattr(M.User, k).in_(str(params[k]).split(",")))
    if params.get("is_active") in ("true", "false", "1", "0"):
        stmt = stmt.where(M.User.is_active.is_(params["is_active"] in ("true", "1")))
    return stmt


@users.get("")
def list_users(request: Request, db: Session = Depends(get_db), ctx: Ctx = Depends(require("users"))):
    params = dict(request.query_params)
    rows, meta = paginate(db, _user_query(db, ctx, params), M.User, params, "name")
    items = [to_dict(r) for r in rows]
    _user_enrich(db, items)
    return {"items": items, **meta}


@users.get("/options")
def user_options(company_id: int | None = None, db: Session = Depends(get_db), ctx: Ctx = Depends(require("dashboard"))):
    """Lightweight list for assignment dropdowns – any signed-in user can pick colleagues."""
    stmt = select(M.User.id, M.User.name, M.User.role_id, M.User.team_id, M.User.company_id).where(
        M.User.deleted_at.is_(None), M.User.is_active.is_(True))
    if ctx.is_global:
        if company_id:
            stmt = stmt.where(M.User.company_id == company_id)
    else:
        stmt = stmt.where(M.User.company_id == ctx.company_id)
    roles = {r.id: r.name for r in db.scalars(select(M.Role))}
    return [{"id": i, "name": n, "role": roles.get(r), "team_id": t, "company_id": c}
            for i, n, r, t, c in db.execute(stmt.order_by(M.User.name))]


def _check_role_assignable(db, ctx, role_id):
    role = db.get(M.Role, role_id)
    if not role:
        raise HTTPException(422, "Invalid role")
    if role.level >= ctx.role.level and ctx.role.key != "super_admin":
        raise HTTPException(403, "You cannot assign a role equal to or higher than your own")
    if role.company_id and not ctx.is_global and role.company_id != ctx.company_id:
        raise HTTPException(403, "Invalid role")
    return role


def temp_password() -> str:
    """Random temporary password that always satisfies the password policy."""
    return f"{secrets.token_urlsafe(9)}Dc7!"


def _welcome(user, password):
    if settings.password_login_enabled:
        how = (f'<tr><td style="padding:4px 12px 4px 0;color:#555">Temporary password</td><td><b>{html.escape(password)}</b></td></tr></table>'
               "<p>You will be asked to change this password after your first sign-in.</p>")
    else:
        how = ("</table><p>To sign in, enter your email on the login page and we'll email you a one-time 6-digit code. "
               "No password is needed.</p>")
    send_email_async(user.email, "Your Darpann Investments CRM account", f"""
<h2 style="color:#1e3a8a">Welcome to Darpann Investments CRM</h2><p>Hi {html.escape(user.name)},</p>
<p>An account has been created for you.</p>
<table style="border-collapse:collapse"><tr><td style="padding:4px 12px 4px 0;color:#555">Login URL</td>
<td><a href="{settings.app_url}/login">{settings.app_url}/login</a></td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#555">Email</td><td>{html.escape(user.email)}</td></tr>{how}""")


@users.post("")
def create_user(request: Request, data: dict = Body(...), db: Session = Depends(get_db),
                ctx: Ctx = Depends(require("users", "add"))):
    email = (data.get("email") or "").strip().lower()
    if not data.get("name") or not email or not data.get("role_id"):
        raise HTTPException(422, "Name, email and role are required")
    if db.scalar(select(M.User.id).where(M.User.email == email)):
        raise HTTPException(409, "A user with this email already exists")
    role = _check_role_assignable(db, ctx, int(data["role_id"]))
    payload = clean_payload(M.User, data, exclude=PROTECTED_USER_FIELDS)
    payload["email"] = email
    payload["company_id"] = None if role.level >= 90 and ctx.is_global and not data.get("company_id") \
        else resolve_company_id(ctx, data.get("company_id"))
    password = data.get("password") or temp_password()
    validate_password_strength(password, email, data.get("name"))
    payload["password_hash"] = hash_password(password)
    payload["must_change_password"] = settings.password_login_enabled and not data.get("password")
    u = M.User(**payload)
    db.add(u)
    db.flush()
    audit(db, ctx, "create", "users", u.id, f"Created user {u.email} ({role.name})", company_id=u.company_id,
          request=request)
    db.commit()
    if data.get("send_welcome", True):
        _welcome(u, password)
    out = [to_dict(u)]
    _user_enrich(db, out)
    return out[0]


def _get_user(db, ctx, uid, action="view"):
    u = db.get(M.User, uid)
    if not u or u.deleted_at:
        raise HTTPException(404, "User not found")
    scope = ctx.scope("users", action)
    if scope != "all" and u.company_id != ctx.company_id:
        raise HTTPException(404, "User not found")
    if scope in ("team", "own") and uid not in visible_user_ids(db, ctx):
        raise HTTPException(403, "Not allowed")
    return u


@users.get("/{uid}")
def get_user(uid: int, db: Session = Depends(get_db), ctx: Ctx = Depends(require("users"))):
    out = [to_dict(_get_user(db, ctx, uid))]
    _user_enrich(db, out)
    return out[0]


@users.patch("/{uid}")
def update_user(uid: int, request: Request, data: dict = Body(...), db: Session = Depends(get_db),
                ctx: Ctx = Depends(require("users", "edit"))):
    u = _get_user(db, ctx, uid, "edit")
    target_role = db.get(M.Role, u.role_id)
    if target_role.level >= ctx.role.level and ctx.role.key != "super_admin" and uid != ctx.id:
        raise HTTPException(403, "You cannot edit a user with an equal or higher role")
    payload = clean_payload(M.User, data, exclude=PROTECTED_USER_FIELDS | {"email"})
    if not ctx.is_global:
        payload.pop("company_id", None)
    if "role_id" in payload and payload["role_id"] != u.role_id:
        if uid == ctx.id:
            raise HTTPException(403, "You cannot change your own role")
        _check_role_assignable(db, ctx, int(payload["role_id"]))
    if data.get("email") and data["email"].strip().lower() != u.email:
        new = data["email"].strip().lower()
        if db.scalar(select(M.User.id).where(M.User.email == new)):
            raise HTTPException(409, "Email already in use")
        payload["email"] = new
    if payload.get("is_active") is False and uid == ctx.id:
        raise HTTPException(400, "You cannot deactivate yourself")
    ch = diff(u, payload)
    for k, v in payload.items():
        setattr(u, k, v)
    if payload.get("is_active") is False:
        db.execute(update(M.UserSession).where(M.UserSession.user_id == uid, M.UserSession.revoked_at.is_(None))
                   .values(revoked_at=utcnow()))
    audit(db, ctx, "update", "users", uid, f"Updated user {u.email}", ch, company_id=u.company_id, request=request)
    db.commit()
    out = [to_dict(u)]
    _user_enrich(db, out)
    return out[0]


@users.post("/{uid}/reset-password")
def admin_reset_password(uid: int, request: Request, data: dict = Body(default={}), db: Session = Depends(get_db),
                         ctx: Ctx = Depends(require("users", "edit"))):
    u = _get_user(db, ctx, uid, "edit")
    if not settings.password_login_enabled:
        raise HTTPException(400, "Password sign-in is disabled – users sign in with email codes.")
    password = data.get("password") or temp_password()
    validate_password_strength(password, u.email, u.name)
    u.password_hash = hash_password(password)
    u.must_change_password = True
    db.execute(update(M.UserSession).where(M.UserSession.user_id == uid, M.UserSession.revoked_at.is_(None))
               .values(revoked_at=utcnow()))
    audit(db, ctx, "password_reset", "users", uid, f"Admin reset password for {u.email}", company_id=u.company_id,
          request=request)
    db.commit()
    _welcome(u, password)
    return {"ok": True, "emailed": True}


@users.post("/{uid}/unlock")
def unlock_user(uid: int, request: Request, db: Session = Depends(get_db), ctx: Ctx = Depends(require("users", "edit"))):
    u = _get_user(db, ctx, uid, "edit")
    u.failed_login_count, u.locked_until = 0, None
    audit(db, ctx, "unlock", "users", uid, f"Unlocked {u.email}", company_id=u.company_id, request=request)
    db.commit()
    return {"ok": True}


@users.delete("/{uid}")
def delete_user(uid: int, request: Request, db: Session = Depends(get_db),
                ctx: Ctx = Depends(require("users", "delete"))):
    if uid == ctx.id:
        raise HTTPException(400, "You cannot delete yourself")
    u = _get_user(db, ctx, uid, "delete")
    u.deleted_at = utcnow()
    u.is_active = False
    db.execute(update(M.UserSession).where(M.UserSession.user_id == uid).values(revoked_at=utcnow()))
    audit(db, ctx, "delete", "users", uid, f"Deleted user {u.email}", company_id=u.company_id, request=request)
    db.commit()
    return {"ok": True}


@users.get("/{uid}/sessions")
def user_sessions(uid: int, db: Session = Depends(get_db), ctx: Ctx = Depends(require("users", "edit"))):
    _get_user(db, ctx, uid, "edit")
    rows = db.scalars(select(M.UserSession).where(M.UserSession.user_id == uid, M.UserSession.revoked_at.is_(None),
                                                  M.UserSession.expires_at > utcnow()))
    return [{"id": s.id, "ip": s.ip, "user_agent": s.user_agent, "created_at": to_dict(s)["created_at"],
             "last_seen_at": to_dict(s)["last_seen_at"]} for s in rows]


@users.post("/{uid}/logout-all")
def user_logout_all(uid: int, request: Request, db: Session = Depends(get_db),
                    ctx: Ctx = Depends(require("users", "edit"))):
    u = _get_user(db, ctx, uid, "edit")
    db.execute(update(M.UserSession).where(M.UserSession.user_id == uid, M.UserSession.revoked_at.is_(None))
               .values(revoked_at=utcnow()))
    audit(db, ctx, "logout_all", "users", uid, f"Signed out all sessions of {u.email}", request=request)
    db.commit()
    return {"ok": True}


# ── Teams ──────────────────────────────────────────────────────────────────────
def _team_enrich(db, items, ctx):
    names = name_map(db, M.User, [i["manager_id"] for i in items] + [i["lead_id"] for i in items])
    counts = dict(db.execute(select(M.User.team_id, func.count()).where(
        M.User.team_id.in_([i["id"] for i in items] or [0]), M.User.deleted_at.is_(None)).group_by(M.User.team_id)).all())
    comps = name_map(db, M.Company, [i["company_id"] for i in items])
    for i in items:
        i["manager_name"] = names.get(i["manager_id"])
        i["lead_name"] = names.get(i["lead_id"])
        i["member_count"] = counts.get(i["id"], 0)
        i["company_name"] = comps.get(i["company_id"])


teams = crud_router(model="Team", module="users", prefix="/api/teams", enrich=_team_enrich, required=("name",))


# ── Roles & permissions ────────────────────────────────────────────────────────
roles = APIRouter(prefix="/api/roles", tags=["roles"])


@roles.get("/catalog")
def catalog(ctx: Ctx = Depends(require("dashboard"))):
    return {"modules": MODULES, "actions": ACTIONS, "scopes": SCOPES}


@roles.get("")
def list_roles(db: Session = Depends(get_db), ctx: Ctx = Depends(require("users"))):
    stmt = select(M.Role)
    if not ctx.is_global:
        stmt = stmt.where(or_(M.Role.company_id.is_(None), M.Role.company_id == ctx.company_id))
    rows = list(db.scalars(stmt.order_by(M.Role.level.desc(), M.Role.name)))
    counts = dict(db.execute(select(M.User.role_id, func.count()).where(M.User.deleted_at.is_(None))
                             .group_by(M.User.role_id)).all())
    return [to_dict(r, {"user_count": counts.get(r.id, 0),
                        "assignable": r.level < ctx.role.level or ctx.role.key == "super_admin"}) for r in rows]


@roles.get("/{rid}")
def get_role(rid: int, db: Session = Depends(get_db), ctx: Ctx = Depends(require("roles"))):
    r = db.get(M.Role, rid)
    if not r or (r.company_id and not ctx.is_global and r.company_id != ctx.company_id):
        raise HTTPException(404, "Role not found")
    perms: dict = {}
    for p in db.scalars(select(M.RolePermission).where(M.RolePermission.role_id == rid)):
        perms.setdefault(p.module, {})[p.action] = p.scope
    return to_dict(r, {"permissions": perms})


@roles.post("")
def create_role(request: Request, data: dict = Body(...), db: Session = Depends(get_db),
                ctx: Ctx = Depends(require("roles", "configure"))):
    if not data.get("name"):
        raise HTTPException(422, "Role name is required")
    level = int(data.get("level") or 20)
    if level >= ctx.role.level and ctx.role.key != "super_admin":
        raise HTTPException(403, "Role level must be lower than your own")
    key = data.get("key") or data["name"].lower().replace(" ", "_")
    company_id = None if ctx.is_global and not data.get("company_id") else resolve_company_id(ctx, data.get("company_id"))
    r = M.Role(key=key[:64], name=data["name"], description=data.get("description"), level=level,
               company_id=company_id, is_system=False)
    db.add(r)
    db.flush()
    base = data.get("copy_from_role_id")
    if base:
        for p in db.scalars(select(M.RolePermission).where(M.RolePermission.role_id == int(base))):
            db.add(M.RolePermission(role_id=r.id, module=p.module, action=p.action, scope=p.scope))
    audit(db, ctx, "create", "roles", r.id, r.name, request=request)
    db.commit()
    return to_dict(r)


@roles.patch("/{rid}")
def update_role(rid: int, request: Request, data: dict = Body(...), db: Session = Depends(get_db),
                ctx: Ctx = Depends(require("roles", "configure"))):
    r = db.get(M.Role, rid)
    if not r:
        raise HTTPException(404, "Role not found")
    if r.company_id is None and not ctx.is_global:
        raise HTTPException(403, "System roles can only be changed by CRM admins")
    if r.key == "super_admin" and ctx.role.key != "super_admin":
        raise HTTPException(403, "Not allowed")
    for k in ("name", "description"):
        if k in data:
            setattr(r, k, data[k])
    if "level" in data and not r.is_system:
        r.level = int(data["level"])
    perms = data.get("permissions")
    if isinstance(perms, dict):
        if r.key == "super_admin":
            raise HTTPException(400, "Super Admin always has full access")
        db.execute(delete(M.RolePermission).where(M.RolePermission.role_id == rid))
        for module, actions in perms.items():
            if module not in MODULES:
                continue
            for action, scope in (actions or {}).items():
                if action in MODULES[module]["actions"] and scope in SCOPES and scope != "none":
                    if not ctx.is_global and scope == "all":
                        scope = "company"
                    db.add(M.RolePermission(role_id=rid, module=module, action=action, scope=scope))
        audit(db, ctx, "permission_change", "roles", rid, f"Updated permissions for {r.name}", perms,
              request=request)
    db.commit()
    return get_role(rid, db, ctx)


@roles.post("/{rid}/reset")
def reset_role(rid: int, request: Request, db: Session = Depends(get_db),
               ctx: Ctx = Depends(require("roles", "configure"))):
    r = db.get(M.Role, rid)
    if not r or not r.is_system or not ctx.is_global:
        raise HTTPException(400, "Only system roles can be reset, by CRM admins")
    db.execute(delete(M.RolePermission).where(M.RolePermission.role_id == rid))
    for (module, action), scope in default_matrix(r.key).items():
        db.add(M.RolePermission(role_id=rid, module=module, action=action, scope=scope))
    audit(db, ctx, "permission_change", "roles", rid, f"Reset {r.name} to defaults", request=request)
    db.commit()
    return get_role(rid, db, ctx)


@roles.delete("/{rid}")
def delete_role(rid: int, request: Request, db: Session = Depends(get_db),
                ctx: Ctx = Depends(require("roles", "configure"))):
    r = db.get(M.Role, rid)
    if not r or r.is_system:
        raise HTTPException(400, "System roles cannot be deleted")
    if db.scalar(select(func.count()).select_from(M.User).where(M.User.role_id == rid, M.User.deleted_at.is_(None))):
        raise HTTPException(400, "Reassign users before deleting this role")
    db.execute(delete(M.RolePermission).where(M.RolePermission.role_id == rid))
    db.delete(r)
    audit(db, ctx, "delete", "roles", rid, r.name, request=request)
    db.commit()
    return {"ok": True}


for _r in (companies, users, teams, roles):
    router.include_router(_r)
