# AI Receptionist Functions

## VedoraEats AI outreach

Dashboard -> **AI outreach** imports a UTF-8 restaurant CSV, creates a reviewable
draft, and starts sequential Twilio calls connected to Ultravox conversations.
Enter verified VedoraEats benefits and your team's notification email in the
campaign form. The agent identifies itself as an AI assistant, asks for the owner,
explains those benefits, and collects interest, owner name, email, preferred
callback time, and explicit permission for team follow-up. It does not invent
product benefits, prices or savings. Campaign settings are fixed after import;
create a new draft to change the offer, recipient or calling hours.

Calls run in CSV order, at most one active call **per campaign**, on weekdays in
the selected Europe/London window (default 10:00–17:00, automatically handling
BST/GMT). The durable Functions timer runs each minute, so keep the backend and
its runtime storage running; the browser can close. Each attempt rings for up to
30 seconds and is limited to 10 minutes. Pause stops new calls and allows an
active conversation to finish. Unanswered/busy/failed calls are not redialled.
Callback requests are collected for the human team, not automatically scheduled.

### CSV format

Download the header-only template from the dashboard. Required columns:

| Column | Meaning |
| --- | --- |
| `phone` | UK landline/mobile in `020…`, `07…`, `+44…` or `0044…` format |
| `restaurant_name` | Restaurant being contacted |
| `automated_call_consent` | `yes`, `true` or `1` only where specific consent was obtained |
| `consent_evidence` | Record of when/how the subscriber consented to VedoraEats automated marketing calls |

Optional columns include `owner_name`, `email`, `city` and additional business
details. Quoted cells and UTF-8 BOMs are supported. Limits: 2 MB, 5,000 rows,
30 columns and 2,000 characters per cell. Invalid rows and duplicate normalized
numbers are reported during import. Non-UK numbers, premium-rate, personal
numbering and pager destinations are excluded, including Crown Dependency
numbers sharing +44. Valid contacts without consent evidence remain visible as
skipped. CSV owner details are context; the agent must confirm contact details.

UK automated marketing calls require prior consent specifically covering the
organisation and automated calls, including calls to businesses. General
marketing or live-call consent is insufficient. See [ICO guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/direct-marketing-guidance/plan-direct-marketing/).
The CSV records operator-supplied evidence; this feature does not independently
verify that consent. Opt-outs are stored per account and suppress that number in
all its current and future campaigns. Importing it again cannot clear an opt-out.

### Server configuration

- `AUTH_SESSION_SECRET` (or an existing supported session-secret setting): signed
  login sessions. Campaign APIs require a valid owner/manager session; supplying
  an email address alone is insufficient. Added client users cannot manage campaigns.
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`: existing Twilio account with voice
  geographic permissions for the UK; trial-account destination restrictions still apply.
- An active tenant-owned caller ID in `phone_numbers` or `caller_numbers`. It must
  also be a voice-capable Twilio number or verified outgoing caller ID in that account.
- `ULTRAVOX_API_KEY`: existing Ultravox API key. Optional `ULTRAVOX_BASE_URL`
  defaults to `https://api.ultravox.ai/api`; optional `OUTREACH_ULTRAVOX_VOICE`
  selects a voice ID. Calls use the direct create-call API with a dedicated prompt;
  existing inbound receptionist agents are unaffected.
- `OUTREACH_TOOL_SECRET`: separate random secret for per-contact HMAC tool
  authentication. Generate a strong random value and retain it while calls are active.
- `SENDGRID_API_KEY`, `FROM_EMAIL`: SendGrid mail-send credentials and a verified
  sender identity. Email is never reported as sent when credentials are missing.
- `API_PUBLIC_BASE_URL`: public HTTPS origin **without `/api`**, reachable from
  Twilio and Ultravox, for example `https://api.example.com`. Localhost does not
  work for live callbacks; use a development tunnel and set its HTTPS origin.
- `AzureWebJobsStorage`, `DATABASE_URL`: existing runtime storage and persistent
  SQL database. `init_db()` automatically creates the three new outreach tables.

