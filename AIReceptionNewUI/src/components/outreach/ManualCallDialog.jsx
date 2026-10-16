import { useEffect, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, LoaderCircle, PhoneCall, X } from "lucide-react";
import { outreachRequest } from "../../lib/api/outreach";
import { SignInRequiredError } from "../../lib/authSession";
import { callStatus } from "../../lib/callHistory";
import { useDialogFocus } from "../ui/useDialogFocus";
import "./ManualCallDialog.css";

export default function ManualCallDialog({ user, config, campaigns, defaultCampaign, defaultCallerId, onClose, onStarted, onConversation, onAuthRequired }) {
  const [template, setTemplate] = useState(defaultCampaign?.id || "");
  const [form, setForm] = useState({
    phone: "", restaurant_name: "", consent_evidence: "", consent_confirmed: false,
    benefits: defaultCampaign?.benefits || "",
    notification_email: defaultCampaign?.notification_email || user?.email || "",
    caller_id: config?.caller_ids?.includes(defaultCallerId) ? defaultCallerId : config?.caller_ids?.includes(defaultCampaign?.caller_id)
      ? defaultCampaign.caller_id : config?.caller_ids?.[0] || "",
  });
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const [call, setCall] = useState(null);
  const dialogRef = useRef(null);
  const feedbackRef = useRef(null);
  const inFlight = useRef(false);
  const request = useRef(null);
  const close = () => { if (!inFlight.current) onClose(); };
  useDialogFocus(dialogRef, true, close);
  useEffect(() => {
    if (error) feedbackRef.current?.scrollIntoView({ block: "nearest" });
  }, [error]);
  const update = (key) => (event) => setForm((value) => ({
    ...value, [key]: event.target.type === "checkbox" ? event.target.checked : event.target.value,
  }));
  const chooseTemplate = (event) => {
    setTemplate(event.target.value);
    const campaign = campaigns.find((item) => item.id === event.target.value);
    if (campaign) setForm((value) => ({ ...value,
      benefits: campaign.benefits,
      notification_email: campaign.notification_email,
      caller_id: config?.caller_ids?.includes(campaign.caller_id) ? campaign.caller_id : value.caller_id,
    }));
  };
  const submit = async (event) => {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    request.current ||= { ...form, request_id: crypto.randomUUID() };
    let response;
    try {
      response = await outreachRequest("manual-calls", user, request.current);
    } catch (err) {
      if (err instanceof SignInRequiredError) {
        onAuthRequired?.(err);
      } else if (err.status >= 400 && err.status < 500) {
        request.current = null;
        setUncertain(false);
      } else {
        // Keep the exact request identity and payload. Checking after a timeout
        // retrieves this attempt instead of placing a second call.
        setUncertain(true);
      }
      setError(err.message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
    if (response) {
      setCall(response.call);
      setUncertain(false);
      onStarted(response.call);
    }
  };
  const failed = call && ["failed", "needs_review", "canceled", "skipped"].includes(call.status);
  const configurationErrors = config?.configuration_errors || [];
  return (
    <div className="calling-dialog-backdrop" onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="calling-dialog manual-call-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="manual-call-title" tabIndex={-1}>
        <header className="calling-dialog-heading">
          <div>
            <span className="calling-eyebrow">ONE NUMBER. ONE CONVERSATION.</span>
            <h2 id="manual-call-title">Dial a number</h2>
            <p>Start an AI call directly. No CSV needed.</p>
          </div>
          <button className="calling-icon" onClick={close} disabled={busy} aria-label="Close manual dial"><X size={20} /></button>
        </header>
        {call ? (
          <>
            <div className="manual-call-result" role="status">
              {failed ? <PhoneCall size={30} /> : <CheckCircle2 size={30} />}
              <h3>{failed ? "This call needs your attention" : call.status === "completed" ? "This call is complete" : call.status === "queued" ? "Your call request is saved" : "Your call has started"}</h3>
              <strong>{call.restaurant_name}</strong>
              <span>{call.phone}</span>
              <span className={`calling-status status-${call.status}`}>{callStatus(call.status)}</span>
              <p>{call.error || "Open the conversation for current call status, transcript, summary, and activity. Your AI will explain the pitch and capture the response."}</p>
            </div>
            <footer className="calling-dialog-footer">
              <button className="calling-button" onClick={close}>Close</button>
              <button className="calling-button is-primary" onClick={() => onConversation(call)}>View conversation <ArrowRight size={17} /></button>
            </footer>
          </>
        ) : (
          <form onSubmit={submit}>
            <div className="manual-call-form-body">
              <fieldset className="calling-form-fields manual-call-fields" disabled={busy || uncertain}>
                <div className="manual-call-recipient">
                  <label>UK phone number
                    <input required type="tel" inputMode="tel" autoComplete="tel" maxLength={40} placeholder="020 7946 0018 or +44…" value={form.phone} onChange={update("phone")} />
                    <small>UK landlines and mobiles.</small>
                  </label>
                  <label>Business name
                    <input required maxLength={150} autoComplete="organization" placeholder="The Willow Kitchen" value={form.restaurant_name} onChange={update("restaurant_name")} />
                  </label>
                </div>
                {campaigns.length > 0 && <label>Use a saved campaign pitch
                  <select value={template} onChange={chooseTemplate}>
                    <option value="">Enter your own call details</option>
                    {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
                  </select>
                  <small>This call is saved separately and won’t start the campaign’s contact list.</small>
                </label>}
                <label>Your pitch and benefits
                  <textarea required maxLength={12000} rows={4} placeholder="What should the AI explain about your company? Use confirmed benefits and offers." value={form.benefits} onChange={update("benefits")} />
                </label>
                <div className="manual-call-recipient">
                  <label>Call from
                    <select required value={form.caller_id} onChange={update("caller_id")}>
                      <option value="">Select your calling number</option>
                      {config?.caller_ids?.map((number) => <option key={number} value={number}>{number}</option>)}
                    </select>
                  </label>
                  <label>Team notification email
                    <input required type="email" maxLength={254} value={form.notification_email} onChange={update("notification_email")} />
                    <small>Interested-owner details go here when follow-up is permitted.</small>
                  </label>
                </div>
                <label>Automated-call consent evidence
                  <input required maxLength={2000} placeholder="When and how this contact agreed to your AI calls" value={form.consent_evidence} onChange={update("consent_evidence")} />
                </label>
                <label className="manual-call-consent">
                  <input required type="checkbox" checked={form.consent_confirmed} onChange={update("consent_confirmed")} />
                  <span>This contact agreed to automated marketing calls from our company.</span>
                </label>
                <p className="calling-fine-print">Available Monday to Friday, 09:00–20:00 London time. The AI speaks to the contact; you can follow the saved conversation in call history.</p>
              </fieldset>
              <div className="manual-call-feedback" ref={feedbackRef} aria-live="polite">
                {configurationErrors.length > 0 && <div className="calling-alert"><strong>Calling setup is incomplete.</strong> {configurationErrors.join(". ")}</div>}
                {!config?.caller_ids?.length && <p className="calling-alert">Assign an active Twilio calling number in Calling setup before dialling.</p>}
                {error && <p className="calling-alert is-error" role="alert">{error}</p>}
                {uncertain && <p className="calling-alert">The response was interrupted. Your call may already be active. Choose “Check call request” to retrieve the same attempt without dialling again.</p>}
              </div>
            </div>
            <footer className="calling-dialog-footer">
              <button type="button" className="calling-button" onClick={close} disabled={busy}>{uncertain ? "Close" : "Cancel"}</button>
              <button type="submit" className="calling-button is-primary" disabled={busy || (!uncertain && (!config?.caller_ids?.length || configurationErrors.length > 0))}>
                {busy ? <LoaderCircle className="spin" size={17} /> : <PhoneCall size={17} />}
                {busy ? "Connecting…" : uncertain ? "Check call request" : "Start AI call now"}
              </button>
            </footer>
          </form>
        )}
      </section>
    </div>
  );
}
