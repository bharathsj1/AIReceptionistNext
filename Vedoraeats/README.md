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
