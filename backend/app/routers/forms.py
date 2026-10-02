import base64
import json
import re
import secrets
import time
import uuid
from urllib.parse import quote
from collections import defaultdict

import jwt
from fastapi import APIRouter, Body, Depends, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import settings
from ..crud import crud_router, paginate
from ..db import M, get_db, to_dict, utcnow
from ..security import Ctx, ensure_access, get_ctx, require
from ..services.core import activity, audit, get_setting, name_map, notify
from .documents import _safe_name, save_upload
from .leads import create_lead_record

router = APIRouter(tags=["forms"])

LEAD_MAP = {"name", "mobile", "alt_mobile", "email", "city", "state", "country", "preferred_location",
            "property_type", "budget_min", "budget_max", "purpose", "requirement", "notes", "campaign", "sub_source"}
CLIENT_MAP = {"name", "mobile", "alt_mobile", "email", "address", "city"}


def _slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:80] or "form"


def _form_before(db, ctx, obj, payload):
    if obj is None or (payload.get("slug") and payload["slug"] != obj.slug):
        base = _slugify(payload.get("slug") or payload.get("name") or "form")
        slug, n = base, 1
        while db.scalar(select(M.Form.id).where(M.Form.slug == slug)):
            n += 1
            slug = f"{base}-{n}"
        payload["slug"] = slug
    if obj is None:
        payload.setdefault("fields", [])
    elif "fields" in payload and payload["fields"] != obj.fields:
        payload["version"] = (obj.version or 1) + 1  # earlier submissions keep their form_version


def _form_enrich(db, items, ctx):
    ids = [i["id"] for i in items] or [0]
    counts = dict(db.execute(select(M.FormSubmission.form_id, func.count()).where(
        M.FormSubmission.form_id.in_(ids)).group_by(M.FormSubmission.form_id)).all())
    projects = name_map(db, M.Project, [i["project_id"] for i in items])
    for i in items:
        i["submission_count"] = counts.get(i["id"], 0)
        i["project_name"] = projects.get(i["project_id"])
        i["public_url"] = f"{settings.app_url}/f/{i['slug']}"
        i["embed_code"] = (f'<iframe src="{settings.app_url}/f/{i["slug"]}?embed=1" width="100%" height="720" '
                           f'style="border:0" loading="lazy"></iframe>')
        i["conversion_rate"] = round(100 * i["submission_count"] / i["views"], 1) if i.get("views") else None


forms = crud_router(model="Form", module="forms", prefix="/api/forms", search=("name", "slug", "form_type"),
                    before_save=_form_before, enrich=_form_enrich, required=("name",))


@forms.get("/{fid}/submissions")
def submissions(fid: int, request: Request, db: Session = Depends(get_db), ctx: Ctx = Depends(require("forms"))):
    form = ensure_access(db, ctx, db.get(M.Form, fid), "forms")
    p = dict(request.query_params)
    stmt = select(M.FormSubmission).where(M.FormSubmission.form_id == form.id)
    if p.get("status"):
        stmt = stmt.where(M.FormSubmission.status.in_(p["status"].split(",")))
    rows, meta = paginate(db, stmt, M.FormSubmission, p, "-created_at")
    leads = name_map(db, M.Lead, [r.lead_id for r in rows], "code")
    clients = name_map(db, M.Client, [r.client_id for r in rows], "code")
    return {"items": [to_dict(r, {"lead_code": leads.get(r.lead_id), "client_code": clients.get(r.client_id)})
                      for r in rows], **meta, "fields": form.fields}


