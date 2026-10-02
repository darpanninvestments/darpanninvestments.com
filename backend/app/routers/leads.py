import html as html_lib
from datetime import timedelta

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..crud import paginate
from ..db import M, clean_payload, get_db, parse_dt, to_dict, utcnow
from ..security import Ctx, can_access_row, ensure_access, get_ctx, require, resolve_company_id, scope_filter
from ..services.core import (activity, assign_code, audit, auto_assign, default_status, diff, find_duplicates,
                             get_setting, name_map, notify)
from ..services.email import send_email_async

router = APIRouter(prefix="/api/leads", tags=["leads"])
fu_router = APIRouter(prefix="/api/followups", tags=["followups"])
act_router = APIRouter(prefix="/api/activities", tags=["activities"])

LEAD_SEARCH = ("name", "mobile", "alt_mobile", "email", "code", "campaign", "preferred_location", "city")


# ── helpers ────────────────────────────────────────────────────────────────────
def enrich_leads(db: Session, items: list[dict]):
    if not items:
        return items
    ids = [i["id"] for i in items]
    statuses = {s.id: s for s in db.scalars(select(M.LeadStatus).where(
        M.LeadStatus.id.in_({i["status_id"] for i in items if i["status_id"]} or {0})))}
    subs = name_map(db, M.LeadSubStatus, [i["sub_status_id"] for i in items])
    sources = name_map(db, M.LeadSource, [i["source_id"] for i in items])
    projects = name_map(db, M.Project, [i["project_id"] for i in items])
    users = name_map(db, M.User, [i["assigned_to_id"] for i in items] + [i["created_by"] for i in items])
    comps = name_map(db, M.Company, [i["company_id"] for i in items])
    procs = name_map(db, M.Process, [i["process_id"] for i in items])
    visits = dict(db.execute(select(M.Visit.lead_id, func.count()).where(M.Visit.lead_id.in_(ids))
                             .group_by(M.Visit.lead_id)).all())
    meetings = dict(db.execute(select(M.Meeting.lead_id, func.count()).where(M.Meeting.lead_id.in_(ids))
                               .group_by(M.Meeting.lead_id)).all())
    for i in items:
        st = statuses.get(i["status_id"])
        i["status_name"] = st.name if st else None
        i["status_color"] = st.color if st else "#94a3b8"
        i["status_category"] = st.category if st else "open"
        i["sub_status_name"] = subs.get(i["sub_status_id"])
        i["source_name"] = sources.get(i["source_id"])
        i["project_name"] = projects.get(i["project_id"])
        i["process_name"] = procs.get(i["process_id"])
        i["assigned_to_name"] = users.get(i["assigned_to_id"])
        i["created_by_name"] = users.get(i["created_by"])
        i["company_name"] = comps.get(i["company_id"])
        i["visit_count"] = visits.get(i["id"], 0)
        i["meeting_count"] = meetings.get(i["id"], 0)
    return items


def get_lead(db: Session, ctx: Ctx, lead_id: int, action: str = "view"):
    return ensure_access(db, ctx, db.get(M.Lead, lead_id), "leads", action)


def sync_next_followup(db: Session, lead_id: int | None):
    if not lead_id:
        return
    lead = db.get(M.Lead, lead_id)
    if not lead:
        return
    db.flush()
    lead.next_followup_at = db.scalar(select(func.min(M.FollowUp.due_at)).where(
        M.FollowUp.lead_id == lead_id, M.FollowUp.status == "pending"))


def create_followup(db: Session, ctx, *, lead=None, client=None, due_at, assigned_to_id=None, notes=None,
                    type="call", reminder_minutes=None, priority=None):
    owner = assigned_to_id or (lead.assigned_to_id if lead else None) or (client.assigned_to_id if client else None) \
        or (ctx.id if ctx else None)
    company_id = (lead or client).company_id
    if reminder_minutes is None:
        reminder_minutes = (get_setting(db, company_id, "followup", {}) or {}).get("default_reminder_minutes", 15)
    fu = M.FollowUp(company_id=company_id, lead_id=lead.id if lead else None, client_id=client.id if client else None,
                    assigned_to_id=owner, due_at=due_at, reminder_minutes=reminder_minutes, notes=notes, type=type,
                    priority=priority or (lead.priority if lead else "Warm"), created_by=ctx.id if ctx else None)
    db.add(fu)
    db.flush()
    activity(db, ctx, company_id=company_id, lead_id=fu.lead_id, client_id=fu.client_id, type="followup",
             title=f"Follow-up scheduled for {due_at:%d %b %Y %H:%M} UTC", description=notes,
             meta={"followup_id": fu.id, "due_at": to_dict(fu)["due_at"]})
    if owner and ctx and owner != ctx.id:
        notify(db, owner, "New follow-up assigned", f"{(lead or client).name} – {notes or ''}", type="assignment",
               link=f"/leads/{lead.id}" if lead else f"/clients/{client.id}", company_id=company_id)
    sync_next_followup(db, fu.lead_id)
    return fu


