"""Site visits, meetings and clients."""
from datetime import timedelta

import jwt
from fastapi import APIRouter, Body, Depends, HTTPException, Request
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..config import settings
from ..crud import crud_router
from ..db import M, get_db, parse_dt, to_dict, utcnow
from ..permissions import SENSITIVE_FIELDS
from ..security import Ctx, ensure_access, require
from ..services.core import activity, audit, name_map, notify
from .leads import create_followup, get_lead

router = APIRouter(tags=["sales"])


def _link_enrich(db, items, owner_key):
    leads = {l.id: l for l in db.scalars(select(M.Lead).where(M.Lead.id.in_({i["lead_id"] for i in items if i.get("lead_id")} or {0})))}
    clients = {c.id: c for c in db.scalars(select(M.Client).where(M.Client.id.in_({i["client_id"] for i in items if i.get("client_id")} or {0})))}
    projects = name_map(db, M.Project, [i.get("project_id") for i in items])
    users = name_map(db, M.User, [i.get(owner_key) for i in items])
    for i in items:
        rec = leads.get(i.get("lead_id")) or clients.get(i.get("client_id"))
        i["contact_name"] = rec.name if rec else None
        i["contact_mobile"] = rec.mobile if rec else None
        i["contact_code"] = rec.code if rec else None
        i["project_name"] = projects.get(i.get("project_id"))
        i[owner_key.replace("_id", "_name")] = users.get(i.get(owner_key))


def _attach(owner_key, kind):
    """before_save: validate linked lead/client, inherit company, default the owner."""
    def before(db, ctx, obj, payload):
        if obj is None:
            rec = None
            if payload.get("lead_id"):
                rec = get_lead(db, ctx, int(payload["lead_id"]))
                payload.setdefault("project_id", rec.project_id)
            elif payload.get("client_id"):
                rec = ensure_access(db, ctx, db.get(M.Client, int(payload["client_id"])), "clients")
                payload.setdefault("project_id", rec.project_id)
            if rec:
                payload["company_id"] = rec.company_id
            payload[owner_key] = payload.get(owner_key) or (rec.assigned_to_id if rec else None) or ctx.id
            if not payload.get("scheduled_at"):
                raise HTTPException(422, "Date and time are required")
            if kind == "visit" and payload.get("project_id") and not payload.get("location"):
                p = db.get(M.Project, int(payload["project_id"]))
                if p:
                    payload["location"] = p.address
                    payload["map_link"] = payload.get("map_link") or p.map_link
        elif payload.get("scheduled_at") and payload["scheduled_at"] != obj.scheduled_at:
            payload["reminder_sent_at"] = None
            if "status" not in payload and obj.status in ("Scheduled", "Confirmed"):
                payload["status"] = "Rescheduled"
    return before


def _after(kind, owner_key):
    label = "Site visit" if kind == "visit" else "Meeting"

    def after(db, ctx, obj, created):
        when = f"{obj.scheduled_at:%d %b %Y %H:%M} UTC"
        if created:
            title = f"{label} scheduled for {when}"
        else:
            title = f"{label} {obj.status.lower()}" + (f" – {obj.outcome}" if obj.outcome else "") + f" ({when})"
        activity(db, ctx, company_id=obj.company_id, lead_id=obj.lead_id, client_id=obj.client_id, type=kind,
                 title=title, description=obj.notes, meta={f"{kind}_id": obj.id, "status": obj.status})
        owner = getattr(obj, owner_key)
        if created and owner and owner != ctx.id:
            notify(db, owner, f"{label} assigned to you", title, type="assignment",
                   link=f"/{kind}s", company_id=obj.company_id)
        if obj.lead_id and obj.status in ("Scheduled", "Completed"):
            _set_sub_status(db, ctx, db.get(M.Lead, obj.lead_id),
                            f"{'Site Visit' if kind == 'visit' else 'Meeting'} {'Scheduled' if obj.status == 'Scheduled' else 'Done'}")
    return after


def _set_sub_status(db, ctx, lead, sub_name):
    """Keep lead pipeline in sync, e.g. visit scheduled → Interested / Site Visit Scheduled."""
    if not lead:
        return
    sub = db.scalar(select(M.LeadSubStatus).where(M.LeadSubStatus.name == sub_name, M.LeadSubStatus.is_active.is_(True)))
    if sub and lead.sub_status_id != sub.id:
        st = db.get(M.LeadStatus, sub.status_id)
        if st and st.category == "open":
            lead.status_id, lead.sub_status_id = st.id, sub.id


visits = crud_router(model="Visit", module="visits", prefix="/api/visits", owner_cols=("agent_id",),
                     search=("location", "notes", "outcome"), default_sort="-scheduled_at",
                     enrich=lambda db, items, ctx: _link_enrich(db, items, "agent_id"),
                     before_save=_attach("agent_id", "visit"), after_save=_after("visit", "agent_id"))