@forms.patch("/submissions/{sid}")
def review_submission(sid: int, data: dict = Body(...), db: Session = Depends(get_db),
                      ctx: Ctx = Depends(get_ctx)):
    s = db.get(M.FormSubmission, sid)
    if not s:
        raise HTTPException(404, "Submission not found")
    if s.client_id and ctx.can("clients", "edit"):  # RMs review their own clients' onboarding
        ensure_access(db, ctx, db.get(M.Client, s.client_id), "clients", "edit")
    elif ctx.can("forms", "edit"):
        ensure_access(db, ctx, db.get(M.Form, s.form_id), "forms", "edit")
    else:
        raise HTTPException(403, "You do not have permission to review submissions")
    s.status = data.get("status", "Reviewed")  # Reviewed | Correction Requested
    if s.client_id:
        c = db.get(M.Client, s.client_id)
        activity(db, ctx, company_id=s.company_id, client_id=s.client_id, lead_id=c.lead_id if c else None,
                 type="system", title=f"Onboarding submission {s.status.lower()}", description=data.get("note"),
                 is_internal=False)
        if s.status == "Reviewed" and c and c.stage in ("Onboarding Pending", "Onboarding In Progress"):
            c.stage = "Documents Pending"
    db.commit()
    return to_dict(s)


# ── Public (no auth) ───────────────────────────────────────────────────────────
public = APIRouter(prefix="/api/public", tags=["public"])
_hits: dict[str, list[float]] = defaultdict(list)


def _rate_limit(key: str, limit: int = 10, window: int = 600):
    now = time.time()
    _hits[key] = [t for t in _hits[key] if now - t < window]
    if len(_hits[key]) >= limit:
        raise HTTPException(429, "Too many submissions. Please try again later.")
    _hits[key].append(now)


def _client_from_token(token: str | None, form) -> int | None:
    if not token:
        return None
    try:
        data = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(403, "This link has expired. Please ask your relationship manager for a new one.")
    if data.get("fid") != form.id:
        raise HTTPException(403, "Invalid link")
    return int(data["cid"])


@public.get("/forms/{slug}")
def public_form(slug: str, t: str | None = None, db: Session = Depends(get_db)):
    form = db.scalar(select(M.Form).where(M.Form.slug == slug, M.Form.deleted_at.is_(None)))
    if not form or not form.is_active:
        raise HTTPException(404, "This form is not available")
    cid = _client_from_token(t, form)
    prefill = {}
    if cid:
        c = db.get(M.Client, cid)
        prefill = {k: getattr(c, k) for k in CLIENT_MAP if getattr(c, k, None)} | (c.onboarding_data or {})
        if not (c.onboarding_data or {}).get("_opened_at"):
            c.onboarding_data = {**(c.onboarding_data or {}), "_opened_at": utcnow().isoformat()}
            activity(db, None, company_id=c.company_id, client_id=c.id, type="system",
                     title="Client opened onboarding form", is_internal=False)
    form.views = (form.views or 0) + 1
    company = db.get(M.Company, form.company_id)
    db.commit()
    return {"name": form.name, "description": form.description, "fields": form.fields, "version": form.version,
            "success_message": form.success_message, "company": company.name if company else "",
            "logo_url": company.logo_url if company else None, "prefill": prefill}


