import secrets
import time
from dataclasses import dataclass, field
from datetime import timedelta

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .config import settings
from .db import M, get_db, utcnow
from .permissions import SCOPE_RANK

COOKIE_NAME = "crm_session"


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt(rounds=12)).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except ValueError:
        return False


COMMON_PASSWORDS = {
    "password", "password1", "password123", "12345678", "123456789", "1234567890", "qwerty123", "qwertyuiop",
    "admin123", "admin@123", "welcome1", "welcome@123", "letmein1", "iloveyou1", "abc12345", "abcd1234",
    "passw0rd", "india123", "india@123", "darpann123", "darpann@123", "crm12345", "test1234", "11111111",
}

# Hash of a random string: verifying against it makes unknown-user logins take as long as real ones.
DUMMY_HASH = bcrypt.hashpw(secrets.token_bytes(16), bcrypt.gensalt(rounds=12)).decode()


def password_issues(pw: str, email: str | None = None, name: str | None = None) -> list[str]:
    issues = []
    if len(pw) < 8:
        issues.append("use at least 8 characters")
    if len(pw) > 128:
        issues.append("use at most 128 characters")
    if not any(c.isalpha() for c in pw) or not any(c.isdigit() for c in pw):
        issues.append("include letters and numbers")
    if not (any(c.islower() for c in pw) and any(c.isupper() for c in pw)) and not any(not c.isalnum() for c in pw):
        issues.append("include an uppercase letter or a symbol")
    low = pw.lower()
    if low in COMMON_PASSWORDS or len(set(low)) <= 3:
        issues.append("must not be a common or repetitive password")
    local = (email or "").split("@")[0].lower()
    if (local and len(local) >= 4 and local in low) or any(len(p) >= 4 and p.lower() in low for p in (name or "").split()):
        issues.append("must not contain your name or email")
    return issues


def validate_password_strength(pw: str, email: str | None = None, name: str | None = None) -> None:
    issues = password_issues(pw, email, name)
    if issues:
        raise HTTPException(400, "Choose a stronger password: " + "; ".join(issues) + ".")


def client_ip(request: Request) -> str:
    """On Vercel the edge sets x-vercel-forwarded-for / x-real-ip (not client-controllable).
    Locally uvicorn's proxy-headers resolves X-Forwarded-For from the trusted Next.js proxy."""
    if settings.on_vercel:
        for h in ("x-vercel-forwarded-for", "x-real-ip", "x-forwarded-for"):
            v = request.headers.get(h)
            if v:
                return v.split(",")[0].strip()
    return (request.client.host if request.client else "") or "unknown"


class RateLimiter:
    """In-process sliding-window limiter. For several API instances, back this with Redis."""

    def __init__(self, limit: int, window_seconds: int):
        self.limit, self.window = limit, window_seconds
        self.hits: dict[str, list[float]] = {}

    def hit(self, key: str, message: str = "Too many requests. Please wait a few minutes and try again."):
        now = time.time()
        recent = [t for t in self.hits.get(key, []) if now - t < self.window]
        if len(recent) >= self.limit:
            self.hits[key] = recent
            raise HTTPException(429, message)
        recent.append(now)
        self.hits[key] = recent
        if len(self.hits) > 50_000:  # bound memory
            self.hits = {k: v for k, v in self.hits.items() if v and now - v[-1] < self.window}


def create_session(db: Session, user, request: Request) -> tuple[str, int]:
    token_id = secrets.token_hex(24)
    hours = settings.access_token_hours
    exp = utcnow() + timedelta(hours=hours)
    db.add(M.UserSession(
        user_id=user.id, token_id=token_id, expires_at=exp, last_seen_at=utcnow(),
        ip=request.client.host if request.client else None,
        user_agent=(request.headers.get("user-agent") or "")[:500],
    ))
    token = jwt.encode({"sub": str(user.id), "sid": token_id, "exp": exp + timedelta(minutes=1)},
                       settings.jwt_secret, algorithm="HS256")
    return token, hours * 3600


@dataclass
class Ctx:
    """The authenticated user + resolved permissions, passed to every handler."""
    user: object
    role: object
    perms: dict[str, dict[str, str]]
    session_id: str
    _visible: list[int] | None = field(default=None, repr=False)

    @property
    def id(self) -> int:
        return self.user.id

    @property
    def company_id(self) -> int | None:
        return self.user.company_id

    @property
    def is_global(self) -> bool:
        return self.role.level >= 90

    def scope(self, module: str, action: str) -> str:
        return self.perms.get(module, {}).get(action, "none")

    def can(self, module: str, action: str) -> bool:
        return self.scope(module, action) != "none"


def _load_perms(db: Session, role_id: int) -> dict[str, dict[str, str]]:
    perms: dict[str, dict[str, str]] = {}
    for rp in db.scalars(select(M.RolePermission).where(M.RolePermission.role_id == role_id)):
        perms.setdefault(rp.module, {})[rp.action] = rp.scope
    return perms


