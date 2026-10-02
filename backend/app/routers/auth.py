import html
import secrets
from datetime import timedelta

from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from ..config import settings
from ..db import M, get_db, to_dict, utcnow
from ..permissions import MODULES
from ..security import (COOKIE_NAME, DUMMY_HASH, Ctx, RateLimiter, client_ip, create_session, get_ctx, hash_password,
                        password_issues, validate_password_strength, verify_password)
from ..services.core import audit
from ..services.email import send_email_async

router = APIRouter(prefix="/api/auth", tags=["auth"])

MAX_FAILED = 5                       # failures before the account locks
LOCK_MINUTES = (15, 30, 60, 240)     # each further lock lasts longer
ip_login_limit = RateLimiter(30, 600)        # login attempts per IP / 10 min (any account)
ip_email_limit = RateLimiter(60, 3600)       # codes sent per IP / hour (offices share one IP)
otp_verify_limit = RateLimiter(20, 600)      # code checks per IP / 10 min
GENERIC_LOGIN_ERROR = "Invalid email or password"
OTP_COOKIE = "crm_otp"  # binds an emailed code to the browser that requested it


def _require_password_login():
    if not settings.password_login_enabled:
        raise HTTPException(403, "Password sign-in is disabled. Sign in with a one-time email code.")


def me_payload(db: Session, ctx: Ctx) -> dict:
    u = ctx.user
    company = db.get(M.Company, u.company_id) if u.company_id else None
    team = db.get(M.Team, u.team_id) if u.team_id else None
    unread = db.query(M.Notification).filter(M.Notification.user_id == u.id,
                                             M.Notification.is_read.is_(False)).count()
    user = to_dict(u)
    for k in ("failed_login_count", "locked_until"):
        user.pop(k, None)
    return {
        "user": user,
        "role": {"id": ctx.role.id, "key": ctx.role.key, "name": ctx.role.name, "level": ctx.role.level},
        "company": to_dict(company),
        "team": to_dict(team),
        "permissions": ctx.perms,
        "modules": {k: v["label"] for k, v in MODULES.items()},
        "unread_notifications": unread,
        "is_global": ctx.is_global,
        "session_idle_minutes": settings.session_idle_minutes,
        "password_login_enabled": settings.password_login_enabled,
    }


def _find_user(db: Session, email: str):
    return db.scalar(select(M.User).where(M.User.email == email.strip().lower(), M.User.deleted_at.is_(None)))