def apply_status(db: Session, ctx: Ctx, lead, status_id: int | None, sub_status_id: int | None = None,
                 loss_reason: str | None = None, note: str | None = None, followup_at=None, request=None):
    """Workflow engine for a status change: validation, auto follow-up, timeline, audit, notifications."""
    st = db.get(M.LeadStatus, int(status_id)) if status_id else None
    if status_id and not st:
        raise HTTPException(422, "Invalid status")
    old_status = db.get(M.LeadStatus, lead.status_id) if lead.status_id else None
    if st and old_status and st.id != old_status.id and old_status.allowed_next_ids:
        if st.id not in [int(x) for x in old_status.allowed_next_ids]:
            raise HTTPException(422, f"'{old_status.name}' cannot move to '{st.name}'")
    if st and st.requires_reason and not (loss_reason or sub_status_id):
        raise HTTPException(422, f"A reason is required for '{st.name}'")
    if sub_status_id:
        sub = db.get(M.LeadSubStatus, int(sub_status_id))
        if not sub or (st and sub.status_id != st.id):
            raise HTTPException(422, "Sub-status does not belong to the selected status")
    old_sub = db.get(M.LeadSubStatus, lead.sub_status_id) if lead.sub_status_id else None
    new_sub = db.get(M.LeadSubStatus, int(sub_status_id)) if sub_status_id else None
    lead.status_id = st.id if st else lead.status_id
    lead.sub_status_id = int(sub_status_id) if sub_status_id else None
    if loss_reason is not None:
        lead.loss_reason = loss_reason or None
    lead.updated_by = ctx.id
    frm = f"{old_status.name if old_status else '—'}{' / ' + old_sub.name if old_sub else ''}"
    to = f"{st.name if st else '—'}{' / ' + new_sub.name if new_sub else ''}"
    activity(db, ctx, company_id=lead.company_id, lead_id=lead.id, type="status", title=f"Status changed from {frm} to {to}",
             description=note or loss_reason, meta={"from": frm, "to": to, "status_id": lead.status_id})
    audit(db, ctx, "status_change", "leads", lead.id, f"{lead.code}: status {frm} to {to}",
          {"status": {"from": frm, "to": to}}, company_id=lead.company_id, request=request)
    # close pending follow-ups when the lead reaches a terminal state
    if st and st.category in ("won", "lost", "invalid"):
        for fu in db.scalars(select(M.FollowUp).where(M.FollowUp.lead_id == lead.id, M.FollowUp.status == "pending")):
            fu.status, fu.outcome, fu.completed_at = "cancelled", f"Lead marked {st.name}", utcnow()
        lead.next_followup_at = None
    if followup_at:
        create_followup(db, ctx, lead=lead, due_at=parse_dt(followup_at), notes=note)
    elif st and st.auto_followup_hours and st.category == "open":
        create_followup(db, ctx, lead=lead, due_at=utcnow() + timedelta(hours=st.auto_followup_hours),
                        notes=f"Auto follow-up after status '{st.name}'")
    if lead.assigned_to_id and lead.assigned_to_id != ctx.id:
        notify(db, lead.assigned_to_id, f"Lead {lead.code} status changed", f"{lead.name}: {to}", type="status",
               link=f"/leads/{lead.id}", company_id=lead.company_id)
    sync_next_followup(db, lead.id)
    return st


def do_assign(db: Session, ctx, lead, user_id: int | None, request=None, notify_user=True):
    if user_id:
        u = db.get(M.User, int(user_id))
        if not u or not u.is_active or u.company_id != lead.company_id:
            raise HTTPException(422, "Assignee must be an active user of the lead's company")
    old = lead.assigned_to_id
    if old == (int(user_id) if user_id else None):
        return
    lead.assigned_to_id = int(user_id) if user_id else None
    if user_id:
        lead.team_id = db.get(M.User, int(user_id)).team_id
    names = name_map(db, M.User, [old, lead.assigned_to_id])
    activity(db, ctx, company_id=lead.company_id, lead_id=lead.id, type="assignment",
             title=f"Reassigned from {names.get(old, 'Unassigned')} to {names.get(lead.assigned_to_id, 'Unassigned')}")
    audit(db, ctx, "assign", "leads", lead.id, f"{lead.code} assigned to {names.get(lead.assigned_to_id)}",
          {"assigned_to_id": {"from": old, "to": lead.assigned_to_id}}, company_id=lead.company_id, request=request)
    for fu in db.scalars(select(M.FollowUp).where(M.FollowUp.lead_id == lead.id, M.FollowUp.status == "pending")):
        fu.assigned_to_id = lead.assigned_to_id or fu.assigned_to_id
    if notify_user and lead.assigned_to_id and (not ctx or lead.assigned_to_id != ctx.id):
        notify(db, lead.assigned_to_id, "New lead assigned to you",
               f"{lead.name} ({lead.mobile})\nCode: {lead.code}", type="assignment", link=f"/leads/{lead.id}",
               company_id=lead.company_id)


