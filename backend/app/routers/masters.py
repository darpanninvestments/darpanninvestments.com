"""Configurable masters (statuses, sources, lookups, custom fields, locations, templates),
processes / projects / properties, settings, saved views and the /api/meta dropdown feed."""
import secrets

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from ..crud import crud_router
from ..db import M, get_db, to_dict
from ..security import Ctx, get_ctx, require
from ..services.core import audit, get_setting, name_map, set_setting

router = APIRouter(tags=["masters"])


def _company_or_global(model, ctx: Ctx, company_id: int | None = None):
    cid = company_id if ctx.is_global and company_id else ctx.company_id
    if cid is None:
        return model.company_id.is_(None) if ctx.is_global and not company_id else True
    return or_(model.company_id.is_(None), model.company_id == cid)


# ── Lead statuses (with nested sub-statuses) ───────────────────────────────────
def _status_enrich(db, items, ctx):
    ids = [i["id"] for i in items]
    subs: dict[int, list] = {}
    for s in db.scalars(select(M.LeadSubStatus).where(M.LeadSubStatus.status_id.in_(ids or [0]))
                        .order_by(M.LeadSubStatus.sort_order, M.LeadSubStatus.id)):
        subs.setdefault(s.status_id, []).append(to_dict(s))
    counts = dict(db.execute(select(M.Lead.status_id, func.count()).where(
        M.Lead.status_id.in_(ids or [0]), M.Lead.deleted_at.is_(None)).group_by(M.Lead.status_id)).all())
    for i in items:
        i["sub_statuses"] = subs.get(i["id"], [])
        i["lead_count"] = counts.get(i["id"], 0)


statuses = crud_router(model="LeadStatus", module="settings", prefix="/api/lead-statuses", global_rows=True,
                       write_action="configure", enrich=_status_enrich, default_sort="sort_order",
                       hard_delete=True, required=("name",))


@statuses.put("/{sid}/sub-statuses")
def save_sub_statuses(sid: int, request: Request, items: list[dict] = Body(..., embed=True),
                      db: Session = Depends(get_db), ctx: Ctx = Depends(require("settings", "configure"))):
    st = db.get(M.LeadStatus, sid)
    if not st or (st.company_id is None and not ctx.is_global):
        raise HTTPException(403, "Not allowed")
    keep = []
    for idx, it in enumerate(items):
        if not (it.get("name") or "").strip():
            continue
        if it.get("id"):
            s = db.get(M.LeadSubStatus, int(it["id"]))
            if s and s.status_id == sid:
                s.name, s.sort_order, s.is_active = it["name"].strip(), idx, bool(it.get("is_active", True))
                keep.append(s.id)
                continue
        s = M.LeadSubStatus(status_id=sid, name=it["name"].strip(), sort_order=idx,
                            is_active=bool(it.get("is_active", True)))
        db.add(s)
        db.flush()
        keep.append(s.id)
    db.execute(delete(M.LeadSubStatus).where(M.LeadSubStatus.status_id == sid, M.LeadSubStatus.id.not_in(keep or [0])))
    audit(db, ctx, "configure", "lead_statuses", sid, f"Updated sub-statuses of {st.name}", request=request)
    db.commit()
    return {"ok": True}


@statuses.post("/reorder")
def reorder_statuses(ids: list[int] = Body(..., embed=True), db: Session = Depends(get_db),
                     ctx: Ctx = Depends(require("settings", "configure"))):
    for idx, i in enumerate(ids):
        st = db.get(M.LeadStatus, i)
        if st and (st.company_id is not None or ctx.is_global):
            st.sort_order = idx + 1
    db.commit()
    return {"ok": True}


sources = crud_router(model="LeadSource", module="settings", prefix="/api/lead-sources", global_rows=True,
                      write_action="configure", search=("name", "code"), default_sort="name", required=("name",))
lookups = crud_router(model="Lookup", module="settings", prefix="/api/lookups", global_rows=True,
                      write_action="configure", search=("name", "type"), default_sort="sort_order",
                      hard_delete=True, required=("type", "name"))
custom_fields = crud_router(model="CustomField", module="settings", prefix="/api/custom-fields", global_rows=True,
                            write_action="configure", search=("label", "key"), default_sort="sort_order",
                            hard_delete=True, required=("module", "key", "label"))
templates = crud_router(model="MessageTemplate", module="settings", prefix="/api/message-templates",
                        global_rows=True, write_action="configure", view_module="dashboard",
                        search=("name", "body"), default_sort="name", hard_delete=True, required=("name", "body"))


# ── Locations ──────────────────────────────────────────────────────────────────
countries = crud_router(model="Country", module="locations", prefix="/api/locations/countries",
                        company_scoped=False, default_sort="name", hard_delete=True, required=("name",),
                        view_module="dashboard")
