"""Import Master & Export Management."""
import csv
import io
import re
import uuid
from datetime import datetime
from urllib.parse import urlencode

from fastapi import APIRouter, BackgroundTasks, Body, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from openpyxl import Workbook, load_workbook
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from ..config import settings
from ..crud import LIST_HANDLERS, build_list_query, paginate
from ..db import M, SessionLocal, get_db, to_dict, utcnow
from ..security import Ctx, require, resolve_company_id
from ..services import storage
from ..services.core import audit, find_duplicates, get_setting, name_map, notify, set_setting
from .leads import create_lead_record, enrich_leads, enrich_followups, fu_query, lead_query

router = APIRouter(tags=["data"])

LEAD_FIELDS = {
    "name": "Name", "mobile": "Mobile", "alt_mobile": "Alternate Mobile", "email": "Email", "city": "City",
    "state": "State", "country": "Country", "preferred_location": "Preferred Location", "property_type": "Property Type",
    "budget_min": "Budget Min", "budget_max": "Budget Max", "purpose": "Purpose", "requirement": "Requirement",
    "priority": "Priority", "source": "Source (name)", "project": "Project (name)", "status": "Status (name)",
    "sub_status": "Sub-status (name)", "assigned_to": "Assigned To (email or name)", "sub_source": "Sub-source",
    "campaign": "Campaign", "ad_set": "Ad Set", "ad_name": "Ad", "notes": "Notes", "external_id": "External ID",
    "created_at": "Lead Date",
}
PROPERTY_FIELDS = {
    "project": "Project (name)", "code": "Property ID", "unit_no": "Unit No", "property_type": "Type", "size": "Size",
    "size_unit": "Size Unit", "facing": "Facing", "floor": "Floor", "bedrooms": "Bedrooms", "bathrooms": "Bathrooms",
    "base_price": "Base Price", "offer_price": "Offer Price", "availability": "Availability",
    "description": "Description",
}
MODULE_FIELDS = {"leads": LEAD_FIELDS, "properties": PROPERTY_FIELDS}
IMPORT_PREFIX = "_imports/"


def _read_table(raw: bytes, name: str) -> tuple[list[str], list[list]]:
    if name.lower().endswith((".xlsx", ".xlsm")):
        wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
        rows = [list(r) for r in wb.active.iter_rows(values_only=True)]
    else:
        text = raw.decode("utf-8-sig", errors="replace")
        rows = list(csv.reader(io.StringIO(text)))
    rows = [r for r in rows if any(c not in (None, "") for c in r)]
    if not rows:
        raise HTTPException(422, "The file is empty")
    headers = [str(h or f"Column {i + 1}").strip() for i, h in enumerate(rows[0])]
    return headers, [[("" if c is None else c) for c in r] + [""] * (len(headers) - len(r)) for r in rows[1:]]


def _guess(header: str, fields: dict) -> str | None:
    h = re.sub(r"[^a-z]", "", header.lower())
    aliases = {"phone": "mobile", "phonenumber": "mobile", "mobileno": "mobile", "contact": "mobile",
               "fullname": "name", "customername": "name", "leadname": "name", "emailid": "email",
               "budget": "budget_max", "location": "preferred_location", "leadsource": "source",
               "assignedto": "assigned_to", "owner": "assigned_to", "agent": "assigned_to", "remarks": "notes",
               "adset": "ad_set", "adname": "ad_name", "leadid": "external_id", "date": "created_at",
               "createdtime": "created_at", "propertyid": "code", "unit": "unit_no"}
    if h in aliases:
        return aliases[h]
    for k, label in fields.items():
        if h in (re.sub(r"[^a-z]", "", k), re.sub(r"[^a-z]", "", label.lower())):
            return k
    return None


@router.get("/api/imports/fields")
def import_fields(module: str = "leads", db: Session = Depends(get_db), ctx: Ctx = Depends(require("imports"))):
    templates = get_setting(db, ctx.company_id, "import_templates", []) or []
    return {"fields": MODULE_FIELDS.get(module, LEAD_FIELDS), "templates": [t for t in templates if t.get("module", "leads") == module]}