def create_lead_record(db: Session, ctx, data: dict, *, company_id: int, source_label: str = "manual",
                       allow_duplicate: bool = True, request=None):
    """Shared by manual entry, forms, webhooks and imports."""
    payload = clean_payload(M.Lead, data, exclude={"code", "client_id", "converted_at", "is_duplicate",
                                                   "duplicate_of_id", "created_by", "updated_by"})
    if not payload.get("name") or not payload.get("mobile"):
        raise HTTPException(422, "Name and mobile are required")
    payload["company_id"] = company_id
    dups = find_duplicates(db, company_id, payload.get("mobile"), payload.get("email"))
    if dups and not allow_duplicate:
        raise HTTPException(409, {"message": "Possible duplicate lead",
                                  "duplicates": enrich_leads(db, [to_dict(d) for d in dups])})
    if dups:
        payload["is_duplicate"], payload["duplicate_of_id"] = True, dups[0].id
    if not payload.get("status_id"):
        st = default_status(db, company_id)
        payload["status_id"] = st.id if st else None
    assignee = payload.pop("assigned_to_id", None)
    lead = M.Lead(**payload, code=f"TMP-{utcnow().timestamp()}", created_by=ctx.id if ctx else None)
    db.add(lead)
    db.flush()
    assign_code(lead, "LD")
    if not assignee:
        assignee = auto_assign(db, company_id, lead)
    activity(db, ctx, company_id=company_id, lead_id=lead.id, type="system",
             title=f"Lead created ({source_label})" + (" – possible duplicate" if dups else ""),
             meta={"duplicate_of": dups[0].code if dups else None})
    if assignee:
        do_assign(db, ctx, lead, assignee, request)
    if payload.get("next_followup_at"):
        create_followup(db, ctx, lead=lead, due_at=payload["next_followup_at"], notes=payload.get("next_action"))
    audit(db, ctx, "create", "leads", lead.id, f"{lead.code} {lead.name}", company_id=company_id, request=request)
    if not lead.assigned_to_id:  # tell company admins there is an unassigned lead
        admins = db.scalars(select(M.User.id).join(M.Role, M.Role.id == M.User.role_id).where(
            M.User.company_id == company_id, M.Role.key.in_(["company_admin", "manager"]), M.User.is_active.is_(True)))
        for uid in admins:
            notify(db, uid, "New unassigned lead", f"{lead.name} ({lead.mobile}) via {source_label}",
                   type="new_lead", link=f"/leads/{lead.id}", company_id=company_id)
    return lead


# ── Lead list / board ──────────────────────────────────────────────────────────
def lead_query(db: Session, ctx: Ctx, p: dict, action="view"):
    stmt = scope_filter(select(M.Lead), M.Lead, db, ctx, "leads", action)
    stmt = stmt.where(M.Lead.deleted_at.is_(None))
    if p.get("q"):
        like = f"%{p['q'].strip()}%"
        stmt = stmt.where(or_(*[getattr(M.Lead, c).like(like) for c in LEAD_SEARCH]))
    for k in ("status_id", "sub_status_id", "source_id", "project_id", "process_id", "company_id", "priority",
              "assigned_to_id", "team_id", "property_type", "purpose", "city", "import_job_id"):
        v = p.get(k)
        if v in (None, ""):
            continue
        if v == "none":
            stmt = stmt.where(getattr(M.Lead, k).is_(None))
        else:
            stmt = stmt.where(getattr(M.Lead, k).in_(str(v).split(",")))
    if p.get("status_category"):
        stmt = stmt.where(M.Lead.status_id.in_(select(M.LeadStatus.id).where(
            M.LeadStatus.category.in_(p["status_category"].split(",")))))
    if p.get("created_from"):
        stmt = stmt.where(M.Lead.created_at >= parse_dt(p["created_from"]))
    if p.get("created_to"):
        stmt = stmt.where(M.Lead.created_at <= parse_dt(p["created_to"]))
    if p.get("is_duplicate") in ("1", "true"):
        stmt = stmt.where(M.Lead.is_duplicate.is_(True))
    if p.get("converted") in ("1", "true"):
        stmt = stmt.where(M.Lead.converted_at.is_not(None))
    elif p.get("converted") in ("0", "false"):
        stmt = stmt.where(M.Lead.converted_at.is_(None))
    fu = p.get("followup")
    now = utcnow()
    day_start = parse_dt(p["day_start"]) if p.get("day_start") else now.replace(hour=0, minute=0, second=0)
    day_end = day_start + timedelta(days=1)
    if fu == "overdue":
        stmt = stmt.where(M.Lead.next_followup_at < now)
    elif fu == "today":
        stmt = stmt.where(M.Lead.next_followup_at >= day_start, M.Lead.next_followup_at < day_end)
    elif fu == "upcoming":
        stmt = stmt.where(M.Lead.next_followup_at >= now)
    elif fu == "none":
        stmt = stmt.where(M.Lead.next_followup_at.is_(None))
    return stmt


@router.get("")
def list_leads(request: Request, db: Session = Depends(get_db), ctx: Ctx = Depends(require("leads"))):
    p = dict(request.query_params)
    rows, meta = paginate(db, lead_query(db, ctx, p), M.Lead, p, "-created_at")
    return {"items": enrich_leads(db, [to_dict(r) for r in rows]), **meta}


@router.get("/stats")
def lead_stats(request: Request, db: Session = Depends(get_db), ctx: Ctx = Depends(require("leads"))):
    """Counts per status for the board's status tabs (respects the other filters)."""
    p = {k: v for k, v in request.query_params.items() if k not in ("status_id", "sub_status_id", "status_category")}
    sub = lead_query(db, ctx, p).subquery()
    rows = db.execute(select(sub.c.status_id, func.count()).group_by(sub.c.status_id)).all()
    return {"by_status": {str(k or "none"): v for k, v in rows}, "total": sum(v for _, v in rows)}


@router.get("/check-duplicate")
def check_duplicate(mobile: str | None = None, email: str | None = None, company_id: int | None = None,
                    exclude_id: int | None = None, db: Session = Depends(get_db), ctx: Ctx = Depends(require("leads"))):
    cid = resolve_company_id(ctx, company_id) if (company_id or not ctx.is_global) else ctx.company_id
    if not cid:
        return {"duplicates": []}
    dups = find_duplicates(db, cid, mobile, email, exclude_id)
    out = []
    for d in dups:
        visible = can_access_row(db, ctx, d, "leads")
        out.append({"id": d.id, "code": d.code, "name": d.name if visible else "Restricted",
                    "mobile": d.mobile if visible else None, "visible": visible,
                    "assigned_to_name": name_map(db, M.User, [d.assigned_to_id]).get(d.assigned_to_id)})
    return {"duplicates": out}