def get_ctx(request: Request, db: Session = Depends(get_db)) -> Ctx:
    token = request.cookies.get(COOKIE_NAME)
    auth = request.headers.get("authorization", "")
    if not token and auth.lower().startswith("bearer "):
        token = auth[7:]
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired")
    sess = db.scalar(select(M.UserSession).where(M.UserSession.token_id == payload.get("sid")))
    now = utcnow()
    if not sess or sess.revoked_at or sess.expires_at < now:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired")
    if (now - sess.last_seen_at).total_seconds() > settings.session_idle_minutes * 60:
        sess.revoked_at = now
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Signed out after inactivity")
    user = db.get(M.User, int(payload["sub"]))
    if not user or not user.is_active or user.deleted_at:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account disabled")
    if (now - sess.last_seen_at).total_seconds() > 60:
        sess.last_seen_at = now
        db.commit()
    role = db.get(M.Role, user.role_id)
    return Ctx(user=user, role=role, perms=_load_perms(db, role.id), session_id=sess.token_id)


def require(module: str, action: str = "view"):
    def dep(ctx: Ctx = Depends(get_ctx)) -> Ctx:
        if not ctx.can(module, action):
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"You do not have permission to {action} {module}")
        return ctx
    return dep


def visible_user_ids(db: Session, ctx: Ctx) -> list[int]:
    """Self + everyone reporting to the user (recursively) + members of teams they manage/lead."""
    if ctx._visible is not None:
        return ctx._visible
    users = db.execute(
        select(M.User.id, M.User.reports_to_id, M.User.team_id).where(M.User.company_id == ctx.company_id)
    ).all()
    led_teams = set(db.scalars(select(M.Team.id).where(
        or_(M.Team.manager_id == ctx.id, M.Team.lead_id == ctx.id))))
    if ctx.user.team_id and ctx.role.level >= 40:
        led_teams.add(ctx.user.team_id)
    children: dict[int, list[int]] = {}
    for uid, rep, _ in users:
        if rep:
            children.setdefault(rep, []).append(uid)
    seen = {ctx.id}
    stack = [ctx.id] + [uid for uid, _, tid in users if tid in led_teams]
    while stack:
        u = stack.pop()
        seen.add(u)
        for c in children.get(u, []):
            if c not in seen:
                stack.append(c)
    ctx._visible = list(seen)
    return ctx._visible


def scope_filter(stmt, model, db: Session, ctx: Ctx, module: str, action: str = "view",
                 owner_cols: tuple[str, ...] = ("assigned_to_id",)):
    """Restrict a SELECT to the rows the user may see for module/action."""
    scope = ctx.scope(module, action)
    cols = model.__table__.columns
    if scope == "none":
        return stmt.where(False)
    if scope == "all":
        return stmt
    if "company_id" in cols and ctx.company_id is not None:
        stmt = stmt.where(model.company_id == ctx.company_id)
    if scope == "company":
        return stmt
    owners = [getattr(model, c) for c in owner_cols if c in cols]
    if "created_by" in cols:
        owners.append(model.created_by)
    if not owners:
        return stmt
    ids = [ctx.id] if scope == "own" else visible_user_ids(db, ctx)
    return stmt.where(or_(*[o.in_(ids) for o in owners]))


def can_access_row(db: Session, ctx: Ctx, row, module: str, action: str = "view",
                   owner_cols: tuple[str, ...] = ("assigned_to_id",)) -> bool:
    scope = ctx.scope(module, action)
    if scope == "none":
        return False
    if scope == "all":
        return True
    if getattr(row, "company_id", None) is not None and ctx.company_id is not None \
            and row.company_id != ctx.company_id:
        return False
    if scope == "company":
        return True
    ids = {ctx.id} if scope == "own" else set(visible_user_ids(db, ctx))
    owners = [getattr(row, c, None) for c in (*owner_cols, "created_by")]
    return any(o in ids for o in owners if o)


def ensure_access(db: Session, ctx: Ctx, row, module: str, action: str = "view",
                  owner_cols: tuple[str, ...] = ("assigned_to_id",)):
    if row is None or getattr(row, "deleted_at", None):
        raise HTTPException(404, "Record not found")
    if not can_access_row(db, ctx, row, module, action, owner_cols):
        raise HTTPException(403, "You do not have access to this record")
    return row


def resolve_company_id(ctx: Ctx, requested: int | None) -> int:
    """Which company a new record belongs to. Global admins may choose; others are pinned."""
    if ctx.is_global:
        if requested:
            return int(requested)
        if ctx.company_id:
            return ctx.company_id
        raise HTTPException(400, "Please select a company")
    if ctx.company_id is None:
        raise HTTPException(400, "Your account is not linked to a company")
    return ctx.company_id


def max_scope(*scopes: str) -> str:
    return max(scopes, key=lambda s: SCOPE_RANK.get(s, 0))
