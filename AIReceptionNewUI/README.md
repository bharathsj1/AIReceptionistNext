# AIReceptionNewUI

## Local setup without payment

Add `VITE_LOCAL_SKIP_PAYMENT=true` to `.env.development.local` and run Vite with
`BACKEND_UPSTREAM=http://127.0.0.1:7071`. The
currently running local UI is at `http://127.0.0.1:5176`.

Sign in (or create a local account), enter the business name and phone, add the
website, review the crawled details, and select **Save and open dashboard**.
Existing accounts with a completed business profile return directly to the
dashboard. You can also enter details manually if the site cannot be crawled.
Local crawling copies readable website text into the review form without an AI
API key; verify and edit it before saving. A failed crawl or profile save stays
in setup with an error so you can retry.

This option requires Vite development mode, a loopback host and a relative `/api`
proxy. Production builds ignore it. It skips plan selection, Stripe payment,
Ultravox provisioning and Twilio number purchases, and opens the dashboard tools
for local development. It does not create paid subscriptions or bypass login.
Live provider operations retain their server configuration and access checks.
Your local database has its own accounts; production logins are not copied.

Run `npm run test:local-setup` to check the local-only gate and website extraction.

## Interface design

The app uses a light workspace, ink sidebar and teal accents. Shared design
tokens and responsive styles live in `src/redesign.css`. The landing page,
account screens, pricing and service pages share this visual system with the
workspace tools and public pages (`public/public-theme.css`).

Setup has a persistent progress indicator, inline password guidance and a
direct signup entry point. The workspace includes labeled tool navigation,
a mobile drawer, a theme toggle, and a keyboard-accessible tool search (`⌘K`
or `Ctrl+K`). Shared dialogs and CRM drawers trap focus, close with Escape and return focus to the
trigger. Motion respects the reduced-motion preference, and page scrolling is
native. Mobile task calendars start in day view; week and month remain available.

Existing backend routes, payment amounts, authentication, subscription checks,
and provider integrations are retained. No API contract changes are required
for the new layouts. Public `/login` and `/signup` links resolve to the account
screens. Live payment, phone and OAuth operations still need configured providers.

Validation includes TypeScript and production builds, desktop/mobile browser
checks, and isolated review of workspace navigation and onboarding screens.
Temporary review fixtures are not included in the shipped app.

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