@router.post("")
def create_lead(request: Request, data: dict = Body(...), db: Session = Depends(get_db),
                ctx: Ctx = Depends(require("leads", "add"))):
    cid = resolve_company_id(ctx, data.get("company_id"))
    if data.get("assigned_to_id") and not ctx.can("leads", "assign"):
        data["assigned_to_id"] = ctx.id
    if not data.get("assigned_to_id") and ctx.scope("leads", "view") == "own":
        data["assigned_to_id"] = ctx.id  # agents own what they create
    lead = create_lead_record(db, ctx, data, company_id=cid, source_label="manual entry",
                              allow_duplicate=bool(data.get("force")), request=request)
    db.commit()
    return enrich_leads(db, [to_dict(lead)])[0]


@router.get("/{lead_id}")
def lead_detail(lead_id: int, db: Session = Depends(get_db), ctx: Ctx = Depends(require("leads"))):
    lead = get_lead(db, ctx, lead_id)
    out = enrich_leads(db, [to_dict(lead)])[0]
    out["followups"] = [to_dict(f) for f in db.scalars(select(M.FollowUp).where(M.FollowUp.lead_id == lead_id)
                                                      .order_by(M.FollowUp.due_at.desc()).limit(50))]
    out["visits"] = [to_dict(v) for v in db.scalars(select(M.Visit).where(M.Visit.lead_id == lead_id)
                                                   .order_by(M.Visit.scheduled_at.desc()))]
    out["meetings"] = [to_dict(v) for v in db.scalars(select(M.Meeting).where(M.Meeting.lead_id == lead_id)
                                                     .order_by(M.Meeting.scheduled_at.desc()))]
    out["duplicates"] = [{"id": d.id, "code": d.code, "name": d.name} for d in
                         find_duplicates(db, lead.company_id, lead.mobile, lead.email, exclude_id=lead.id)]
    out["property"] = to_dict(db.get(M.Property, lead.property_id)) if lead.property_id else None
    out["client"] = to_dict(db.get(M.Client, lead.client_id)) if lead.client_id else None
    return out


@router.get("/{lead_id}/timeline")
def lead_timeline(lead_id: int, type: str | None = None, db: Session = Depends(get_db),
                  ctx: Ctx = Depends(require("leads"))):
    lead = get_lead(db, ctx, lead_id)
    conds = [M.Activity.lead_id == lead_id]
    if lead.client_id:
        conds.append(M.Activity.client_id == lead.client_id)
    stmt = select(M.Activity).where(or_(*conds))
    if type:
        stmt = stmt.where(M.Activity.type.in_(type.split(",")))
    rows = list(db.scalars(stmt.order_by(M.Activity.is_pinned.desc(), M.Activity.created_at.desc()).limit(300)))
    users = name_map(db, M.User, [r.user_id for r in rows])
    return [to_dict(r, {"user_name": users.get(r.user_id, "System")}) for r in rows]


@router.patch("/{lead_id}")
def update_lead(lead_id: int, request: Request, data: dict = Body(...), db: Session = Depends(get_db),
                ctx: Ctx = Depends(require("leads", "edit"))):
    lead = get_lead(db, ctx, lead_id, "edit")
    status_keys = {"status_id", "sub_status_id", "loss_reason"}
    if status_keys & data.keys() and (data.get("status_id", lead.status_id) != lead.status_id
                                      or data.get("sub_status_id", lead.sub_status_id) != lead.sub_status_id):
        apply_status(db, ctx, lead, data.get("status_id", lead.status_id), data.get("sub_status_id"),
                     data.get("loss_reason"), data.get("status_note"), request=request)
    if "assigned_to_id" in data and data["assigned_to_id"] != lead.assigned_to_id:
        if not ctx.can("leads", "assign"):
            raise HTTPException(403, "You do not have permission to reassign leads")
        do_assign(db, ctx, lead, data["assigned_to_id"], request)
    payload = clean_payload(M.Lead, data, exclude={"code", "company_id", "client_id", "converted_at", "created_by",
                                                   "assigned_to_id", "next_followup_at", *status_keys})
    if "mobile" in payload and not payload["mobile"]:
        raise HTTPException(422, "Mobile is required")
    ch = diff(lead, payload)
    for k, v in payload.items():
        setattr(lead, k, v)
    lead.updated_by = ctx.id
    if ch:
        audit(db, ctx, "update", "leads", lead.id, f"{lead.code}: updated {', '.join(ch)}"[:500], ch,
              company_id=lead.company_id, request=request)
        if {"budget_min", "budget_max", "project_id", "property_type", "priority"} & ch.keys():
            activity(db, ctx, company_id=lead.company_id, lead_id=lead.id, type="system",
                     title=f"Updated {', '.join(ch)}"[:255])
    db.commit()
    return enrich_leads(db, [to_dict(lead)])[0]


