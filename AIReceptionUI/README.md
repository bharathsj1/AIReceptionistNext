# AI Receptionist Landing Page

A single-page marketing site for the AI Receptionist product. It highlights capabilities, pricing, FAQs, and a contact form to request demos.

## Getting started

1. Install dependencies for the optional Python backend:
   ```bash
   pip install -r requirements.txt
   ```
2. Start the Flask server (accepts demo requests at `/api/demo-requests` and writes them to `data/demo_leads.json`):
   ```bash
   python app.py
   ```
3. In a separate terminal, serve the front-end for same-origin requests:
   ```bash
   cd frontend
   python -m http.server 5500
   ```
   Then visit `http://localhost:5500/` (or open `frontend/index.html` directly).
   
   If you only want to view the static site without submitting the form, you can still just open `frontend/index.html` directly in the browser.

## Structure
- `frontend/` – all static assets:
  - `index.html` – page content and layout.
  - `styles.css` – global theme, layout, and responsive styles.
  - `script.js` – smooth scrolling and demo form interaction.
- `backend/` – backend dependencies and utilities.
- `app.py` – minimal Flask server for demo requests (optional).

## Backend local database
Use the Flask app factory at `backend/main.py` with SQLite by default (stored at `backend/app/dev.db`).

1) Create a virtualenv and install dependencies
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
```
2) Export the Flask entrypoint (uses `create_app()`)
```bash
export FLASK_APP=backend/main.py
```
3) Initialize and run migrations
```bash
flask db init    # first time only
flask db migrate -m "init"
flask db upgrade
```
4) Run the backend locally
```bash
python backend/main.py  # runs on http://localhost:5001
```

Config:
- Database URL: set `DATABASE_URL` (defaults to SQLite dev file)
- Reset local DB: remove `backend/app/dev.db` and re-run migrations

## Scrape-once crawler (backend)
Build a single text knowledge base from a small marketing site for AI/Vapi use.

```bash
pip install -r backend/requirements.txt
python backend/scrape_once.py --url https://example.com --max-pages 50
```

- Output: `backend/data/website_knowledge.txt` (one entry per page with URL, TITLE, CONTENT).
- Behavior: follows only same-domain links, skips mailto/tel/javascript/# anchors, limits pages via `--max-pages` (default 50), strips script/style/nav/header/footer/aside tags, and ignores non-HTML responses with basic handling for timeouts and 4xx/5xx.
- Notes: robots.txt is not enforced; ensure you have permission to scrape target sites.

## Customization tips
- Update the hero copy, feature bullets, and pricing text in `index.html` to match your offering.
- Adjust colors and spacing in `styles.css` by changing the CSS variables at the top of the file.
- Replace the form submission handler in `script.js` with a real endpoint to capture leads.