@router.post("/api/imports/preview")
async def preview(file: UploadFile = File(...), module: str = "leads", ctx: Ctx = Depends(require("imports", "import"))):
    ext = (file.filename or "").lower().rsplit(".", 1)[-1]
    if ext not in ("csv", "xlsx", "xlsm"):
        raise HTTPException(422, "Upload a .csv or .xlsx file")
    data = await file.read()
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(413, f"File exceeds {settings.max_upload_bytes // (1024 * 1024)} MB")
    headers, rows = _read_table(data, file.filename or f"file.{ext}")
    # kept in storage between the preview and run steps (may be different serverless instances)
    token = storage.save_bytes(f"{IMPORT_PREFIX}{uuid.uuid4().hex}.{ext}", data)
    fields = MODULE_FIELDS.get(module, LEAD_FIELDS)
    return {"token": token, "file_name": file.filename, "headers": headers, "total_rows": len(rows),
            "sample": [[str(c) for c in r] for r in rows[:10]],
            "suggested_mapping": {h: _guess(h, fields) for h in headers}}


@router.post("/api/imports/templates")
def save_template(data: dict = Body(...), db: Session = Depends(get_db), ctx: Ctx = Depends(require("imports", "import"))):
    templates = get_setting(db, ctx.company_id, "import_templates", []) or []
    templates = [t for t in templates if t.get("name") != data["name"]]
    templates.append({"name": data["name"], "module": data.get("module", "leads"), "mapping": data["mapping"]})
    set_setting(db, ctx.company_id, "import_templates", templates)
    db.commit()
    return {"ok": True}


def _num(v):
    if v in (None, ""):
        return None
    s = str(v).lower().replace(",", "").replace("₹", "").strip()
    mult = 1
    for suf, m in (("cr", 1e7), ("crore", 1e7), ("lac", 1e5), ("lakh", 1e5), ("l", 1e5), ("k", 1e3)):
        if s.endswith(suf):
            s, mult = s[: -len(suf)].strip(), m
            break
    try:
        return float(s) * mult
    except ValueError:
        return None


def _date(v):
    if isinstance(v, datetime):
        return v
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d/%m/%Y %H:%M", "%m/%d/%Y"):
        try:
            return datetime.strptime(str(v).strip()[:19], fmt)
        except ValueError:
            continue
    return None