@router.post("/{lead_id}/status")
def change_status(lead_id: int, request: Request, data: dict = Body(...), db: Session = Depends(get_db),
                  ctx: Ctx = Depends(require("leads", "edit"))):
    lead = get_lead(db, ctx, lead_id, "edit")
    apply_status(db, ctx, lead, data.get("status_id"), data.get("sub_status_id"), data.get("loss_reason"),
                 data.get("note"), data.get("followup_at"), request=request)
    db.commit()
    return enrich_leads(db, [to_dict(lead)])[0]


@router.post("/{lead_id}/assign")
def assign(lead_id: int, request: Request, user_id: int | None = Body(None, embed=True),
           db: Session = Depends(get_db), ctx: Ctx = Depends(require("leads", "assign"))):
    lead = get_lead(db, ctx, lead_id, "assign")
    do_assign(db, ctx, lead, user_id, request)
    db.commit()
    return enrich_leads(db, [to_dict(lead)])[0]


@router.post("/{lead_id}/activity")
def log_activity(lead_id: int, data: dict = Body(...), db: Session = Depends(get_db),
                 ctx: Ctx = Depends(require("leads", "view"))):
    """One-click actions (call / whatsapp / sms / email / note) are recorded here."""
    lead = get_lead(db, ctx, lead_id)
    t = data.get("type", "note")
    if t not in ("call", "whatsapp", "sms", "email", "note"):
        raise HTTPException(422, "Invalid activity type")
    titles = {"call": "Call", "whatsapp": "WhatsApp message", "sms": "SMS", "email": "Email", "note": "Note"}
    title = data.get("title") or titles[t] + (f" – {data['outcome']}" if data.get("outcome") else "")
    activity(db, ctx, company_id=lead.company_id, lead_id=lead.id, type=t, title=title,
             description=data.get("description"), meta={k: data[k] for k in ("outcome", "duration", "template_id")
                                                        if k in data},
             is_internal=data.get("is_internal", True))
    if data.get("followup_at"):
        create_followup(db, ctx, lead=lead, due_at=parse_dt(data["followup_at"]), notes=data.get("description"))
    db.commit()
    return {"ok": True}


@router.post("/{lead_id}/email")
def email_lead(lead_id: int, data: dict = Body(...), db: Session = Depends(get_db),
               ctx: Ctx = Depends(require("leads", "view"))):
    from .documents import read_document_bytes
    lead = get_lead(db, ctx, lead_id)
    to = data.get("to") or lead.email
    if not to:
        raise HTTPException(422, "This lead has no email address")
    subject, body = data.get("subject") or "Darpann Investments", data.get("body") or ""
    attachments = []
    for did in data.get("document_ids") or []:
        if not ctx.can("documents", "share"):
            raise HTTPException(403, "You do not have permission to share documents")
        doc, content = read_document_bytes(db, ctx, int(did))
        attachments.append((doc.file_name, content, doc.mime_type or "application/octet-stream"))
        db.add(M.DocumentShare(document_id=doc.id, lead_id=lead.id, channel="email", recipient=to, shared_by=ctx.id))
    esc = html_lib.escape
    html = f"""<div style="font-family:Arial,sans-serif;max-width:600px;color:#111;white-space:pre-line">{esc(body)}</div>
<p style="color:#666;font-size:13px">— {esc(ctx.user.name)}<br>Darpann Investments{('<br>' + esc(ctx.user.mobile)) if ctx.user.mobile else ''}</p>"""
    send_email_async(to, subject, html, attachments=attachments)
    activity(db, ctx, company_id=lead.company_id, lead_id=lead.id, type="email", title=f"Email sent: {subject}",
             description=body, meta={"to": to, "attachments": [a[0] for a in attachments]}, is_internal=False)
    db.commit()
    return {"ok": True}


@router.post("/{lead_id}/convert")
def convert_lead(lead_id: int, request: Request, data: dict = Body(default={}), db: Session = Depends(get_db),
                 ctx: Ctx = Depends(require("leads", "convert"))):
    lead = get_lead(db, ctx, lead_id, "convert")
    if lead.client_id:
        raise HTTPException(409, "Lead is already converted")
    client = M.Client(
        code=f"TMP-{utcnow().timestamp()}", company_id=lead.company_id, lead_id=lead.id,
        project_id=data.get("project_id") or lead.project_id, property_id=data.get("property_id") or lead.property_id,
        assigned_to_id=lead.assigned_to_id or ctx.id, name=lead.name, mobile=lead.mobile, alt_mobile=lead.alt_mobile,
        email=lead.email, city=lead.city, source_id=lead.source_id, stage="Onboarding Pending",
        booking_date=parse_dt(data.get("booking_date")) or utcnow(), booking_amount=data.get("booking_amount") or None,
        deal_value=data.get("deal_value") or None, payment_plan=data.get("payment_plan"), notes=data.get("notes"),
        custom_fields=lead.custom_fields, created_by=ctx.id)
    db.add(client)
    db.flush()
    assign_code(client, "CL")
    lead.client_id, lead.converted_at = client.id, utcnow()
    won = db.scalar(select(M.LeadStatus).where(M.LeadStatus.category == "won", M.LeadStatus.is_active.is_(True),
                                               or_(M.LeadStatus.company_id.is_(None),
                                                   M.LeadStatus.company_id == lead.company_id))
                    .order_by(M.LeadStatus.sort_order))
    if won and lead.status_id != won.id:
        sub = db.scalar(select(M.LeadSubStatus).where(M.LeadSubStatus.status_id == won.id)
                        .order_by(M.LeadSubStatus.sort_order))
        apply_status(db, ctx, lead, won.id, sub.id if sub else None, note="Converted to client", request=request)
    if client.property_id:
        prop = db.get(M.Property, client.property_id)
        if prop and prop.availability in ("Available", "Hold", "Reserved"):
            prop.availability = "Booked"
    activity(db, ctx, company_id=lead.company_id, lead_id=lead.id, client_id=client.id, type="conversion",
             title=f"Converted to client {client.code}")
    audit(db, ctx, "convert", "leads", lead.id, f"{lead.code} converted to {client.code}", company_id=lead.company_id,
          request=request)
    # auto document checklist after conversion (Settings → client_checklist)
    checklist = get_setting(db, lead.company_id, "client_checklist", None) or {"items": [
        {"category": "KYC", "title": "PAN Card", "required": True},
        {"category": "KYC", "title": "Aadhaar Card", "required": True},
        {"category": "Booking", "title": "Booking Form", "required": True},
        {"category": "Payment", "title": "Booking Payment Receipt", "required": True},
        {"category": "Address Proof", "title": "Address Proof", "required": False}]}
    for item in checklist.get("items", []):
        db.add(M.Document(company_id=lead.company_id, client_id=client.id, category=item.get("category", "General"),
                          title=item["title"], file_name="", storage_path="", status="Pending",
                          is_sensitive=True, uploaded_by=ctx.id))
    for uid in {lead.assigned_to_id, *db.scalars(select(M.User.id).join(M.Role, M.Role.id == M.User.role_id).where(
            M.User.company_id == lead.company_id, M.Role.key == "company_admin"))}:
        if uid and uid != ctx.id:
            notify(db, uid, "Lead converted", f"{lead.name} converted to client {client.code}", type="conversion",
                   link=f"/clients/{client.id}", company_id=lead.company_id)
    db.commit()
    return {"client_id": client.id, "client_code": client.code}


