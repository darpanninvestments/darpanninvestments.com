"""Emergency sign-in code for when email delivery is unavailable (requires server access).
Usage:  .venv/bin/python login_code.py user@example.com
The code is valid for 10 minutes, works once, and the action is written to the audit log."""
import secrets
import sys
from datetime import timedelta

from sqlalchemy import select, update

from app.db import M, SessionLocal, init_models, utcnow
from app.security import hash_password

init_models()
if len(sys.argv) != 2:
    sys.exit(__doc__)
db = SessionLocal()
user = db.scalar(select(M.User).where(M.User.email == sys.argv[1].strip().lower(), M.User.deleted_at.is_(None)))
if not user or not user.is_active:
    sys.exit("No active user with that email")
code = f"{secrets.randbelow(1_000_000):06d}"
db.execute(update(M.OtpToken).where(M.OtpToken.user_id == user.id, M.OtpToken.purpose.in_(["login", "login_cli"]),
                                    M.OtpToken.consumed_at.is_(None)).values(consumed_at=utcnow()))
db.add(M.OtpToken(user_id=user.id, purpose="login_cli", code_hash=hash_password(f"{code}:"),
                  expires_at=utcnow() + timedelta(minutes=10)))
db.add(M.AuditLog(company_id=user.company_id, user_id=user.id, action="login_code_cli", entity="users", entity_id=user.id,
                  summary=f"Emergency sign-in code issued from the server console for {user.email}"))
db.commit()
print(f"Sign-in code for {user.email}: {code}  (valid 10 minutes, single use)")
print("On the login page: enter the email, click 'Email me a code', then type this code.")
