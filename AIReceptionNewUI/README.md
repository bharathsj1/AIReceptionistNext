# Vedora Outreach UI

The app is a dedicated company cold-calling workspace. The former receptionist,
mail, social, tasks, and CRM modules are no longer part of the active interface.

## Company setup

Run `npm run dev -- --host 127.0.0.1` with
`BACKEND_UPSTREAM=http://127.0.0.1:7071` to use the local backend.
Sign in or create an account, add company details, enter a website or a manual
brief, review the information, and save to open the dashboard. This direct setup
applies to development and Docker builds; it does not open a payment flow or
provision a receptionist. Website review uses the crawler's source text and
requires no additional AI provider. Login and backend authorization still apply.

## Calling workspace

- **Overview:** aggregate campaign, attempted-call, interest, and handoff counts.
- **Campaigns:** search and filter campaigns, inspect the brief and imported
  contacts, and start, pause, or resume calling.
- **Contacts:** campaign-scoped calling lists with search and status filters.
- **Call history:** all account-owned calls across campaigns, with search, campaign,
  date, call-status and owner-response filters, pagination and CSV page export.
  Desktop tables become contact cards on phones. Each call opens a transcript,
  summary/details and activity timeline. Spoken turns have AI/contact labels and
  available time offsets, search highlighting and plain-text transcript download.
  Partial, missing and unavailable transcripts are explicitly distinguished.
- **Interested leads:** captured owner details, follow-up permissions, callback
  preferences, notification state, and CSV export of the filtered view.
- **Calling setup:** company profile, assigned caller IDs, and provider settings
  readiness. Credentials remain on the backend; configured settings do not
  establish that a provider is reachable.

The new-campaign dialog collects the pitch, a UTF-8 CSV (up to 2 MB), caller ID,
team notification address, and weekday London calling hours. Importing creates
an inactive draft for review. Calling starts only after the explicit start action
and the existing backend checks. Automated interested-owner notifications remain
part of campaign handoff; there is no standalone mail interface.

Conversation text is fetched through authenticated outreach routes and saved in
SQLite on the backend's persistent Docker volume. The background worker fetches
transcripts without the browser open; opening an older call also requests a
backfill. History refreshes with the workspace; an open unfinished conversation
checks for updates every 30 seconds. A summary is never substituted for a missing
transcript. Older provider messages can only be recovered while Ultravox still
has them. Detailed event timelines start with the new logging implementation.

`src/screens/CallingWorkspace.css` owns the responsive workspace styles.
`OutreachLanding.css` styles the calling-focused landing page. Account and
company setup screens retain shared styles in `src/redesign.css`. Navigation,
CSV input, dialogs, filters, and exports work without third-party UI services.
Temporary browser fixtures are excluded from the shipped application.

Run `npm test`, `npm run typecheck`, and `npm run build` for existing automated
checks. Provider credentials and assigned calling numbers are required for live
calls; UI verification does not require placing calls or sending notifications.

The runnable UI is the Vite/React SPA in `src`, with static pages in `public`.
The legacy Next.js `app`, `lib` and `middleware.ts` files are not served by Vite
or this image. The two Python services run in Docker containers alongside
Nginx, SQLite and Azurite storage. The default stack does not use cloud API or
storage hosts.

## Run with Docker

From the repository root:

```sh
python3 scripts/configure_docker.py
docker compose up --build -d
curl --fail http://localhost:8080/api/health
docker compose logs backend meetings
```

Open http://localhost:8080. Compose starts Nginx, the backend, the meetings
service and Azurite. `/api/meetings` and its subpaths go to `meetings:80`;
other `/api/*` requests go to `backend:80`. Browser requests always use `/api`
on the current origin. Legacy public API and fallback-host environment variables
are ignored. No static Azure routing configuration or Azure deployment workflows
remain. `compose.backend.yaml` and `compose.local.yaml` are compatibility overlays;
they are no longer necessary.

`configure_docker.py` creates `.env.docker` and fills missing session-signing,
social-token encryption and outreach-tool secrets without printing or rotating
existing values. Retain that file across deployments. The backend refuses to
start without `AUTH_SESSION_SECRET` in Docker. Old sessions without a token,
expired sessions, or sessions rejected by the backend require a fresh sign-in;
the app does not authenticate an account from a cached email alone.

Before deploying behind HTTPS, set `PUBLIC_APP_URL` and `API_PUBLIC_BASE_URL`
in `.env.docker` to your public origin (without `/api`), for example
`https://aireceptionist.vedoraeats.com`. Set `ALLOWED_ORIGINS` to the UI origin.
Add provider credentials there as needed. Recreate containers after changes.
Keep backend secrets out of Vite settings.

Compose fixes the SQL database to `sqlite:////data/app.db`, overriding copied
remote database URLs. SQLite/uploads persist in `backend-data`; Blob/Table/Queue data persists in
`azurite-data`. Storage ports are not published, and backend/meetings host ports
bind to loopback only. Existing cloud data is not automatically copied: import
it into the Docker data stores before switching a populated deployment. Keep
backups and existing encryption keys; `docker compose down` retains data, while
`down --volumes` deletes it. Azurite implements the storage API locally; it does
not make the application use Azure cloud storage. The Python container runtime
remains the Functions runtime.

Public photos/social uploads are served through a read-only backend media route,
not through a public Azurite port. Private meeting audio is not exposed there.

`VITE_JITSI_DOMAIN` selects the video UI host (default `meet.jit.si`) at build
time. It is separate from the Docker meetings API. Nginx serves the SPA and static
assets, supports deep links and forwards streams without buffering. Terminate
HTTPS at your ingress. Local environment files and old builds are excluded from
image build contexts.

## Local development

```sh
cd AIReceptionNewUI
cp .env.example .env
npm ci
npm run dev -- --host 0.0.0.0
```

Open http://localhost:5173. `BACKEND_UPSTREAM` selects the server-side Vite
proxy target (default `http://127.0.0.1:7071`); `MEETINGS_UPSTREAM` defaults to
`http://127.0.0.1:7072`. The browser always uses the same-origin `/api` routes.
`npm run typecheck` checks the TypeScript components. `npm run build` generates
`dist`; `npm run preview` previews static files only
and does not provide the production Nginx API proxy.

## Verification

The Docker CI workflow builds the image and checks health, SPA routing, static
pages/assets, API path/query forwarding, API errors and unbuffered streams
against isolated backend and meetings mocks. `npm test` checks same-origin API
routes, session expiry and local onboarding.
Real login, payments, calling, email and meetings additionally require working
backend services, credentials and data; a frontend build cannot verify them.

Compatible dependency updates were applied during container preparation.
`npm audit` still reports 11 issues (1 critical, 7 high, 3 moderate), including
the legacy Next.js dependency and Vite/Tailwind build tools. Resolving these
requires broader dependency upgrades. Node dependencies are not copied into
the Nginx runtime image, and the Next.js server is not started.