@router.delete("/{lead_id}")
def delete_lead(lead_id: int, request: Request, db: Session = Depends(get_db),
                ctx: Ctx = Depends(require("leads", "delete"))):
    lead = get_lead(db, ctx, lead_id, "delete")
    lead.deleted_at = utcnow()
    audit(db, ctx, "delete", "leads", lead.id, f"{lead.code} {lead.name}", company_id=lead.company_id, request=request)
    db.commit()
    return {"ok": True}


@router.post("/{lead_id}/restore")
def restore_lead(lead_id: int, request: Request, db: Session = Depends(get_db),
                 ctx: Ctx = Depends(require("leads", "delete"))):
    lead = db.get(M.Lead, lead_id)
    if not lead or not lead.deleted_at or not can_access_row(db, ctx, lead, "leads", "delete"):
        raise HTTPException(404, "Deleted lead not found")
    lead.deleted_at = None
    audit(db, ctx, "restore", "leads", lead.id, lead.code, company_id=lead.company_id, request=request)
    db.commit()
    return {"ok": True}


@router.post("/bulk")
def bulk_action(request: Request, data: dict = Body(...), db: Session = Depends(get_db),
                ctx: Ctx = Depends(require("leads", "edit"))):
    ids, action = data.get("ids") or [], data.get("action")
    perm = {"assign": "assign", "delete": "delete"}.get(action, "edit")
    if not ctx.can("leads", perm):
        raise HTTPException(403, f"You do not have permission to {perm} leads")
    leads = [l for l in db.scalars(select(M.Lead).where(M.Lead.id.in_(ids or [0]), M.Lead.deleted_at.is_(None)))
             if can_access_row(db, ctx, l, "leads", perm)]
    for lead in leads:
        if action == "assign":
            do_assign(db, ctx, lead, data.get("user_id"), request, notify_user=False)
        elif action == "status":
            apply_status(db, ctx, lead, data.get("status_id"), data.get("sub_status_id"), data.get("loss_reason"),
                         data.get("note"), request=request)
        elif action == "followup":
            create_followup(db, ctx, lead=lead, due_at=parse_dt(data["due_at"]), notes=data.get("notes"))
        elif action == "priority":
            lead.priority = data.get("priority", lead.priority)
        elif action == "project":
            lead.project_id = data.get("project_id")
        elif action == "delete":
            lead.deleted_at = utcnow()
        else:
            raise HTTPException(422, "Unknown bulk action")
    if action == "assign" and data.get("user_id") and leads:
        notify(db, int(data["user_id"]), f"{len(leads)} leads assigned to you", "", type="assignment",
               link="/leads?assigned_to_id=" + str(data["user_id"]), company_id=leads[0].company_id)
    audit(db, ctx, f"bulk_{action}", "leads", None, f"Bulk {action} on {len(leads)} leads",
          {k: v for k, v in data.items() if k != "ids"} | {"ids": [l.id for l in leads]}, request=request)
    db.commit()
    return {"updated": len(leads)}


# ── Activities ─────────────────────────────────────────────────────────────────
@act_router.patch("/{aid}")
def update_activity(aid: int, data: dict = Body(...), db: Session = Depends(get_db), ctx: Ctx = Depends(get_ctx)):
    a = db.get(M.Activity, aid)
    if not a:
        raise HTTPException(404, "Activity not found")
    if a.lead_id:
        get_lead(db, ctx, a.lead_id)
    elif a.client_id:
        ensure_access(db, ctx, db.get(M.Client, a.client_id), "clients")
    if "is_pinned" in data:
        a.is_pinned = bool(data["is_pinned"])
    if "is_internal" in data and a.user_id == ctx.id:
        a.is_internal = bool(data["is_internal"])
    db.commit()
    return to_dict(a)


