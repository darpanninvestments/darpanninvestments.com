import html as html_lib
import mimetypes
import re
import secrets
import uuid
from datetime import timedelta
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..config import settings
from ..crud import paginate
from ..db import M, get_db, parse_dt, to_dict, utcnow
from ..security import Ctx, can_access_row, ensure_access, require, resolve_company_id, scope_filter
from ..services.core import activity, audit, name_map
from ..services.email import send_email_async

router = APIRouter(prefix="/api/documents", tags=["documents"])

ALLOWED_EXT = {".pdf", ".jpg", ".jpeg", ".png", ".webp", ".gif", ".doc", ".docx", ".xls", ".xlsx", ".csv",
               ".ppt", ".pptx", ".txt", ".zip", ".mp4", ".mov", ".dwg", ".heic"}
MAGIC_BLOCK = (b"MZ", b"\x7fELF", b"#!")  # executables / scripts


def _safe_name(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9._ -]", "_", Path(name or "file").name)[:200]


async def save_upload(file: UploadFile, company_id: int) -> tuple[str, int, str]:
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(422, f"File type {ext or '(none)'} is not allowed")
    data = await file.read()
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"File exceeds {settings.max_upload_mb} MB")
    if not data:
        raise HTTPException(422, "File is empty")
    if data[:4].startswith(MAGIC_BLOCK):
        raise HTTPException(422, "Executable files are not allowed")
    rel = Path(str(company_id)) / f"{utcnow():%Y%m}" / f"{uuid.uuid4().hex}{ext}"
    dest = settings.upload_path / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    mime = file.content_type or mimetypes.guess_type(file.filename or "")[0] or "application/octet-stream"
    return str(rel), len(data), mime


def _doc_access(db, ctx, doc, action="view"):
    """A document is visible if its parent record is visible (lead/client) or by documents scope."""
    if doc is None or doc.deleted_at:
        raise HTTPException(404, "Document not found")
    if not ctx.can("documents", action):
        raise HTTPException(403, f"You do not have permission to {action} documents")
    if doc.lead_id and not doc.client_id:
        lead = db.get(M.Lead, doc.lead_id)
        if lead and not can_access_row(db, ctx, lead, "leads"):
            raise HTTPException(403, "No access")
    elif doc.client_id:
        cl = db.get(M.Client, doc.client_id)
        if cl and not can_access_row(db, ctx, cl, "clients"):
            raise HTTPException(403, "No access")
    elif not can_access_row(db, ctx, doc, "documents", action, ("uploaded_by",)):
        raise HTTPException(403, "No access")
    return doc


def read_document_bytes(db, ctx, doc_id: int):
    doc = _doc_access(db, ctx, db.get(M.Document, doc_id), "download")
    if not doc.storage_path:
        raise HTTPException(422, f"'{doc.title}' has no file uploaded yet")
    return doc, (settings.upload_path / doc.storage_path).read_bytes()


def _enrich(db, items):
    users = name_map(db, M.User, [i["uploaded_by"] for i in items])
    projects = name_map(db, M.Project, [i["project_id"] for i in items])
    clients = name_map(db, M.Client, [i["client_id"] for i in items])
    now = utcnow().isoformat()
    for i in items:
        i["uploaded_by_name"] = users.get(i["uploaded_by"])
        i["project_name"] = projects.get(i["project_id"])
        i["client_name"] = clients.get(i["client_id"])
        i["has_file"] = bool(i["storage_path"])
        i["is_expired"] = bool(i["expires_at"] and i["expires_at"] < now)
        i.pop("storage_path", None)
    return items


