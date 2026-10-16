import { useCallback, useEffect, useRef, useState } from "react";
import { Mail, Pause, PhoneCall, Play, RefreshCw, Upload } from "lucide-react";
import { outreachRequest } from "../lib/api/outreach";
import { hasCurrentSession, SignInRequiredError } from "../lib/authSession";
import "./AIOutreachScreen.css";

const label = (value) => String(value || "unknown").replaceAll("_", " ").replaceAll("-", " ");
const downloadTemplate = () => {
  const blob = new Blob(["phone,restaurant_name,owner_name,email,city,automated_call_consent,consent_evidence\r\n"], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "vedoraeats-outreach-template.csv";
  link.click();
  URL.revokeObjectURL(url);
};

function CallReview({ lead, user, onReviewed, onError }) {
  const [sid, setSid] = useState("");
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const review = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await outreachRequest(`leads/${lead.id}/review`, user, { call_sid: sid.trim(), confirmed_no_active_call: checked });
      await onReviewed();
    } catch (err) { onError(err.message); }
    finally { setBusy(false); }
  };
  return <form className="outreach-call-review" onSubmit={review}><label>Twilio Call SID<input value={sid} onChange={(event) => setSid(event.target.value)} placeholder="CA…" /></label><label><input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />I checked Twilio logs and there is no active call. Skip this contact if no SID is provided.</label><button className="outreach-button" disabled={busy || (!sid.trim() && !checked)}>Resolve call review</button></form>;
}

