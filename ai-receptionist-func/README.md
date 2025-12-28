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