@router.get("")
def list_documents(request: Request, db: Session = Depends(get_db), ctx: Ctx = Depends(require("documents"))):
    p = dict(request.query_params)
    stmt = scope_filter(select(M.Document), M.Document, db, ctx, "documents", "view", ("uploaded_by",))
    stmt = stmt.where(M.Document.deleted_at.is_(None))
    if p.get("latest_only", "1") == "1":
        # hide superseded versions
        stmt = stmt.where(~M.Document.id.in_(select(M.Document.parent_id).where(M.Document.parent_id.is_not(None),
                                                                              M.Document.deleted_at.is_(None))))
    for k in ("project_id", "property_id", "client_id", "lead_id", "category", "status"):
        if p.get(k):
            stmt = stmt.where(getattr(M.Document, k).in_(p[k].split(",")))
    if p.get("scope") == "project":
        stmt = stmt.where(M.Document.project_id.is_not(None), M.Document.client_id.is_(None))
    elif p.get("scope") == "client":
        stmt = stmt.where(M.Document.client_id.is_not(None))
    if p.get("q"):
        stmt = stmt.where(or_(M.Document.title.like(f"%{p['q']}%"), M.Document.file_name.like(f"%{p['q']}%")))
    rows, meta = paginate(db, stmt, M.Document, p, "-created_at")
    return {"items": _enrich(db, [to_dict(r) for r in rows]), **meta}


@router.get("/for-lead/{lead_id}")
def documents_for_lead(lead_id: int, db: Session = Depends(get_db), ctx: Ctx = Depends(require("documents"))):
    """Documents relevant to a lead: its interested project/property + anything attached to the lead."""
    lead = ensure_access(db, ctx, db.get(M.Lead, lead_id), "leads")
    conds = [M.Document.lead_id == lead_id]
    if lead.project_id:
        conds.append((M.Document.project_id == lead.project_id) & M.Document.client_id.is_(None))
    if lead.property_id:
        conds.append(M.Document.property_id == lead.property_id)
    rows = db.scalars(select(M.Document).where(or_(*conds), M.Document.deleted_at.is_(None),
                                               M.Document.storage_path != "").order_by(M.Document.category))
    return _enrich(db, [to_dict(r) for r in rows])


@router.post("")
async def upload_document(request: Request, file: UploadFile = File(...), title: str = Form(""),
                          category: str = Form("General"), project_id: int | None = Form(None),
                          property_id: int | None = Form(None), client_id: int | None = Form(None),
                          lead_id: int | None = Form(None), company_id: int | None = Form(None),
                          expires_at: str | None = Form(None), is_sensitive: bool = Form(False),
                          replace_id: int | None = Form(None), fill_id: int | None = Form(None),
                          db: Session = Depends(get_db), ctx: Ctx = Depends(require("documents", "add"))):
    """replace_id → upload a new version; fill_id → upload into a pending checklist slot."""
    if replace_id or fill_id:
        cid = _doc_access(db, ctx, db.get(M.Document, replace_id or fill_id), "edit" if replace_id else "add").company_id
    elif client_id:
        cid = ensure_access(db, ctx, db.get(M.Client, client_id), "clients").company_id
    elif lead_id:
        cid = ensure_access(db, ctx, db.get(M.Lead, lead_id), "leads").company_id
    elif project_id:
        proj = db.get(M.Project, project_id)
        if not proj:
            raise HTTPException(422, "Invalid project")
        cid = proj.company_id
        if not ctx.is_global and cid != ctx.company_id:
            raise HTTPException(403, "No access")
    else:
        cid = resolve_company_id(ctx, company_id)
    rel, size, mime = await save_upload(file, cid)
    fname = _safe_name(file.filename)
    if fill_id:
        doc = _doc_access(db, ctx, db.get(M.Document, fill_id), "add")
        doc.file_name, doc.storage_path, doc.size_bytes, doc.mime_type = fname, rel, size, mime
        doc.status, doc.uploaded_by = "Uploaded", ctx.id
        if expires_at:
            doc.expires_at = parse_dt(expires_at)
    else:
        parent = None
        if replace_id:
            parent = _doc_access(db, ctx, db.get(M.Document, replace_id), "edit")
        doc = M.Document(
            company_id=cid, project_id=parent.project_id if parent else project_id,
            property_id=parent.property_id if parent else property_id,
            client_id=parent.client_id if parent else client_id, lead_id=parent.lead_id if parent else lead_id,
            category=parent.category if parent else (category or "General"),
            title=(title or (parent.title if parent else Path(fname).stem))[:255], file_name=fname, mime_type=mime,
            size_bytes=size, storage_path=rel, version=(parent.version + 1) if parent else 1,
            parent_id=parent.id if parent else None, is_sensitive=is_sensitive or (parent.is_sensitive if parent else False),
            expires_at=parse_dt(expires_at), uploaded_by=ctx.id, status="Uploaded")
        db.add(doc)
    db.flush()
    if doc.client_id or doc.lead_id:
        activity(db, ctx, company_id=cid, client_id=doc.client_id, lead_id=doc.lead_id, type="document",
                 title=f"Document uploaded: {doc.title}" + (f" (v{doc.version})" if doc.version > 1 else ""),
                 meta={"document_id": doc.id})
    audit(db, ctx, "upload", "documents", doc.id, f"{doc.title} ({fname})", company_id=cid, request=request)
    db.commit()
    return _enrich(db, [to_dict(doc)])[0]