@act_router.get("")
def recent_activities(request: Request, db: Session = Depends(get_db), ctx: Ctx = Depends(require("reports"))):
    p = dict(request.query_params)
    stmt = scope_filter(select(M.Activity), M.Activity, db, ctx, "reports", "view", ("user_id",))
    if p.get("type"):
        stmt = stmt.where(M.Activity.type.in_(p["type"].split(",")))
    if p.get("user_id"):
        stmt = stmt.where(M.Activity.user_id == int(p["user_id"]))
    rows, meta = paginate(db, stmt, M.Activity, p, "-created_at")
    users = name_map(db, M.User, [r.user_id for r in rows])
    leads = name_map(db, M.Lead, [r.lead_id for r in rows])
    return {"items": [to_dict(r, {"user_name": users.get(r.user_id, "System"), "lead_name": leads.get(r.lead_id)})
                      for r in rows], **meta}


# ── Follow-ups ─────────────────────────────────────────────────────────────────
def fu_query(db, ctx, p):
    stmt = scope_filter(select(M.FollowUp), M.FollowUp, db, ctx, "followups", "view")
    now = utcnow()
    day_start = parse_dt(p["day_start"]) if p.get("day_start") else now.replace(hour=0, minute=0, second=0)
    day_end = day_start + timedelta(days=1)
    bucket = p.get("bucket")
    if bucket in ("overdue", "due_now", "later_today", "upcoming", "today", "pending"):
        stmt = stmt.where(M.FollowUp.status == "pending")
    if bucket == "overdue":
        stmt = stmt.where(M.FollowUp.due_at < now - timedelta(minutes=15))
    elif bucket == "due_now":
        stmt = stmt.where(M.FollowUp.due_at >= now - timedelta(minutes=15), M.FollowUp.due_at <= now + timedelta(hours=1))
    elif bucket == "later_today":
        stmt = stmt.where(M.FollowUp.due_at > now + timedelta(hours=1), M.FollowUp.due_at < day_end)
    elif bucket == "today":
        stmt = stmt.where(M.FollowUp.due_at >= day_start, M.FollowUp.due_at < day_end)
    elif bucket == "upcoming":
        stmt = stmt.where(M.FollowUp.due_at >= day_end)
    elif bucket == "completed":
        stmt = stmt.where(M.FollowUp.status == "completed")
    for k in ("assigned_to_id", "lead_id", "client_id", "status", "priority", "type"):
        if p.get(k):
            stmt = stmt.where(getattr(M.FollowUp, k).in_(str(p[k]).split(",")))
    if p.get("from"):
        stmt = stmt.where(M.FollowUp.due_at >= parse_dt(p["from"]))
    if p.get("to"):
        stmt = stmt.where(M.FollowUp.due_at <= parse_dt(p["to"]))
    return stmt


def enrich_followups(db, rows):
    items = [to_dict(r) for r in rows]
    leads = {l.id: l for l in db.scalars(select(M.Lead).where(M.Lead.id.in_({i["lead_id"] for i in items if i["lead_id"]} or {0})))}
    clients = {c.id: c for c in db.scalars(select(M.Client).where(M.Client.id.in_({i["client_id"] for i in items if i["client_id"]} or {0})))}
    users = name_map(db, M.User, [i["assigned_to_id"] for i in items])
    projects = name_map(db, M.Project, [l.project_id for l in leads.values()])
    statuses = {s.id: s for s in db.scalars(select(M.LeadStatus))}
    sources = name_map(db, M.LeadSource, [l.source_id for l in leads.values()])
    for i in items:
        rec = leads.get(i["lead_id"]) or clients.get(i["client_id"])
        i["assigned_to_name"] = users.get(i["assigned_to_id"])
        if rec:
            i["name"], i["mobile"], i["email"] = rec.name, rec.mobile, rec.email
            i["record_code"] = rec.code
            i["project_name"] = projects.get(getattr(rec, "project_id", None))
        lead = leads.get(i["lead_id"])
        if lead:
            st = statuses.get(lead.status_id)
            i["status_name"], i["status_color"] = (st.name, st.color) if st else (None, None)
            i["source_name"] = sources.get(lead.source_id)
    return items


@fu_router.get("")
def list_followups(request: Request, db: Session = Depends(get_db), ctx: Ctx = Depends(require("followups"))):
    p = dict(request.query_params)
    rows, meta = paginate(db, fu_query(db, ctx, p), M.FollowUp, p, p.get("sort") or "due_at")
    return {"items": enrich_followups(db, rows), **meta}


@fu_router.get("/counters")
def followup_counters(request: Request, db: Session = Depends(get_db), ctx: Ctx = Depends(require("followups"))):
    p = dict(request.query_params)
    out = {}
    for b in ("overdue", "due_now", "later_today", "upcoming", "today"):
        sub = fu_query(db, ctx, {**p, "bucket": b}).subquery()
        out[b] = db.scalar(select(func.count()).select_from(sub))
    return out


