# Vedoraeats

Standalone pre-launch website for **VEDORA** at `vedoraeats.com`.

## Frontend

```bash
npm install
npm run dev
```

The site runs on Vite. Forms post to:

- `POST /api/vedora/waitlist`
- `POST /api/vedora/restaurant-interest`

Set `VITE_API_BASE` if the backend is hosted somewhere other than the local Azure Functions runtime.

## Azure Static Web Apps

Recommended first deployment: create a new GitHub repository containing only this `Vedoraeats` folder, then create an Azure Static Web App from that repository.

Use these Azure build settings if the GitHub repository root is `Vedoraeats`:

```text
App location: /
API location: api
Output location: dist
Build command: npm run build
```

If you deploy from the larger `AIReceptionistNext` monorepo instead, use:

```text
App location: /Vedoraeats
API location: /Vedoraeats/api
Output location: dist
Build command: npm run build
```

The frontend build is pinned to Node 22 in `package.json`. Azure Static Web Apps reads this from the `engines.node` field.

Add these application settings in Azure before relying on the forms:

```text
ALLOWED_ORIGINS=https://vedoraeats.com,https://www.vedoraeats.com
DATABASE_URL=<production database URL>
VEDORA_ADMIN_EMAIL=<lead notification email>
SMTP_HOST=<SMTP server>
SMTP_PORT=587
SMTP_USERNAME=<SMTP username>
SMTP_PASSWORD=<SMTP password>
SMTP_FROM_EMAIL=<from address>
```

## Backend

A minimal Azure Functions backend scaffold lives in `api/`.

```bash
cd api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
func start
```

By default, submissions are stored in local SQLite at `api/data/vedora.db`. Set `DATABASE_URL` for Postgres or another SQLAlchemy-supported database.