meetings = crud_router(model="Meeting", module="meetings", prefix="/api/meetings", owner_cols=("host_id",),
                       search=("title", "purpose", "notes", "location"), default_sort="-scheduled_at",
                       enrich=lambda db, items, ctx: _link_enrich(db, items, "host_id"),
                       before_save=_attach("host_id", "meeting"), after_save=_after("meeting", "host_id"),
                       required=("title",))


def _outcome_endpoint(r, model_name, module, owner_key, kind):
    @r.post("/{oid}/outcome")
    def record_outcome(oid: int, data: dict = Body(...), db: Session = Depends(get_db),
                       ctx: Ctx = Depends(require(module, "edit"))):
        """Record outcome + optionally schedule the next follow-up in one step."""
        obj = ensure_access(db, ctx, db.get(getattr(M, model_name), oid), module, "edit", (owner_key,))
        obj.status = data.get("status") or "Completed"
        obj.outcome = data.get("outcome")
        if data.get("notes"):
            obj.notes = data["notes"]
        if "next_action" in data and hasattr(obj, "next_action"):
            obj.next_action = data["next_action"]
        _after(kind, owner_key)(db, ctx, obj, False)
        if data.get("next_followup_at"):
            lead = db.get(M.Lead, obj.lead_id) if obj.lead_id else None
            client = db.get(M.Client, obj.client_id) if obj.client_id else None
            if lead or client:
                create_followup(db, ctx, lead=lead, client=client, due_at=parse_dt(data["next_followup_at"]),
                                notes=data.get("next_action") or f"After {kind}: {obj.outcome or obj.status}")
        db.commit()
        return to_dict(obj)


_outcome_endpoint(visits, "Visit", "visits", "agent_id", "visit")
_outcome_endpoint(meetings, "Meeting", "meetings", "host_id", "meeting")


# ── Clients ────────────────────────────────────────────────────────────────────
def _client_enrich(db, items, ctx):
    ids = [i["id"] for i in items] or [0]
    projects = name_map(db, M.Project, [i["project_id"] for i in items])
    props = name_map(db, M.Property, [i["property_id"] for i in items], "code")
    users = name_map(db, M.User, [i["assigned_to_id"] for i in items])
    sources = name_map(db, M.LeadSource, [i["source_id"] for i in items])
    comps = name_map(db, M.Company, [i["company_id"] for i in items])
    docs: dict = {}
    for cid, status, n in db.execute(select(M.Document.client_id, M.Document.status, func.count()).where(
            M.Document.client_id.in_(ids), M.Document.deleted_at.is_(None))
            .group_by(M.Document.client_id, M.Document.status)):
        docs.setdefault(cid, {})[status] = n
    can_see_money = ctx.can("clients", "approve") or ctx.can("settings", "configure")
    for i in items:
        i["project_name"] = projects.get(i["project_id"])
        i["property_code"] = props.get(i["property_id"])
        i["assigned_to_name"] = users.get(i["assigned_to_id"])
        i["source_name"] = sources.get(i["source_id"])
        i["company_name"] = comps.get(i["company_id"])
        d = docs.get(i["id"], {})
        total = sum(d.values())
        done = total - d.get("Pending", 0) - d.get("Rejected", 0)
        i["documents_total"], i["documents_done"] = total, done
        i["document_completion"] = round(100 * done / total) if total else 100
        if not can_see_money:
            for f in SENSITIVE_FIELDS["clients"]:
                i[f] = None
                i[f"{f}_masked"] = True


def _client_after(db, ctx, obj, created):
    if not created:
        return
    from ..services.core import get_setting
    checklist = get_setting(db, obj.company_id, "client_checklist", None) or {"items": [
        {"category": "KYC", "title": "PAN Card"}, {"category": "KYC", "title": "Aadhaar Card"},
        {"category": "Booking", "title": "Booking Form"}, {"category": "Payment", "title": "Booking Payment Receipt"}]}
    for item in checklist.get("items", []):
        db.add(M.Document(company_id=obj.company_id, client_id=obj.id, category=item.get("category", "General"),
                          title=item["title"], file_name="", storage_path="", status="Pending", is_sensitive=True,
                          uploaded_by=ctx.id))
    activity(db, ctx, company_id=obj.company_id, client_id=obj.id, type="system", title="Client created")


clients = crud_router(model="Client", module="clients", prefix="/api/clients", owner_cols=("assigned_to_id",),
                      search=("name", "mobile", "email", "code", "city"), code_prefix="CL", enrich=_client_enrich,
                      after_save=_client_after, required=("name", "mobile"))