@public.post("/forms/{slug}")
async def submit_form(slug: str, request: Request, db: Session = Depends(get_db)):
    form = db.scalar(select(M.Form).where(M.Form.slug == slug, M.Form.deleted_at.is_(None)))
    if not form or not form.is_active:
        raise HTTPException(404, "This form is not available")
    ip = request.client.host if request.client else "?"
    _rate_limit(f"{ip}:{slug}")
    files: dict[str, UploadFile] = {}
    if request.headers.get("content-type", "").startswith("multipart/"):
        fd = await request.form()
        data = json.loads(fd.get("data") or "{}")
        files = {k: v for k, v in fd.items() if hasattr(v, "filename") and k != "data"}
    else:
        data = await request.json()
    token = data.pop("_t", None)
    if data.pop("_hp", None):  # honeypot – silently accept bots
        return {"ok": True, "message": form.success_message or "Thank you!"}
    client_id = _client_from_token(token, form)
    fields = form.fields or []
    clean, errors = {}, {}
    for f in fields:
        k, ftype = f.get("key"), f.get("type")
        if not k or ftype == "section":
            continue
        v = data.get(k)
        if ftype == "file":
            v = files.get(k).filename if files.get(k) else None
        if f.get("required") and v in (None, "", [], False):
            errors[k] = f"{f.get('label', k)} is required"
        if v and ftype == "email" and not re.match(r"[^@\s]+@[^@\s]+\.[^@\s]+$", str(v)):
            errors[k] = "Enter a valid email"
        if v and ftype == "tel" and len(re.sub(r"\D", "", str(v))) < 7:
            errors[k] = "Enter a valid phone number"
        if v not in (None, ""):
            clean[k] = v if ftype != "signature" else "[signature]"
    if errors:
        raise HTTPException(422, {"message": "Please fix the highlighted fields", "errors": errors})
    sub = M.FormSubmission(form_id=form.id, form_version=form.version, company_id=form.company_id, data=clean,
                           client_id=client_id, ip=ip, user_agent=(request.headers.get("user-agent") or "")[:500])
    db.add(sub)
    db.flush()

    def mapped(target: set):
        out = {}
        for f in fields:
            dest = f.get("map_to") or f.get("key")
            if dest in target and clean.get(f.get("key")) not in (None, ""):
                out[dest] = clean[f["key"]]
        return out

    # files & signatures become documents
    for f in fields:
        k = f.get("key")
        doc_kw = dict(company_id=form.company_id, client_id=client_id, category=f.get("category") or "Form Upload",
                      title=f.get("label") or k, status="Uploaded", is_sensitive=True)
        if f.get("type") == "file" and files.get(k):
            rel, size, mime = await save_upload(files[k], form.company_id)
            pending = db.scalar(select(M.Document).where(M.Document.client_id == client_id, M.Document.status == "Pending",
                                                         M.Document.title == (f.get("label") or k))) if client_id else None
            if pending:
                pending.file_name, pending.storage_path, pending.size_bytes, pending.mime_type = _safe_name(files[k].filename), rel, size, mime
                pending.status = "Uploaded"
            else:
                db.add(M.Document(**doc_kw, file_name=_safe_name(files[k].filename), storage_path=rel, size_bytes=size,
                                  mime_type=mime))
        if f.get("type") == "signature" and str(data.get(k, "")).startswith("data:image/png;base64,"):
            raw = base64.b64decode(data[k].split(",", 1)[1])[:2_000_000]
            rel = f"{form.company_id}/signatures/{uuid.uuid4().hex}.png"
            (settings.upload_path / rel).parent.mkdir(parents=True, exist_ok=True)
            (settings.upload_path / rel).write_bytes(raw)
            db.add(M.Document(**{**doc_kw, "category": "Signature"}, file_name="signature.png", storage_path=rel,
                              size_bytes=len(raw), mime_type="image/png"))

    notify_ids: set[int] = set()
    if client_id:
        c = db.get(M.Client, client_id)
        for k, v in mapped(CLIENT_MAP).items():
            setattr(c, k, v)
        c.onboarding_data = {**(c.onboarding_data or {}), **{k: v for k, v in clean.items() if k not in CLIENT_MAP},
                             "_submitted_at": utcnow().isoformat()}
        if c.stage in ("Onboarding Pending", "Onboarding In Progress"):
            c.stage = "Onboarding In Progress"
        activity(db, None, company_id=c.company_id, client_id=c.id, lead_id=c.lead_id, type="system",
                 title=f"Client submitted '{form.name}'", meta={"submission_id": sub.id}, is_internal=False)
        notify_ids.add(c.assigned_to_id)
        link = f"/clients/{c.id}"
    elif form.destination == "lead":
        lead_data = mapped(LEAD_MAP)
        if not lead_data.get("name") or not lead_data.get("mobile"):
            raise HTTPException(422, "Name and mobile are required")
        lead_data.update({"source_id": form.source_id, "project_id": form.project_id, "process_id": form.process_id,
                          "assigned_to_id": form.assign_to_id,
                          "custom_fields": {k: v for k, v in clean.items()
                                            if (next((f.get("map_to") for f in fields if f.get("key") == k), None) or k) not in LEAD_MAP},
                          "sub_source": lead_data.get("sub_source") or f"Form: {form.name}"})
        for utm in ("utm_campaign", "utm_source"):
            if data.get(utm):
                lead_data["campaign" if utm == "utm_campaign" else "sub_source"] = str(data[utm])[:191]
        lead = create_lead_record(db, None, lead_data, company_id=form.company_id, source_label=f"form '{form.name}'")
        sub.lead_id = lead.id
        link = f"/leads/{lead.id}"
    else:
        link = f"/forms/{form.id}"
    notify_ids.add(form.created_by)
    for uid in notify_ids:
        notify(db, uid, f"New submission: {form.name}", ", ".join(f"{k}: {v}" for k, v in list(clean.items())[:4]),
               type="form_submission", link=link, company_id=form.company_id)
    db.commit()
    return {"ok": True, "message": form.success_message or "Thank you! We will get in touch shortly."}