def _run_import(job_id: int, stored: str, ctx_user_id: int):
    """Runs in the background with its own DB session."""
    db = SessionLocal()
    try:
        job = db.get(M.ImportJob, job_id)
        headers, rows = _read_table(storage.read_bytes(stored), stored)
        mapping, defaults = job.mapping or {}, job.defaults or {}
        cid = job.company_id
        lookup = lambda model, extra=None: {str(n).strip().lower(): i for i, n in db.execute(  # noqa: E731
            select(model.id, model.name).where(*(extra or [])))}
        sources = lookup(M.LeadSource)
        projects = lookup(M.Project, [M.Project.company_id == cid])
        statuses = lookup(M.LeadStatus)
        subs = {(s.status_id, s.name.lower()): s.id for s in db.scalars(select(M.LeadSubStatus))}
        users_by = {}
        for u in db.scalars(select(M.User).where(M.User.company_id == cid)):
            users_by[u.email.lower()] = u.id
            users_by[u.name.lower()] = u.id

        class _Ctx:  # minimal actor for timeline/audit
            id = ctx_user_id
            company_id = cid

        actor = _Ctx()
        errors, ok, failed, dups = [], 0, 0, 0
        for idx, row in enumerate(rows, start=2):
            rec = {}
            for h, val in zip(headers, row):
                f = mapping.get(h)
                if f and val not in (None, ""):
                    rec[f] = val
            try:
                with db.begin_nested():
                    if job.module == "properties":
                        proj = projects.get(str(rec.pop("project", "") or defaults.get("project", "")).lower()) \
                            or defaults.get("project_id")
                        if not proj:
                            raise ValueError("Project not found")
                        for k in ("size", "base_price", "offer_price"):
                            if k in rec:
                                rec[k] = _num(rec[k])
                        for k in ("bedrooms", "bathrooms"):
                            if k in rec:
                                rec[k] = int(_num(rec[k]) or 0)
                        rec = {k: (str(v) if isinstance(v, (int, float)) and k in ("code", "unit_no", "floor") else v)
                               for k, v in rec.items()}
                        existing = db.scalar(select(M.Property).where(M.Property.project_id == proj,
                                                                      M.Property.code == str(rec.get("code")))) if rec.get("code") else None
                        if existing:
                            for k, v in rec.items():
                                setattr(existing, k, v)
                        else:
                            n = db.scalar(select(func.count()).select_from(M.Property).where(M.Property.project_id == proj)) or 0
                            rec.setdefault("code", f"P{proj}-{n + 1:03d}")
                            db.add(M.Property(company_id=cid, project_id=proj, created_by=ctx_user_id, **rec))
                        db.flush()
                        ok += 1
                        continue
                    # leads
                    rec["mobile"] = re.sub(r"[^\d+]", "", str(rec.get("mobile", "")).split(".")[0])
                    if not rec.get("name") or not rec.get("mobile"):
                        raise ValueError("Name and mobile are required")
                    if "source" in rec:
                        rec["source_id"] = sources.get(str(rec.pop("source")).strip().lower())
                    if "project" in rec:
                        rec["project_id"] = projects.get(str(rec.pop("project")).strip().lower())
                    if "status" in rec:
                        rec["status_id"] = statuses.get(str(rec.pop("status")).strip().lower())
                    if "sub_status" in rec:
                        rec["sub_status_id"] = subs.get((rec.get("status_id"), str(rec.pop("sub_status")).strip().lower()))
                    if "assigned_to" in rec:
                        rec["assigned_to_id"] = users_by.get(str(rec.pop("assigned_to")).strip().lower())
                    for k in ("budget_min", "budget_max"):
                        if k in rec:
                            rec[k] = _num(rec[k])
                    if "created_at" in rec:
                        rec["created_at"] = _date(rec["created_at"])
                    for k, v in defaults.items():
                        if not k.startswith("_") and k != "skip_duplicates" and v not in (None, "") and not rec.get(k):
                            rec[k] = v
                    rec = {k: (str(v) if isinstance(v, float) and k not in ("budget_min", "budget_max") else v)
                           for k, v in rec.items()}
                    rec["import_job_id"] = job.id
                    if job.mode == "update" and job.match_key in ("mobile", "email", "external_id"):
                        key_val = rec.get(job.match_key)
                        existing = None
                        if job.match_key == "mobile":
                            found = find_duplicates(db, cid, key_val, None, limit=1)
                            existing = found[0] if found else None
                        elif key_val:
                            existing = db.scalar(select(M.Lead).where(M.Lead.company_id == cid, M.Lead.deleted_at.is_(None),
                                                                      getattr(M.Lead, job.match_key) == key_val))
                        if existing:
                            for k, v in rec.items():
                                if k not in ("import_job_id", "created_at") and v not in (None, "") and hasattr(existing, k):
                                    setattr(existing, k, v)
                            existing.updated_by = ctx_user_id
                            db.flush()
                            ok += 1
                            continue
                    if job.mode != "update" and defaults.get("skip_duplicates") and find_duplicates(
                            db, cid, rec.get("mobile"), rec.get("email"), limit=1):
                        dups += 1
                        errors.append({"row": idx, "error": "Duplicate – skipped", "data": [str(c) for c in row]})
                        continue
                    created_at = rec.pop("created_at", None)
                    lead = create_lead_record(db, actor, rec, company_id=cid, source_label=f"import #{job.id}")
                    if created_at:
                        lead.created_at = created_at
                    if lead.is_duplicate:
                        dups += 1
                    db.flush()
                    ok += 1
            except Exception as e:  # noqa: BLE001 – record the failure, continue with the next row
                failed += 1
                msg = getattr(e, "detail", None) or str(e)
                errors.append({"row": idx, "error": str(msg)[:300], "data": [str(c) for c in row]})
            if idx % 200 == 0:
                job.success_count, job.failed_count, job.duplicate_count = ok, failed, dups
                db.commit()
        job.success_count, job.failed_count, job.duplicate_count = ok, failed, dups
        job.errors, job.status = errors[:5000], "Completed" if ok or not failed else "Failed"
        replace_id = defaults.get("_replace_job_id")
        if replace_id and job.status == "Completed":
            db.execute(update(M.Lead).where(M.Lead.import_job_id == replace_id, M.Lead.deleted_at.is_(None))
                       .values(deleted_at=utcnow()))
            prev = db.get(M.ImportJob, replace_id)
            if prev:
                prev.status = "Replaced"
        notify(db, ctx_user_id, f"Import #{job.id} {job.status.lower()}",
               f"{job.file_name}: {ok} imported, {failed} failed, {dups} duplicates", type="import",
               link="/imports", company_id=cid)
        db.commit()
    except Exception as e:  # noqa: BLE001
        db.rollback()
        job = db.get(M.ImportJob, job_id)
        job.status, job.errors = "Failed", [{"row": 0, "error": str(e)[:500]}]
        db.commit()
    finally:
        db.close()
        storage.delete(stored)


