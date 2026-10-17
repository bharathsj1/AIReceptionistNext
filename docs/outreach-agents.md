# Company Ultravox agents

The current Outreach workspace uses a tenant-owned reusable Ultravox agent for
AI calls. `bharath.sj1@gmail.com` uses agent
`8c21e3b9-a049-4c52-9065-19a518437ad6` exclusively. Other companies get separate
agents, including companies with identical business names. Legacy receptionist
agent assignments are not reused for another company.

## Flow

1. The signed-in owner saves their business details, crawls their website and
   reviews the captured company information.
2. Company details and bounded website knowledge are saved in `clients`.
   Saving requires the owner's signed session; an email in the request alone
   does not authorize changes or agent provisioning. Initial signup sessions
   can save details before they have a client ID.
3. `outreach_agents` stores a per-client agent ID, deterministic provider name,
   desired and synchronized content hashes, status, safe error and retry time.
   Schema initialization creates this additive table.
4. The background outreach worker creates or updates pending agents. Owners can
   also use **Calling setup → Your AI calling agent → Connect AI agent**.
   Existing voice settings are preserved when the outbound system prompt changes.
5. The prompt contains the saved company facts and a required `outreach_context`
   template variable. Each AI call is created through
   `POST /api/agents/{agent_id}/calls` with `templateContext`, supplying its current
   company facts, campaign pitch, recipient and result-capture instructions.
6. Per-call tool overrides replace inherited tools with the scoped result-saving
   tool and hang-up. Twilio still creates the phone call after wallet reservation
   and connects its media stream to Ultravox. Normal browser calls bypass agents
   and Ultravox entirely.

The account API key stays on the backend. Provider lookup and mutation use a
per-client database lease. A deterministic agent name allows a lost creation
response to be recovered by lookup before another POST. Changed business facts
are synchronized to the existing agent rather than creating a new one. A profile
saved during synchronization remains pending for another pass. Failed agent
setup pauses AI dialling before any wallet reservation or phone call.

`GET /api/outreach/config` returns only the signed-in tenant's agent status and ID,
plus a suggested pitch from its business summary/services. The manual and CSV
campaign forms prefill that pitch for review. `POST /api/outreach/agent` checks or
synchronizes the caller's own company; request-supplied agent IDs or client IDs
cannot change ownership.

No additional provider credentials are needed beyond `ULTRAVOX_API_KEY`.
Preserve the database when moving deployments. Agent templates and call creation
follow the [Ultravox agent API](https://docs.ultravox.ai/api-reference/agents/agents-post)
and [agent call API](https://docs.ultravox.ai/api-reference/agents/agents-calls-post).
