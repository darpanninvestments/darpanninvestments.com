"""Dashboard cards, reports & dashboard layouts."""
from datetime import timedelta

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from ..db import M, get_db, parse_dt, to_dict, utcnow
from ..security import Ctx, get_ctx, require, scope_filter
from ..services.core import name_map

router = APIRouter(tags=["insights"])

ALL_CARDS = [
    ("new_leads_today", "New Leads Today", "kpi"), ("unassigned", "Fresh / Unassigned", "kpi"),
    ("followups_today", "Today's Follow-Ups", "kpi"), ("followups_overdue", "Overdue Follow-Ups", "kpi"),
    ("hot_leads", "Hot / High Priority Leads", "kpi"), ("visits_today", "Visits Today", "kpi"),
    ("meetings_today", "Meetings Today", "kpi"), ("whatsapp_leads", "New WhatsApp Leads", "kpi"),
    ("conversions", "Bookings / Conversions", "kpi"), ("pending_documents", "Pending Documents", "kpi"),
    ("followup_center", "Daily Follow-Up Command Center", "wide"),
    ("source_performance", "Source Performance", "chart"), ("project_demand", "Project Demand", "chart"),
    ("conversion_funnel", "Conversion Funnel", "chart"), ("lost_leads", "Lost Leads", "chart"),
    ("lead_trend", "Lead Trend", "chart"), ("agent_performance", "Agent Performance", "table"),
    ("import_activity", "Import Activity", "table"), ("notification_center", "Notification Center", "table"),
    ("recent_leads", "Recent Leads", "table"),
]
ROLE_DEFAULTS = {
    "agent": ["followups_today", "followups_overdue", "hot_leads", "visits_today", "meetings_today",
              "new_leads_today", "followup_center", "recent_leads", "conversion_funnel", "notification_center"],
    "team_lead": ["new_leads_today", "unassigned", "followups_today", "followups_overdue", "visits_today",
                  "meetings_today", "followup_center", "agent_performance", "conversion_funnel", "source_performance"],
}


def default_cards(role_key: str):
    keys = ROLE_DEFAULTS.get(role_key) or [c[0] for c in ALL_CARDS]
    return [{"id": k, "visible": True, "size": next(c[2] for c in ALL_CARDS if c[0] == k)} for k in keys]


def _filters(p: dict):
    now = utcnow()
    start = parse_dt(p.get("from")) or (now - timedelta(days=30))
    end = parse_dt(p.get("to")) or now
    day_start = parse_dt(p.get("day_start")) or now.replace(hour=0, minute=0, second=0, microsecond=0)
    return start, end, day_start, day_start + timedelta(days=1), now


def _lead_base(db, ctx, p):
    stmt = scope_filter(select(M.Lead), M.Lead, db, ctx, "leads", "view").where(M.Lead.deleted_at.is_(None))
    for k in ("company_id", "project_id", "source_id", "assigned_to_id", "team_id", "process_id", "status_id"):
        if p.get(k):
            stmt = stmt.where(getattr(M.Lead, k).in_(str(p[k]).split(",")))
    if p.get("city"):
        stmt = stmt.where(M.Lead.city == p["city"])
    return stmt.subquery()


def _scoped(db, ctx, model, module, p, owner):
    stmt = scope_filter(select(model), model, db, ctx, module, "view", owner)
    if p.get("company_id") and "company_id" in model.__table__.columns:
        stmt = stmt.where(model.company_id == int(p["company_id"]))
    if p.get("assigned_to_id"):
        stmt = stmt.where(getattr(model, owner[0]) == int(p["assigned_to_id"]))
    return stmt.subquery()


def _count(db, sub, *conds):
    return db.scalar(select(func.count()).select_from(sub).where(*conds)) or 0


def _statuses(db):
    return {s.id: s for s in db.scalars(select(M.LeadStatus))}


