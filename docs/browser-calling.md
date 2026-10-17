# Manual AI and normal calls

In **Dial a number**, AI calls retain the Twilio → Ultravox conversation flow.
Normal calls connect the initiating user's browser microphone to the saved UK
contact through Twilio Voice SDK and a dedicated TwiML application. No Ultravox
session, notification email, recording or transcript is created for normal calls.
Both modes save call status, duration and activity in call history.

## Browser setup

The sole platform administrator can select **Normal call → Connect browser calling**
and supply an existing Standard Twilio API key and secret from the same account as
`TWILIO_ACCOUNT_SID`. Server variables `TWILIO_API_KEY` and `TWILIO_API_SECRET`
are optional alternatives. The backend validates the existing key, creates or reuses
an Outreach-specific TwiML app, and stores the settings encrypted in
`OutreachBillingSetting`. Existing TwiML applications are not modified.
Preserve `AUTH_SESSION_SECRET` and the database across deployments.

`API_PUBLIC_BASE_URL` must be the public HTTPS origin, without `/api`.
The dedicated application receives these POST hooks:

- `/api/outreach/browser/voice`: connects a single-use browser attempt to its saved contact.
- `/api/outreach/browser/status`: receives the browser leg's final duration.
- `/api/outreach/browser/finish`: receives the destination leg's final result.
- `/api/outreach/leads/{lead_id}/status`: receives the destination leg's progress.

All provider hooks require a valid Twilio signature and account. Browser access
tokens expire within two minutes, allow outgoing calls only and identify one
saved attempt. Only its initiating account user can retrieve the token or stop it.
Destinations and caller IDs come from tenant-owned database records; client-supplied
destination parameters cannot override them. A consumed attempt cannot dial twice.

`OutreachBrowserCall` is created through the existing schema initialization. It
stores the initiator, single-use state, parent call SID, expiry and both leg
durations. Existing lead rows remain AI calls unless their saved contact explicitly
has `call_type: normal`; CSV imports always create AI calls.

## Pricing and limits

Customer normal calls cost **2 × (Twilio destination + browser connection)**,
converted to GBP. The browser rate defaults to USD 0.004/minute and is configurable
with `OUTREACH_TWILIO_BROWSER_COST_PER_MINUTE` and
`OUTREACH_TWILIO_BROWSER_COST_CURRENCY`. Each leg uses its own started minutes;
the combined charge is rounded up to a penny. AI pricing remains 2× the combined
Twilio and Ultravox cost. The UI quotes the selected call type before dialling.

Wallet funds are reserved before issuing a browser token. The first TwiML verb is
`Dial` with `answerOnBridge`, a 30-second ring timeout and a provider-enforced
`timeLimit`. The browser leg stays ringing until the destination answers. When
the destination call ends, the action response hangs up the browser leg; a fallback
`Hangup` follows `Dial`. Calls use the balance-covered whole-minute limit,
up to ten minutes. Settlement waits for both trusted leg durations and is idempotent.
Unused reservations are released after reconciliation, including expired attempts
that never connect a microphone. The sole platform admin remains wallet-exempt.
The existing test-payment guard still prevents Stripe test funds paying real usage.

Closing an active call requires hang-up first. Mute and hang-up use the Voice SDK;
hang-up and connection failures also request server-side termination. A background
worker recovers missing callbacks from Twilio, including attempts whose campaign
was already completed. Manual requests reconcile stale browser attempts before
checking for an active call. Provider timeouts remain uncertain
attempts and are never automatically redialled.

Provider references: [Voice SDK](https://www.twilio.com/docs/voice/sdks/javascript/get-started),
[Dial](https://www.twilio.com/docs/voice/twiml/dial),
[UK voice pricing](https://www.twilio.com/en-us/voice/pricing/gb).