@router.post("/checklist")
def add_checklist_item(data: dict = Body(...), db: Session = Depends(get_db),
                       ctx: Ctx = Depends(require("documents", "add"))):
    c = ensure_access(db, ctx, db.get(M.Client, int(data["client_id"])), "clients")
    doc = M.Document(company_id=c.company_id, client_id=c.id, category=data.get("category", "General"),
                     title=data["title"], file_name="", storage_path="", status="Pending", is_sensitive=True,
                     uploaded_by=ctx.id, expires_at=parse_dt(data.get("expires_at")))
    db.add(doc)
    db.commit()
    return _enrich(db, [to_dict(doc)])[0]


@router.get("/{doc_id}/versions")
def versions(doc_id: int, db: Session = Depends(get_db), ctx: Ctx = Depends(require("documents"))):
    doc = _doc_access(db, ctx, db.get(M.Document, doc_id))
    chain, cur = [], doc
    while cur:
        chain.append(cur)
        cur = db.get(M.Document, cur.parent_id) if cur.parent_id else None
    return _enrich(db, [to_dict(d) for d in chain])


@router.get("/{doc_id}/file")
def download(doc_id: int, request: Request, inline: bool = False, db: Session = Depends(get_db),
             ctx: Ctx = Depends(require("documents"))):
    doc = _doc_access(db, ctx, db.get(M.Document, doc_id), "view" if inline else "download")
    if not doc.storage_path:
        raise HTTPException(404, "No file uploaded yet")
    if not inline:
        audit(db, ctx, "download", "documents", doc.id, doc.title, company_id=doc.company_id, request=request)
        db.commit()
    path = settings.upload_path / doc.storage_path
    disp = "inline" if inline else "attachment"
    return FileResponse(path, media_type=doc.mime_type or "application/octet-stream",
                        headers={"Content-Disposition": f"{disp}; filename*=UTF-8''{quote(doc.file_name)}",
                                 "X-Content-Type-Options": "nosniff"})


@router.patch("/{doc_id}")
def update_document(doc_id: int, request: Request, data: dict = Body(...), db: Session = Depends(get_db),
                    ctx: Ctx = Depends(require("documents", "edit"))):
    doc = _doc_access(db, ctx, db.get(M.Document, doc_id), "edit")
    for k in ("title", "category", "status", "is_sensitive"):
        if k in data:
            setattr(doc, k, data[k])
    if "expires_at" in data:
        doc.expires_at = parse_dt(data["expires_at"])
    if "status" in data and (doc.client_id or doc.lead_id):
        activity(db, ctx, company_id=doc.company_id, client_id=doc.client_id, lead_id=doc.lead_id, type="document",
                 title=f"Document {doc.title}: {data['status']}")
    audit(db, ctx, "update", "documents", doc.id, doc.title, data, company_id=doc.company_id, request=request)
    db.commit()
    return _enrich(db, [to_dict(doc)])[0]


