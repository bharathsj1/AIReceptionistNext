import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, LoaderCircle, MessageSquareText, Phone, PhoneCall, Plus, RefreshCw, X } from "lucide-react";
import { outreachRequest } from "../../lib/api/outreach";
import { SignInRequiredError } from "../../lib/authSession";
import { callDate, readable } from "../../lib/callHistory";
import { useDialogFocus } from "../ui/useDialogFocus";
import "./NumbersWorkspace.css";
import { stripeRedirect } from "./BillingWorkspace";

const money = (amount, currency) => new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(Number(amount));
const pending = (status) => ["preparing", "accepted", "queued", "sending", "sent"].includes(status);

export function DashboardNumbers({ numbers = [], error, onCall, onMessage, onManage }) {
  return <section className="calling-panel dashboard-numbers" aria-label="Your account phone numbers">
    <div>
      <span className="calling-eyebrow">YOUR ACCOUNT NUMBER{numbers.length > 1 ? "S" : ""}</span>
      {numbers.length ? numbers.map((number) => <div className="dashboard-number" key={number.sid}>
        <Phone size={22} /><strong>{number.phone_number}</strong>
        <span>{[number.voice_enabled && "Calls", number.sms_enabled && "SMS"].filter(Boolean).join(" · ")}</span>
        <div>
          <button className="calling-button" disabled={!number.sms_enabled} onClick={() => onMessage(number.phone_number)}><MessageSquareText size={17} /> Send SMS</button>
          <button className="calling-button is-primary" disabled={!number.voice_enabled} onClick={() => onCall(number.phone_number)}><PhoneCall size={17} /> Make a call</button>
        </div>
      </div>) : <p>{error || "Get a dedicated Twilio number for calls and text messages from this account."}</p>}
    </div>
    <button className="calling-text-button" onClick={onManage}>{numbers.length ? "Manage numbers" : "Get a number"}</button>
  </section>;
}

export default function NumbersWorkspace({ user, numbers = [], refreshKey, onCall, onMessage, onBuy, onReviewPurchase, onAuthRequired }) {
  const [messages, setMessages] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let current = true;
    Promise.all([outreachRequest("messages", user), outreachRequest("numbers/purchases", user)]).then(([data, purchaseData]) => { if (current) { setMessages(data.items); setPurchases(purchaseData.items); setError(""); } })
      .catch((err) => { if (current) { setError(err.message); if (err instanceof SignInRequiredError) onAuthRequired(err); } })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [refreshKey, user?.auth_token, user?.authToken]);
  return <div className="numbers-workspace">
    <section className="calling-panel">
      <header className="calling-panel-heading"><div><h2>Your phone numbers</h2><p>Dedicated to this account. Used for outbound calls and SMS.</p></div>
        <button className="calling-button is-primary" onClick={onBuy}><Plus size={17} /> Buy a number</button>
      </header>
      <div className="owned-number-list">
        {numbers.length ? numbers.map((number) => <article className="owned-number-card" key={number.sid}>
          <div><Phone size={23} /><div><strong>{number.phone_number}</strong><span>United Kingdom · {number.number_type} · Active</span></div></div>
          <div className="number-capabilities"><span>{number.voice_enabled ? "Voice enabled" : "Voice unavailable"}</span><span>{number.sms_enabled ? "SMS enabled" : "SMS unavailable"}</span></div>
          <div className="number-card-actions"><button className="calling-button" disabled={!number.sms_enabled} onClick={() => onMessage(number.phone_number)}><MessageSquareText size={17} /> Send SMS</button><button className="calling-button is-primary" disabled={!number.voice_enabled} onClick={() => onCall(number.phone_number)}><PhoneCall size={17} /> Make a call</button></div>
        </article>) : <div className="calling-empty"><Phone size={30} /><h3>Your account needs its own number</h3><p>Search available UK numbers, review the monthly charge, and purchase the number you want.</p><button className="calling-button is-primary" onClick={onBuy}>Find a UK number</button></div>}
      </div>
      {purchases.map((purchase) => <div className="number-purchase-notice" key={purchase.id}>
        <div><strong>{purchase.phone_number}</strong><p>{purchase.error || "Purchase is being checked"}</p></div>
        <button className="calling-button" onClick={() => onReviewPurchase(purchase)}>Review purchase</button>
      </div>)}
    </section>
    <section className="calling-panel">
      <header className="calling-panel-heading"><div><h2>Recent SMS messages</h2><p>Delivery status for messages sent from your account.</p></div></header>
      {error && <p role="alert" className="calling-alert is-error">{error}</p>}
      {loading ? <p className="numbers-empty">Loading messages…</p> : messages.length ? <div className="sms-history">{messages.map((item) => <article key={item.id}>
        <header><strong>{item.to_number}</strong><span className={`calling-status status-${item.status}`}>{readable(item.status)}</span></header>
        <p>{item.body}</p><small>From {item.from_number} · {callDate(item.created_at)}</small>{item.error && <p className="calling-inline-warning">{item.error}</p>}
      </article>)}</div> : <p className="numbers-empty">Your sent messages will appear here.</p>}
    </section>
  </div>;
}

