import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .config import settings
from .db import init_models
from .security import COOKIE_NAME

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
init_models()  # reflect Prisma-managed tables before routers import models

from .routers import admin, auth, data_io, documents, forms, insights, leads, masters, sales, system  # noqa: E402
from .services import scheduler  # noqa: E402


@asynccontextmanager
async def lifespan(_app: FastAPI):
    task = asyncio.create_task(scheduler.loop())
    yield
    task.cancel()


app = FastAPI(title="Darpann Investments – Real Estate CRM API", version="1.0.0", lifespan=lifespan,
              docs_url=None if settings.is_production else "/api/docs",
              redoc_url=None, openapi_url=None if settings.is_production else "/api/openapi.json")

UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}
MAX_BODY = (settings.max_upload_mb + 5) * 1024 * 1024


@app.exception_handler(RequestValidationError)
async def validation_handler(_req: Request, exc: RequestValidationError):
    errs = exc.errors()
    first = errs[0] if errs else {}
    field = ".".join(str(x) for x in first.get("loc", [])[1:]) or "request"
    return JSONResponse(status_code=422, content={"detail": f"{field}: {first.get('msg', 'invalid')}", "errors": errs})


@app.middleware("http")
async def security(request: Request, call_next):
    path = request.url.path
    # Request size cap (uploads are additionally checked per file)
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > MAX_BODY:
        return JSONResponse(status_code=413, content={"detail": "Request is too large"})
    # CSRF: cookie-authenticated state changes must come from our own origin.
    # Public endpoints (forms, webhook with API key) are designed to be called cross-site.
    if request.method in UNSAFE and not path.startswith("/api/public/") and COOKIE_NAME in request.cookies:
        origin = request.headers.get("origin") or ""
        if not origin:
            ref = request.headers.get("referer") or ""
            origin = "/".join(ref.split("/")[:3]) if ref.startswith("http") else ""
        if origin and origin.rstrip("/") not in settings.allowed_origins:
            return JSONResponse(status_code=403, content={"detail": "Cross-site request blocked"})
    resp = await call_next(request)
    h = resp.headers
    h.setdefault("X-Content-Type-Options", "nosniff")
    h.setdefault("X-Frame-Options", "DENY")
    h.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    h.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    if settings.secure_cookies:
        h.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    ctype = h.get("content-type", "")
    if (path.endswith("/file") or path.startswith("/api/public/doc/")) and not ctype.startswith(("application/pdf", "image/", "video/")):
        # user-uploaded files can never run scripts in our origin
        h["Content-Security-Policy"] = "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'"
    if path.startswith("/api/") and "cache-control" not in h:
        h["Cache-Control"] = "no-store"
    return resp


@app.get("/api/health")
def health():
    return {"ok": True}


app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(masters.router)
app.include_router(leads.router)
app.include_router(leads.fu_router)
app.include_router(leads.act_router)
app.include_router(sales.router)
app.include_router(documents.router)
app.include_router(forms.router)
app.include_router(insights.router)
app.include_router(data_io.router)
app.include_router(system.router)