@public.get("/doc/{token}")
def public_document(token: str, request: Request, db: Session = Depends(get_db)):
    share = db.scalar(select(M.DocumentShare).where(M.DocumentShare.share_token == token))
    if not share or (share.expires_at and share.expires_at < utcnow()):
        raise HTTPException(404, "This link has expired")
    doc = db.get(M.Document, share.document_id)
    if not doc or doc.deleted_at or not doc.storage_path or (doc.expires_at and doc.expires_at < utcnow()):
        raise HTTPException(404, "Document not available")
    return FileResponse(settings.upload_path / doc.storage_path, media_type=doc.mime_type,
                        headers={"Content-Disposition": f"inline; filename*=UTF-8''{quote(doc.file_name)}",
                                 "X-Content-Type-Options": "nosniff"})


@public.post("/leads")
async def webhook_lead(request: Request, db: Session = Depends(get_db)):
    """Incoming leads from website / Meta / Google / any integration.
    Auth: header `X-API-Key: <key from Settings, Integrations>`.
    Idempotent on `external_id` (e.g. Meta leadgen_id)."""
    key = request.headers.get("x-api-key", "")
    m = re.match(r"dcrm_(\d+)_", key)
    if not m:
        raise HTTPException(401, "Invalid API key")
    cid = int(m.group(1))
    integ = get_setting(db, cid, "integrations", {}) or {}
    if not integ.get("api_key") or not secrets.compare_digest(integ["api_key"], key):
        raise HTTPException(401, "Invalid API key")
    _rate_limit(f"api:{cid}", limit=600, window=60)
    body = await request.json()
    items = body if isinstance(body, list) else [body]
    results = []
    for item in items[:500]:
        ext = str(item.get("external_id") or "")[:191] or None
        if ext:
            existing = db.scalar(select(M.Lead).where(M.Lead.company_id == cid, M.Lead.external_id == ext))
            if existing:
                results.append({"external_id": ext, "lead_id": existing.id, "code": existing.code, "duplicate": True})
                continue
        src = item.pop("source", None)
        if src and not item.get("source_id"):
            s = db.scalar(select(M.LeadSource).where(func.lower(M.LeadSource.name) == str(src).lower()))
            item["source_id"] = s.id if s else None
        proj = item.pop("project", None)
        if proj and not item.get("project_id"):
            p = db.scalar(select(M.Project).where(M.Project.company_id == cid, func.lower(M.Project.name) == str(proj).lower()))
            item["project_id"] = p.id if p else None
        item["external_id"] = ext
        try:
            lead = create_lead_record(db, None, item, company_id=cid, source_label=src or "API")
            db.flush()
            results.append({"external_id": ext, "lead_id": lead.id, "code": lead.code, "duplicate": lead.is_duplicate})
        except HTTPException as e:
            results.append({"external_id": ext, "error": e.detail})
    audit(db, None, "webhook", "leads", None, f"Webhook received {len(items)} lead(s)", company_id=cid, request=request)
    db.commit()
    return {"results": results}


for _r in (forms, public):
    router.include_router(_r)
