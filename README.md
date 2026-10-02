# Darpann Investments – Real Estate CRM

Multi-company real-estate CRM: leads → follow-ups → visits/meetings → booking → client onboarding,
with projects, inventory, documents, forms, imports/exports, reports, notifications and full RBAC.

| Layer | Tech |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, Tailwind v4, TanStack Query, Recharts |
| API | Python 3.12+ · FastAPI · SQLAlchemy 2 (reflects the Prisma-managed tables) |
| Database | TiDB Cloud (MySQL-compatible) · schema owned by **Prisma** |
| Email | Gmail SMTP (app password) – password-reset OTPs, welcome mails, reminders, lead emails |

```
database/   prisma/schema.prisma  ← single source of truth for tables
backend/    FastAPI app (app/), seed.py
frontend/   Next.js app (src/app/(app) = signed-in pages, src/app/f/[slug] = public forms)
.env        secrets (git-ignored) – see .env.example
```

## First-time setup

```bash
# 1. Database schema → TiDB
cd database && npm install && npm run db:push

# 2. API
cd ../backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python seed.py                     # roles, permissions, super admin, masters (idempotent)
.venv/bin/uvicorn app.main:app --port 8000 --reload --reload-dir app

# 3. Web
cd ../frontend && npm install && npm run dev  # http://localhost:3000
```

The browser only talks to Next.js; `/api/*` is rewritten to FastAPI (`BACKEND_URL`, default
`http://127.0.0.1:8000`), so the httpOnly session cookie is first-party. API docs: `http://localhost:8000/api/docs`.

## Changing the schema
Edit `database/prisma/schema.prisma` → `npm run db:push` (from `database/`) → restart the API.
SQLAlchemy reflects tables at startup, so no Python model changes are needed for new columns.

## Sign-in & security
* **Passwordless:** users sign in with a 6-digit code emailed via Gmail SMTP (`PASSWORD_LOGIN_ENABLED=false`, the default).
  Codes expire in 10 minutes, are single-use, allow 5 tries, and only work in the browser that requested them.
* New-device sign-ins trigger an alert email; sessions end after `SESSION_IDLE_MINUTES` (default 240) of inactivity.
* Rate limits: 3 codes per account / 15 min, 60 per IP / hour, 20 code checks per IP / 10 min (in-process – use Redis
  if you run several API instances).
* **Emergency access** (email outage): `cd backend && .venv/bin/python login_code.py user@company.com` prints a
  10-minute code; enter the email on the login page, click "Email me a code", then type the printed code. It is audit-logged.
* CSRF origin check, CSP / anti-clickjacking headers, sandboxed file downloads, HTML-escaped emails and
  formula-safe Excel/CSV exports are built in. Set `ENVIRONMENT=production` in production (hides API docs, HSTS, secure cookies).

## Roles & access
System roles (editable in **Roles & Permissions**): Super Admin › CRM Admin › Company Admin › Manager › Team Lead › Agent.
Each role has, per module and action, a data scope: `all › company › team › own › none`.
"Team" = the user, everyone reporting to them (recursively) and members of teams they lead/manage.
Re-apply defaults for system roles: `.venv/bin/python seed.py --reset-permissions`.

## Integrations
* **Incoming leads webhook** – `POST /api/public/leads` with header `X-API-Key` (generate in Settings → Integrations).
  Body: one object or an array `{name, mobile, email, source, project, campaign, external_id, …}`; idempotent on `external_id`.
  Point Meta Lead Ads / Google Ads lead forms (via Zapier/Make/your server) at this endpoint.
* **Website forms** – build in Forms, share the hosted link / QR, or embed the iframe snippet.
* **WhatsApp** – one-click WhatsApp uses `wa.me` deep links with templates and is logged on the timeline.
  Per-user QR (WhatsApp-Web style) sessions are Phase 2 and need a separate session service.
* **Reminders/escalations** – a background loop in the API sends in-app + email reminders for follow-ups,
  visits and meetings, and escalates overdue follow-ups to the TL/manager (Settings → Automation).

## Production notes
* Set `COOKIE_SECURE=true`, a long random `JWT_SECRET`, and `APP_URL` to the public URL.
* Run the API with several workers behind a reverse proxy; keep **one** instance running the reminder loop
  (or move it to a scheduled job). Uploaded files live in `backend/uploads/` – mount persistent storage or move to S3.
* Rotate the database password and Gmail app password if they have ever been shared in plain text.
