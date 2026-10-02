"""Background loop: follow-up / visit / meeting reminders and overdue escalation to TL/Manager."""
import asyncio
import logging
from datetime import timedelta

from sqlalchemy import select

from ..config import settings
from ..db import M, SessionLocal, utcnow
from .core import get_setting, notify

log = logging.getLogger("crm.scheduler")


def run_once():
    db = SessionLocal()
    now = utcnow()
    try:
        # follow-up reminders
        for fu in db.scalars(select(M.FollowUp).where(
                M.FollowUp.status == "pending", M.FollowUp.reminder_sent_at.is_(None),
                M.FollowUp.due_at <= now + timedelta(minutes=1440), M.FollowUp.due_at >= now - timedelta(hours=2))):
            if fu.due_at - timedelta(minutes=fu.reminder_minutes or 0) > now:
                continue
            rec = db.get(M.Lead, fu.lead_id) if fu.lead_id else db.get(M.Client, fu.client_id)
            name = rec.name if rec else "Follow-up"
            link = f"/leads/{fu.lead_id}" if fu.lead_id else f"/clients/{fu.client_id}"
            notify(db, fu.assigned_to_id, f"Follow-up due: {name}",
                   f"{fu.type.capitalize()} {rec.mobile if rec else ''} at {fu.due_at:%H:%M} UTC\n{fu.notes or ''}",
                   type="followup_reminder", link=link, company_id=fu.company_id)
            fu.reminder_sent_at = now
        # visit / meeting reminders
        for model, owner, label, ntype in ((M.Visit, "agent_id", "Site visit", "visit_reminder"),
                                           (M.Meeting, "host_id", "Meeting", "meeting_reminder")):
            for ev in db.scalars(select(model).where(
                    model.status.in_(["Scheduled", "Confirmed", "Rescheduled"]), model.reminder_sent_at.is_(None),
                    model.scheduled_at >= now, model.scheduled_at <= now + timedelta(days=1))):
                if ev.scheduled_at - timedelta(minutes=ev.reminder_minutes or 0) > now:
                    continue
                rec = db.get(M.Lead, ev.lead_id) if ev.lead_id else (db.get(M.Client, ev.client_id) if ev.client_id else None)
                extra = getattr(ev, "meeting_link", None) or ev.location or ""
                notify(db, getattr(ev, owner), f"{label} at {ev.scheduled_at:%H:%M} UTC",
                       f"{rec.name if rec else ''} {rec.mobile if rec else ''}\n{extra}", type=ntype,
                       link=f"/{label.split()[-1].lower()}s", company_id=ev.company_id)
                ev.reminder_sent_at = now
        # overdue escalation (Settings → escalation: {"enabled": true, "after_hours": 4})
        companies = [c for c, in db.execute(select(M.FollowUp.company_id).where(
            M.FollowUp.status == "pending", M.FollowUp.escalated_at.is_(None), M.FollowUp.due_at < now).distinct())]
        for cid in companies:
            cfg = get_setting(db, cid, "escalation", {"enabled": True, "after_hours": 4}) or {}
            if not cfg.get("enabled", True):
                continue
            cutoff = now - timedelta(hours=float(cfg.get("after_hours", 4)))
            overdue = list(db.scalars(select(M.FollowUp).where(
                M.FollowUp.company_id == cid, M.FollowUp.status == "pending", M.FollowUp.escalated_at.is_(None),
                M.FollowUp.due_at < cutoff).limit(500)))
            by_owner: dict[int, list] = {}
            for fu in overdue:
                by_owner.setdefault(fu.assigned_to_id, []).append(fu)
                fu.escalated_at = now
            for uid, items in by_owner.items():
                user = db.get(M.User, uid)
                boss = user.reports_to_id if user else None
                if not boss and user and user.team_id:
                    team = db.get(M.Team, user.team_id)
                    boss = (team.lead_id if team and team.lead_id != uid else None) or (team.manager_id if team else None)
                if boss:
                    notify(db, boss, f"{len(items)} overdue follow-up(s) – {user.name}",
                           f"{user.name} has {len(items)} follow-up(s) overdue by more than {cfg.get('after_hours', 4)}h.",
                           type="escalation", link=f"/followups?assigned_to_id={uid}&bucket=overdue", company_id=cid)
        db.commit()
    except Exception:  # noqa: BLE001
        log.exception("scheduler tick failed")
        db.rollback()
    finally:
        db.close()


async def loop():
    while True:
        await asyncio.to_thread(run_once)
        await asyncio.sleep(settings.reminder_interval_seconds)