@fu_router.post("")
def add_followup(data: dict = Body(...), db: Session = Depends(get_db), ctx: Ctx = Depends(require("followups", "add"))):
    if not data.get("due_at"):
        raise HTTPException(422, "Date and time are required")
    lead = client = None
    if data.get("lead_id"):
        lead = get_lead(db, ctx, int(data["lead_id"]))
    elif data.get("client_id"):
        client = ensure_access(db, ctx, db.get(M.Client, int(data["client_id"])), "clients")
    else:
        raise HTTPException(422, "Follow-up must be linked to a lead or client")
    assignee = data.get("assigned_to_id") if ctx.can("followups", "assign") else None
    fu = create_followup(db, ctx, lead=lead, client=client, due_at=parse_dt(data["due_at"]), assigned_to_id=assignee,
                         notes=data.get("notes"), type=data.get("type", "call"),
                         reminder_minutes=data.get("reminder_minutes"), priority=data.get("priority"))
    if lead and data.get("next_action"):
        lead.next_action = data["next_action"]
    db.commit()
    return enrich_followups(db, [fu])[0]


def _get_fu(db, ctx, fid, action="edit"):
    fu = db.get(M.FollowUp, fid)
    if not fu:
        raise HTTPException(404, "Follow-up not found")
    return ensure_access(db, ctx, fu, "followups", action)


@fu_router.post("/{fid}/complete")
def complete_followup(fid: int, data: dict = Body(default={}), db: Session = Depends(get_db),
                      ctx: Ctx = Depends(require("followups", "edit"))):
    """Quick outcomes: Completed, No Answer, Busy, Call Back, Rescheduled, Not Required.
    Optional next_followup_at creates the next follow-up in the same click."""
    fu = _get_fu(db, ctx, fid)
    outcome = data.get("outcome") or "Completed"
    fu.status, fu.outcome, fu.completed_at = "completed", outcome, utcnow()
    if data.get("notes"):
        fu.notes = ((fu.notes + "\n") if fu.notes else "") + data["notes"]
    lead = db.get(M.Lead, fu.lead_id) if fu.lead_id else None
    client = db.get(M.Client, fu.client_id) if fu.client_id else None
    activity(db, ctx, company_id=fu.company_id, lead_id=fu.lead_id, client_id=fu.client_id, type="followup",
             title=f"Follow-up completed – {outcome}", description=data.get("notes"), meta={"followup_id": fu.id})
    nxt = data.get("next_followup_at")
    if not nxt and outcome in ("No Answer", "Busy", "Call Back"):
        hours = (get_setting(db, fu.company_id, "followup", {}) or {}).get("retry_hours", 2)
        nxt = (utcnow() + timedelta(hours=hours)).isoformat()
    if nxt and (lead or client):
        create_followup(db, ctx, lead=lead, client=client, due_at=parse_dt(nxt), assigned_to_id=fu.assigned_to_id,
                        notes=data.get("next_action") or f"Retry after: {outcome}", type=fu.type)
    if lead:
        if data.get("next_action"):
            lead.next_action = data["next_action"]
        if data.get("status_id"):
            apply_status(db, ctx, lead, data["status_id"], data.get("sub_status_id"), data.get("loss_reason"),
                         data.get("notes"))
        sync_next_followup(db, lead.id)
    audit(db, ctx, "complete", "followups", fu.id, f"Follow-up {outcome}", company_id=fu.company_id)
    db.commit()
    return {"ok": True}


@fu_router.post("/{fid}/reschedule")
def reschedule_followup(fid: int, data: dict = Body(...), db: Session = Depends(get_db),
                        ctx: Ctx = Depends(require("followups", "edit"))):
    fu = _get_fu(db, ctx, fid)
    old = fu.due_at
    fu.due_at, fu.reminder_sent_at, fu.escalated_at = parse_dt(data["due_at"]), None, None
    if data.get("notes"):
        fu.notes = data["notes"]
    activity(db, ctx, company_id=fu.company_id, lead_id=fu.lead_id, client_id=fu.client_id, type="followup",
             title=f"Follow-up rescheduled from {old:%d %b %H:%M} to {fu.due_at:%d %b %H:%M} UTC", description=data.get("notes"))
    audit(db, ctx, "reschedule", "followups", fu.id, "Rescheduled", company_id=fu.company_id)
    sync_next_followup(db, fu.lead_id)
    db.commit()
    return {"ok": True}


@fu_router.post("/bulk")
def bulk_followups(data: dict = Body(...), db: Session = Depends(get_db), ctx: Ctx = Depends(require("followups", "edit"))):
    action, n = data.get("action"), 0
    if action == "assign" and not ctx.can("followups", "assign"):
        raise HTTPException(403, "You do not have permission to reassign follow-ups")
    for fu in db.scalars(select(M.FollowUp).where(M.FollowUp.id.in_(data.get("ids") or [0]))):
        if not can_access_row(db, ctx, fu, "followups", "edit"):
            continue
        if action == "reschedule":
            fu.due_at, fu.reminder_sent_at, fu.escalated_at = parse_dt(data["due_at"]), None, None
        elif action == "assign":
            fu.assigned_to_id = int(data["user_id"])
        elif action == "complete":
            fu.status, fu.outcome, fu.completed_at = "completed", data.get("outcome", "Completed"), utcnow()
        else:
            raise HTTPException(422, "Unknown action")
        sync_next_followup(db, fu.lead_id)
        n += 1
    audit(db, ctx, f"bulk_{action}", "followups", None, f"Bulk {action} on {n} follow-ups")
    db.commit()
    return {"updated": n}


@fu_router.delete("/{fid}")
def delete_followup(fid: int, db: Session = Depends(get_db), ctx: Ctx = Depends(require("followups", "delete"))):
    fu = _get_fu(db, ctx, fid, "delete")
    fu.status = "cancelled"
    sync_next_followup(db, fu.lead_id)
    db.commit()
    return {"ok": True}