@router.get("/api/dashboard/summary")
def summary(request: Request, db: Session = Depends(get_db), ctx: Ctx = Depends(require("dashboard"))):
    p = dict(request.query_params)
    start, end, ds, de, now = _filters(p)
    L = _lead_base(db, ctx, p)
    sts = _statuses(db)
    lost_ids = [s.id for s in sts.values() if s.category == "lost"] or [0]
    wa = db.scalar(select(M.LeadSource.id).where(M.LeadSource.name.like("%WhatsApp%")))
    F = _scoped(db, ctx, M.FollowUp, "followups", p, ("assigned_to_id",))
    V = _scoped(db, ctx, M.Visit, "visits", p, ("agent_id",))
    Mt = _scoped(db, ctx, M.Meeting, "meetings", p, ("host_id",))
    cards: dict = {
        "new_leads_today": _count(db, L, L.c.created_at >= ds, L.c.created_at < de),
        "unassigned": _count(db, L, L.c.assigned_to_id.is_(None), L.c.converted_at.is_(None)),
        "followups_today": _count(db, F, F.c.status == "pending", F.c.due_at >= ds, F.c.due_at < de),
        "followups_overdue": _count(db, F, F.c.status == "pending", F.c.due_at < now),
        "hot_leads": _count(db, L, L.c.priority == "Hot", L.c.converted_at.is_(None), L.c.status_id.not_in(lost_ids)),
        "visits_today": _count(db, V, V.c.scheduled_at >= ds, V.c.scheduled_at < de),
        "meetings_today": _count(db, Mt, Mt.c.scheduled_at >= ds, Mt.c.scheduled_at < de),
        "whatsapp_leads": _count(db, L, L.c.source_id == wa, L.c.created_at >= start) if wa else 0,
        "conversions": _count(db, L, L.c.converted_at >= start, L.c.converted_at <= end),
        "total_leads": _count(db, L, L.c.created_at >= start, L.c.created_at <= end),
    }
    D = _scoped(db, ctx, M.Document, "documents", p, ("uploaded_by",))
    cards["pending_documents"] = _count(db, D, D.c.status == "Pending", D.c.deleted_at.is_(None))

    in_range = (L.c.created_at >= start, L.c.created_at <= end)
    srcs = name_map(db, M.LeadSource, [r for r, in db.execute(select(L.c.source_id).distinct())])
    cards["source_performance"] = [
        {"name": srcs.get(sid, "Unknown"), "leads": n, "converted": int(c or 0)}
        for sid, n, c in db.execute(select(L.c.source_id, func.count(), func.sum(case((L.c.converted_at.is_not(None), 1), else_=0)))
                                    .where(*in_range).group_by(L.c.source_id).order_by(func.count().desc()).limit(10))]
    projs = name_map(db, M.Project, [r for r, in db.execute(select(L.c.project_id).distinct())])
    cards["project_demand"] = [
        {"name": projs.get(pid, "Not specified"), "leads": n}
        for pid, n in db.execute(select(L.c.project_id, func.count()).where(*in_range).group_by(L.c.project_id)
                                 .order_by(func.count().desc()).limit(10))]
    funnel = dict(db.execute(select(L.c.status_id, func.count()).where(*in_range).group_by(L.c.status_id)).all())
    cards["conversion_funnel"] = [{"name": s.name, "color": s.color, "count": funnel.get(s.id, 0)}
                                  for s in sorted(sts.values(), key=lambda s: s.sort_order) if s.is_active]
    cards["lost_leads"] = [
        {"name": r or "Not specified", "count": n}
        for r, n in db.execute(select(func.coalesce(L.c.loss_reason, ""), func.count())
                               .where(L.c.status_id.in_(lost_ids), *in_range)
                               .group_by(func.coalesce(L.c.loss_reason, "")).order_by(func.count().desc()).limit(8))]
    day = func.date(L.c.created_at)
    cards["lead_trend"] = [{"date": str(d), "leads": n} for d, n in db.execute(
        select(day, func.count()).where(*in_range).group_by(day).order_by(day))]
    cards["agent_performance"] = agent_rows(db, ctx, p, start, end, L, limit=10)
    imports = select(M.ImportJob).order_by(M.ImportJob.id.desc()).limit(5)
    if not ctx.is_global:
        imports = imports.where(M.ImportJob.company_id == ctx.company_id)
    cards["import_activity"] = [to_dict(i) for i in db.scalars(imports)] if ctx.can("imports", "view") else []
    cards["notification_center"] = [to_dict(n) for n in db.scalars(
        select(M.Notification).where(M.Notification.user_id == ctx.id).order_by(M.Notification.id.desc()).limit(6))]
    cards["recent_leads"] = [
        {"id": r.id, "code": r.code, "name": r.name, "created_at": to_dict(db.get(M.Lead, r.id))["created_at"],
         "status": sts[r.status_id].name if r.status_id in sts else None,
         "color": sts[r.status_id].color if r.status_id in sts else None}
        for r in db.execute(select(L.c.id, L.c.code, L.c.name, L.c.status_id).order_by(L.c.created_at.desc()).limit(8))]
    return cards


