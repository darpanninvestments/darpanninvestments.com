"""Idempotent seed: system roles + permissions, super admin, default company and masters.
Run:  .venv/bin/python seed.py            (safe to re-run)
      .venv/bin/python seed.py --reset-permissions   (re-apply default matrix to system roles)"""
import sys

from sqlalchemy import delete, select

from app.config import settings
from app.db import M, SessionLocal, init_models
from app.permissions import SYSTEM_ROLES, default_matrix
from app.security import hash_password

init_models()
db = SessionLocal()
RESET = "--reset-permissions" in sys.argv


def get_or_create(model, where: dict, **values):
    q = select(model)
    for k, v in where.items():
        q = q.where(getattr(model, k).is_(None) if v is None else getattr(model, k) == v)
    obj = db.scalar(q)
    if obj:
        return obj, False
    obj = model(**where, **values)
    db.add(obj)
    db.flush()
    return obj, True


# ── Roles & permission matrix ──────────────────────────────────────────────────
roles = {}
for r in SYSTEM_ROLES:
    role, created = get_or_create(M.Role, {"key": r["key"], "company_id": None}, name=r["name"], level=r["level"],
                                  is_system=True)
    roles[r["key"]] = role
    if created or RESET:
        db.execute(delete(M.RolePermission).where(M.RolePermission.role_id == role.id))
        for (module, action), scope in default_matrix(r["key"]).items():
            db.add(M.RolePermission(role_id=role.id, module=module, action=action, scope=scope))
print("roles ok")

# ── Default company ────────────────────────────────────────────────────────────
company, _ = get_or_create(M.Company, {"code": "DARPANN"}, name="Darpann Investments",
                           email="darpanninvestmentsindia@gmail.com", timezone="Asia/Kolkata", currency="INR")

# ── Super admin ────────────────────────────────────────────────────────────────
email = settings.seed_admin_email.strip().lower()
if email and settings.seed_admin_password:
    admin = db.scalar(select(M.User).where(M.User.email == email))
    if not admin:
        db.add(M.User(name="Super Admin", email=email, role_id=roles["super_admin"].id, company_id=None,
                      password_hash=hash_password(settings.seed_admin_password), designation="CRM Owner"))
        print(f"super admin created: {email}")
    else:
        print(f"super admin exists: {email}")

# ── Lead statuses (from the Lead_Statuses master in the requirements) ──────────
STATUSES = [
    ("Fresh Lead", "#3B82F6", "open", False, ["Not Assigned", "Assigned", "Number unavailable"]),
    ("Fresh", "#4CAF50", "open", False, ["Newly assigned leads", "No statuses"]),
    ("Invalid Number", "#EF4444", "invalid", False, ["Wrong Number", "Incomplete number"]),
    ("Contacted", "#8B5CF6", "open", False, ["Postponed", "Call back", "Switched Off", "Not Answered",
                                              "Attempted to Contact", "Busy", "Call Waiting", "Voice Mail"]),
    ("Interested", "#EC4899", "open", False, ["Postponed", "Site Visit Done", "Site Visit Scheduled", "Meeting Done",
                                               "Meeting Scheduled", "Negotiation", "Followup",
                                               "In Touch with another RM", "Raw Land"]),
    ("Other Property Interested", "#059669", "open", False, ["Other City Location", "Another Property",
                                                              "Dwarka Expressway", "Golf Course Extn Road",
                                                              "Golf Course Road"]),
    ("Not Interested", "#EF4444", "lost", True, ["Lost to Competitor", "Budget Issue", "Postponed",
                                                  "Hot to Not Interested", "False Query",
                                                  "Taken in Another Property/Location", "Planned Dropped"]),
    ("Converted", "#059669", "won", False, ["Booking Done", "Booking Created"]),
]
AUTO_FU = {"Contacted": 24, "Interested": 48, "Other Property Interested": 72}
for i, (name, color, cat, reason, subs) in enumerate(STATUSES, start=1):
    st, created = get_or_create(M.LeadStatus, {"name": name, "company_id": None}, color=color, sort_order=i,
                                category=cat, requires_reason=reason, auto_followup_hours=AUTO_FU.get(name))
    if created:
        for j, s in enumerate(subs):
            db.add(M.LeadSubStatus(status_id=st.id, name=s, sort_order=j))
