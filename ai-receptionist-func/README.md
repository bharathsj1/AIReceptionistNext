# AI Receptionist Functions

## VedoraEats AI outreach

Dashboard -> **Campaigns** imports a UTF-8 restaurant CSV, creates a reviewable
draft, and starts sequential Twilio calls connected to Ultravox conversations.
Enter verified VedoraEats benefits and your team's notification email in the
campaign form. The agent identifies itself as an AI assistant, asks for the owner,
explains those benefits, and collects interest, owner name, email, preferred
callback time, and explicit permission for team follow-up. It does not invent
product benefits, prices or savings. Campaign settings are fixed after import;
create a new draft to change the offer or recipient.

Calls run in CSV order, at most one active call **per campaign**, on any day and
at any time. No weekday or time-window restrictions apply to manual calls or
campaigns, including existing campaigns with saved legacy hours. London time is
still used to display call history and callback preferences. The durable Functions
timer runs each minute, so keep the backend and
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

Optional columns include `owner_name`, `email`, `city` and additional business
details. Quoted cells and UTF-8 BOMs are supported. Limits: 2 MB, 5,000 rows,
30 columns and 2,000 characters per cell. Invalid rows and duplicate normalized
numbers are reported during import. Non-UK numbers, premium-rate, personal
numbering and pager destinations are excluded, including Crown Dependency
numbers sharing +44. CSV owner details are context; the agent must confirm contact details.

The website no longer collects consent evidence or uses it as a call gate.
Historical evidence is retained when supplied; removing this gate does not
fabricate evidence or requeue previously skipped rows. Opt-outs are stored per account and suppress that number in
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
- SMTP settings, saved in **Calling setup → Email delivery settings** or configured
  with `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD` and `SMTP_USE_TLS`.
  Verification codes and interested-owner summaries use this same connection.
  `FROM_EMAIL` overrides the default sender `support@vedoraeats.com` when using
  environment settings; a saved platform configuration uses its validated support
  sender. The sender must be authorized by the SMTP provider. Email is never
  reported as sent when credentials are missing. No SendGrid key is required.
  New campaigns and manual calls default their notification recipient to the
  signed-in user's email from the authenticated session, including manager logins.
  An explicitly entered campaign recipient is preserved. Existing campaigns keep
  their saved recipient. Calling setup displays both email defaults.
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

### Durable call history and transcripts

**Call history** lists every attempted outreach contact across the account's
campaigns, including unanswered, failed and uncertain attempts. It supports
25-row pages (maximum 100), search, campaign, status, outcome, and inclusive
Europe/London date filters. Start/end timestamps use UTC in the API; the UI
shows London time. Talk duration uses a provider measurement, never the elapsed
preparation/ringing interval. Missing measurements remain unknown.

`outreach_conversations` persists normalized spoken messages, timing, sync state
and provider errors. `outreach_call_events` records call preparation, voice-session
creation, provider status changes, owner-result changes, and manual review. Normal
`init_db()` creates the new tables without replacing existing call records. Rebuild
and restart the backend and UI containers to enable the feature.

An independent timer processes pending transcripts every minute. It also backfills
completed campaigns, uses bounded batches/backoff and retries, and does not hold up
the calling worker. Opening a conversation can fetch an uncached transcript on demand;
refreshes are throttled and locked per conversation. Saved final transcripts are
served from the local database, even when Ultravox is unavailable. Empty final
transcripts can be explicitly rechecked. A shorter or failed provider response
never replaces saved dialogue. Empty provider responses are allowed time to settle
before being classified as having no spoken transcript.