export default function AIOutreachScreen({ user, onSignIn }) {
  const [config, setConfig] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [campaign, setCampaign] = useState(null);
  const [error, setError] = useState("");
  const [authRequired, setAuthRequired] = useState(!hasCurrentSession(user));
  const [busy, setBusy] = useState(false);
  const [importErrors, setImportErrors] = useState([]);
  const [filename, setFilename] = useState("");
  const [csvText, setCsvText] = useState("");
  const [form, setForm] = useState({ name: "VedoraEats restaurant outreach", benefits: "", notification_email: "", caller_id: "", start_hour: 10, end_hour: 17 });
  const selectedRef = useRef("");
  const generation = useRef(0);
  const fileGeneration = useRef(0);
  const userRef = useRef(user);
  userRef.current = user;

  const load = useCallback(async (id = selectedRef.current) => {
    const requestGeneration = ++generation.current;
    const [settings, list, detail] = await Promise.all([
      outreachRequest("config", userRef.current),
      outreachRequest("campaigns", userRef.current),
      id ? outreachRequest(`campaigns/${id}`, userRef.current) : Promise.resolve(null),
    ]);
    if (requestGeneration !== generation.current) return;
    setConfig(settings);
    setCampaigns(list.items);
    if (detail) setCampaign(detail.campaign);
    setForm((current) => ({ ...current, caller_id: current.caller_id || settings.caller_ids[0] || "" }));
  }, []);

  useEffect(() => {
    if (authRequired) return;
    const failed = (err) => {
      setError(err.message);
      if (err instanceof SignInRequiredError) setAuthRequired(true);
    };
    load().catch(failed);
    const timer = setInterval(() => load().catch(failed), 15000);
    return () => { clearInterval(timer); generation.current += 1; };
  }, [authRequired, load, user?.auth_token, user?.authToken]);

  if (authRequired) return (
    <section className="ai-outreach outreach-panel" aria-label="Outreach sign-in required">
      <h2>Sign in to manage outreach</h2>
      <p>Your saved session is no longer valid for this deployment.</p>
      <button type="button" className="outreach-button outreach-primary" onClick={onSignIn}>Sign in</button>
    </section>
  );

  const select = async (id) => {
    selectedRef.current = id;
    setSelectedId(id);
    setCampaign(null);
    setError("");
    try { await load(id); } catch (err) { setError(err.message); }
  };

  const readFile = async (event) => {
    const current = ++fileGeneration.current;
    const file = event.target.files?.[0];
    setCsvText("");
    setFilename("");
    setError("");
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv") || file.size > 2 * 1024 * 1024) {
      setError("Choose a CSV file up to 2 MB.");
      event.target.value = "";
      return;
    }
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      if (current !== fileGeneration.current) return;
      setCsvText(text);
      setFilename(file.name);
    } catch { setError("The CSV must use UTF-8 text encoding."); }
  };

  const create = async (event) => {
    event.preventDefault();
    setBusy(true); setError(""); setImportErrors([]);
    try {
      const payload = await outreachRequest("campaigns", userRef.current, { ...form, csv_text: csvText });
      setImportErrors(payload.import_errors);
      selectedRef.current = payload.campaign.id;
      setSelectedId(payload.campaign.id);
      setCampaign(payload.campaign);
      await load(payload.campaign.id);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const action = async (value) => {
    setBusy(true); setError("");
    try {
      const payload = await outreachRequest(`campaigns/${selectedId}`, userRef.current, { action: value });
      setCampaign(payload.campaign);
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <section className="ai-outreach" aria-label="VedoraEats AI outreach">
      <header className="outreach-heading">
        <div><p className="outreach-eyebrow">VEDORAEATS · UK RESTAURANTS</p><h2>Turn conversations into partnerships</h2>
          <p>Upload your contacts. Let your AI explain the benefits, capture interest, and hand qualified owners to your team.</p></div>
        <button className="outreach-button" onClick={() => load().catch((err) => setError(err.message))} disabled={busy}><RefreshCw size={16} />Refresh</button>
      </header>
      {error && <p className="outreach-message outreach-error" role="alert">{error}</p>}
      {config?.configuration_errors?.length > 0 && <div className="outreach-message" role="status"><strong>Provider setup required before calling</strong><ul>{config.configuration_errors.map((item) => <li key={item}>{item}</li>)}</ul></div>}
      <div className="outreach-layout">
        <form className="outreach-panel outreach-form" onSubmit={create}>
          <h3><Upload size={18} /> Create a campaign</h3>
          <label>Campaign name<input required maxLength={150} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>Verified VedoraEats benefits<textarea required rows={6} maxLength={12000} value={form.benefits} onChange={(e) => setForm({ ...form, benefits: e.target.value })} placeholder="Add the actual benefits and offer you want the AI to explain. Include confirmed pricing only if applicable." /></label>
          <p className="outreach-help">The AI uses these facts and collects the owner's name, interest, email, preferred callback time, and permission for your team to follow up.</p>
          <label>Team email for interested owners<input required type="email" maxLength={254} value={form.notification_email} onChange={(e) => setForm({ ...form, notification_email: e.target.value })} placeholder="partnerships@yourcompany.com" /></label>
          <label>Twilio caller ID<select required value={form.caller_id} onChange={(e) => setForm({ ...form, caller_id: e.target.value })}><option value="">Select a number</option>{config?.caller_ids?.map((number) => <option key={number}>{number}</option>)}</select></label>
          {config && !config.caller_ids.length && <p className="outreach-help">Add an active Twilio number to your account to create a campaign.</p>}
          <div className="outreach-hours"><label>Call from<select value={form.start_hour} onChange={(e) => setForm({ ...form, start_hour: Number(e.target.value) })}>{Array.from({ length: 11 }, (_, i) => i + 9).map((hour) => <option value={hour} key={hour}>{String(hour).padStart(2, "0")}:00</option>)}</select></label>
            <label>Call until<select value={form.end_hour} onChange={(e) => setForm({ ...form, end_hour: Number(e.target.value) })}>{Array.from({ length: 11 }, (_, i) => i + 10).map((hour) => <option value={hour} key={hour}>{String(hour).padStart(2, "0")}:00</option>)}</select></label></div>
          <p className="outreach-help">Weekdays, Europe/London. Calls run one at a time per campaign, even after you close this page.</p>
          <div className="outreach-upload"><label>Restaurant contacts CSV<input type="file" accept=".csv,text/csv" onChange={readFile} /></label>{filename && <span>{filename}</span>}<button type="button" className="outreach-text-button" onClick={downloadTemplate}>Download CSV template</button></div>
          <p className="outreach-help">Required columns: <code>phone</code>, <code>restaurant_name</code>, <code>automated_call_consent</code>, <code>consent_evidence</code>. Optional: owner_name, email, city and other details. Use 020… / 07… or +44… numbers.</p>
          <p className="outreach-consent">Include contacts with specific prior consent to automated marketing calls from VedoraEats. Set consent to “yes” and record when/how it was obtained. Contacts without evidence and previous opt-outs are skipped. <a href="https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/direct-marketing-guidance/plan-direct-marketing/" target="_blank" rel="noreferrer">UK guidance</a></p>
          <button type="submit" className="outreach-button outreach-primary" disabled={busy || !csvText || !form.caller_id || form.start_hour >= form.end_hour}>{busy ? "Working…" : "Import and review campaign"}</button>
          <p className="outreach-help">Review imported contacts, then start the campaign.</p>
        </form>
        <div className="outreach-main">
          <div className="outreach-panel"><h3><PhoneCall size={18} /> Campaigns</h3>
            {!campaigns.length && <p className="outreach-empty">Your first restaurant partnership starts with a conversation. Import a CSV to get started.</p>}
            <div className="outreach-campaign-list">{campaigns.map((item) => <button key={item.id} type="button" className={`outreach-campaign ${item.id === selectedId ? "selected" : ""}`} onClick={() => select(item.id)}><span><strong>{item.name}</strong><small>{item.total} contacts · {item.interested} interested</small></span><span className={`outreach-status status-${item.status}`}>{label(item.status)}</span></button>)}</div>
          </div>
          {importErrors.length > 0 && <div className="outreach-message"><strong>{importErrors.length} CSV rows excluded</strong><ul>{importErrors.slice(0, 20).map((item) => <li key={item.row}>Row {item.row}: {item.error}</li>)}</ul>{importErrors.length > 20 && <p>Showing the first 20 errors.</p>}</div>}
          {selectedId && !campaign && <p role="status">Loading campaign…</p>}
          {campaign && <div className="outreach-panel">
            <div className="outreach-detail-heading"><div><h3>{campaign.name}</h3><p className="outreach-help">{label(campaign.status)} · {String(campaign.start_hour).padStart(2, "0")}:00–{String(campaign.end_hour).padStart(2, "0")}:00 London · weekdays</p></div>
              {campaign.status === "running" ? <button className="outreach-button" onClick={() => action("pause")} disabled={busy}><Pause size={16} />Pause campaign</button> : ["draft", "paused"].includes(campaign.status) && <button className="outreach-button outreach-primary" onClick={() => action("start")} disabled={busy || !!config?.configuration_errors?.length || !campaign.counts.queued}><Play size={16} />{campaign.status === "paused" ? "Resume" : "Start calling"}</button>}
            </div>
            {campaign.error && <p className="outreach-message outreach-error">{campaign.error}</p>}
            <div className="outreach-metrics"><div><strong>{campaign.counts.queued || 0}</strong><span>Waiting</span></div><div><strong>{campaign.interested}</strong><span>Interested</span></div><div><strong>{campaign.emails_sent}</strong><span>Emails accepted</span></div><div><strong>{campaign.counts.skipped || 0}</strong><span>Skipped</span></div></div>
            <p className="outreach-help"><Mail size={14} /> Summaries go to {campaign.notification_email}. Pause stops new calls; an active conversation can finish. Provider acceptance does not confirm inbox delivery.</p>
            <div className="outreach-table-wrap"><table><thead><tr><th>Restaurant</th><th>Call status</th><th>Owner response</th><th>Team email</th></tr></thead><tbody>{campaign.leads.map((lead) => <tr key={lead.id}><td><strong>{lead.restaurant_name}</strong><small>{lead.phone}</small></td><td><span className="outreach-status">{label(lead.status)}</span>{lead.error && <small>{lead.error}</small>}{lead.status === "needs_review" && <CallReview lead={lead} user={user} onReviewed={() => load()} onError={setError} />}</td><td>{lead.result ? <details><summary>{label(lead.result.outcome)}</summary><p>{lead.result.summary}</p>{lead.result.owner_name && <p>Owner: {lead.result.owner_name}</p>}{lead.result.owner_email && <p>{lead.result.owner_email}</p>}{lead.result.preferred_callback_time && <p>Callback: {lead.result.preferred_callback_time}</p>}<p>Follow-up permission: {lead.result.follow_up_permission ? "Yes" : "No"}</p></details> : lead.status === "completed" ? "No structured result captured" : "Awaiting result"}</td><td>{label(lead.notification_status)}</td></tr>)}</tbody></table></div>
          </div>}
        </div>
      </div>
    </section>
  );
}