states = crud_router(model="State", module="locations", prefix="/api/locations/states", company_scoped=False,
                     default_sort="name", hard_delete=True, required=("name", "country_id"), view_module="dashboard")
cities = crud_router(model="City", module="locations", prefix="/api/locations/cities", company_scoped=False,
                     default_sort="name", hard_delete=True, required=("name", "state_id"), view_module="dashboard")
areas = crud_router(model="Area", module="locations", prefix="/api/locations/areas", company_scoped=False,
                    search=("name", "pincode", "tags"), default_sort="name", hard_delete=True,
                    required=("name", "city_id"), view_module="dashboard")


# ── Processes / Projects / Properties ──────────────────────────────────────────
def _process_enrich(db, items, ctx):
    ids = [i["id"] for i in items] or [0]
    projects = dict(db.execute(select(M.Project.process_id, func.count()).where(
        M.Project.process_id.in_(ids), M.Project.deleted_at.is_(None)).group_by(M.Project.process_id)).all())
    leads = dict(db.execute(select(M.Lead.process_id, func.count()).where(
        M.Lead.process_id.in_(ids), M.Lead.deleted_at.is_(None)).group_by(M.Lead.process_id)).all())
    comps = name_map(db, M.Company, [i["company_id"] for i in items])
    for i in items:
        i["project_count"] = projects.get(i["id"], 0)
        i["lead_count"] = leads.get(i["id"], 0)
        i["company_name"] = comps.get(i["company_id"])


def _project_enrich(db, items, ctx):
    ids = [i["id"] for i in items] or [0]
    procs = name_map(db, M.Process, [i["process_id"] for i in items])
    cities = name_map(db, M.City, [i["city_id"] for i in items])
    areas = name_map(db, M.Area, [i["area_id"] for i in items])
    comps = name_map(db, M.Company, [i["company_id"] for i in items])
    props = {}
    for pid, avail, n in db.execute(select(M.Property.project_id, M.Property.availability, func.count()).where(
            M.Property.project_id.in_(ids), M.Property.deleted_at.is_(None))
            .group_by(M.Property.project_id, M.Property.availability)):
        props.setdefault(pid, {})[avail] = n
    leads = dict(db.execute(select(M.Lead.project_id, func.count()).where(
        M.Lead.project_id.in_(ids), M.Lead.deleted_at.is_(None)).group_by(M.Lead.project_id)).all())
    superseded = select(M.Document.parent_id).where(M.Document.parent_id.is_not(None), M.Document.deleted_at.is_(None))
    docs = dict(db.execute(select(M.Document.project_id, func.count()).where(
        M.Document.project_id.in_(ids), M.Document.deleted_at.is_(None), M.Document.client_id.is_(None),
        ~M.Document.id.in_(superseded)).group_by(M.Document.project_id)).all())
    for i in items:
        i["process_name"] = procs.get(i["process_id"])
        i["city_name"] = cities.get(i["city_id"])
        i["area_name"] = areas.get(i["area_id"])
        i["company_name"] = comps.get(i["company_id"])
        i["inventory"] = props.get(i["id"], {})
        i["property_count"] = sum(props.get(i["id"], {}).values())
        i["lead_count"] = leads.get(i["id"], 0)
        i["document_count"] = docs.get(i["id"], 0)


def _property_enrich(db, items, ctx):
    projects = name_map(db, M.Project, [i["project_id"] for i in items])
    for i in items:
        i["project_name"] = projects.get(i["project_id"])


def _property_before(db, ctx, obj, payload):
    pid = payload.get("project_id") or (obj.project_id if obj else None)
    if not pid:
        raise HTTPException(422, "Project is required")
    proj = db.get(M.Project, int(pid))
    if not proj or proj.deleted_at:
        raise HTTPException(422, "Invalid project")
    if obj is None:
        payload["company_id"] = proj.company_id
        if not payload.get("code"):
            n = db.scalar(select(func.count()).select_from(M.Property).where(M.Property.project_id == proj.id)) or 0
            payload["code"] = f"{(proj.code or 'PR' + str(proj.id)).upper()}-{n + 1:03d}"
    elif obj.availability != payload.get("availability", obj.availability):
        audit(db, ctx, "status_change", "properties", obj.id,
              f"Availability changed from {obj.availability} to {payload['availability']}",
              {"availability": {"from": obj.availability, "to": payload["availability"]}}, company_id=obj.company_id)


def _project_before(db, ctx, obj, payload):
    if payload.get("process_id"):
        proc = db.get(M.Process, int(payload["process_id"]))
        if not proc:
            raise HTTPException(422, "Invalid process")