The integration uses the [Ultravox call messages API](https://docs.ultravox.ai/api-reference/calls/calls-messages-list)
with `mode=in_call` and every cursor page. Only spoken AI/contact messages are
saved; system/tool messages and tool payloads are excluded. Next-page URLs are
not followed with provider credentials: only the cursor is extracted and sent to
the configured provider origin. Newly created sessions request retained provider
data so the transcript can be collected. Calls made before this feature are
backfilled only if provider messages remain available; missing historical event
timelines are not invented. Audio recording is not enabled by this feature.

### API and validation

- `GET /api/outreach/calls` (optional `q`, `campaign_id`, `status`, `outcome`,
  `from`/`to` as `YYYY-MM-DD`, `page`, `page_size`; returns filtered totals and metadata)
- `GET /api/outreach/leads/{id}/conversation` (saved/spoken messages, call metadata
  and activity; optional `refresh=true` to recheck the provider when not final)
- `GET /api/outreach/config`
- `POST /api/outreach/manual-calls` (`request_id`: UUID, `phone`,
  `restaurant_name`, `benefits`, `notification_email`, `caller_id`). Creates a one-contact manual
  campaign and immediately uses the existing Twilio/Ultravox launch path; no CSV
  is needed. Returns `{call, campaign_id, created}` with 201 for a new attempt or
  200 for an idempotent replay. Request IDs are scoped to the signed-in account;
  retries and concurrent delivery cannot redial the same request. Reusing an ID
  with different details returns 409. Provider uncertainty remains `needs_review`.
  Checks assigned caller IDs, opt-outs, active/uncertain attempts for that number,
  configuration. Calls can start on any day and at any time. The existing
  worker reconciles the call, and history/transcripts/notifications use the same
  storage and callbacks. No database migration is required.
- `GET|POST /api/outreach/campaigns` (POST: `name`, `benefits`,
  `notification_email`, `caller_id`, `csv_text`, optional `voice`). Legacy
  `start_hour` and `end_hour` inputs are ignored; responses use 0 and 24 for
  compatibility. Existing database columns are retained without a data migration.
- `GET|POST /api/outreach/campaigns/{id}` (POST: `action: start|pause`)
- `POST /api/outreach/leads/{id}/review` (owner session; matching `call_sid` or
  `confirmed_no_active_call: true`)
- `POST /api/outreach/leads/{id}/status` (Twilio signature)
- `POST /api/outreach/leads/{id}/result` (per-contact `X-Outreach-Token`)

### Signed-in email verification

The sole platform administrator can open **Calling setup → Email delivery settings**
to validate and save SMTP credentials. The check opens a TLS connection, logs in,
and checks `MAIL FROM` for `support@vedoraeats.com`; it does not send a message.
Use port 587 for STARTTLS or 465 for implicit TLS. Settings are encrypted in
`outreach_email_settings` using `AUTH_SESSION_SECRET` and override environment SMTP
settings for both verification emails and interested-owner summaries. Passwords
are never returned by the settings API.
Request an actual verification code after saving to check delivery to the inbox.
SMTP authentication, sender, recipient and connection failures have distinct safe
messages; logs contain only the exception category and SMTP status, never the code
or provider response. Cooldowns and verification attempt limits still apply.

To reuse the working VedoraEats website SMTP settings without entering its password
again, run `python scripts/reuse_vedora_smtp.py` from this repository on the Docker
host. It reads only the SMTP fields from `vedora-sandbox-api`, validates them from
`aireceptionist-backend-1`, then stores them encrypted in the Outreach database.
The source is unchanged; no email is sent, and secrets never appear in command-line
arguments, output or temporary files. Both container names can be overridden with
`--source-container` / `--destination-container`. Send a verification code in the
dashboard afterward to check inbox delivery.

- `GET /api/outreach/email-verification`: signed-in address, verification status,
  pending challenge, resend countdown and mail-delivery readiness.
- `POST /api/outreach/email-verification/send`: optional `email`, which must match
  the signed-in address. Sends a six-digit code to that address only.
- `POST /api/outreach/email-verification/verify`: `code` and optional matching `email`.

The restaurant portal's account-settings flow is adapted here; no cross-product
tokens, account databases or credentials are shared. `outreach_email_verifications`
is created automatically on the existing Docker database. Records are scoped to
tenant, signed-in identity and normalized email. Codes use salted HMAC hashes with
the existing session signing secret; plaintext codes never appear in API responses
or logs. Codes expire after 10 minutes, are single-use, and allow five attempts.
Resends invalidate older codes, enforce 60 seconds between sends and permit three
sends per 10 minutes. Atomic updates enforce limits across concurrent processes;
send intent is saved before mail delivery, with no automatic provider retry.
Verified status survives restarts. Changing the signed-in email requires a new
verification. The flow does not change login, calling or notification permissions.

Both email flows use saved encrypted SMTP settings, falling back to existing
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD` and `SMTP_USE_TLS`
settings when no saved configuration exists (SSL on port 465, STARTTLS otherwise
when enabled). There is no SendGrid fallback. Missing mail configuration returns
503 for verification and blocks new calls until SMTP is configured. Explicit
temporary SMTP rejections retry with backoff; unknown send outcomes require review
to avoid duplicate lead emails. A successful provider acceptance is recorded as
sent; inbox delivery still depends on the receiving email provider.

The campaign UI uses the existing login bearer token. Data and caller IDs are
scoped to the resolved account, and another account's campaign/contact returns 404.
Conversation/history responses use `Cache-Control: no-store`; transcript reads
require a signed account-owner/manager session and never accept a browser-supplied
Ultravox call ID as proof of access.

Run `DATABASE_URL=sqlite:///:memory: python -m unittest discover -s tests -v` from
this directory, and `npm run build` / `npm run typecheck` from `AIReceptionNewUI`.
The outreach tests use isolated SQLite databases and simulated providers; they do
not call phone numbers or send email. Before production, run one consenting test
contact through a configured public HTTPS deployment and confirm conversation,
opt-out handling, callback status and actual email receipt.

## Docker deployment

The default Compose stack runs the UI, backend, meetings and storage containers.
It has no legacy cloud API upstreams and uses Azurite for Blob/Table/Queue storage
inside the Docker network. SQLite and uploaded files persist in `backend-data`,
and storage persists in `azurite-data`. The Functions framework runs inside the
Python containers; an Azure-hosted application or storage account is not required.

From the repository root:

```sh
python3 scripts/configure_docker.py
docker compose up --build -d
curl --fail http://localhost:7071/api/health
curl --fail http://localhost:7072/api/health
curl --fail http://localhost:8080/api/health
docker compose logs backend meetings
```

Open http://localhost:8080. Existing three-file Compose commands still work,
but the compatibility overlays are optional. Both Python images run on amd64;
Apple Silicon uses emulation. Azurite is reachable only inside Docker. The backend
and meetings host ports bind to localhost.

### Deployment settings

The configuration helper preserves non-empty secrets and generates only missing
`AUTH_SESSION_SECRET`, `SOCIAL_TOKEN_ENC_KEY` and `OUTREACH_TOOL_SECRET` values.
Keep `.env.docker` private and retain it across restarts and deployments. The
backend image requires `AUTH_SESSION_SECRET` before registering functions, so
sign-in cannot silently succeed without a usable token. Storage connection
strings are not used as authentication secrets.

Set `API_PUBLIC_BASE_URL` and `PUBLIC_APP_URL` to the public HTTPS origin without
`/api`, and set `ALLOWED_ORIGINS` to the UI origin. Add Twilio, Ultravox, SendGrid
and other provider credentials as needed. Docker supplies the internal storage
connection strings and disables cloud Application Insights destinations.
Credentials are kept in the backend/meetings containers, never in the UI image.
Nginx sends `/api/meetings` to the meetings container and other APIs to the main
backend. There is no automatic fallback to a retired host.

Existing database/blob/table data is not copied automatically. Import existing
data into the Docker volumes before switching an installation, and preserve
its encryption key. Stop with `docker compose down` to retain volumes; do not
use `--volumes` unless intentionally deleting data. Back up both data volumes.
Compose fixes the database URL to `sqlite:////data/app.db`, overriding copied
remote database URLs.

Local settings, environment files, virtual environments and local data are
excluded from image builds. The Docker workflows check proxy routing, provider
isolation, functions registration, health and persistent storage startup; the
retired cloud deployment workflows have been removed.

### Ultravox calendar booking tool
The Ultravox HTTP tool `calendar_book` is created and attached to each agent so the model can call `POST /api/calendar/book` with structured fields (start, callerPhone, etc.). The tool is provisioned automatically after Google connect and when listing calendar events.

### How to test
1. Connect Google via the existing auth flow so tokens are stored.
2. Place a call with the Ultravox agent and confirm an appointment time (e.g., 2025-12-17T15:00:00+00:00).
3. After confirmation, Ultravox should invoke the `calendar_book` HTTP tool; verify the call in backend container logs and that the payload includes `start` and `callerPhone`.
4. Verify the request hits `POST /api/calendar/book` (public base comes from `API_PUBLIC_BASE_URL`) and a Google Calendar event is created.
5. Optional: enable `ENABLE_ULTRAVOX_DEBUG=true` and call `GET /api/ultravox/debug-tools?agentId=<id>` to see attached tools.

### Config
- `ULTRAVOX_API_KEY` (required)
- `ULTRAVOX_BASE_URL` (optional, defaults to https://api.ultravox.ai/api)
- `ULTRAVOX_WEBHOOK_SECRET` (optional, shared secret for Ultravox webhooks)
- `TWILIO_AUTH_TOKEN` (required for Twilio API usage)
- `API_PUBLIC_BASE_URL` (used for tool callback URL; if unset, falls back to `http://localhost:7071` locally)
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
- Frontend: `BACKEND_UPSTREAM` (Vite server-side development proxy, default `http://127.0.0.1:7071`); browser requests stay on `/api`

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
   - `npm run dev` (Vite dev server on 5173; proxy target from `BACKEND_UPSTREAM`)
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

## Account-owned number purchasing and SMS

`tenant_phone_numbers` holds exclusive Twilio number ownership and capabilities.
`outreach_number_purchases` and `outreach_sms` persist intent before external
mutations, retain provider references and prevent retries from repeating purchases
or SMS sends. Existing calls and customer records are retained; `init_db()` creates
these new tables automatically on the persistent Docker database.

The explicitly approved number `+447861937466` (`PNc4cdbbe58f3b6a52c573f048046213c2`)
is reserved for `bharath.sj1@gmail.com`. The provider account is configured privately
through `TWILIO_ACCOUNT_SID`. The first signed configuration/number read for
that owner performs a read-only Twilio verification of the number, resource SID and
configured provider account before saving the assignment.
Other accounts cannot list, claim, send from or dial using that number. Existing
conflicting assignments require administrator review, rather than being silently
transferred. Additional numbers must be bought through the account purchase flow.

All account routes require a signed session and scope data using its resolved
`client_id`; an email/query/body claim cannot select another account. Every successfully authenticated account user can search/purchase numbers,
with payments and ownership scoped to their resolved account. Managers can use
the account's assigned numbers and shared wallet. Legacy `/clients/provision`,
`/clients/assign-number`, `/twilio/available-numbers`, `/voice-token`,
`/voice-outbound` and `/call-history` return 410. `/active-phone-numbers` now uses
the authenticated account number list. Shared/default caller-number seeding and
account-wide number fallback are removed. `/dashboard` also requires a signed
session and returns private, uncached company information.

Routes:

- `GET /api/outreach/numbers`: owned active numbers and voice/SMS capabilities.
- `GET /api/outreach/numbers/available?number_type=mobile|local&contains=...`:
  available UK numbers with both capabilities and live monthly price/currency.
- `POST /api/outreach/numbers/purchase`: `request_id` UUID, `phone_number`,
  `number_type`, `monthly_price`, `currency`, `confirm_purchase: true`.
- `GET /api/outreach/numbers/purchases/{id}`: scoped purchase status/reconciliation.
- `GET|POST /api/outreach/messages`: list recent account messages or send with
  `request_id` UUID, `from_number`, `to_number` (UK) and `body` (1–1,600 characters).
- `GET /api/outreach/messages/{id}`: scoped saved message/provider delivery status.
- `POST /api/outreach/messages/{id}/status`: Twilio-signed status callback; validates
  account, sender, recipient and provider reference, and prevents status regression.

Purchases recheck provider stock, both capabilities, the confirmed price and
exclusive ownership. They never reuse a number belonging to another customer.
Interrupted purchases reconcile only a provider number with the operation's
unique friendly-name tag; they never blindly repeat the purchase. SMS sends also
persist intent and require explicit review after uncertain outcomes, never auto-
resending. Public HTTPS deployments attach signed SMS status callbacks. Local HTTP
sends omit callbacks and use authenticated provider-status polling after Twilio
returns a message reference. SMS content/history remains private to its account.

For UK stock requiring approved identities, configure server-only
`OUTREACH_NUMBER_REGULATORY_SETTINGS` as JSON keyed by the primary owner's email:
`{"owner@example.com":{"bundle_sid":"BU...","address_sid":"AD..."}}`.
Use valid approved Twilio SIDs for that customer. Browser-supplied regulatory SIDs
and global address/bundle defaults are not accepted. Twilio can reject purchases
until that customer's regulatory requirements are satisfied. Customer rental prices shown in the UI are twice the current Twilio quote,
converted to GBP and rounded up to a penny. A paid monthly Stripe subscription
is required before Twilio provisioning. The platform administrator uses the
provider balance directly.

Unresolved purchases can also be recovered after a refresh through
`GET /api/outreach/numbers/purchases`. The Numbers & SMS page lists the account's
pending/failed purchases and opens their saved status for review without buying
again. Available-number capability checks accept Twilio's uppercase `SMS` keys
as well as the lowercase keys returned by purchased-number resources.


## Stripe payments, calling credits, and sole platform administrator

`bharath.sj1@gmail.com` is the only platform administrator. The exemption requires
that exact email from a validated **primary-user session**; a workspace `admin`
role, browser email, query parameter or submitted `admin_exempt` flag cannot grant
it. Other users, including workspace owners, use their account's GBP wallet.
Admin calls debit the configured Twilio/Ultravox provider accounts directly and
create an exempt call audit record. Twilio and Ultravox remain separate providers;
Stripe receipts do not automatically fund either provider account.

Customer number flow:

1. Search UK stock; the server gets current Twilio rental pricing and quotes **2x**
   that cost in GBP, rounded up to the nearest penny. The UI confirms monthly
   renewal. Address/bundle references remain account-scoped server settings.
2. Save a tenant-scoped durable payment order, then create a monthly Stripe
   Checkout subscription using the order's fixed idempotency key. No Twilio
   purchase occurs here. A checkout does not reserve Twilio inventory.
3. A strictly signed callback, authenticated status check, or reconciliation worker
   retrieves the saved Stripe session, matching amount, currency, order metadata,
   mode, paid status, active subscription and paid invoice. Only then may the
   private Twilio purchase service run with a paid-order reference.
4. Provisioning persists its own provider intent and operation tag before buying.
   Duplicate callbacks/refreshes cannot buy twice. Uncertain outcomes are held for
   reconciliation. Definitive provisioning failure cancels the subscription and
   requests an idempotent full refund; pending refunds remain visible for review.
5. Monthly renewals require a current paid invoice before extending service.
   Cancelling renewal retains access to the end of the paid period. Unpaid/ended
   periods block outbound use and trigger retryable subscription cancellation and
   provider release; a released number may be unrecoverable.

Customer calling flow:

- Wallets begin at **zero**. Stripe Checkout top-ups are £10, £25, £50 or £100;
  **1 credit = 1p**. A redirect/success URL never credits funds. Only server-verified
  paid GBP card payments create an idempotent ledger credit. Canonical refunds
  reverse credits once; disputes freeze spending. A refunded spent wallet may
  have a negative accounting balance, which blocks new calls.
- Before a manual call or campaign starts, the server quotes the exact destination
  using Twilio v2 Voice Numbers Pricing and the configured Ultravox per-minute
  cost. Quotes expire after five minutes and belong to the signed-in account,
  initiating email, destination and caller number.
- Default customer call rate is **2x (Twilio + Ultravox)**. Set
  `OUTREACH_CALL_MARKUP_MODE=twilio_only` if the commercial policy is 2x Twilio
  alone. Ultravox defaults to its published USD 0.05/min standard rate; set
  `OUTREACH_ULTRAVOX_COST_PER_MINUTE` and `_CURRENCY` for a different provider plan.
  Currency conversion uses ECB rates with a seven-day freshness limit, or an
  explicit server-managed `OUTREACH_<CURRENCY>_GBP_RATE`. There is no invented FX
  or provider-price fallback.
- A campaign's approved quote becomes its rate ceiling. Each next contact gets a
  fresh route quote; a higher rate pauses for approval. No price approval or no
  credits means no Ultravox or Twilio call is created.
- Before provider I/O, an atomic reservation holds enough funds for the affordable
  whole minutes (maximum ten). Both Twilio `time_limit` and Ultravox `maxDuration`
  receive that limit. Competing calls cannot spend reserved funds.
- Verified Twilio connected duration settles usage per **started minute**, with the
  total GBP charge rounded up once to the nearest penny and capped by the hold.
  Unused funds are released. A zero-duration call costs zero; an unknown outcome
  keeps its reservation until provider confirmation. Signed callbacks, provider
  polling, and explicit SID reconciliation settle once and keep the audit ledger.

Docker migration adds `outreach_wallets`, `outreach_wallet_entries`,
`outreach_payment_orders`, `outreach_call_quotes`, `outreach_campaign_billing`,
`outreach_call_charges`, and `outreach_billing_settings` through `init_db()` on the
persistent SQLite database. Existing contacts, calls and transcripts remain.
Existing campaigns must be started again by a signed-in user to record their
billing identity and approved price; pre-billing non-admin numbers require a paid
subscription before outbound use.

Deployment setup:

- Set stable `AUTH_SESSION_SECRET`, public HTTPS `API_PUBLIC_BASE_URL` and
  `PUBLIC_APP_URL`. Configure `STRIPE_SECRET_KEY` in the backend environment, or
  use the admin-only form in **Billing & wallet** when no key is configured.
  The form first validates the receiving Stripe account with a read-only request;
  the administrator confirms its account ID/business name and live/test mode
  before saving. The key is encrypted in the persistent database and is never
  returned by an API or written to browser storage. Live accounts must have
  charges enabled. Once billing is initialized, changing its receiving account
  through this bootstrap form is blocked to protect existing payments. Before
  orders/callbacks exist, **Set keys for initial setup** can select the intended
  account over an unused deployment default. The confirmed, encrypted database
  key takes precedence over that default. Key saving and callback registration
  share a database lease to prevent conflicting concurrent setup operations.
- In **Billing & wallet**, the sole platform admin clicks **Connect Stripe billing**.
  This registers the dedicated `/api/outreach/billing/stripe-webhook` endpoint,
  pinned to Stripe API `2024-06-20`, and encrypts its signing secret in SQLite.
  Alternatively configure `OUTREACH_STRIPE_WEBHOOK_SECRET` for that exact endpoint.
  Customer checkout remains unavailable until signed callbacks are configured.
- Retain the existing website's separate Stripe callback/subscriptions. Outreach
  callbacks only handle orders carrying their own `vedora_outreach` metadata.
- Stripe credentials may be test or live; callback mode must match. In test mode,
  successful payments are recorded as `test_completed` without issuing spendable
  credits or provisioning real Twilio numbers. Customer calls and number
  entitlement are blocked even if an old wallet has funds. Admin calls remain
  exempt and use real provider balances. The UI identifies test mode explicitly.
  Use test-mode Stripe and mocked providers for validation; never charge real
  cards to test. A matching-mode publishable key can be stored with the secret
  key, although hosted Checkout does not require a publishable key.
- Keep the persistent database and signing secret backed up together. Review
  provisioning/refund/release exceptions in the administrator billing view.

Billing endpoints are under `/api/outreach/billing`: summary, `topups`,
`orders/{id}`, `call-quotes`, `campaigns/{id}/quote`, `numbers/{id}/cancel`,
`admin/stripe-key` (validate, then confirm initial credentials),
`admin/connect-stripe`, `admin/overview`, and the signed `stripe-webhook`.
All customer reads and actions use the authenticated account's `client_id`.