def agent_rows(db, ctx, p, start, end, L=None, limit=None):
    L = L if L is not None else _lead_base(db, ctx, p)
    rng = (L.c.created_at >= start, L.c.created_at <= end)
    base = {uid: {"assigned": n, "converted": int(c or 0), "hot": int(h or 0)} for uid, n, c, h in db.execute(
        select(L.c.assigned_to_id, func.count(), func.sum(case((L.c.converted_at.is_not(None), 1), else_=0)),
               func.sum(case((L.c.priority == "Hot", 1), else_=0)))
        .where(*rng).group_by(L.c.assigned_to_id))}
    contacted = dict(db.execute(select(M.Activity.user_id, func.count(func.distinct(M.Activity.lead_id))).where(
        M.Activity.type.in_(["call", "whatsapp", "sms", "email"]), M.Activity.created_at >= start,
        M.Activity.created_at <= end).group_by(M.Activity.user_id)).all())
    calls = dict(db.execute(select(M.Activity.user_id, func.count()).where(
        M.Activity.type == "call", M.Activity.created_at >= start, M.Activity.created_at <= end)
        .group_by(M.Activity.user_id)).all())
    fu_done = dict(db.execute(select(M.FollowUp.assigned_to_id, func.count()).where(
        M.FollowUp.status == "completed", M.FollowUp.completed_at >= start, M.FollowUp.completed_at <= end)
        .group_by(M.FollowUp.assigned_to_id)).all())
    fu_overdue = dict(db.execute(select(M.FollowUp.assigned_to_id, func.count()).where(
        M.FollowUp.status == "pending", M.FollowUp.due_at < utcnow()).group_by(M.FollowUp.assigned_to_id)).all())
    visits = dict(db.execute(select(M.Visit.agent_id, func.count()).where(
        M.Visit.status == "Completed", M.Visit.scheduled_at >= start, M.Visit.scheduled_at <= end)
        .group_by(M.Visit.agent_id)).all())
    meetings = dict(db.execute(select(M.Meeting.host_id, func.count()).where(
        M.Meeting.status == "Completed", M.Meeting.scheduled_at >= start, M.Meeting.scheduled_at <= end)
        .group_by(M.Meeting.host_id)).all())
    names = name_map(db, M.User, list(base.keys()))
    rows = []
    for uid, b in base.items():
        if uid is None:
            continue
        rows.append({"user_id": uid, "name": names.get(uid, f"User {uid}"), **b, "contacted": contacted.get(uid, 0),
                     "calls": calls.get(uid, 0), "followups_done": fu_done.get(uid, 0),
                     "followups_overdue": fu_overdue.get(uid, 0), "visits": visits.get(uid, 0),
                     "meetings": meetings.get(uid, 0),
                     "conversion_rate": round(100 * b["converted"] / b["assigned"], 1) if b["assigned"] else 0})
    rows.sort(key=lambda r: (-r["converted"], -r["assigned"]))
    return rows[:limit] if limit else rows


# ── Layouts ────────────────────────────────────────────────────────────────────
@router.get("/api/dashboard/layout")
def get_layout(db: Session = Depends(get_db), ctx: Ctx = Depends(get_ctx)):
    row = db.scalar(select(M.DashboardLayout).where(M.DashboardLayout.user_id == ctx.id))
    if not row:
        row = db.scalar(select(M.DashboardLayout).where(M.DashboardLayout.role_key == ctx.role.key,
                                                        M.DashboardLayout.user_id.is_(None)))
    cards = row.cards if row else default_cards(ctx.role.key)
    return {"cards": cards, "catalog": [{"id": k, "title": t, "size": s} for k, t, s in ALL_CARDS]}


@router.put("/api/dashboard/layout")
def save_layout(cards: list = Body(..., embed=True), for_role: str | None = Body(None, embed=True),
                db: Session = Depends(get_db), ctx: Ctx = Depends(require("dashboard", "configure"))):
    if for_role:
        if not ctx.can("settings", "configure"):
            raise HTTPException(403, "Only admins can set role default dashboards")
        row = db.scalar(select(M.DashboardLayout).where(M.DashboardLayout.role_key == for_role,
                                                        M.DashboardLayout.user_id.is_(None)))
        if not row:
            row = M.DashboardLayout(role_key=for_role, name=f"{for_role} default", cards=cards, is_default=True)
            db.add(row)
    else:
        row = db.scalar(select(M.DashboardLayout).where(M.DashboardLayout.user_id == ctx.id))
        if not row:
            row = M.DashboardLayout(user_id=ctx.id, cards=cards)
            db.add(row)
    row.cards = cards
    db.commit()
    return {"ok": True}


