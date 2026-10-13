# AIReceptionNewUI

The runnable UI is the Vite/React SPA in `src`, with static pages in `public`.
The legacy Next.js `app`, `lib` and `middleware.ts` files are not served by Vite
or this image. The two Python directories are separate Azure Functions services;
the UI container connects to them, rather than starting them.

## Run with Docker

From the repository root, with Docker Engine and Compose installed:

```sh
docker compose up --build -d
curl --fail http://localhost:8080/healthz
docker compose logs ui
```

Open http://localhost:8080. SPA deep links are supported, existing public HTML
pages are served directly, and `/api/*` is proxied to the Functions backend.
The default backend is `https://smartconnect4u-func.azurewebsites.net`; meetings
use the dedicated Jitsi Functions app from `.env.example`.

To use another backend, set its origin **without a trailing slash or `/api`**:

```sh
API_UPSTREAM=https://your-functions.azurewebsites.net UI_PORT=8081 docker compose up -d
```

`API_UPSTREAM` is read when the container starts, so changing it only needs a
container recreation. A local backend on a Docker Desktop host can use
`http://host.docker.internal:7071`; `localhost` inside the container refers to
the container itself. Configure that backend to accept the incoming host.

Jitsi URLs and domains are public build settings. Change `VITE_JITSI_API_BASE`
(including `/api`) or `VITE_JITSI_DOMAIN` before `docker compose up --build -d`.
Set `VITE_JITSI_API_BASE=/api` to send meetings to the main proxy instead.

For deployment without Compose:

```sh
docker build -t ai-reception-ui ./AIReceptionNewUI
docker run -d --name ai-reception-ui -p 8080:8080 \
  -e API_UPSTREAM=https://your-functions.azurewebsites.net ai-reception-ui
```

The runtime serves static files through Nginx on port 8080. It includes an
HTTP health check and disables API response buffering for streamed chat/tasks.
Terminate HTTPS at your hosting platform or ingress. Local `.env` files,
dependencies and old build output are excluded from the image build context.
Keep backend credentials in the Functions service; Vite variables are public.

## Local development

```sh
cd AIReceptionNewUI
cp .env.example .env
npm ci
npm run dev -- --host 0.0.0.0
```

Open http://localhost:5173. `VITE_FUNCTION_HOST` selects the Vite proxy target
(default `http://localhost:7071`); the browser uses `/api`. To call a backend
directly, set `VITE_API_PROXY_BASE` to its full API URL and configure backend CORS.
`npm run typecheck` checks the TypeScript components. `npm run build` generates
`dist`; `npm run preview` previews static files only
and does not provide the production Nginx API proxy.

## Verification

The Docker CI workflow builds the image and checks health, SPA routing, static
pages/assets, API path/query forwarding, API errors and unbuffered streams
against a mock backend.
Real login, payments, calling, email and meetings additionally require working
backend services, credentials and data; a frontend build cannot verify them.

Compatible dependency updates were applied during container preparation.
`npm audit` still reports 11 issues (1 critical, 7 high, 3 moderate), including
the legacy Next.js dependency and Vite/Tailwind build tools. Resolving these
requires broader dependency upgrades. Node dependencies are not copied into
the Nginx runtime image, and the Next.js server is not started.