@router.delete("/{doc_id}")
def delete_document(doc_id: int, request: Request, db: Session = Depends(get_db),
                    ctx: Ctx = Depends(require("documents", "delete"))):
    doc = _doc_access(db, ctx, db.get(M.Document, doc_id), "delete")
    doc.deleted_at = utcnow()
    audit(db, ctx, "delete", "documents", doc.id, doc.title, company_id=doc.company_id, request=request)
    db.commit()
    return {"ok": True}


@router.post("/share")
def share_documents(request: Request, data: dict = Body(...), db: Session = Depends(get_db),
                    ctx: Ctx = Depends(require("documents", "share"))):
    """One-click share from a lead/client. channel: whatsapp|email|link.
    Returns tokenised public links (+ a wa.me deep link for WhatsApp)."""
    channel = data.get("channel", "link")
    lead = ensure_access(db, ctx, db.get(M.Lead, int(data["lead_id"])), "leads") if data.get("lead_id") else None
    client = ensure_access(db, ctx, db.get(M.Client, int(data["client_id"])), "clients") if data.get("client_id") else None
    rec = lead or client
    days = int(data.get("valid_days") or 7)
    links = []
    for did in data.get("document_ids") or []:
        doc = _doc_access(db, ctx, db.get(M.Document, int(did)), "share")
        if not doc.storage_path:
            continue
        token = secrets.token_urlsafe(24)
        db.add(M.DocumentShare(document_id=doc.id, lead_id=lead.id if lead else None,
                               client_id=client.id if client else None, channel=channel,
                               recipient=data.get("recipient") or (rec.mobile if channel == "whatsapp" and rec else
                                                                   rec.email if rec else None),
                               share_token=token, expires_at=utcnow() + timedelta(days=days), shared_by=ctx.id))
        links.append({"id": doc.id, "title": doc.title, "url": f"{settings.app_url}/api/public/doc/{token}"})
    if not links:
        raise HTTPException(422, "Select at least one uploaded document")
    text = (data.get("message") or f"Hello{(' ' + rec.name) if rec else ''}, please find the documents from "
            f"Darpann Investments:") + "\n\n" + "\n".join(f"• {l['title']}: {l['url']}" for l in links)
    out = {"links": links, "message": text}
    if channel == "whatsapp" and rec:
        phone = re.sub(r"\D", "", rec.mobile or "")
        if len(phone) == 10:
            phone = "91" + phone
        out["whatsapp_url"] = f"https://wa.me/{phone}?text={quote(text)}"
    if channel == "email":
        to = data.get("recipient") or (rec.email if rec else None)
        if not to:
            raise HTTPException(422, "No email address on record")
        html = "<div style='font-family:Arial,sans-serif'>" + html_lib.escape(text).replace("\n", "<br>") + "</div>"
        send_email_async(to, data.get("subject") or "Documents from Darpann Investments", html)
        out["emailed_to"] = to
    if rec:
        activity(db, ctx, company_id=rec.company_id, lead_id=lead.id if lead else (client.lead_id if client else None),
                 client_id=client.id if client else None, type="document",
                 title=f"Shared {len(links)} document(s) via {channel}",
                 description=", ".join(l["title"] for l in links), meta={"document_ids": [l["id"] for l in links]},
                 is_internal=False)
    audit(db, ctx, "share", "documents", None, f"Shared {len(links)} docs via {channel}",
          {"document_ids": [l["id"] for l in links]}, request=request)
    db.commit()
    return out


@router.get("/{doc_id}/shares")
def share_history(doc_id: int, db: Session = Depends(get_db), ctx: Ctx = Depends(require("documents"))):
    _doc_access(db, ctx, db.get(M.Document, doc_id))
    rows = list(db.scalars(select(M.DocumentShare).where(M.DocumentShare.document_id == doc_id)
                           .order_by(M.DocumentShare.id.desc())))
    users = name_map(db, M.User, [r.shared_by for r in rows])
    return [to_dict(r, {"shared_by_name": users.get(r.shared_by), "share_token": None}) for r in rows]
