import os
from functools import lru_cache
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(ROOT / ".env", ROOT / "backend" / ".env"), extra="ignore")

    database_url: str
    jwt_secret: str
    access_token_hours: int = 12

    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from_name: str = "Darpann Investments CRM"

    app_url: str = "http://localhost:3000"
    # public, absolute URL so the logo renders inside email clients
    email_logo_url: str = "https://darpanninvestments.com/wp-content/themes/darpan/assets/images/logo.png"
    upload_dir: str = "./uploads"
    max_upload_mb: int = 25
    password_login_enabled: bool = False  # False = sign in only with one-time email codes
    environment: str = "development"  # "production" hides API docs and enforces secure cookies
    cookie_secure: bool = False
    session_idle_minutes: int = 240     # sign out after this much inactivity
    trusted_origins: str = ""           # extra comma-separated origins allowed to call the API with cookies
    reminder_interval_seconds: int = 60
    cron_secret: str = ""  # protects /api/cron/reminders (Vercel Cron sends "Authorization: Bearer <CRON_SECRET>")

    seed_admin_email: str = ""
    seed_admin_password: str = ""

    @property
    def sqlalchemy_url(self) -> tuple[str, dict]:
        """Convert the Prisma-style mysql:// URL into a SQLAlchemy URL + TLS connect args."""
        u = urlparse(self.database_url)
        q = parse_qs(u.query)
        url = (
            f"mysql+pymysql://{u.username}:{unquote(u.password or '')}@{u.hostname}:{u.port or 3306}"
            f"{u.path}?charset=utf8mb4"
        )
        connect_args: dict = {}
        if "tidbcloud.com" in (u.hostname or "") or q.get("sslaccept"):
            import certifi
            connect_args["ssl"] = {"ca": certifi.where(), "check_hostname": True}
            connect_args["ssl_verify_cert"] = True
            connect_args["ssl_verify_identity"] = True
        return url, connect_args

    @property
    def on_vercel(self) -> bool:
        return bool(os.getenv("VERCEL"))

    @property
    def max_upload_bytes(self) -> int:
        # Vercel Functions accept request bodies up to 4.5 MB
        mb = min(self.max_upload_mb, 4) if self.on_vercel else self.max_upload_mb
        return mb * 1024 * 1024

    @property
    def upload_path(self) -> Path:
        p = Path(self.upload_dir)
        if self.on_vercel:  # only /tmp is writable (and ephemeral) on Vercel – real files go to Blob
            p = Path("/tmp/uploads")
        elif not p.is_absolute():
            p = ROOT / "backend" / p
        p.mkdir(parents=True, exist_ok=True)
        return p


    @property
    def is_production(self) -> bool:
        return self.environment.lower() in ("production", "prod")

    @property
    def secure_cookies(self) -> bool:
        return self.cookie_secure or self.is_production or self.app_url.startswith("https://")

    @property
    def allowed_origins(self) -> set[str]:
        out = {self.app_url.rstrip("/")}
        out |= {o.strip().rstrip("/") for o in self.trusted_origins.split(",") if o.strip()}
        if not self.is_production:
            out |= {"http://localhost:3000", "http://127.0.0.1:3000"}
        return out


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if os.getenv("VERCEL") and "localhost" in s.app_url:
        prod = os.getenv("VERCEL_PROJECT_PRODUCTION_URL") or os.getenv("VERCEL_URL")
        if prod:
            s.app_url = f"https://{prod}"
    if len(s.jwt_secret) < 32:
        raise RuntimeError("JWT_SECRET must be at least 32 random characters")
    return s


settings = get_settings()