print("statuses ok")

for name, code, color in [("Meta Ads / Facebook Ads", "meta", "#1877F2"), ("Google Ads", "google", "#EA4335"),
                          ("Website", "website", "#0EA5E9"), ("Meta WhatsApp", "whatsapp", "#25D366"),
                          ("Manual Entry", "manual", "#64748B"), ("CSV/Excel Import", "import", "#A855F7"),
                          ("Referral", "referral", "#F59E0B"), ("Partner / Channel Partner", "partner", "#14B8A6"),
                          ("Walk-in", "walkin", "#84CC16"), ("Calling Campaign", "calling", "#F97316"),
                          ("Other", "other", "#94A3B8")]:
    get_or_create(M.LeadSource, {"name": name, "company_id": None}, code=code, color=color)

LOOKUPS = {
    "property_type": ["Villa", "Plot", "Farmhouse", "Apartment", "Commercial", "Land"],
    "purpose": ["Investment", "End-use", "Rental", "Other"],
    "priority": ["Hot", "Warm", "Cold"],
    "loss_reason": ["Lost to Competitor", "Budget Issue", "Location Mismatch", "Postponed Plan", "False Query",
                    "Not Reachable", "Bought Elsewhere"],
    "document_category": ["Brochure", "Price List", "Floor Plan", "Map", "Approval", "Agreement", "Images", "KYC",
                          "Booking", "Payment", "Identity", "Address Proof", "General"],
    "client_stage": ["Onboarding Pending", "Onboarding In Progress", "Documents Pending", "Active Client",
                     "Closed / Completed"],
    "process_type": ["Sales", "Farmhouse Sales", "Villa Sales", "Plot Sales", "Resale", "Rental", "Commercial"],
    "project_status": ["Upcoming", "Pre-Launch", "Active", "Ready to Move", "Sold Out", "On Hold"],
    "visit_status": ["Scheduled", "Confirmed", "Rescheduled", "Completed", "Cancelled", "No Show"],
    "meeting_status": ["Scheduled", "Confirmed", "Rescheduled", "Completed", "Cancelled", "No Show"],
    "meeting_type": ["Introduction", "Presentation", "Negotiation", "Documentation", "Closure", "Other"],
    "followup_outcome": ["Completed", "No Answer", "Busy", "Call Back", "Rescheduled", "Not Required"],
    "activity_type": ["Call", "WhatsApp", "SMS", "Email", "Note"],
    "facing": ["North", "South", "East", "West", "North-East", "North-West", "South-East", "South-West"],
}
for t, names in LOOKUPS.items():
    for i, n in enumerate(names):
        get_or_create(M.Lookup, {"type": t, "name": n, "company_id": None}, sort_order=i)
print("lookups ok")

# ── Locations ──────────────────────────────────────────────────────────────────
india, _ = get_or_create(M.Country, {"name": "India"}, iso_code="IN")
LOC = {"Haryana": {"Gurugram": ["Golf Course Road", "Golf Course Extension Road", "Dwarka Expressway",
                                "Sohna Road", "New Gurugram", "Southern Peripheral Road"]},
       "Delhi": {"New Delhi": ["South Delhi", "Dwarka", "Chhatarpur"]},
       "Uttar Pradesh": {"Noida": ["Noida Expressway"]},
       "Maharashtra": {"Sindhudurg": ["Kudal"], "Mumbai": []},
       "Rajasthan": {"Jaipur": []}, "Uttarakhand": {"Dehradun": []}}
for sname, cities in LOC.items():
    st, _ = get_or_create(M.State, {"name": sname, "country_id": india.id})
    for cname, areas in cities.items():
        c, _ = get_or_create(M.City, {"name": cname, "state_id": st.id})
        for a in areas:
            get_or_create(M.Area, {"name": a, "city_id": c.id}, tags=a)
print("locations ok")

# ── Processes & starter projects ───────────────────────────────────────────────
sales, _ = get_or_create(M.Process, {"name": "Sales", "company_id": company.id}, type="Sales",
                         description="Primary residential sales")
farm, _ = get_or_create(M.Process, {"name": "Farmhouse Sales", "company_id": company.id}, type="Farmhouse Sales")
kudal_city = db.scalar(select(M.City).where(M.City.name == "Sindhudurg"))
get_or_create(M.Project, {"name": "Kudal", "company_id": company.id}, process_id=sales.id, code="KUDAL",
              status="Active", country_id=india.id, city_id=kudal_city.id if kudal_city else None)