No provider dashboard webhook registration is necessary: each Twilio call
includes its signed status callback, and each Ultravox conversation includes a
temporary `save_outreach_result` tool secured by a contact-specific header.
Twilio signatures are always validated on the outreach callback, including behind
an ingress; `TWILIO_VALIDATE_SIGNATURE=false` does not bypass this check.
Provider credentials are never returned to the frontend.

### Results and delivery

Owner outcomes are `interested`, `not_interested`, `callback_requested`,
`owner_unavailable`, `wrong_number` and `do_not_call`. Completed calls without a
tool result are labelled as missing a structured result; interest is never guessed.
Only an `interested` outcome with explicit follow-up permission queues a team
email. Email waits for call completion, includes the confirmed details, summary,
callback request and provider references, and has a durable delivery state.
The UI's email count means SendGrid accepted the request, not inbox delivery.
Rate-limit rejections retry with backoff; other definitive email rejections show
`failed`. Network/5xx uncertainty shows `needs_review` to avoid duplicate email.
Check SendGrid activity before manually following up on failed/uncertain emails.

A call-creation timeout or interrupted attempt pauses the campaign and marks the
contact `needs_review`; the worker never retries an uncertain paid call. Check
Twilio logs, then use the contact's **Resolve call review** form to supply the
matching completed Call SID, or confirm there is no active call and skip that
contact. A verified active call cannot be resolved prematurely. Resume the
campaign after reviewing all uncertain contacts. Missed status callbacks for
known call IDs are reconciled by polling Twilio. Duplicate/out-of-order callbacks
cannot regress a terminal call. Duplicate tool delivery cannot resend an accepted email.

### API and validation

- `GET /api/outreach/config`
- `GET|POST /api/outreach/campaigns` (POST: `name`, `benefits`,
  `notification_email`, `caller_id`, `csv_text`, optional `start_hour`, `end_hour`, `voice`)
- `GET|POST /api/outreach/campaigns/{id}` (POST: `action: start|pause`)
- `POST /api/outreach/leads/{id}/review` (owner session; matching `call_sid` or
  `confirmed_no_active_call: true`)
- `POST /api/outreach/leads/{id}/status` (Twilio signature)
- `POST /api/outreach/leads/{id}/result` (per-contact `X-Outreach-Token`)

The campaign UI uses the existing login bearer token. Data and caller IDs are
scoped to the resolved account, and another account's campaign/contact returns 404.

Run `DATABASE_URL=sqlite:///:memory: python -m unittest discover -s tests -v` from
this directory, and `npm run build` / `npm run typecheck` from `AIReceptionNewUI`.
The outreach tests use isolated SQLite databases and simulated providers; they do
not call phone numbers or send email. Before production, run one consenting test
contact through a configured public HTTPS deployment and confirm conversation,
opt-out handling, callback status and actual email receipt.

## Docker deployment

This service now has a Docker image using Microsoft's Azure Functions v4 Python
3.11 runtime. It runs the existing HTTP routes and timer jobs on Docker hosts;
an Azure Functions hosting resource is not required. The application still uses
Azure Storage APIs and its existing database/integration providers.

### Run the UI and backend locally

From the repository root, with Docker Engine and Compose installed:

```sh
cp ai-receptionist-func/.env.docker.example .env.docker
docker compose -f compose.yaml -f compose.backend.yaml -f compose.local.yaml up --build -d
curl --fail http://localhost:7071/api/health
curl --fail http://localhost:8080/api/health
docker compose -f compose.yaml -f compose.backend.yaml -f compose.local.yaml logs backend
```

Open http://localhost:8080. Nginx forwards `/api/*` to the backend container.
The local overlay supplies Azurite Blob/Queue/Table storage and a persistent
SQLite database; no cloud credentials are required to start and check health.
Integration features need their own provider settings. Meetings still use the
existing separate Jitsi service; that service is not included in this backend.