@router.post("/api/imports/run")
def run_import(request: Request, background: BackgroundTasks, data: dict = Body(...), db: Session = Depends(get_db),
               ctx: Ctx = Depends(require("imports", "import"))):
    module = data.get("module", "leads")
    if module == "leads" and not ctx.can("leads", "import") and not ctx.can("imports", "import"):
        raise HTTPException(403, "No permission to import leads")
    stored = str(data.get("token") or "")
    name_part = stored.removeprefix(storage.BLOB_PREFIX)
    if not re.fullmatch(r"_imports/[a-f0-9]{32}\.(csv|xlsx|xlsm)", name_part):
        raise HTTPException(422, "Upload expired – please upload the file again")
    mapping = {h: f for h, f in (data.get("mapping") or {}).items() if f}
    targets = set(mapping.values())
    if module == "leads" and not {"name", "mobile"} <= targets:
        raise HTTPException(422, "Map at least the Name and Mobile columns")
    cid = resolve_company_id(ctx, data.get("company_id"))
    mode = data.get("mode", "append")
    defaults = dict(data.get("defaults") or {})
    if mode == "replace":  # old records are removed only after the new import succeeds (see _run_import)
        prev = db.get(M.ImportJob, int(data.get("replace_job_id") or 0))
        if not prev or prev.company_id != cid:
            raise HTTPException(422, "Choose the previous import to replace")
        defaults["_replace_job_id"] = prev.id
    job = M.ImportJob(company_id=cid, module=module, file_name=data.get("file_name") or name_part.rsplit("/", 1)[-1], mode=mode,
                      match_key=data.get("match_key"), mapping=mapping, defaults=defaults,
                      total_rows=int(data.get("total_rows") or 0), status="Processing", uploaded_by=ctx.id)
    db.add(job)
    db.flush()
    audit(db, ctx, "import", module, job.id, f"Import #{job.id}: {job.file_name}", {"mode": mode}, company_id=cid,
          request=request)
    db.commit()
    background.add_task(_run_import, job.id, stored, ctx.id)
    return to_dict(job)