get_or_create(M.Project, {"name": "Naugaon Farmhouse", "company_id": company.id}, process_id=farm.id,
              code="NAUGAON", status="Active", country_id=india.id)

# ── Message templates ──────────────────────────────────────────────────────────
TEMPLATES = [
    ("whatsapp", "Introduction", None,
     "Hello {name}, this is {agent} from Darpann Investments. Thank you for your interest in {project}. "
     "When would be a good time to talk?"),
    ("whatsapp", "Site visit confirmation", None,
     "Hi {name}, your site visit to {project} is confirmed. Our team looks forward to meeting you!"),
    ("whatsapp", "Follow-up", None, "Hi {name}, just following up on your property requirement. "
                                    "Can we schedule a quick call?"),
    ("email", "Project details", "Project details – {project}",
     "Dear {name},\n\nThank you for your interest in {project}. Please find the details attached.\n\n"
     "Regards,\n{agent}\nDarpann Investments"),
]
for ch, name, subj, body in TEMPLATES:
    get_or_create(M.MessageTemplate, {"name": name, "channel": ch, "company_id": None}, subject=subj, body=body)

# ── Client onboarding form template ────────────────────────────────────────────
get_or_create(M.Form, {"slug": "client-onboarding"}, company_id=company.id, name="Client Onboarding",
              form_type="client_onboarding", destination="client",
              description="Please complete your details so we can process your booking.",
              success_message="Thank you! Your details have been received.", fields=[
                  {"key": "s1", "type": "section", "label": "Personal details"},
                  {"key": "name", "type": "text", "label": "Full name", "required": True, "map_to": "name"},
                  {"key": "mobile", "type": "tel", "label": "Mobile", "required": True, "map_to": "mobile"},
                  {"key": "email", "type": "email", "label": "Email", "required": True, "map_to": "email"},
                  {"key": "dob", "type": "date", "label": "Date of birth"},
                  {"key": "address", "type": "textarea", "label": "Address", "required": True, "map_to": "address"},
                  {"key": "city", "type": "text", "label": "City", "map_to": "city"},
                  {"key": "s2", "type": "section", "label": "KYC documents"},
                  {"key": "pan_no", "type": "text", "label": "PAN number", "required": True},
                  {"key": "pan", "type": "file", "label": "PAN Card", "required": True, "category": "KYC"},
                  {"key": "aadhaar", "type": "file", "label": "Aadhaar Card", "required": True, "category": "KYC"},
                  {"key": "s3", "type": "section", "label": "Declaration"},
                  {"key": "consent", "type": "checkbox", "label": "I confirm the information provided is correct",
                   "required": True},
                  {"key": "signature", "type": "signature", "label": "Signature", "required": True},
              ])
get_or_create(M.Form, {"slug": "enquiry"}, company_id=company.id, name="Website Enquiry", form_type="enquiry",
              destination="lead", success_message="Thank you! Our property expert will call you shortly.",
              source_id=db.scalar(select(M.LeadSource.id).where(M.LeadSource.code == "website")), fields=[
                  {"key": "name", "type": "text", "label": "Your name", "required": True},
                  {"key": "mobile", "type": "tel", "label": "Mobile number", "required": True},
                  {"key": "email", "type": "email", "label": "Email"},
                  {"key": "property_type", "type": "select", "label": "Looking for",
                   "options": ["Villa", "Plot", "Farmhouse", "Apartment", "Commercial"]},
                  {"key": "budget_max", "type": "number", "label": "Budget (₹)"},
                  {"key": "requirement", "type": "textarea", "label": "Your requirement"},
              ])

# ── Default settings ───────────────────────────────────────────────────────────
for key, value in {"assignment_rules": {"mode": "round_robin", "user_ids": [], "rules": []},
                   "duplicate_rules": {"mobile": True, "email": True},
                   "followup": {"default_reminder_minutes": 15, "retry_hours": 2},
                   "escalation": {"enabled": True, "after_hours": 4}}.items():
    get_or_create(M.Setting, {"company_id": None, "key": key}, value=value)

db.commit()
print("seed complete")