processes = crud_router(model="Process", module="processes", prefix="/api/processes", search=("name", "type"),
                        enrich=_process_enrich, default_sort="name", required=("name",))
projects = crud_router(model="Project", module="projects", prefix="/api/projects",
                       search=("name", "code", "developer", "address"), enrich=_project_enrich, default_sort="name",
                       before_save=_project_before, required=("name",))
properties = crud_router(model="Property", module="properties", prefix="/api/properties",
                         search=("code", "unit_no", "property_type", "description"), enrich=_property_enrich,
                         before_save=_property_before, default_sort="code")


@properties.post("/bulk-update")
def bulk_update_properties(request: Request, ids: list[int] = Body(...), data: dict = Body(...),
                           db: Session = Depends(get_db), ctx: Ctx = Depends(require("properties", "edit"))):
    allowed = {"availability", "base_price", "offer_price", "price_status", "property_type"}
    data = {k: v for k, v in data.items() if k in allowed}
    n = 0
    for p in db.scalars(select(M.Property).where(M.Property.id.in_(ids), M.Property.deleted_at.is_(None))):
        if ctx.is_global or p.company_id == ctx.company_id:
            for k, v in data.items():
                setattr(p, k, v)
            n += 1
    audit(db, ctx, "bulk_update", "properties", None, f"Bulk updated {n} properties", data, request=request)
    db.commit()
    return {"updated": n}


# ── Settings (per company, key → JSON) ────────────────────────────────────────
settings_r = APIRouter(prefix="/api/settings", tags=["settings"])
SETTING_KEYS = {"general", "assignment_rules", "duplicate_rules", "followup", "escalation", "notifications",
                "client_checklist", "integrations"}


@settings_r.get("")
def get_settings(company_id: int | None = None, db: Session = Depends(get_db),
                 ctx: Ctx = Depends(require("settings", "view"))):
    cid = company_id if ctx.is_global and company_id else ctx.company_id
    out = {k: get_setting(db, cid, k) for k in SETTING_KEYS}
    integ = out.get("integrations") or {}
    if integ.get("api_key"):
        integ["api_key"] = integ["api_key"][:6] + "…" + integ["api_key"][-4:]
    out["integrations"] = integ
    return out


@settings_r.put("/{key}")
def put_setting(key: str, request: Request, value: dict = Body(...), company_id: int | None = None,
                db: Session = Depends(get_db), ctx: Ctx = Depends(require("settings", "configure"))):
    if key not in SETTING_KEYS:
        raise HTTPException(404, "Unknown setting")
    cid = company_id if ctx.is_global and company_id else ctx.company_id
    if key == "integrations":
        current = get_setting(db, cid, key, {}) or {}
        value["api_key"] = current.get("api_key")  # api key only changes via rotate endpoint
    set_setting(db, cid, key, value)
    audit(db, ctx, "configure", "settings", None, f"Updated setting {key}", value, company_id=cid, request=request)
    db.commit()
    return {"ok": True}


@settings_r.post("/integrations/rotate-api-key")
def rotate_api_key(request: Request, company_id: int | None = None, db: Session = Depends(get_db),
                   ctx: Ctx = Depends(require("settings", "configure"))):
    cid = company_id if ctx.is_global and company_id else ctx.company_id
    if not cid:
        raise HTTPException(400, "Select a company")
    key = f"dcrm_{cid}_{secrets.token_urlsafe(32)}"
    current = get_setting(db, cid, "integrations", {}) or {}
    current["api_key"] = key
    set_setting(db, cid, "integrations", current)
    audit(db, ctx, "configure", "settings", None, "Rotated lead API key", company_id=cid, request=request)
    db.commit()
    return {"api_key": key, "webhook_url": "/api/public/leads"}


# ── Saved views ────────────────────────────────────────────────────────────────
views = APIRouter(prefix="/api/saved-views", tags=["views"])


@views.get("")
def list_views(module: str, db: Session = Depends(get_db), ctx: Ctx = Depends(get_ctx)):
    rows = db.scalars(select(M.SavedView).where(M.SavedView.module == module, or_(
        M.SavedView.user_id == ctx.id,
        (M.SavedView.visibility == "company") & (M.SavedView.company_id == ctx.company_id),
        (M.SavedView.visibility == "team") & (M.SavedView.company_id == ctx.company_id),
    )).order_by(M.SavedView.name))
    return [to_dict(r, {"mine": r.user_id == ctx.id}) for r in rows]