@router.get("/api/imports")
def list_imports(request: Request, db: Session = Depends(get_db), ctx: Ctx = Depends(require("imports"))):
    p = dict(request.query_params)
    stmt = build_list_query(db, ctx, M.ImportJob, "imports", p, search=("file_name",), owner_cols=("uploaded_by",))
    rows, meta = paginate(db, stmt, M.ImportJob, p, "-id")
    users = name_map(db, M.User, [r.uploaded_by for r in rows])
    comps = name_map(db, M.Company, [r.company_id for r in rows])
    live = dict(db.execute(select(M.Lead.import_job_id, func.count()).where(
        M.Lead.import_job_id.in_([r.id for r in rows] or [0]), M.Lead.deleted_at.is_(None))
        .group_by(M.Lead.import_job_id)).all())
    return {"items": [to_dict(r, {"errors": None, "error_count": len(r.errors or []),
                                  "uploaded_by_name": users.get(r.uploaded_by), "company_name": comps.get(r.company_id),
                                  "live_records": live.get(r.id, 0)}) for r in rows], **meta}


def _job(db, ctx, jid):
    job = db.get(M.ImportJob, jid)
    if not job or (not ctx.is_global and job.company_id != ctx.company_id):
        raise HTTPException(404, "Import not found")
    return job


@router.get("/api/imports/{jid}")
def import_detail(jid: int, db: Session = Depends(get_db), ctx: Ctx = Depends(require("imports"))):
    return to_dict(_job(db, ctx, jid))


@router.get("/api/imports/{jid}/errors.csv")
def import_errors(jid: int, db: Session = Depends(get_db), ctx: Ctx = Depends(require("imports"))):
    job = _job(db, ctx, jid)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Row", "Error", *(list((job.mapping or {}).keys()))])
    for e in job.errors or []:
        w.writerow([e.get("row"), e.get("error"), *(e.get("data") or [])])
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="import-{jid}-errors.csv"'})


@router.post("/api/imports/{jid}/rollback")
def rollback_import(jid: int, request: Request, db: Session = Depends(get_db),
                    ctx: Ctx = Depends(require("imports", "delete"))):
    """Soft-deletes every record created by this import (restorable from the DB)."""
    job = _job(db, ctx, jid)
    n = db.execute(update(M.Lead).where(M.Lead.import_job_id == jid, M.Lead.deleted_at.is_(None))
                   .values(deleted_at=utcnow())).rowcount
    job.status = "Rolled Back"
    audit(db, ctx, "rollback", "imports", jid, f"Rolled back import #{jid} ({n} records)", company_id=job.company_id,
          request=request)
    db.commit()
    return {"deleted": n}


# ── Exports ────────────────────────────────────────────────────────────────────
EXPORTABLE = {"leads": "leads", "clients": "clients", "projects": "projects", "properties": "properties",
              "visits": "visits", "meetings": "meetings", "followups": "followups", "documents": "documents",
              "users": "users"}


@router.get("/api/exports/{module}/columns")
def export_columns(module: str, ctx: Ctx = Depends(require("dashboard"))):
    if module not in EXPORTABLE:
        raise HTTPException(404, "Unknown module")
    model = {"leads": M.Lead, "clients": M.Client, "projects": M.Project, "properties": M.Property,
             "visits": M.Visit, "meetings": M.Meeting, "followups": M.FollowUp, "documents": M.Document,
             "users": M.User}[module]
    cols = [c for c in model.__table__.columns.keys() if c not in ("password_hash", "storage_path", "deleted_at",
                                                                     "custom_fields", "preferences", "onboarding_data")]
    extra = {"leads": ["status_name", "sub_status_name", "source_name", "project_name", "assigned_to_name",
                       "company_name", "visit_count", "meeting_count"],
             "clients": ["project_name", "assigned_to_name", "document_completion"],
             "followups": ["name", "mobile", "assigned_to_name", "status_name"],
             "visits": ["contact_name", "contact_mobile", "project_name", "agent_name"],
             "meetings": ["contact_name", "contact_mobile", "project_name", "host_name"],
             "projects": ["process_name", "city_name", "property_count", "lead_count"],
             "properties": ["project_name"]}.get(module, [])
    return {"columns": extra + cols}


