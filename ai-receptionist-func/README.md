# AI Receptionist Functions

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
- `API_PUBLIC_BASE_URL` (used for tool callback URL)
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