SQLite and local uploads persist in `backend-data`; emulator data persists in
`azurite-data`. Stop with the same three `-f` options followed by `down`.
The Functions image uses `linux/amd64`; Apple Silicon requires emulation.
The backend port is bound to localhost, and emulator ports are not published.

### Deploy with real services

Copy the example to `.env.docker`, then supply these settings there or through
your hosting platform's secret/environment settings:

- `AzureWebJobsStorage`: runtime storage connection string for scheduled jobs
  and host coordination. Use a separate development account when testing.
- `AZURE_STORAGE_CONNECTION_STRING`: application Blob/Table storage connection
  string for CRM, chat, tasks, routing and media; it can use the same account.
- `DATABASE_URL`: production PostgreSQL connection URL, preserving TLS options.
- `API_PUBLIC_BASE_URL`: externally reachable HTTPS origin without `/api`, used
  in provider callback URLs. `PUBLIC_APP_URL`: the external UI origin.
- `ALLOWED_ORIGINS`: your UI origins. Add the provider credentials and OAuth
  redirect URLs used by your existing deployment; retain `SOCIAL_TOKEN_ENC_KEY`
  when reusing an existing database.

Run the UI/backend with the real storage settings, omitting the emulator overlay:

```sh
docker compose -f compose.yaml -f compose.backend.yaml up --build -d
```

Or build and run only the backend:

```sh
docker build --platform linux/amd64 -t ai-reception-backend ./ai-receptionist-func
docker run -d --name ai-reception-backend --platform linux/amd64 \
  --env-file .env.docker -p 127.0.0.1:7071:80 \
  -v ai-reception-backend-data:/data ai-reception-backend
```

Deploy the image through your container hosting platform or registry. The
container listens on port 80; terminate HTTPS at your ingress and route `/api`
to it. Ensure it can reach the database and storage. Scheduled jobs keep running
alongside HTTP endpoints. The Docker health check calls `/api/health`, so failed
function registration or database initialization prevents a healthy startup.
Local settings, credentials, virtual environments and local data are excluded
from the image. Requirements are currently unpinned, so dependency resolution
can change between builds.

The backend Docker workflow runs the existing unit tests, builds and starts the
UI/backend/Azurite stack, and verifies health both directly and through the UI
proxy. Local checks passed for all 36 unit tests, registration of 158 functions,
Functions host health and an Azurite Table Storage write. Docker itself was not
available on the development machine, so image startup is verified by CI.