@views.post("")
def save_view(data: dict = Body(...), db: Session = Depends(get_db), ctx: Ctx = Depends(get_ctx)):
    vis = data.get("visibility", "personal")
    if vis != "personal" and ctx.role.level < 40:
        vis = "personal"
    v = M.SavedView(user_id=ctx.id, company_id=ctx.company_id, module=data["module"], name=data["name"][:128],
                    filters=data.get("filters"), columns=data.get("columns"), visibility=vis)
    db.add(v)
    db.commit()
    return to_dict(v)


@views.delete("/{vid}")
def delete_view(vid: int, db: Session = Depends(get_db), ctx: Ctx = Depends(get_ctx)):
    v = db.get(M.SavedView, vid)
    if not v or v.user_id != ctx.id:
        raise HTTPException(404, "View not found")
    db.delete(v)
    db.commit()
    return {"ok": True}


# ── Meta: everything dropdowns need, in one call ───────────────────────────────
meta = APIRouter(prefix="/api/meta", tags=["meta"])


@meta.get("")
def get_meta(company_id: int | None = None, db: Session = Depends(get_db), ctx: Ctx = Depends(get_ctx)):
    cid = company_id if ctx.is_global and company_id else ctx.company_id

    def scoped(model):
        q = select(model).where(model.is_active.is_(True))
        if cid is not None:
            q = q.where(or_(model.company_id.is_(None), model.company_id == cid))
        return q

    statuses_rows = list(db.scalars(scoped(M.LeadStatus).order_by(M.LeadStatus.sort_order, M.LeadStatus.id)))
    subs: dict[int, list] = {}
    for s in db.scalars(select(M.LeadSubStatus).where(M.LeadSubStatus.is_active.is_(True))
                        .order_by(M.LeadSubStatus.sort_order)):
        subs.setdefault(s.status_id, []).append({"id": s.id, "name": s.name})
    lookups_by_type: dict[str, list] = {}
    for l in db.scalars(scoped(M.Lookup).order_by(M.Lookup.sort_order, M.Lookup.name)):
        lookups_by_type.setdefault(l.type, []).append({"id": l.id, "name": l.name, "value": l.value or l.name,
                                                       "color": l.color})

    def company_rows(model, *cols):
        q = select(*[getattr(model, c) for c in cols]).where(model.deleted_at.is_(None))
        if cid is not None:
            q = q.where(model.company_id == cid)
        return [dict(zip(cols, r)) for r in db.execute(q.order_by(getattr(model, cols[1])))]

    users_q = select(M.User.id, M.User.name, M.User.role_id, M.User.team_id, M.User.company_id).where(
        M.User.deleted_at.is_(None), M.User.is_active.is_(True))
    if cid is not None:
        users_q = users_q.where(M.User.company_id == cid)
    companies_rows = []
    if ctx.is_global:
        companies_rows = [{"id": i, "name": n} for i, n in db.execute(
            select(M.Company.id, M.Company.name).where(M.Company.deleted_at.is_(None)).order_by(M.Company.name))]
    elif ctx.company_id:
        c = db.get(M.Company, ctx.company_id)
        companies_rows = [{"id": c.id, "name": c.name}]
    teams_q = select(M.Team.id, M.Team.name, M.Team.company_id).where(M.Team.deleted_at.is_(None))
    if cid is not None:
        teams_q = teams_q.where(M.Team.company_id == cid)
    return {
        "statuses": [{"id": s.id, "name": s.name, "color": s.color, "category": s.category,
                      "requires_reason": s.requires_reason, "allowed_next_ids": s.allowed_next_ids,
                      "sub_statuses": subs.get(s.id, [])} for s in statuses_rows],
        "sources": [{"id": s.id, "name": s.name, "color": s.color} for s in
                    db.scalars(scoped(M.LeadSource).order_by(M.LeadSource.name))],
        "lookups": lookups_by_type,
        "custom_fields": [to_dict(f) for f in db.scalars(scoped(M.CustomField).order_by(M.CustomField.sort_order))],
        "processes": company_rows(M.Process, "id", "name"),
        "projects": company_rows(M.Project, "id", "name", "process_id"),
        "users": [{"id": i, "name": n, "role_id": r, "team_id": t, "company_id": c} for i, n, r, t, c in
                  db.execute(users_q.order_by(M.User.name))],
        "teams": [{"id": i, "name": n, "company_id": c} for i, n, c in db.execute(teams_q.order_by(M.Team.name))],
        "companies": companies_rows,
        "templates": [{"id": t.id, "name": t.name, "channel": t.channel, "subject": t.subject, "body": t.body}
                      for t in db.scalars(scoped(M.MessageTemplate).order_by(M.MessageTemplate.name))],
    }


for _r in (statuses, sources, lookups, custom_fields, templates, countries, states, cities, areas, processes,
           projects, properties, settings_r, views, meta):
    router.include_router(_r)