def _locked_message(user) -> str:
    mins = max(1, int((user.locked_until - utcnow()).total_seconds() // 60) + 1)
    return f"Too many failed attempts. This account is locked for {mins} more minute{'s' if mins > 1 else ''}. " \
           f"You can reset your password or sign in with an email code."


def _register_failure(db: Session, user, request: Request) -> int:
    user.failed_login_count = (user.failed_login_count or 0) + 1
    remaining = MAX_FAILED - (user.failed_login_count % MAX_FAILED or MAX_FAILED)
    if user.failed_login_count % MAX_FAILED == 0:
        step = min(user.failed_login_count // MAX_FAILED - 1, len(LOCK_MINUTES) - 1)
        user.locked_until = utcnow() + timedelta(minutes=LOCK_MINUTES[step])
        audit(db, None, "account_locked", "users", user.id, f"{user.email} locked after repeated failures",
              company_id=user.company_id, request=request, user_id=user.id)
        remaining = 0
    audit(db, None, "login_failed", "users", user.id, f"Failed sign-in for {user.email}", company_id=user.company_id,
          request=request, user_id=user.id)
    db.commit()
    return remaining


def _check_account_state(db: Session, user):
    if not user.is_active:
        raise HTTPException(403, "Your account is deactivated. Contact your administrator.")
    if user.company_id:
        company = db.get(M.Company, user.company_id)
        if company and (not company.is_active or company.deleted_at):
            raise HTTPException(403, "Your company account is inactive. Contact your administrator.")


def _start_session(db: Session, user, request: Request, response: Response, remember: bool, method: str) -> dict:
    ip = client_ip(request)
    known_ip = ip == user.last_login_ip or db.scalar(select(M.UserSession.id).where(
        M.UserSession.user_id == user.id, M.UserSession.ip == ip).limit(1))
    if user.last_login_at and not known_ip:
        agent = (request.headers.get("user-agent") or "unknown device")[:160]
        send_email_async(user.email, "New sign-in to your Darpann CRM account", f"""
<p>Hi {html.escape(user.name)},</p><p>Your account was just signed in from a new network or device.</p>
<p style="color:#444;font-size:14px">IP: {html.escape(ip)}<br>Device: {html.escape(agent)}<br>Time: {utcnow():%d %b %Y %H:%M} UTC</p>
<p style="color:#666;font-size:13px">If this was you, no action is needed. If not, open your Profile in the CRM, go to Security,
sign out all other sessions, then tell your administrator.</p>""")
    token, max_age = create_session(db, user, request)
    user.failed_login_count, user.locked_until = 0, None
    user.last_login_at, user.last_login_ip = utcnow(), client_ip(request)
    audit(db, None, "login", "users", user.id, f"{user.email} signed in ({method})", company_id=user.company_id,
          request=request, user_id=user.id)
    db.commit()
    response.set_cookie(COOKIE_NAME, token, httponly=True, samesite="lax", secure=settings.secure_cookies,
                        max_age=max_age if remember else None, path="/")
    response.delete_cookie(OTP_COOKIE, path="/api/auth")
    return {"ok": True, "must_change_password": bool(user.must_change_password) and settings.password_login_enabled}


@router.post("/login")
def login(request: Request, response: Response, email: str = Body(..., max_length=191),
          password: str = Body(..., max_length=256), remember: bool = Body(False), db: Session = Depends(get_db)):
    _require_password_login()
    ip_login_limit.hit(client_ip(request), "Too many sign-in attempts from this network. Please wait 10 minutes.")
    user = _find_user(db, email)
    if not user:
        # Same work as a real failure (hash check + audit write) so response time can't reveal which emails exist.
        verify_password(password, DUMMY_HASH)
        audit(db, None, "login_failed", "users", None, f"Failed sign-in for unknown account {email.strip()[:120]}",
              request=request)
        db.commit()
        raise HTTPException(401, {"message": GENERIC_LOGIN_ERROR})
    if user.locked_until and user.locked_until > utcnow():
        raise HTTPException(423, {"message": _locked_message(user), "locked": True})
    if not verify_password(password, user.password_hash):
        remaining = _register_failure(db, user, request)
        if remaining == 0:
            raise HTTPException(423, {"message": _locked_message(user), "locked": True})
        msg = GENERIC_LOGIN_ERROR + (f". {remaining} attempt{'s' if remaining > 1 else ''} left before the account "
                                     f"is locked." if remaining <= 2 else "")
        raise HTTPException(401, {"message": msg, "attempts_left": remaining})
    _check_account_state(db, user)
    # Existing passwords that no longer meet the policy must be replaced right after sign-in.
    if password_issues(password, user.email, user.name):
        user.must_change_password = True
    return _start_session(db, user, request, response, remember, "password")


def _send_code(db: Session, request: Request, email: str, purpose: str, response: Response | None = None):
    ip_email_limit.hit(client_ip(request))
    nonce = ""
    if response is not None:  # always set, even for unknown emails, so the response reveals nothing
        nonce = secrets.token_urlsafe(24)
        response.set_cookie(OTP_COOKIE, nonce, httponly=True, samesite="strict", secure=settings.secure_cookies,
                            max_age=15 * 60, path="/api/auth")
    user = _find_user(db, email)
    if not user or not user.is_active:
        return  # same response either way – emails can't be enumerated
    recent = db.scalar(select(func.count()).select_from(M.OtpToken).where(
        M.OtpToken.user_id == user.id, M.OtpToken.purpose == purpose,
        M.OtpToken.created_at > utcnow() - timedelta(minutes=15)))
    if recent >= 3:
        return  # silently drop: avoids mailbox flooding without revealing the account exists
    code = f"{secrets.randbelow(1_000_000):06d}"
    db.execute(update(M.OtpToken).where(M.OtpToken.user_id == user.id, M.OtpToken.purpose == purpose,
                                        M.OtpToken.consumed_at.is_(None)).values(consumed_at=utcnow()))
    mins = 10 if purpose == "login" else 15
    db.add(M.OtpToken(user_id=user.id, purpose=purpose, code_hash=hash_password(f"{code}:{nonce}"),
                      expires_at=utcnow() + timedelta(minutes=mins)))
    db.commit()
    what = "sign in" if purpose == "login" else "reset your password"
    send_email_async(user.email, f"Your Darpann CRM {'sign-in' if purpose == 'login' else 'password reset'} code", f"""
<p>Hi {html.escape(user.name)},</p>
<p>Use this code to {what}. It expires in {mins} minutes.</p>
<p style="font-size:32px;letter-spacing:8px;font-weight:bold;color:#111;margin:20px 0">{code}</p>
<p style="color:#666;font-size:13px">Requested from IP {html.escape(client_ip(request))} at {utcnow():%d %b %Y %H:%M} UTC.<br>
If this wasn't you, ignore this email – your account stays safe. Never share this code with anyone.</p>""")


def _consume_code(db: Session, request: Request, email: str, code: str, purpose: str):
    otp_verify_limit.hit(client_ip(request))
    user = _find_user(db, email)
    purposes = [purpose, "login_cli"] if purpose == "login" else [purpose]
    tokens = list(db.scalars(select(M.OtpToken).where(
        M.OtpToken.user_id == user.id, M.OtpToken.purpose.in_(purposes), M.OtpToken.consumed_at.is_(None),
        M.OtpToken.expires_at > utcnow(), M.OtpToken.attempts < 5).order_by(M.OtpToken.id.desc()))) if user else []
    if not tokens:
        raise HTTPException(400, "Invalid or expired code. Request a new one.")
    cookie_nonce = request.cookies.get(OTP_COOKIE, "")
    for otp in tokens:
        # emailed sign-in codes only work in the browser that requested them; console (CLI) codes are unbound
        nonce = cookie_nonce if otp.purpose == "login" else ""
        if verify_password(f"{code.strip()}:{nonce}", otp.code_hash):
            otp.consumed_at = utcnow()
            return user
    for otp in tokens:
        otp.attempts += 1
    db.commit()
    if purpose == "login" and not cookie_nonce:
        raise HTTPException(400, "Enter the code in the same browser where you requested it, or request a new code here.")
    left = 5 - max(t.attempts for t in tokens)
    raise HTTPException(400, f"Incorrect code. {left} attempt{'s' if left != 1 else ''} left." if left > 0
                        else "Too many incorrect codes. Request a new one.")


@router.post("/login-code")
def request_login_code(request: Request, response: Response, email: str = Body(..., embed=True, max_length=191),
                       db: Session = Depends(get_db)):
    """Passwordless sign-in: email a one-time 6-digit code, bound to this browser."""
    _send_code(db, request, email, "login", response)
    return {"ok": True, "message": "If the email is registered, a sign-in code has been sent."}


@router.post("/login-code/verify")
def verify_login_code(request: Request, response: Response, email: str = Body(..., max_length=191),
                      code: str = Body(..., max_length=12), remember: bool = Body(False), db: Session = Depends(get_db)):
    user = _consume_code(db, request, email, code, "login")
    _check_account_state(db, user)
    return _start_session(db, user, request, response, remember, "email code")


@router.post("/check-password")
def check_password(password: str = Body(..., embed=True, max_length=256), email: str | None = Body(None, embed=True),
                   name: str | None = Body(None, embed=True)):
    """Lets the UI show the exact server-side password rules as the user types."""
    issues = password_issues(password, email, name)
    return {"ok": not issues, "issues": issues}


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db), ctx: Ctx = Depends(get_ctx)):
    db.execute(update(M.UserSession).where(M.UserSession.token_id == ctx.session_id).values(revoked_at=utcnow()))
    audit(db, ctx, "logout", "users", ctx.id, f"{ctx.user.email} signed out", request=request)
    db.commit()
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/me")
def me(db: Session = Depends(get_db), ctx: Ctx = Depends(get_ctx)):
    return me_payload(db, ctx)


@router.patch("/me")
def update_profile(data: dict = Body(...), db: Session = Depends(get_db), ctx: Ctx = Depends(get_ctx)):
    u = db.get(M.User, ctx.id)
    for k in ("name", "mobile", "avatar_url", "designation"):
        if k in data:
            v = data[k].strip() if isinstance(data[k], str) else data[k]
            if k == "name" and not v:
                raise HTTPException(422, "Name is required")
            if k == "avatar_url" and v and not str(v).startswith(("https://", "/")):
                raise HTTPException(422, "Avatar must be an https:// URL")
            setattr(u, k, v)
    if "preferences" in data and isinstance(data["preferences"], dict):
        u.preferences = {**(u.preferences or {}), **data["preferences"]}
    db.commit()
    db.refresh(u)
    ctx.user = u
    return me_payload(db, ctx)


@router.post("/change-password")
def change_password(request: Request, current_password: str = Body(..., max_length=256),
                    new_password: str = Body(..., max_length=256), db: Session = Depends(get_db),
                    ctx: Ctx = Depends(get_ctx)):
    _require_password_login()
    u = db.get(M.User, ctx.id)
    if not verify_password(current_password, u.password_hash):
        raise HTTPException(400, "Current password is incorrect")
    if verify_password(new_password, u.password_hash):
        raise HTTPException(400, "New password must be different from the current one")
    validate_password_strength(new_password, u.email, u.name)
    u.password_hash = hash_password(new_password)
    u.must_change_password = False
    u.password_changed_at = utcnow()
    # sign out every other device
    db.execute(update(M.UserSession).where(M.UserSession.user_id == u.id, M.UserSession.token_id != ctx.session_id,
                                           M.UserSession.revoked_at.is_(None)).values(revoked_at=utcnow()))
    audit(db, ctx, "password_change", "users", u.id, "Password changed", request=request)
    db.commit()
    send_email_async(u.email, "Your Darpann CRM password was changed", f"""
<p>Hi {html.escape(u.name)},</p><p>The password for your CRM account was changed at {utcnow():%d %b %Y %H:%M} UTC
from IP {html.escape(client_ip(request))}. All other devices were signed out.</p>
<p style="color:#666;font-size:13px">If you didn't do this, reset your password immediately and contact your administrator.</p>""")
    return {"ok": True}


@router.post("/forgot-password")
def forgot_password(request: Request, email: str = Body(..., embed=True, max_length=191), db: Session = Depends(get_db)):
    _require_password_login()
    _send_code(db, request, email, "reset")
    return {"ok": True, "message": "If the email is registered, a reset code has been sent."}


@router.post("/reset-password")
def reset_password(request: Request, email: str = Body(..., max_length=191), code: str = Body(..., max_length=12),
                   new_password: str = Body(..., max_length=256), db: Session = Depends(get_db)):
    _require_password_login()
    known = _find_user(db, email)
    validate_password_strength(new_password, email, known.name if known else None)
    user = _consume_code(db, request, email, code, "reset")
    user.password_hash = hash_password(new_password)
    user.must_change_password = False
    user.password_changed_at = utcnow()
    user.failed_login_count, user.locked_until = 0, None
    db.execute(update(M.UserSession).where(M.UserSession.user_id == user.id, M.UserSession.revoked_at.is_(None))
               .values(revoked_at=utcnow()))
    audit(db, None, "password_reset", "users", user.id, "Password reset via email code", company_id=user.company_id,
          request=request, user_id=user.id)
    db.commit()
    return {"ok": True}


@router.get("/sessions")
def my_sessions(db: Session = Depends(get_db), ctx: Ctx = Depends(get_ctx)):
    rows = db.scalars(select(M.UserSession).where(
        M.UserSession.user_id == ctx.id, M.UserSession.revoked_at.is_(None), M.UserSession.expires_at > utcnow()
    ).order_by(M.UserSession.last_seen_at.desc()))
    return [{"id": s.id, "ip": s.ip, "user_agent": s.user_agent, "current": s.token_id == ctx.session_id,
             **{k: to_dict(s)[k] for k in ("created_at", "last_seen_at", "expires_at")}} for s in rows]


@router.delete("/sessions/{sid}")
def revoke_session(sid: int, db: Session = Depends(get_db), ctx: Ctx = Depends(get_ctx)):
    s = db.get(M.UserSession, sid)
    if not s or s.user_id != ctx.id:
        raise HTTPException(404, "Session not found")
    s.revoked_at = utcnow()
    db.commit()
    return {"ok": True}


@router.post("/sessions/revoke-others")
def revoke_other_sessions(db: Session = Depends(get_db), ctx: Ctx = Depends(get_ctx)):
    n = db.execute(update(M.UserSession).where(M.UserSession.user_id == ctx.id, M.UserSession.token_id != ctx.session_id,
                                               M.UserSession.revoked_at.is_(None)).values(revoked_at=utcnow())).rowcount
    db.commit()
    return {"revoked": n}