References: [Microsoft Functions container guidance](https://learn.microsoft.com/en-us/azure/azure-functions/functions-how-to-custom-container),
[Azurite local storage](https://learn.microsoft.com/en-us/azure/storage/common/storage-use-azurite).

### Ultravox calendar booking tool
The Ultravox HTTP tool `calendar_book` is created and attached to each agent so the model can call `POST /api/calendar/book` with structured fields (start, callerPhone, etc.). The tool is provisioned automatically after Google connect and when listing calendar events.

### How to test
1. Connect Google via the existing auth flow so tokens are stored.  
2. Place a call with the Ultravox agent and confirm an appointment time (e.g., 2025-12-17T15:00:00+00:00).  
3. After confirmation, Ultravox should invoke the `calendar_book` HTTP tool; verify the call in Azure logs and that the payload includes `start` and `callerPhone`.  
4. Verify the request hits `POST /api/calendar/book` (public base comes from `API_PUBLIC_BASE_URL`) and a Google Calendar event is created.  
5. Optional: enable `ENABLE_ULTRAVOX_DEBUG=true` and call `GET /api/ultravox/debug-tools?agentId=<id>` to see attached tools.

### Config
- `ULTRAVOX_API_KEY` (required)
- `ULTRAVOX_BASE_URL` (optional, defaults to https://api.ultravox.ai/api)
- `ULTRAVOX_WEBHOOK_SECRET` (optional, shared secret for Ultravox webhooks)
- `TWILIO_AUTH_TOKEN` (required for Twilio API usage)
- `API_PUBLIC_BASE_URL` (used for tool callback URL; if unset, falls back to `WEBSITE_HOSTNAME` on Azure or `http://localhost:7071` locally)
- `ENABLE_ULTRAVOX_DEBUG` (optional, enables debug endpoint)

### Webhooks
- Twilio voice webhook: `POST /api/twilio/incoming`
- Ultravox mapping webhook: `POST /api/ultravox/webhook` (set `ULTRAVOX_WEBHOOK_SECRET` and pass `X-Ultravox-Webhook-Secret`)

### Call Routing Scheduler + Warm Transfer
- Dashboard settings API: `GET|PUT /api/dashboard/routing-settings?email=...`
- Inbound routing webhook: `POST /api/twilio/voice/inbound`
- Forward continuation webhook: `POST /api/twilio/voice/forward-next`
- Whisper prompt webhook: `GET|POST /api/twilio/voice/whisper`
- Whisper result webhook: `POST /api/twilio/voice/whisper-result`
- Ultravox warm transfer tool: `POST /api/ultravox/tools/warm-transfer` (`X-ULTRAVOX-TOOL-SECRET` required)

Storage tables (Azure Table Storage):
- `RoutingConfigs` (PartitionKey=`tenantId`, RowKey=`twilioNumber`)
- `ForwardTargets` (PartitionKey=`tenantId`, RowKey=`twilioNumber`)
- `TransferLogs` (PartitionKey=`tenantId`, RowKey=`callSid`)

Required/optional env vars:
- `AZURE_STORAGE_CONNECTION_STRING` (required for persistent routing config/logs)
- `TWILIO_AUTH_TOKEN` (required; all `/api/twilio/*` routes validate signature)
- `TWILIO_VALIDATE_SIGNATURE` (optional, default `true`)
- `ULTRAVOX_TOOL_SECRET` (required for `/api/ultravox/tools/warm-transfer`)
- `ROUTING_CONFIGS_TABLE` / `FORWARD_TARGETS_TABLE` / `TRANSFER_LOGS_TABLE` (optional overrides)

Local test flow:
1. Open dashboard settings -> Phone routing and save config for your Twilio number.
2. Point Twilio Voice webhook to `POST /api/twilio/voice/inbound`.
3. Place a call during and outside configured AI windows and verify rule matching.
4. Trigger warm transfer from Ultravox tool call and verify whisper + press 1 accept behavior.

### Gmail email manager
- `GET /api/email/messages?email=...&max_results=20&label_ids=INBOX`
- `POST /api/email/summary` with `{ "email": "...", "message_id": "..." }`
- Ensure `GOOGLE_SCOPES` includes `https://www.googleapis.com/auth/gmail.readonly`, then re-connect Google OAuth.

### Calls + transcript proxy
- `GET /api/calls?email=...` (or `aiPhoneNumber=...`)
- `GET /api/calls/{call_id}/transcript` (call_id can be DB id or Twilio CallSid; fetches live from Ultravox, no DB storage)

### Social Media Manager
Env vars:
- `META_APP_ID` / `META_APP_SECRET` (Meta OAuth)
- `META_VERIFY_TOKEN` (Meta + WhatsApp webhook verification)
- `PUBLIC_APP_URL` (used for Meta OAuth redirect back to `/api/social/meta/callback`)
- `SOCIAL_TOKEN_ENC_KEY` (AES-GCM key used to encrypt stored tokens)
- `OPENAI_API_KEY` (optional, enables AI reply suggestions)

Webhooks:
- Meta (Facebook/Instagram): `GET|POST /api/social/meta/webhook`
- WhatsApp Cloud API: `GET|POST /api/social/whatsapp/webhook`

Connect Meta (Facebook + Instagram):
1. Go to Social -> Connect in the dashboard.
2. Click "Connect Meta" and approve the requested permissions.
3. The connected Pages + IG Business accounts appear in the connections list.

Connect WhatsApp (MVP manual):
1. Gather `phone_number_id`, `waba_id`, and a permanent token from Meta Cloud API.
2. Submit the manual form in Social -> Connect.

---

## SmartConnect4u Chat Widget + /api/chat endpoint

### What ships
- Floating chat widget in the web app (Vite/React) with streaming responses, localStorage session, glassy UI, and “New conversation” reset.
- Azure Function `POST /api/chat` that streams OpenAI responses, persists messages to Azure Table Storage, applies basic prompt-injection guard, and rate limits by IP.

### Environment variables
- `OPENAI_API_KEY` (required)
- `OPENAI_MODEL` (default `gpt-4.1-mini`)
- `CHAT_SYSTEM_PROMPT` (system instructions for the assistant)
- `CHAT_FAQ_TEXT` (optional FAQ/KB blob appended as system context)
- `CHAT_TABLE` (optional, defaults to `ChatConversations`)
- `CHAT_MAX_MESSAGE_LENGTH` (default `1500`)
- `CHAT_MAX_CONTEXT_MESSAGES` (default `12`)
- `CHAT_RATE_LIMIT_TOKENS` (default `6` requests)
- `CHAT_RATE_LIMIT_WINDOW_SEC` (default `60`)
- `ALLOWED_ORIGINS` (comma-separated origins for CORS; falls back to `CORS_ALLOWED_ORIGINS`)
- Frontend: `VITE_API_PROXY_BASE` (prod API base, e.g., `https://<func-app>.azurewebsites.net/api`), `VITE_FUNCTION_HOST` (local Azure Functions host, default `http://localhost:7071`)

### Local development
1) Backend  
   - `cd ai-receptionist-func`  
   - Ensure `python -m venv .venv && source .venv/bin/activate` (or Windows equivalent)  
   - `pip install -r requirements.txt`  
   - Set envs in `local.settings.json` (`OPENAI_API_KEY`, `CHAT_SYSTEM_PROMPT`, `ALLOWED_ORIGINS=http://localhost:5173`, optional `CHAT_FAQ_TEXT`)  
   - Run: `func host start`
2) Frontend  
   - `cd AIReceptionNewUI`  
   - `npm install` (if not already)  
   - `npm run dev` (Vite dev server on 5173; proxy target from `VITE_FUNCTION_HOST`)  
   - Open http://localhost:5173 and click the launcher bottom-right to chat.

### Production checklist
- Deploy the Functions app with the env vars above and Azure Table Storage connection string (`AZURE_STORAGE_CONNECTION_STRING`) set.  
- Confirm the table `ChatConversations` is created automatically on first write.  
- Configure CORS origins (`ALLOWED_ORIGINS`) to your domains.  
- Build and deploy the Vite frontend (`npm run build`) and ensure it calls the deployed `/api/chat`.  
- Verify streaming works via browser DevTools (Network -> chat -> Preview should stream).

---

## CRM Manager (new)

### Overview
CRM Manager adds tenant-isolated entities in Azure Table Storage:
- `CRMContacts`
- `CRMCompanies`
- `CRMDeals`
- `CRMTasks`
- `CRMComments`
- `CRMActivities`
- `CRMEmailLinks`
- `CRMNotifications`
- `CRMAuditLog`
- `CRMTaskByAssignee`
- `CRMTaskByStatus`

All CRM entities are always stored with `PartitionKey = tenantId` (resolved from existing auth context/user email), never from a user-provided tenant id.

### API routes
- `GET|POST /api/crm/tasks`
- `GET|PATCH|DELETE /api/crm/tasks/{task_id}`
- `GET|POST /api/crm/tasks/{task_id}/comments`
- `GET|POST /api/crm/deals/{deal_id}/comments`
- `GET|POST /api/crm/contacts/{contact_id}/comments`
- `GET|POST /api/crm/comments`
- `GET|PATCH|DELETE /api/crm/comments/{comment_id}`
- `GET|POST /api/crm/deals`
- `GET|PATCH|DELETE /api/crm/deals/{deal_id}`
- `GET|POST /api/crm/companies`
- `GET|PATCH|DELETE /api/crm/companies/{company_id}`
- `GET|POST /api/crm/contacts`
- `GET|PATCH|DELETE /api/crm/contacts/{contact_id}`
- `GET|POST /api/crm/activities`
- `GET|POST /api/crm/email-links`
- `GET /api/crm/dashboard`
- `GET /api/crm/users`
- `GET /api/crm/notifications`
- `PATCH /api/crm/notifications/{notif_id}/read`
- `GET /api/crm/audit`
- `GET /api/crm/reports/tasks` (CSV export)
- `GET /api/crm/reports/deals` (CSV export)

### RBAC
- Primary client user: `admin`
- Added user role `admin/manager`: treated as `manager`
- Added user role `editor/member/user`: treated as `member`

Enforcement happens in backend:
- `admin`/`manager`: full tenant CRUD for CRM entities
- `member`: limited to assigned/watcher/collaborator visibility and limited task/deal/contact updates

### Example requests
```bash
# List CRM tasks for the signed-in tenant
curl -s "http://localhost:7071/api/crm/tasks?status=in_progress&limit=20" \
  -H "x-user-email: owner@yourtenant.com"

# Create a task (manager/admin)
curl -s -X POST "http://localhost:7071/api/crm/tasks" \
  -H "Content-Type: application/json" \
  -H "x-user-email: owner@yourtenant.com" \
  -d '{
    "title": "Follow up proposal",
    "description": "Send final quote and timeline",
    "priority": "high",
    "dueDate": "2026-02-20T10:00:00Z",
    "assignedToEmail": "manager@yourtenant.com",
    "watchers": ["owner@yourtenant.com"],
    "status": "new"
  }'

# Move task status (optimistic UI path)
curl -s -X PATCH "http://localhost:7071/api/crm/tasks/<task_id>" \
  -H "Content-Type: application/json" \
  -H "x-user-email: manager@yourtenant.com" \
  -d '{"status":"in_progress","progressPercent":40}'

# Link email thread/message to task
curl -s -X POST "http://localhost:7071/api/crm/email-links" \
  -H "Content-Type: application/json" \
  -H "x-user-email: manager@yourtenant.com" \
  -d '{
    "entityType":"task",
    "entityId":"<task_id>",
    "provider":"gmail",
    "threadId":"<gmail_thread_id>",
    "messageId":"<gmail_message_id>",
    "subject":"Re: Proposal",
    "snippet":"Client asked for revised scope."
  }'

# Export tasks report CSV (primary tenant admin)
curl -s "http://localhost:7071/api/crm/reports/tasks" \
  -H "x-user-email: owner@yourtenant.com"
```

### Optional env overrides
- `CRM_CONTACTS_TABLE`
- `CRM_COMPANIES_TABLE`
- `CRM_DEALS_TABLE`
- `CRM_TASKS_TABLE`
- `CRM_COMMENTS_TABLE`
- `CRM_ACTIVITIES_TABLE`
- `CRM_EMAIL_LINKS_TABLE`
- `CRM_NOTIFICATIONS_TABLE`
- `CRM_AUDIT_TABLE`
- `CRM_TASK_ASSIGNEE_INDEX_TABLE`
- `CRM_TASK_STATUS_INDEX_TABLE`

If not set, defaults shown in the Overview are used.

### Seed demo data
```bash
cd ai-receptionist-func
python3 scripts/seed_crm_demo.py --tenant-id 123 --owner-email owner@yourtenant.com
```

---

## Private Digital Business Cards (Internal-only)

### API routes
- `POST /api/private-cards` (admin-only)
- `PUT /api/private-cards/{token}` (admin-only)
- `POST /api/private-cards/{token}/photo` (admin-only)
- `GET /api/private-card?token=...` (public by secret URL only)
- `GET /api/private-vcard?token=...` (public by secret URL only)

### Required env vars
- `PUBLIC_APP_URL` (default `https://smartconnect4u.com`)
- `AZURE_STORAGE_CONNECTION_STRING`
- `PRIVATE_CARDS_TABLE` (default `PrivateCards`)
- `BLOB_CONTAINER_PHOTOS` (default `employee-photos`)

### Create card (admin auth)
```bash
curl -X POST https://smartconnect4u.com/api/private-cards \
  -H "Authorization: Bearer <token>" \
  -H "x-user-email: <admin-email>" \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Mahmood Tariq",
    "jobTitle": "Customer Success",
    "email": "mahmood@smartconnect4u.com",
    "workPhone": "+4420....",
    "whatsappPhone": "+44....",
    "website": "https://smartconnect4u.com",
    "companyName": "SmartConnect4u",
    "address": "...",
    "mapUrl": "...",
    "linkedInUrl": "..."
  }'
```

### Create response
- `url`: `https://smartconnect4u.com/card/{token}`
- `cardUrl`: `https://smartconnect4u.com/api/private-card?token={token}`
- `vcardUrl`: `https://smartconnect4u.com/api/private-vcard?token={token}`

### QR payload format
- `https://smartconnect4u.com/card/{token}`

---

## Sales Dialer Setup

### API routes
- `GET /api/voice/token` (auth required, role: `SalesRep` or `Admin`)
- `POST /api/voice/twiml` (Twilio webhook for browser dialer routing)
- `POST /api/voice/dialout` (auth required, fallback phone dial-out)
- `POST /api/voice/status` (Twilio status callback for call log updates)
- `GET /api/voice/logs` (auth required, tenant-isolated logs)

### Required env vars
- `TWILIO_ACCOUNT_SID`
- `TWILIO_API_KEY_SID`
- `TWILIO_API_KEY_SECRET`
- `TWILIO_CALLER_APP_SID`
- `TWILIO_CALLER_ID=+14313400857`
- `AZURE_STORAGE_CONNECTION_STRING`

### Recommended env vars
- `TWILIO_AUTH_TOKEN` (recommended to validate Twilio webhook signatures)
- `TWILIO_APP_SID` (legacy fallback; prefer `TWILIO_CALLER_APP_SID`)
- `TWILIO_VALIDATE_SIGNATURE=true`
- `SALES_CALL_LOGS_TABLE=SalesCallLogs`
- `VOICE_DIAL_RATE_LIMIT_MAX=12`
- `VOICE_DIAL_RATE_LIMIT_WINDOW_SECONDS=60`
- `VOICE_BLOCKED_PREFIXES=+1900,+1976,+979`

### Frontend env (optional)
- `VITE_TWILIO_VOICE_SDK_URL=https://sdk.twilio.com/js/voice/releases/2.12.3/twilio.min.js`

### Geo Permissions Note
- Ensure Twilio Voice geographic permissions allow outbound calls from your account/subaccount to Canada (`+1`) from your configured caller ID.
- If dialing is blocked, check Twilio Console:
  - Voice geo permissions
  - Verified caller IDs / number capability
  - Any policy restrictions for destination prefixes

### Quick test checklist
1. Login as `Admin` or a client user with role `SalesRep`.
2. Open Dashboard -> `Sales Dialer`.
3. Browser Dialer test:
   - Enter target in E.164 format (example: `+1416xxxxxxx`).
   - Allow microphone.
   - Click `Call` and confirm status moves `ringing -> connected -> ended`.
4. Fallback test:
   - Switch to `Phone Dial-Out`.
   - Enter rep phone (E.164) and target number.
   - Confirm rep phone rings first, then bridge to target.
5. Confirm logs:
   - `GET /api/voice/logs?email=<rep-email>`
   - Validate `tenantId`, `to`, `from`, `status`, `duration`, and `callSid`.

### Caller ID selection behavior
- Dialer resolves caller IDs from tenant active Twilio numbers (`phone_numbers.is_active = true`).
- Country is inferred from request headers (`cf-ipcountry`, `x-country-code`, etc.), with query/env fallback.
- If multiple active caller IDs exist, frontend shows a caller ID dropdown and sends selected `callerId` to backend.