@clients.get("/{cid}/detail")
def client_detail(cid: int, db: Session = Depends(get_db), ctx: Ctx = Depends(require("clients"))):
    c = ensure_access(db, ctx, db.get(M.Client, cid), "clients")
    out = [to_dict(c)]
    _client_enrich(db, out, ctx)
    out = out[0]
    from .documents import _enrich as enrich_docs
    superseded = select(M.Document.parent_id).where(M.Document.parent_id.is_not(None), M.Document.deleted_at.is_(None))
    out["documents"] = enrich_docs(db, [to_dict(d) for d in db.scalars(select(M.Document).where(
        M.Document.client_id == cid, M.Document.deleted_at.is_(None), ~M.Document.id.in_(superseded))
        .order_by(M.Document.category, M.Document.id))])
    link = or_(M.Visit.client_id == cid, *( [M.Visit.lead_id == c.lead_id] if c.lead_id else []))
    out["visits"] = [to_dict(v) for v in db.scalars(select(M.Visit).where(link).order_by(M.Visit.scheduled_at.desc()))]
    _link_enrich(db, out["visits"], "agent_id")
    mlink = or_(M.Meeting.client_id == cid, *([M.Meeting.lead_id == c.lead_id] if c.lead_id else []))
    out["meetings"] = [to_dict(v) for v in db.scalars(select(M.Meeting).where(mlink).order_by(M.Meeting.scheduled_at.desc()))]
    _link_enrich(db, out["meetings"], "host_id")
    out["followups"] = [to_dict(f) for f in db.scalars(select(M.FollowUp).where(M.FollowUp.client_id == cid)
                                                      .order_by(M.FollowUp.due_at.desc()))]
    conds = [M.Activity.client_id == cid] + ([M.Activity.lead_id == c.lead_id] if c.lead_id else [])
    acts = list(db.scalars(select(M.Activity).where(or_(*conds))
                           .order_by(M.Activity.is_pinned.desc(), M.Activity.created_at.desc()).limit(300)))
    users = name_map(db, M.User, [a.user_id for a in acts])
    out["timeline"] = [to_dict(a, {"user_name": users.get(a.user_id, "System")}) for a in acts]
    out["lead"] = to_dict(db.get(M.Lead, c.lead_id)) if c.lead_id else None
    out["submissions"] = [to_dict(s) for s in db.scalars(select(M.FormSubmission).where(
        M.FormSubmission.client_id == cid).order_by(M.FormSubmission.id.desc()))]
    return out


@clients.post("/{cid}/stage")
def client_stage(cid: int, request: Request, stage: str = Body(..., embed=True), db: Session = Depends(get_db),
                 ctx: Ctx = Depends(require("clients", "edit"))):
    c = ensure_access(db, ctx, db.get(M.Client, cid), "clients", "edit")
    old, c.stage = c.stage, stage
    activity(db, ctx, company_id=c.company_id, client_id=c.id, lead_id=c.lead_id, type="status",
             title=f"Client stage changed from {old} to {stage}")
    audit(db, ctx, "status_change", "clients", c.id, f"{c.code}: stage {old} to {stage}", company_id=c.company_id,
          request=request)
    db.commit()
    return {"ok": True}


@clients.post("/{cid}/note")
def client_note(cid: int, data: dict = Body(...), db: Session = Depends(get_db),
                ctx: Ctx = Depends(require("clients", "view"))):
    c = ensure_access(db, ctx, db.get(M.Client, cid), "clients")
    t = data.get("type", "note")
    activity(db, ctx, company_id=c.company_id, client_id=c.id, type=t if t in ("note", "call", "whatsapp", "sms", "email") else "note",
             title=data.get("title") or t.capitalize(), description=data.get("description"),
             is_internal=data.get("is_internal", True))
    db.commit()
    return {"ok": True}


@clients.post("/{cid}/onboarding-link")
def onboarding_link(cid: int, request: Request, data: dict = Body(default={}), db: Session = Depends(get_db),
                    ctx: Ctx = Depends(require("clients", "edit"))):
    """Signed link to an onboarding form; submissions are stored against this client."""
    c = ensure_access(db, ctx, db.get(M.Client, cid), "clients", "edit")
    form = db.get(M.Form, int(data["form_id"])) if data.get("form_id") else db.scalar(
        select(M.Form).where(M.Form.company_id == c.company_id, M.Form.form_type == "client_onboarding",
                             M.Form.is_active.is_(True), M.Form.deleted_at.is_(None)).order_by(M.Form.id.desc()))
    if not form:
        raise HTTPException(422, "Create an active 'Client Onboarding' form first (Forms, then New form)")
    days = int(data.get("valid_days") or 14)
    token = jwt.encode({"cid": c.id, "fid": form.id, "exp": utcnow() + timedelta(days=days)},
                       settings.jwt_secret, algorithm="HS256")
    url = f"{settings.app_url}/f/{form.slug}?t={token}"
    if c.stage == "Onboarding Pending":
        c.stage = "Onboarding In Progress"
    activity(db, ctx, company_id=c.company_id, client_id=c.id, type="system", title="Onboarding form link generated",
             meta={"form_id": form.id, "status": "Sent"}, is_internal=False)
    audit(db, ctx, "share", "clients", c.id, f"Onboarding link for {c.code}", company_id=c.company_id, request=request)
    db.commit()
    return {"url": url, "expires_in_days": days}


for _r in (visits, meetings, clients):
    router.include_router(_r)