function NumberDialog({ title, subtitle, busy, onClose, children, footer }) {
  const ref = useRef(null);
  const close = () => { if (!busy) onClose(); };
  useDialogFocus(ref, true, close);
  return <div className="calling-dialog-backdrop" onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section className="calling-dialog telephony-dialog" ref={ref} role="dialog" aria-modal="true" aria-labelledby="number-dialog-title" tabIndex={-1}>
      <header className="calling-dialog-heading"><div><span className="calling-eyebrow">YOUR ACCOUNT · YOUR CONNECTIONS</span><h2 id="number-dialog-title">{title}</h2><p>{subtitle}</p></div><button className="calling-icon" disabled={busy} onClick={close} aria-label="Close number dialog"><X size={20} /></button></header>
      <div className="telephony-dialog-body">{children}</div>
      <footer className="calling-dialog-footer">{footer}</footer>
    </section>
  </div>;
}

export function BuyNumberDialog({ user, initialPurchase, onClose, onChanged, onAuthRequired }) {
  const [kind, setKind] = useState("mobile");
  const [contains, setContains] = useState("");
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [operation, setOperation] = useState(initialPurchase || null);
  const [uncertain, setUncertain] = useState(false);
  const request = useRef(null);
  const inFlight = useRef(false);
  const searchVersion = useRef(0);
  const search = async () => {
    const version = ++searchVersion.current;
    setLoading(true); setError(""); setSelected(null); setConfirmed(false);
    try {
      const data = await outreachRequest(`numbers/available?${new URLSearchParams({ number_type: kind, contains })}`, user);
      if (version === searchVersion.current) setItems(data.items);
    } catch (err) { if (version === searchVersion.current) setError(err.message); if (err instanceof SignInRequiredError) onAuthRequired(err); }
    finally { if (version === searchVersion.current) setLoading(false); }
  };
  useEffect(() => { if (!initialPurchase) search(); return () => { searchVersion.current += 1; }; }, []);
  const purchase = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    request.current ||= { ...selected, request_id: crypto.randomUUID(), confirm_purchase: true };
    try {
      const data = operation ? await outreachRequest(`numbers/purchases/${operation.id}`, user)
        : await outreachRequest("numbers/purchase", user, request.current);
      setOperation(data.purchase); setUncertain(false);
      if (data.purchase.checkout_url) stripeRedirect(data.purchase.checkout_url);
      if (data.purchase.status === "completed") onChanged();
    } catch (err) {
      setError(err.message);
      if (err instanceof SignInRequiredError) onAuthRequired(err);
      else if (err.status >= 400 && err.status < 500) { request.current = null; setUncertain(false); }
      else setUncertain(true);
    } finally { setBusy(false); inFlight.current = false; }
  };
  const unresolved = uncertain || ["purchasing", "needs_review", "checkout_open", "checkout_review", "pending", "paid", "provisioning"].includes(operation?.status);
  const completed = operation?.status === "completed";
  return <NumberDialog title="Buy a UK number" subtitle="Choose a dedicated number for calls and SMS." busy={busy} onClose={onClose} footer={<>
    <button className="calling-button" disabled={busy} onClick={onClose}>Close</button>
    {completed ? <span className="number-success"><CheckCircle2 size={18} /> Ready to use</span> : operation?.status === "failed" ? <button className="calling-button" onClick={() => { setOperation(null); request.current = null; search(); }}>Search again</button> : <button className="calling-button is-primary" disabled={busy || (!unresolved && (!selected || !confirmed || loading))} onClick={purchase}>{busy ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}{busy ? "Checking…" : unresolved ? "Check purchase status" : selected?.payment_required ? "Continue to Stripe" : "Purchase number"}</button>}
  </>}>
    {error && <p className="calling-alert is-error" role="alert">{error}</p>}
    {operation ? <div className="number-purchase-result" role="status"><h3>{completed ? "Your number is ready" : operation.status === "failed" ? "The purchase was rejected" : "Check this purchase before continuing"}</h3><strong>{operation.phone_number}</strong><p>{money(operation.monthly_price, operation.currency)} / month, plus usage and taxes</p>{operation.error && <p className="calling-alert">{operation.error}</p>}</div> : <>
      {uncertain && <p className="calling-alert">The response was interrupted. Check the same request to find out whether the purchase completed.</p>}
      <fieldset className="number-purchase-fields" disabled={busy || uncertain}>
        <form className="number-search" onSubmit={(event) => { event.preventDefault(); search(); }}>
          <label>Number type<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="mobile">Mobile</option><option value="local">Local</option></select></label>
          <label>Contains digits (optional)<input value={contains} maxLength={10} inputMode="numeric" pattern="[0-9]{2,10}" onChange={(event) => setContains(event.target.value)} placeholder="e.g. 7861" /></label>
          <button className="calling-button" disabled={loading}>{loading ? "Searching…" : "Search numbers"}</button>
        </form>
        <div className="available-number-list" role="radiogroup" aria-label="Available UK numbers">
          {items.map((number) => <label className={`available-number ${selected?.phone_number === number.phone_number ? "is-selected" : ""}`} key={number.phone_number}>
            <input type="radio" name="available-number" checked={selected?.phone_number === number.phone_number} onChange={() => { setSelected(number); setConfirmed(false); }} />
            <span><strong>{number.phone_number}</strong><small>Calls + SMS · {number.number_type}{number.address_requirements !== "none" ? " · Approved address required" : ""}</small></span><span>{money(number.monthly_price, number.currency)}<small>/ month</small></span>
          </label>)}
          {!loading && !items.length && <p>No matching numbers are available. Try another type or search.</p>}
        </div>
        {selected && <label className="number-purchase-consent"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>I confirm purchasing <strong>{selected.phone_number}</strong> at <strong>{money(selected.monthly_price, selected.currency)} per month</strong>, plus usage and taxes.</span></label>}
      <p className="calling-fine-print">{(selected?.payment_required ?? items[0]?.payment_required) ? "Pay VedoraEats through Stripe before the number is purchased from Twilio. This is a monthly subscription at 2× the provider rental price. If provisioning fails, the subscription is cancelled and a full refund is requested. Availability is not reserved during checkout." : "Platform admin purchases use the Twilio balance directly."} Some UK numbers require an approved regulatory bundle and address for your account.</p>
      </fieldset>
    </>}
  </NumberDialog>;
}

