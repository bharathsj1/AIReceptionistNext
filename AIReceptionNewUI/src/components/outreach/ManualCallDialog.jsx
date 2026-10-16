import { useEffect, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, LoaderCircle, PhoneCall, Mic, MicOff, PhoneOff, X } from "lucide-react";
import { outreachRequest } from "../../lib/api/outreach";
import { SignInRequiredError } from "../../lib/authSession";
import { callStatus } from "../../lib/callHistory";
import { useDialogFocus } from "../ui/useDialogFocus";
import "./ManualCallDialog.css";
import { CallPriceCard } from "./BillingWorkspace";

export default function ManualCallDialog({ user, config, campaigns, defaultCampaign, defaultCallerId, onClose, onStarted, onConversation, onAuthRequired, onAddBalance }) {
  const [template, setTemplate] = useState(defaultCampaign?.id || "");
  const [form, setForm] = useState({
    phone: "", restaurant_name: "", call_type: "ai",
    benefits: defaultCampaign?.benefits || "",
    notification_email: user?.email || config?.notification_email || "",
    caller_id: config?.caller_ids?.includes(defaultCallerId) ? defaultCallerId : config?.caller_ids?.includes(defaultCampaign?.caller_id)
      ? defaultCampaign.caller_id : config?.caller_ids?.[0] || "",
  });
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [quoteVersion, setQuoteVersion] = useState(0);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const [call, setCall] = useState(null);
  const [voicePhase, setVoicePhase] = useState("");
  const [muted, setMuted] = useState(false);
  const [browserReady, setBrowserReady] = useState(!(config?.normal_configuration_errors || []).some(value => value.includes("Connect browser calling")));
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [setupBusy, setSetupBusy] = useState(false);
  const voice = useRef(null);
  const device = useRef(null);
  const mounted = useRef(false);
  const connectionVersion = useRef(0);
  const savedNormalCall = useRef(null);
  const stopped = useRef(false);
  const normal = form.call_type === "normal";
  const voiceActive = normal && ["connecting", "ringing", "connected", "ending"].includes(voicePhase);
  const dialogRef = useRef(null);
  const feedbackRef = useRef(null);
  const inFlight = useRef(false);
  const request = useRef(null);
  const close = () => { if (!inFlight.current && !voiceActive) onClose(); };
  const endBrowserCall = async () => {
    connectionVersion.current += 1;
    const activeVoice = voice.current, activeDevice = device.current;
    voice.current = null; device.current = null;
    activeVoice?.disconnect(); activeDevice?.destroy();
    if (mounted.current) setVoicePhase("ended");
    if (!savedNormalCall.current || stopped.current) return;
    stopped.current = true;
    try { await outreachRequest(`browser/calls/${savedNormalCall.current.id}/stop`, user, {}); }
    catch { if (mounted.current) setError("Hang-up requested. Check call history to confirm the final provider status."); }
    finally { if (mounted.current) onStarted(savedNormalCall.current); }
  };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; endBrowserCall(); };
  }, []);
  useDialogFocus(dialogRef, true, close);
  useEffect(() => {
    let active = true;
    setQuote(null); setQuoteError("");
    if (config?.billing?.is_platform_admin || !form.caller_id || form.phone.replace(/\D/g, "").length < 10) { setQuoteLoading(false); return; }
    setQuoteLoading(true);
    const timer = setTimeout(async () => {
      try {
        const data = await outreachRequest("billing/call-quotes", user, { phone: form.phone, caller_id: form.caller_id, call_type: form.call_type });
        if (active) setQuote(data.quote);
      } catch (err) { if (active) setQuoteError(err.message); if (err instanceof SignInRequiredError) onAuthRequired(err); }
      finally { if (active) setQuoteLoading(false); }
    }, 500);
    return () => { active = false; clearTimeout(timer); };
  }, [form.phone, form.caller_id, form.call_type, config?.billing?.is_platform_admin, quoteVersion]);
  useEffect(() => {
    if (!quote || busy || uncertain || call) return;
    const timer = setTimeout(() => setQuoteVersion(value => value + 1), Math.max(1000, new Date(quote.expires_at).getTime() - Date.now() - 5000));
    return () => clearTimeout(timer);
  }, [quote, busy, uncertain, call]);
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
      caller_id: config?.caller_ids?.includes(campaign.caller_id) ? campaign.caller_id : value.caller_id,
    }));
  };
  const submit = async (event) => {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    let response;
    try {
      if (normal) {
        if (!navigator.mediaDevices?.getUserMedia) {
          const error = new Error("Browser calling needs HTTPS and microphone access."); error.status = 400; throw error;
        }
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach(track => track.stop());
        } catch {
          const error = new Error("Allow microphone access in your browser to make a normal call.");
          error.status = 400; throw error;
        }
      }
      if (!mounted.current) return;
      request.current ||= { ...form, quote_id: quote?.id, request_id: crypto.randomUUID() };
      response = await outreachRequest("manual-calls", user, request.current);
    } catch (err) {
      if (err instanceof SignInRequiredError) {
        onAuthRequired?.(err);
      } else if (err.status >= 400 && err.status < 500) {
        request.current = null;
        setUncertain(false);
        setQuoteVersion(value => value + 1);
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
      if (normal) savedNormalCall.current = response.call;
      if (!mounted.current) { if (normal) endBrowserCall(); return; }
      setCall(response.call);
      setUncertain(false);
      onStarted(response.call);
      if (normal && response.browser) {
        setVoicePhase("connecting");
        const version = ++connectionVersion.current;
        try {
          const { Device } = await import("@twilio/voice-sdk");
          if (!mounted.current || version !== connectionVersion.current) return;
          device.current = new Device(response.browser.token, { closeProtection: true });
          device.current.on("error", () => {
            if (mounted.current) setError("The browser voice connection needs attention. Check microphone access and your network.");
            endBrowserCall();
          });
          const connection = await device.current.connect({ params: { LeadId: response.browser.lead_id } });
          if (!mounted.current || version !== connectionVersion.current) { connection.disconnect(); return; }
          voice.current = connection;
          voice.current.on("ringing", () => setVoicePhase("ringing"));
          voice.current.on("accept", () => setVoicePhase("connected"));
          for (const event of ["disconnect", "cancel", "reject"]) voice.current.on(event, endBrowserCall);
          voice.current.on("error", () => {
            if (mounted.current) setError("The voice connection was interrupted. Check call history before redialling.");
            endBrowserCall();
          });
        } catch {
          if (mounted.current) setError("The browser could not connect. Check call history before trying another call.");
          endBrowserCall();
        }
      }
    }
  };
  const connectBrowser = async () => {
    if (setupBusy) return;
    setSetupBusy(true); setError("");
    try {
      await outreachRequest("browser/setup", user, { api_key: apiKey, api_secret: apiSecret });
      setBrowserReady(true); setApiKey("");
    } catch (err) { setError(err.message); if (err instanceof SignInRequiredError) onAuthRequired?.(err); }
    finally { setApiSecret(""); setSetupBusy(false); }
  };
  const hangup = async () => {
    setVoicePhase("ending");
    await endBrowserCall();
  };
  const failed = call && ["failed", "needs_review", "canceled", "skipped"].includes(call.status);
  const configurationErrors = (normal ? config?.normal_configuration_errors || [] : config?.configuration_errors || []).filter(value => !(normal && browserReady && value.includes("Connect browser calling")));
  return (
    <div className="calling-dialog-backdrop" onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="calling-dialog manual-call-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="manual-call-title" tabIndex={-1}>
        <header className="calling-dialog-heading">
          <div>
            <span className="calling-eyebrow">ONE NUMBER. ONE CONVERSATION.</span>
            <h2 id="manual-call-title">Dial a number</h2>
            <p>Choose an AI conversation or speak directly through your browser. No CSV needed.</p>
          </div>
          <button className="calling-icon" onClick={close} disabled={busy || voiceActive} aria-label="Close manual dial"><X size={20} /></button>
        </header>
        {call ? (
          <>
            <div className="manual-call-result" role="status">
              {failed ? <PhoneCall size={30} /> : <CheckCircle2 size={30} />}
              <h3>{normal ? ({connecting:"Connecting your microphone…",ringing:"Calling the contact…",connected:"You’re connected",ending:"Ending the call…",ended:"Browser call disconnected"}[voicePhase] || (failed ? "This call needs your attention" : "Normal call request saved")) : failed ? "This call needs your attention" : call.status === "completed" ? "This call is complete" : call.status === "queued" ? "Your call request is saved" : "Your call has started"}</h3>
              <strong>{call.restaurant_name}</strong>
              <span>{call.phone}</span>
              <span className={`calling-status status-${call.status}`}>{normal && voicePhase ? ({connecting:"Connecting microphone",ringing:"Ringing",connected:"In conversation",ending:"Disconnecting",ended:"Disconnected · check final status in call history"}[voicePhase]) : callStatus(call.status)}</span>
              <p>{error || call.error || (normal ? "You speak directly with the contact. Status and duration are saved in call history. No AI transcript or recording is created." : "Open the conversation for current call status, transcript, summary, and activity. Your AI will explain the pitch and capture the response.")}</p>
              {normal && voiceActive && <div className="manual-voice-controls"><button type="button" className="calling-button" disabled={!voice.current || voicePhase === "ending"} onClick={() => { voice.current?.mute(!muted); setMuted(!muted); }}>{muted ? <MicOff size={18}/> : <Mic size={18}/>} {muted ? "Unmute" : "Mute"}</button><button type="button" className="calling-button is-primary" disabled={voicePhase === "ending"} onClick={hangup}><PhoneOff size={18}/> Hang up</button></div>}
            </div>
            <footer className="calling-dialog-footer">
              <button className="calling-button" onClick={close} disabled={voiceActive}>Close</button>
              <button className="calling-button is-primary" disabled={voiceActive} onClick={() => onConversation(call)}>{normal ? "View call details" : "View conversation"} <ArrowRight size={17} /></button>
            </footer>
          </>
        ) : (
          <form onSubmit={submit}>
            <div className="manual-call-form-body">
              <fieldset className="calling-form-fields manual-call-fields" disabled={busy || uncertain}>
                <fieldset className="manual-call-type"><legend>Call type</legend><label><input type="radio" name="call-type" value="ai" checked={!normal} onChange={update("call_type")}/><span><strong>AI call</strong><small>Your AI speaks through Twilio + Ultravox.</small></span></label><label><input type="radio" name="call-type" value="normal" checked={normal} onChange={update("call_type")}/><span><strong>Normal call</strong><small>You speak through your browser using Twilio.</small></span></label></fieldset>
                {normal && !browserReady && config?.billing?.is_platform_admin && <div className="manual-browser-setup"><strong>Connect browser calling</strong><p>Use an existing Twilio API key for this account. A dedicated Outreach voice app will be connected; the existing voice app stays as configured.</p><label>Twilio API key<input autoComplete="off" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="SK… (or use the server setting)"/></label><label>Twilio API secret<input type="password" autoComplete="new-password" value={apiSecret} onChange={event => setApiSecret(event.target.value)} placeholder="Existing secret (or use the server setting)"/></label><button type="button" className="calling-button" disabled={setupBusy} onClick={connectBrowser}>{setupBusy ? "Connecting…" : "Connect browser calling"}</button></div>}
                <div className="manual-call-recipient">
                  <label>UK phone number
                    <input required type="tel" inputMode="tel" autoComplete="tel" maxLength={40} placeholder="020 7946 0018 or +44…" value={form.phone} onChange={update("phone")} />
                    <small>UK landlines and mobiles.</small>
                  </label>
                  <label>Business name
                    <input required maxLength={150} autoComplete="organization" placeholder="The Willow Kitchen" value={form.restaurant_name} onChange={update("restaurant_name")} />
                  </label>
                </div>
                {!normal && campaigns.length > 0 && <label>Use a saved campaign pitch
                  <select value={template} onChange={chooseTemplate}>
                    <option value="">Enter your own call details</option>
                    {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
                  </select>
                  <small>This call is saved separately and won’t start the campaign’s contact list.</small>
                </label>}
                {!normal && <label>Your pitch and benefits
                  <textarea required maxLength={12000} rows={4} placeholder="What should the AI explain about your company? Use confirmed benefits and offers." value={form.benefits} onChange={update("benefits")} />
                </label>}
                <div className="manual-call-recipient">
                  <label>Call from
                    <select required value={form.caller_id} onChange={update("caller_id")}>
                      <option value="">Select your calling number</option>
                      {config?.caller_ids?.map((number) => <option key={number} value={number}>{number}</option>)}
                    </select>
                  </label>
                  {!normal && <label>Team notification email
                    <input required type="email" maxLength={254} value={form.notification_email} onChange={update("notification_email")} />
                    <small>Interested-owner details go here when follow-up is permitted.</small>
                  </label>}
                </div>
                <CallPriceCard quote={quote} wallet={config?.billing?.wallet} admin={config?.billing?.is_platform_admin} loading={quoteLoading} error={quoteError} onAddBalance={onAddBalance} callType={form.call_type} />
                <p className="calling-fine-print">{normal ? "Use your microphone and speakers or a headset. Keep this window open while speaking. Normal calls save status and duration without AI transcripts or recordings." : "Call any day, at any time. The AI speaks to the contact; you can follow the saved conversation in call history."}</p>
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
              <button type="submit" className="calling-button is-primary" disabled={busy || (!uncertain && (!config?.caller_ids?.length || configurationErrors.length > 0 || (!config?.billing?.is_platform_admin && (!quote || config?.billing?.wallet?.frozen || (config?.billing?.wallet?.available_pence || 0) < quote.minimum_pence))))}>
                {busy ? <LoaderCircle className="spin" size={17} /> : <PhoneCall size={17} />}
                {busy ? "Connecting…" : uncertain ? "Check call request" : normal ? "Start normal call" : "Start AI call now"}
              </button>
            </footer>
          </form>
        )}
      </section>
    </div>
  );
}
