"""SMTP email (Gmail app password). Sending runs on a worker thread so requests never block."""
import logging
import smtplib
import ssl
from concurrent.futures import ThreadPoolExecutor
from email.message import EmailMessage
from email.utils import formataddr

from ..config import settings

log = logging.getLogger("crm.email")
_pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix="smtp")


def brand_header() -> str:
    return (f'<div style="background:#0f1b3d;padding:16px 20px;border-radius:8px 8px 0 0">'
            f'<img src="{settings.email_logo_url}" alt="Darpann Investments" width="200" style="display:block;height:auto"></div>')


def send_email(to: str, subject: str, html: str, text: str | None = None,
               attachments: list[tuple[str, bytes, str]] | None = None) -> bool:
    if not settings.smtp_user or not settings.smtp_password:
        log.warning("SMTP not configured; skipping email to %s", to)
        return False
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = formataddr((settings.smtp_from_name, settings.smtp_user))
    msg["To"] = to
    msg.set_content(text or "Please view this email in an HTML-capable client.")
    html = f'<div style="max-width:600px;margin:auto">{brand_header()}<div style="padding:4px 20px 20px">{html}</div></div>'
    msg.add_alternative(html, subtype="html")
    for name, data, mime in attachments or []:
        maintype, _, subtype = (mime or "application/octet-stream").partition("/")
        msg.add_attachment(data, maintype=maintype, subtype=subtype or "octet-stream", filename=name)
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as s:
            s.starttls(context=ssl.create_default_context())
            s.login(settings.smtp_user, settings.smtp_password.replace(" ", ""))
            s.send_message(msg)
        return True
    except Exception as e:  # noqa: BLE001 – never break a request because email failed
        log.error("Email to %s failed: %s", to, e)
        return False


def send_email_async(to: str, subject: str, html: str, **kw):
    if settings.on_vercel:  # serverless: finish sending before the function returns
        send_email(to, subject, html, **kw)
    else:
        _pool.submit(send_email, to, subject, html, **kw)