@router.delete("/api/dashboard/layout")
def reset_layout(db: Session = Depends(get_db), ctx: Ctx = Depends(get_ctx)):
    row = db.scalar(select(M.DashboardLayout).where(M.DashboardLayout.user_id == ctx.id))
    if row:
        db.delete(row)
        db.commit()
    return {"ok": True}


# ── Reports ────────────────────────────────────────────────────────────────────
REPORTS = {
    "lead-source": "Lead Source Report", "agent-performance": "Agent Performance", "follow-up": "Follow-Up Report",
    "visit": "Visit Report", "meeting": "Meeting Report", "project": "Project Report", "property": "Property Report",
    "lost-lead": "Lost Lead Report", "conversion-funnel": "Conversion Funnel", "activity": "Activity Report",
    "document": "Document Report", "import-export": "Import/Export Report", "team": "Team Report",
}


@router.get("/api/reports")
def list_reports(ctx: Ctx = Depends(require("reports"))):
    return [{"key": k, "name": v} for k, v in REPORTS.items()]


@router.get("/api/reports/{key}")
def run_report(key: str, request: Request, db: Session = Depends(get_db), ctx: Ctx = Depends(require("reports"))):
    p = dict(request.query_params)
    start, end, *_ = _filters(p)
    L = _lead_base(db, ctx, p)
    rng = (L.c.created_at >= start, L.c.created_at <= end)
    sts = _statuses(db)
    cat = {sid: s.category for sid, s in sts.items()}
    interested_ids = [s.id for s in sts.values() if s.name.lower().startswith("interested")] or [0]
    contacted_ids = [s.id for s in sts.values() if s.category == "open" and "fresh" not in s.name.lower()] or [0]

    def lead_group(col, names):
        rows = []
        for gid, n, conv, inter, contacted, lost in db.execute(select(
                col, func.count(), func.sum(case((L.c.converted_at.is_not(None), 1), else_=0)),
                func.sum(case((L.c.status_id.in_(interested_ids), 1), else_=0)),
                func.sum(case((L.c.status_id.in_(contacted_ids), 1), else_=0)),
                func.sum(case((L.c.status_id.in_([k for k, v in cat.items() if v == "lost"] or [0]), 1), else_=0)))
                .where(*rng).group_by(col).order_by(func.count().desc())):
            rows.append({"name": names.get(gid, "Not specified"), "leads": n, "contacted": int(contacted or 0),
                         "interested": int(inter or 0), "converted": int(conv or 0), "lost": int(lost or 0),
                         "conversion_rate": round(100 * int(conv or 0) / n, 1) if n else 0})
        return rows

    if key == "lead-source":
        srcs = name_map(db, M.LeadSource, [r for r, in db.execute(select(L.c.source_id).distinct())])
        rows = lead_group(L.c.source_id, srcs)
        visits = dict(db.execute(select(L.c.source_id, func.count(M.Visit.id)).join(M.Visit, M.Visit.lead_id == L.c.id)
                                 .where(*rng).group_by(L.c.source_id)).all())
        inv = {v: k for k, v in srcs.items()}
        for r in rows:
            r["visits"] = visits.get(inv.get(r["name"]), 0)
        camp = [{"name": f"{srcs.get(s, '—')} / {c}", "leads": n} for s, c, n in db.execute(
            select(L.c.source_id, L.c.campaign, func.count()).where(*rng, L.c.campaign.is_not(None))
            .group_by(L.c.source_id, L.c.campaign).order_by(func.count().desc()).limit(20))]
        return {"title": REPORTS[key], "rows": rows, "campaigns": camp}
    if key == "agent-performance":
        return {"title": REPORTS[key], "rows": agent_rows(db, ctx, p, start, end, L)}
    if key == "team":
        agents = agent_rows(db, ctx, p, start, end, L)
        teams_of = dict(db.execute(select(M.User.id, M.User.team_id)).all())
        tnames = name_map(db, M.Team, set(teams_of.values()))
        agg: dict = {}
        for a in agents:
            t = tnames.get(teams_of.get(a["user_id"]), "No team")
            g = agg.setdefault(t, {"name": t, "agents": 0, "assigned": 0, "contacted": 0, "followups_done": 0,
                                   "visits": 0, "meetings": 0, "converted": 0})
            g["agents"] += 1
            for k in ("assigned", "contacted", "followups_done", "visits", "meetings", "converted"):
                g[k] += a[k]
        return {"title": REPORTS[key], "rows": sorted(agg.values(), key=lambda g: -g["converted"])}
    if key == "follow-up":
        F = _scoped(db, ctx, M.FollowUp, "followups", p, ("assigned_to_id",))
        names = name_map(db, M.User, [r for r, in db.execute(select(F.c.assigned_to_id).distinct())])
        now = utcnow()
        rows = [{"name": names.get(u, "—"), "total": n, "completed": int(c or 0), "overdue": int(o or 0),
                 "pending": int(pe or 0), "rescheduled": int(rs or 0)}
                for u, n, c, o, pe, rs in db.execute(select(
                    F.c.assigned_to_id, func.count(), func.sum(case((F.c.status == "completed", 1), else_=0)),
                    func.sum(case(((F.c.status == "pending") & (F.c.due_at < now), 1), else_=0)),
                    func.sum(case((F.c.status == "pending", 1), else_=0)),
                    func.sum(case((F.c.outcome == "Rescheduled", 1), else_=0)))
                    .where(F.c.due_at >= start, F.c.due_at <= end).group_by(F.c.assigned_to_id))]
        return {"title": REPORTS[key], "rows": rows}
    if key in ("visit", "meeting"):
        model, owner = (M.Visit, "agent_id") if key == "visit" else (M.Meeting, "host_id")
        S = _scoped(db, ctx, model, f"{key}s", p, (owner,))
        oc = getattr(S.c, owner)
        names = name_map(db, M.User, [r for r, in db.execute(select(oc).distinct())])
        by_status = {}
        for u, st, n in db.execute(select(oc, S.c.status, func.count()).where(
                S.c.scheduled_at >= start, S.c.scheduled_at <= end).group_by(oc, S.c.status)):
            by_status.setdefault(u, {"name": names.get(u, "—")})[st] = n
        rows = []
        for u, d in by_status.items():
            d["total"] = sum(v for k, v in d.items() if k != "name")
            if key == "visit":
                d["converted_after"] = db.scalar(select(func.count(func.distinct(M.Lead.id))).join(
                    M.Visit, M.Visit.lead_id == M.Lead.id).where(M.Visit.agent_id == u, M.Visit.status == "Completed",
                                                                 M.Lead.converted_at > M.Visit.scheduled_at)) or 0
            rows.append(d)
        outcomes = [{"name": o or "—", "count": n} for o, n in db.execute(
            select(S.c.outcome, func.count()).where(S.c.scheduled_at >= start, S.c.scheduled_at <= end,
                                                    S.c.outcome.is_not(None)).group_by(S.c.outcome))]
        return {"title": REPORTS[key], "rows": rows, "outcomes": outcomes}
    if key == "project":
        projs = name_map(db, M.Project, [r for r, in db.execute(select(L.c.project_id).distinct())])
        rows = lead_group(L.c.project_id, projs)
        inv = {v: k for k, v in projs.items()}
        for r in rows:
            pid = inv.get(r["name"])
            r["visits"] = db.scalar(select(func.count()).select_from(M.Visit).where(
                M.Visit.project_id == pid, M.Visit.scheduled_at >= start, M.Visit.scheduled_at <= end)) if pid else 0
            r["meetings"] = db.scalar(select(func.count()).select_from(M.Meeting).where(
                M.Meeting.project_id == pid, M.Meeting.scheduled_at >= start, M.Meeting.scheduled_at <= end)) if pid else 0
        return {"title": REPORTS[key], "rows": rows}
    if key == "property":
        P = _scoped(db, ctx, M.Property, "properties", p, ("created_by",))
        projs = name_map(db, M.Project, [r for r, in db.execute(select(P.c.project_id).distinct())])
        agg: dict = {}
        for pid, av, n, val in db.execute(select(P.c.project_id, P.c.availability, func.count(), func.sum(P.c.base_price))
                                          .where(P.c.deleted_at.is_(None)).group_by(P.c.project_id, P.c.availability)):
            d = agg.setdefault(pid, {"name": projs.get(pid, "—"), "total": 0, "value": 0})
            d[av] = n
            d["total"] += n
            d["value"] += float(val or 0)
        return {"title": REPORTS[key], "rows": list(agg.values())}
    if key == "lost-lead":
        lost = [k for k, v in cat.items() if v == "lost"] or [0]
        srcs = name_map(db, M.LeadSource, [r for r, in db.execute(select(L.c.source_id).distinct())])
        projs = name_map(db, M.Project, [r for r, in db.execute(select(L.c.project_id).distinct())])
        users = name_map(db, M.User, [r for r, in db.execute(select(L.c.assigned_to_id).distinct())])
        subs = name_map(db, M.LeadSubStatus, [r for r, in db.execute(select(L.c.sub_status_id).distinct())])
        rows = [{"reason": r or subs.get(ss) or "Not specified", "source": srcs.get(s, "—"), "project": projs.get(pr, "—"),
                 "agent": users.get(a, "—"), "count": n}
                for r, ss, s, pr, a, n in db.execute(select(L.c.loss_reason, L.c.sub_status_id, L.c.source_id,
                                                            L.c.project_id, L.c.assigned_to_id, func.count())
                                                     .where(L.c.status_id.in_(lost), *rng)
                                                     .group_by(L.c.loss_reason, L.c.sub_status_id, L.c.source_id,
                                                               L.c.project_id, L.c.assigned_to_id)
                                                     .order_by(func.count().desc()))]
        return {"title": REPORTS[key], "rows": rows}
    if key == "conversion-funnel":
        counts = dict(db.execute(select(L.c.status_id, func.count()).where(*rng).group_by(L.c.status_id)).all())
        total = sum(counts.values())
        ordered = sorted([s for s in sts.values() if s.is_active], key=lambda s: s.sort_order)
        rows, remaining = [], total
        for s in ordered:
            n = counts.get(s.id, 0)
            rows.append({"name": s.name, "color": s.color, "count": n,
                         "share": round(100 * n / total, 1) if total else 0,
                         "reached": remaining, "category": s.category})
            remaining -= n
        return {"title": REPORTS[key], "rows": rows, "total": total,
                "converted": _count(db, L, L.c.converted_at.is_not(None), *rng)}
    if key == "activity":
        aq = scope_filter(select(M.Activity), M.Activity, db, ctx, "reports", "view", ("user_id",))
        if p.get("company_id"):
            aq = aq.where(M.Activity.company_id == int(p["company_id"]))
        if p.get("assigned_to_id"):
            aq = aq.where(M.Activity.user_id == int(p["assigned_to_id"]))
        A = aq.subquery()
        names = name_map(db, M.User, [r for r, in db.execute(select(A.c.user_id).distinct())])
        agg = {}
        for u, t, n in db.execute(select(A.c.user_id, A.c.type, func.count()).where(
                A.c.created_at >= start, A.c.created_at <= end).group_by(A.c.user_id, A.c.type)):
            d = agg.setdefault(u, {"name": names.get(u, "System"), "total": 0})
            d[t] = n
            d["total"] += n
        return {"title": REPORTS[key], "rows": sorted(agg.values(), key=lambda d: -d["total"])}
    if key == "document":
        D = _scoped(db, ctx, M.Document, "documents", p, ("uploaded_by",))
        rows = [{"category": c, "status": s, "count": n} for c, s, n in db.execute(
            select(D.c.category, D.c.status, func.count()).where(D.c.deleted_at.is_(None))
            .group_by(D.c.category, D.c.status))]
        shared = db.scalar(select(func.count()).select_from(M.DocumentShare).where(
            M.DocumentShare.created_at >= start, M.DocumentShare.created_at <= end))
        expired = _count(db, D, D.c.expires_at < utcnow(), D.c.deleted_at.is_(None))
        return {"title": REPORTS[key], "rows": rows, "shared": shared, "expired": expired}
    if key == "import-export":
        imp = select(M.ImportJob).where(M.ImportJob.created_at >= start, M.ImportJob.created_at <= end)
        exp = select(M.ExportLog).where(M.ExportLog.created_at >= start, M.ExportLog.created_at <= end)
        cid = ctx.company_id if not ctx.is_global else (int(p["company_id"]) if p.get("company_id") else None)
        if cid:
            imp, exp = imp.where(M.ImportJob.company_id == cid), exp.where(M.ExportLog.company_id == cid)
        imports = list(db.scalars(imp.order_by(M.ImportJob.id.desc())))
        exports = list(db.scalars(exp.order_by(M.ExportLog.id.desc())))
        users = name_map(db, M.User, [i.uploaded_by for i in imports] + [e.user_id for e in exports])
        return {"title": REPORTS[key],
                "imports": [to_dict(i, {"user_name": users.get(i.uploaded_by), "errors": None}) for i in imports],
                "exports": [to_dict(e, {"user_name": users.get(e.user_id)}) for e in exports]}
    raise HTTPException(404, "Unknown report")