export function SmsDialog({ user, numbers, initialFrom, onClose, onChanged, onAuthRequired }) {
  const [from, setFrom] = useState(initialFrom || numbers.find((n) => n.sms_enabled)?.phone_number || "");
  const [to, setTo] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState(null);
  const request = useRef(null);
  const inFlight = useRef(false);
  const refresh = useCallback(async () => {
    if (!message?.id) return;
    try { const data = await outreachRequest(`messages/${message.id}`, user); setMessage(data.message); setError(""); }
    catch (err) { setError(err.message); if (err instanceof SignInRequiredError) onAuthRequired(err); }
  }, [message?.id, user]);
  useEffect(() => {
    if (!message || !pending(message.status)) return;
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [message?.id, message?.status, refresh]);
  const send = async (event) => {
    event.preventDefault(); if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    request.current ||= { request_id: crypto.randomUUID(), from_number: from, to_number: to, body: text };
    try {
      const data = await outreachRequest("messages", user, request.current);
      setMessage(data.message); setUncertain(false); onChanged();
    } catch (err) {
      setError(err.message);
      if (err instanceof SignInRequiredError) onAuthRequired(err);
      else if (err.status >= 400 && err.status < 500) { request.current = null; setUncertain(false); }
      else setUncertain(true);
    } finally { setBusy(false); inFlight.current = false; }
  };
  return <NumberDialog title="Send an SMS" subtitle="Send from a number assigned to your account." busy={busy} onClose={onClose} footer={<>
    <button className="calling-button" disabled={busy} onClick={onClose}>Close</button>
    {!message && <button type="submit" form="sms-compose" className="calling-button is-primary" disabled={busy || (!uncertain && !from)}>{busy ? <LoaderCircle className="spin" size={17} /> : <MessageSquareText size={17} />}{busy ? "Sending…" : uncertain ? "Check message request" : "Send SMS"}</button>}
    {message && <button className="calling-button" onClick={refresh}><RefreshCw size={17} /> Refresh status</button>}
  </>}>
    {error && <p className="calling-alert is-error" role="alert">{error}</p>}
    {message ? <div className="sms-result" role="status"><h3>{message.status === "delivered" ? "Message delivered" : "Message saved"}</h3><span className={`calling-status status-${message.status}`}>{readable(message.status)}</span><p><strong>To:</strong> {message.to_number}</p><p><strong>From:</strong> {message.from_number}</p><p className="sms-result-body">{message.body}</p>{message.error && <p className="calling-alert">{message.error}</p>}<p className="calling-fine-print">Delivery status updates while this panel is open. You can also find this message in Numbers & SMS.</p></div> : <form id="sms-compose" onSubmit={send}>
      {uncertain && <p className="calling-alert">Your message may already have been accepted. Check this same request to retrieve its status.</p>}
      <fieldset className="calling-form-fields sms-compose-fields" disabled={busy || uncertain}>
        <label>From your number<select required value={from} onChange={(e) => setFrom(e.target.value)}><option value="">Select your number</option>{numbers.filter((n) => n.sms_enabled).map((n) => <option key={n.sid} value={n.phone_number}>{n.phone_number}</option>)}</select></label>
        <label>To UK phone number<input required type="tel" inputMode="tel" maxLength={40} value={to} onChange={(e) => setTo(e.target.value)} placeholder="07… or +44…" /></label>
        <label>Message<textarea required rows={5} maxLength={1600} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write your message…" /><small>{text.length} / 1,600 characters · Long messages and emojis may use multiple billable SMS segments.</small></label>
      </fieldset>
    </form>}
  </NumberDialog>;
}