@router.post("/api/exports/{module}")
def export(module: str, request: Request, data: dict = Body(default={}), db: Session = Depends(get_db),
           ctx: Ctx = Depends(require("dashboard"))):
    if module not in EXPORTABLE:
        raise HTTPException(404, "Unknown module")
    if not ctx.can(module, "export") and not (module == "followups" and ctx.can("leads", "export")):
        raise HTTPException(403, f"You do not have permission to export {module}")
    filters = {k: str(v) for k, v in (data.get("filters") or {}).items() if v not in (None, "")}
    filters["page_size"] = "0"
    if module == "leads":
        rows, _ = paginate(db, lead_query(db, ctx, filters), M.Lead, {**filters, "page_size": 50000}, "-created_at")
        items = enrich_leads(db, [to_dict(r) for r in rows])
    elif module == "followups":
        rows, _ = paginate(db, fu_query(db, ctx, filters), M.FollowUp, {**filters, "page_size": 50000}, "due_at")
        items = enrich_followups(db, rows)
    else:
        # reuse each module's list endpoint (same scoping + enrichment as the screen)
        from .admin import list_users
        from .documents import list_documents
        handler = {"/api/users": list_users, "/api/documents": list_documents}.get(f"/api/{module}") \
            or LIST_HANDLERS[f"/api/{module}"]
        req = Request({"type": "http", "query_string": urlencode(filters).encode(), "headers": [], "method": "GET",
                       "path": f"/api/{module}"})
        res = handler(request=req, db=db, ctx=ctx)
        items = res["items"]
    cols = data.get("columns") or (list(items[0].keys()) if items else [])
    cols = [c for c in cols if c not in ("password_hash", "storage_path")]
    fmt = data.get("format", "xlsx")
    db.add(M.ExportLog(company_id=ctx.company_id, user_id=ctx.id, module=module, filters=filters, columns=cols,
                       record_count=len(items), format=fmt))
    audit(db, ctx, "export", module, None, f"Exported {len(items)} {module}", {"filters": filters}, request=request)
    db.commit()
    stamp = f"{utcnow():%Y%m%d-%H%M}"

    def cell(v):
        v = ", ".join(map(str, v)) if isinstance(v, list) else (str(v) if isinstance(v, dict) else v)
        # neutralise spreadsheet formulas (CSV/Excel injection) in user-entered text
        if isinstance(v, str) and v[:1] in ("=", "+", "-", "@", "\t", "\r"):
            return "'" + v
        return v

    if fmt == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(cols)
        for it in items:
            w.writerow([cell(it.get(c)) for c in cols])
        return StreamingResponse(iter(["﻿" + buf.getvalue()]), media_type="text/csv",
                                 headers={"Content-Disposition": f'attachment; filename="{module}-{stamp}.csv"'})
    wb = Workbook()
    ws = wb.active
    ws.title = module.capitalize()
    ws.append([c.replace("_", " ").title() for c in cols])
    for it in items:
        ws.append([cell(it.get(c)) for c in cols])
    ws.freeze_panes = "A2"
    out = io.BytesIO()
    wb.save(out)
    out.seek(0)
    return StreamingResponse(out, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f'attachment; filename="{module}-{stamp}.xlsx"'})


@router.get("/api/exports")
def export_history(request: Request, db: Session = Depends(get_db), ctx: Ctx = Depends(require("exports"))):
    p = dict(request.query_params)
    stmt = build_list_query(db, ctx, M.ExportLog, "exports", p, search=("module",), owner_cols=("user_id",))
    rows, meta = paginate(db, stmt, M.ExportLog, p, "-id")
    users = name_map(db, M.User, [r.user_id for r in rows])
    return {"items": [to_dict(r, {"user_name": users.get(r.user_id)}) for r in rows], **meta}
