"""RBAC catalog: module × action × data-scope.

Scopes (widest → narrowest): all > company > team > own > none.
Roles get a row per (module, action) in role_permissions; anything missing = none.
"""

SCOPES = ["none", "own", "team", "company", "all"]
SCOPE_RANK = {s: i for i, s in enumerate(SCOPES)}

ACTIONS = ["view", "add", "edit", "delete", "assign", "import", "export", "download", "share", "approve",
           "convert", "configure"]

MODULES: dict[str, dict] = {
    "dashboard": {"label": "Dashboard", "actions": ["view", "configure"]},
    "leads": {"label": "Leads", "actions": ["view", "add", "edit", "delete", "assign", "import", "export", "convert"]},
    "followups": {"label": "Follow-ups", "actions": ["view", "add", "edit", "delete", "assign"]},
    "clients": {"label": "Clients", "actions": ["view", "add", "edit", "delete", "export", "approve"]},
    "visits": {"label": "Site Visits", "actions": ["view", "add", "edit", "delete", "export"]},
    "meetings": {"label": "Meetings", "actions": ["view", "add", "edit", "delete", "export"]},
    "processes": {"label": "Processes", "actions": ["view", "add", "edit", "delete"]},
    "projects": {"label": "Projects", "actions": ["view", "add", "edit", "delete", "export"]},
    "properties": {"label": "Properties", "actions": ["view", "add", "edit", "delete", "export", "import"]},
    "locations": {"label": "Locations", "actions": ["view", "add", "edit", "delete"]},
    "documents": {"label": "Documents", "actions": ["view", "add", "edit", "delete", "download", "share"]},
    "forms": {"label": "Forms", "actions": ["view", "add", "edit", "delete", "export"]},
    "reports": {"label": "Reports", "actions": ["view", "export"]},
    "imports": {"label": "Import Master", "actions": ["view", "import", "delete"]},
    "exports": {"label": "Export History", "actions": ["view"]},
    "users": {"label": "Users & Teams", "actions": ["view", "add", "edit", "delete"]},
    "roles": {"label": "Roles & Permissions", "actions": ["view", "configure"]},
    "companies": {"label": "Companies", "actions": ["view", "add", "edit", "delete"]},
    "settings": {"label": "Settings & Masters", "actions": ["view", "configure"]},
    "audit": {"label": "Audit Log", "actions": ["view"]},
    "notifications": {"label": "Notifications", "actions": ["view", "configure"]},
}

# Field-level sensitive fields (masked unless the role has <module>.approve or settings.configure)
SENSITIVE_FIELDS = {"clients": ["booking_amount", "deal_value", "payment_plan"]}

SYSTEM_ROLES = [
    {"key": "super_admin", "name": "Super Admin / CRM Owner", "level": 100},
    {"key": "crm_admin", "name": "CRM Admin", "level": 90},
    {"key": "company_admin", "name": "Company Admin / CEO", "level": 80},
    {"key": "manager", "name": "Manager", "level": 60},
    {"key": "team_lead", "name": "Team Lead", "level": 40},
    {"key": "agent", "name": "Sales Agent", "level": 20},
]

_SALES = ["leads", "followups", "clients", "visits", "meetings"]
_CATALOG = ["processes", "projects", "properties", "locations"]


def default_matrix(role_key: str) -> dict[tuple[str, str], str]:
    """Initial permission matrix per system role. Editable afterwards from Roles & Permissions."""
    m: dict[tuple[str, str], str] = {}

    def grant(module, actions, scope):
        for a in actions:
            if a in MODULES[module]["actions"]:
                m[(module, a)] = scope

    if role_key == "super_admin":
        for mod, meta in MODULES.items():
            grant(mod, meta["actions"], "all")
    elif role_key == "crm_admin":
        for mod, meta in MODULES.items():
            grant(mod, meta["actions"], "all")
        grant("companies", ["delete"], "none")
    elif role_key == "company_admin":
        for mod, meta in MODULES.items():
            if mod != "companies":
                grant(mod, meta["actions"], "company")
        grant("companies", ["view", "edit"], "company")
    elif role_key == "manager":
        grant("dashboard", ["view", "configure"], "team")
        for mod in _SALES:
            grant(mod, MODULES[mod]["actions"], "team")
        for mod in _CATALOG:
            grant(mod, ["view", "add", "edit", "export"], "company")
        grant("documents", ["view", "add", "edit", "download", "share"], "company")
        grant("forms", ["view", "add", "edit", "export"], "company")
        grant("reports", ["view", "export"], "team")
        grant("imports", ["view", "import"], "team")
        grant("exports", ["view"], "own")
        grant("users", ["view"], "team")
        grant("notifications", ["view"], "own")
        grant("settings", ["view"], "company")
    elif role_key == "team_lead":
        grant("dashboard", ["view", "configure"], "team")
        for mod in _SALES:
            grant(mod, ["view", "add", "edit", "assign", "convert", "export"], "team")
        for mod in _CATALOG:
            grant(mod, ["view"], "company")
        grant("documents", ["view", "download", "share"], "company")
        grant("forms", ["view"], "company")
        grant("reports", ["view"], "team")
        grant("imports", ["view", "import"], "own")
        grant("exports", ["view"], "own")
        grant("users", ["view"], "team")
        grant("notifications", ["view"], "own")
    else:  # agent
        grant("dashboard", ["view", "configure"], "own")
        for mod in _SALES:
            grant(mod, ["view", "add", "edit", "convert"], "own")
        for mod in _CATALOG:
            grant(mod, ["view"], "company")
        grant("documents", ["view", "download", "share"], "company")
        grant("documents", ["add"], "own")
        grant("reports", ["view"], "own")
        grant("notifications", ["view"], "own")
    return m
