import { useCallback, useEffect, useRef, useState } from "react";
import { CreditCard, ExternalLink, LoaderCircle, RefreshCw, ShieldCheck, Wallet, X } from "lucide-react";
import { outreachRequest } from "../../lib/api/outreach";
import { SignInRequiredError } from "../../lib/authSession";
import { useDialogFocus } from "../ui/useDialogFocus";
import "./BillingWorkspace.css";

export const gbp = (pence) => new Intl.NumberFormat("en-GB", {style:"currency",currency:"GBP"}).format((pence || 0) / 100);
export const minuteRate = (rate) => new Intl.NumberFormat("en-GB", {style:"currency",currency:"GBP",minimumFractionDigits:2,maximumFractionDigits:4}).format(Number(rate || 0));
export function stripeRedirect(url) {
  if (typeof url !== "string" || new URL(url).origin !== "https://checkout.stripe.com") throw new Error("The payment provider did not return a secure Stripe checkout.");
  window.location.assign(url);
}

export function WalletSummary({ billing, onOpen }) {
  if (!billing) return null;
  const admin = billing.is_platform_admin;
  return <section className={`calling-panel billing-wallet-summary ${admin ? "is-admin" : ""}`} aria-label="Calling credit balance">
    <span className="billing-wallet-icon">{admin ? <ShieldCheck size={25}/> : <Wallet size={25}/>}</span>
    <div><span className="calling-eyebrow">{admin ? "PLATFORM ADMIN" : "CALLING WALLET"}</span>
      <strong>{admin ? "Use your provider balance" : `${Number(billing.wallet?.available_pence || 0).toLocaleString("en-GB")} credits available`}</strong>
      <p>{admin ? "Your signed-in admin account is exempt from wallet charges." : `${gbp(billing.wallet?.available_pence)} available · 1 credit = 1p${billing.wallet?.reserved_pence ? ` · ${gbp(billing.wallet.reserved_pence)} reserved for calls` : ""}`}</p>
    </div>
    <button className="calling-button is-primary" onClick={onOpen}>{admin ? "Billing settings" : "Add balance"}</button>
  </section>;
}

export function CallPriceCard({ quote, wallet, admin, loading, error, onAddBalance }) {
  if (admin) return <div className="billing-call-price"><ShieldCheck size={20}/><div><strong>Platform admin · no wallet charge</strong><p>Twilio and Ultravox usage is billed directly to your provider accounts.</p></div></div>;
  const available = wallet?.available_pence || 0;
  return <div className="billing-call-price" aria-live="polite"><Wallet size={20}/><div>
    <strong>{loading ? "Checking the current call price…" : quote ? `${minuteRate(quote.rate_gbp)} per started minute` : "Enter a UK number to see its call price"}</strong>
    {quote && <p>{Number(quote.credits_per_minute).toFixed(2)} credits/min · Final charge rounded up to the nearest penny.</p>}
    <p>{available.toLocaleString("en-GB")} credits ({gbp(available)}) available. Funds are reserved before dialling and unused funds are released after the call. Calls stop at the duration your balance covers, up to 10 minutes.</p>
    {error && <p className="calling-inline-warning">{error}</p>}
    {(!available || (quote && available < quote.minimum_pence) || wallet?.frozen) && <><p className="calling-inline-warning">{wallet?.frozen ? "This wallet needs payment review. Contact support." : "Add balance before making this call."}</p><button type="button" className="calling-button" onClick={onAddBalance}>Open wallet</button></>}
  </div></div>;
}

export function CampaignPriceDialog({ quote, billing, busy, onClose, onApprove, onAddBalance, error }) {
  const ref = useRef(null);
  useDialogFocus(ref, true, onClose);
  const eligible = !billing?.wallet?.frozen && billing?.wallet?.available_pence >= quote.minimum_pence;
  return <div className="calling-dialog-backdrop"><section className="calling-dialog billing-approval-dialog" ref={ref} role="dialog" aria-modal="true" aria-labelledby="campaign-price-title" tabIndex={-1}>
    <header className="calling-dialog-heading"><div><span className="calling-eyebrow">REVIEW YOUR CALL PRICE</span><h2 id="campaign-price-title">Start with a clear budget.</h2><p>Next contact: {quote.phone}</p></div><button className="calling-icon" disabled={busy} onClick={onClose} aria-label="Close price review"><X size={20}/></button></header>
    <div className="billing-approval-body">{error && <p className="calling-alert is-error" role="alert">{error}</p>}<CallPriceCard quote={quote} wallet={billing?.wallet} onAddBalance={onAddBalance}/><p>This price becomes the campaign’s maximum approved rate. If a later destination costs more, the campaign pauses so you can review its price before it is called.</p></div>
    <footer className="calling-dialog-footer"><button className="calling-button" disabled={busy} onClick={onClose}>Cancel</button><button className="calling-button is-primary" disabled={busy || !eligible} onClick={onApprove}>{busy ? "Starting…" : "Approve price & start"}</button></footer>
  </section></div>;
}

export default function BillingWorkspace({ user, onAuthRequired, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [amount, setAmount] = useState(2500);
  const [busy, setBusy] = useState("");
  const [cancelOrder, setCancelOrder] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [stripeKey, setStripeKey] = useState("");
  const [stripePublishableKey, setStripePublishableKey] = useState("");
  const [stripeAccount, setStripeAccount] = useState(null);
  const [confirmStripe, setConfirmStripe] = useState(false);
  const [editStripeKeys, setEditStripeKeys] = useState(false);
  const cancelRef = useRef(null);
  useDialogFocus(cancelRef, Boolean(cancelOrder), () => { if (!inFlight.current) setCancelOrder(null); });
  const request = useRef(null);
  const inFlight = useRef(false);
  const load = useCallback(async () => {
    const result = await outreachRequest("billing", user);
    setData(result);
    if (result.is_platform_admin) {
      const overview = await outreachRequest("billing/admin/overview", user);
      setReviews(overview.orders);
    }
    return result;
  }, [user]);
  const failed = (err) => { setError(err.message); if (err instanceof SignInRequiredError) onAuthRequired(err); };
  useEffect(() => {
    let live = true;
    const returning = new URLSearchParams(window.location.search).get("billing_order");
    const refresh = async () => {
      try {
        if (returning) {
          const result = await outreachRequest(`billing/orders/${encodeURIComponent(returning)}`, user);
          if (live) setNotice(result.order.status === "completed" ? "Payment confirmed. Your purchase is ready." : result.order.status === "test_completed" ? "Test payment verified. No spendable credits or live Twilio number were created." : `Payment status: ${result.order.status.replaceAll("_", " ")}. Funds are only added after Stripe confirms payment.`);
        }
        if (live) await load();
      } catch (err) { if (live) failed(err); }
    };
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => { live = false; clearInterval(timer); };
  }, [load]);
  const topup = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy("topup"); setError("");
    request.current ||= {request_id:crypto.randomUUID(),amount_pence:amount};
    try {
      const result = await outreachRequest("billing/topups", user, request.current);
      await load();
      if (result.order.checkout_url) stripeRedirect(result.order.checkout_url);
      else setNotice(`Payment status: ${result.order.status.replaceAll("_", " ")}`);
    } catch (err) { failed(err); }
    finally {setBusy("");inFlight.current=false;}
  };
  const checkOrder = async (order) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(order.id); setError("");
    try {await outreachRequest(`billing/orders/${order.id}`,user);await load();onChanged();}
    catch(err){failed(err);}finally{inFlight.current=false;setBusy("");}
  };
  const connect = async () => {
    if (inFlight.current) return;
    inFlight.current = true;setBusy("connect");setError("");
    try {await outreachRequest("billing/admin/connect-stripe",user,{});await load();setNotice("Stripe billing is connected. Payment callbacks are signed and stored securely.");}
    catch(err){failed(err);}finally{inFlight.current=false;setBusy("");}
  };
  const configureKey = async (save = false) => {
    if (inFlight.current || (save && (!confirmStripe || !stripeAccount))) return;
    inFlight.current = true; setBusy("stripe-key"); setError("");
    try {
      const result = await outreachRequest("billing/admin/stripe-key", user, {
        secret_key: stripeKey, publishable_key: stripePublishableKey, ...(save ? { confirm_account: true, account_id: stripeAccount?.account_id } : {}),
      });
      setStripeAccount(result.account);
      if (result.account.saved) {
        setStripeKey(""); setStripePublishableKey(""); setConfirmStripe(false); setEditStripeKeys(false); await load();
        setNotice("Stripe credentials saved securely. Select Connect Stripe billing to enable signed payment callbacks.");
      }
    } catch (err) { failed(err); }
    finally { inFlight.current = false; setBusy(""); }
  };
  const cancel = async () => {
    if (inFlight.current || !cancelOrder) return;
    inFlight.current = true;setBusy("cancel");setError("");
    try {await outreachRequest(`billing/numbers/${cancelOrder.id}/cancel`,user,{confirm_cancel:true});setCancelOrder(null);await load();setNotice("Renewal cancelled. The number stays available until the paid period ends, then it will be released.");}
    catch(err){failed(err);}finally{inFlight.current=false;setBusy("");}
  };
  if (!data) return <section className="calling-panel billing-panel"><h2>Billing & wallet</h2><p>{error || "Loading your balance…"}</p><button className="calling-button" onClick={()=>load().catch(failed)}>Retry</button></section>;
  const admin = data.is_platform_admin;
  return <div className="billing-workspace">
    {error && <p className="calling-alert is-error" role="alert">{error}</p>}{notice && <p className="calling-alert" role="status">{notice}</p>}
    {data.stripe_test_mode && <p className="calling-alert" role="status"><strong>Stripe test mode.</strong> Checkout uses test payments. Successful test payments do not add spendable credits or buy real Twilio numbers.{admin ? " Your admin calls still use your provider balances directly." : " Customer calls remain unavailable in test mode."}</p>}
    <section className="calling-panel billing-panel">
      <header className="calling-panel-heading"><div><span className="calling-eyebrow">{admin ? "PLATFORM ADMIN" : "YOUR CALLING BUDGET"}</span><h2>{admin ? "Provider billing" : "Your credit wallet"}</h2><p>{admin ? "Your account uses provider balances directly." : "Add funds securely through Stripe. Credits appear only after payment is confirmed."}</p></div><Wallet size={25}/></header>
      <div className="billing-balance-grid">
        <div><span>{admin ? "Twilio provider balance" : "Available credits"}</span><strong>{admin ? data.provider_balance ? `${data.provider_balance.currency} ${Number(data.provider_balance.balance).toFixed(2)}` : "Unavailable" : Number(data.wallet.available_pence).toLocaleString("en-GB")}</strong><small>{admin ? "Ultravox usage is billed separately by Ultravox." : `${gbp(data.wallet.available_pence)} available · 1 credit = £0.01`}</small></div>
        <div><span>Reserved for calls</span><strong>{admin ? "Exempt" : gbp(data.wallet.reserved_pence)}</strong><small>Unused reserved funds return when the provider confirms the call has ended.</small></div>
      </div>
      {data.wallet.frozen && <p className="calling-alert is-error">This wallet is frozen following a payment dispute. Contact support before making more calls.</p>}
      {!admin && <div className="billing-topup"><h3>Add balance</h3><div className="billing-amounts" role="group" aria-label="Top-up amount">{data.topup_amounts_pence.map(value=><button key={value} aria-pressed={amount===value} disabled={Boolean(busy) || Boolean(request.current)} className={`calling-button ${amount===value?"is-primary":""}`} onClick={()=>setAmount(value)}>{gbp(value)}<small>{value.toLocaleString("en-GB")} credits</small></button>)}</div><button className="calling-button is-primary" disabled={Boolean(busy)||!data.stripe_configured} onClick={topup}>{busy==="topup"?<LoaderCircle size={18} className="spin"/>:<CreditCard size={18}/>}{data.stripe_test_mode?"Test checkout":"Pay"} {gbp(request.current?.amount_pence || amount)} with Stripe <ExternalLink size={16}/></button>{!data.stripe_configured&&<p className="calling-inline-warning">Payments await platform setup. No payment has been taken.</p>}<p>Wallet funds pay for calls. Number rental is a separate monthly Stripe subscription.</p></div>}
      {admin && <div className="billing-admin-setup"><h3>Stripe payment collection</h3><p>{data.stripe_configured ? "Connected · customers pay VedoraEats through signed Stripe checkout." : data.stripe_key_present ? "Stripe credentials are present. Connect the signed payment callback to enable customer checkout." : "Connect the Stripe account that will receive customer payments. Only your platform admin account can configure this."}</p>
        {!data.stripe_configured && data.stripe_key_present && !editStripeKeys && <button className="calling-button" disabled={Boolean(busy)} onClick={()=>setEditStripeKeys(true)}>Set keys for initial setup</button>}
        {(!data.stripe_key_present || editStripeKeys) && <form className="billing-stripe-form" onSubmit={event=>{event.preventDefault();configureKey(Boolean(stripeAccount));}}>
          <label>Stripe secret key<input type="password" name="stripe-api-secret" autoComplete="off" spellCheck={false} required maxLength={208} disabled={Boolean(busy)} value={stripeKey} placeholder="sk_live_… or sk_test_…" onChange={event=>{setStripeKey(event.target.value);setStripeAccount(null);setConfirmStripe(false);}}/><small>Enter the key directly here. It is encrypted on the backend and never saved in browser storage or returned by the API.</small></label>
          <label>Stripe publishable key (optional)<input type="password" name="stripe-publishable-key" autoComplete="off" spellCheck={false} maxLength={208} disabled={Boolean(busy)} value={stripePublishableKey} placeholder="pk_live_… or pk_test_…" onChange={event=>{setStripePublishableKey(event.target.value);setStripeAccount(null);setConfirmStripe(false);}}/><small>Hosted Stripe Checkout only requires the secret key. If supplied, the publishable key must use the same live or test mode.</small></label>
          {stripeAccount && <div className="billing-stripe-account" role="status"><strong>{stripeAccount.business_name}</strong><span>{stripeAccount.account_id} · {stripeAccount.mode === "live" ? "Live payments — real customer charges" : "Test mode — no live payments"}</span><label className="calling-checkbox"><input type="checkbox" checked={confirmStripe} disabled={Boolean(busy)} onChange={event=>setConfirmStripe(event.target.checked)}/><span>I confirm this is the Stripe account that should receive VedoraEats payments.</span></label></div>}
          <button className="calling-button is-primary" disabled={Boolean(busy)||!stripeKey||(Boolean(stripeAccount)&&!confirmStripe)}>{busy==="stripe-key"?"Checking…":stripeAccount?"Save Stripe credentials":"Validate Stripe account"}</button>
        </form>}
        {!data.stripe_configured&&data.stripe_key_present&&!editStripeKeys&&<button className="calling-button is-primary" disabled={Boolean(busy)} onClick={connect}>{busy==="connect"?"Connecting…":"Connect Stripe billing"}</button>}<p>Stripe receipts do not automatically top up Twilio. Keep your provider accounts funded so paid customer purchases and calls can be fulfilled.</p></div>}
    </section>
    <section className="calling-panel billing-panel"><header className="calling-panel-heading"><div><h2>How pricing works</h2><p>See the price before you pay or dial.</p></div></header><div className="billing-pricing-grid"><article><strong>Phone number</strong><p>2× Twilio’s number rental price, billed monthly through Stripe. Provisioning starts after confirmed payment.</p></article><article><strong>AI conversations</strong><p>{data.call_markup_mode==="twilio_only"?"2× the current Twilio outbound rate.":"2× the combined Twilio and Ultravox usage rate."} Destination-specific GBP prices are shown before calls. Usage is billed per started minute, with the final charge rounded up to a penny.</p></article><article><strong>Stay within your balance</strong><p>Credits are reserved before each call. The call duration is capped by your available balance, up to 10 minutes. Calls cannot start without enough credits for one minute.</p></article></div></section>
    <section className="calling-panel billing-panel"><header className="calling-panel-heading"><div><h2>Payments & number subscriptions</h2><p>Track checkout, provisioning, refunds, and monthly renewal.</p></div><button className="calling-button" onClick={()=>load().catch(failed)}><RefreshCw size={16}/>Refresh</button></header><div className="billing-order-list">{data.orders.length?data.orders.map(order=><article key={order.id}><div><strong>{order.kind==="number"?order.phone_number:"Wallet top-up"}</strong><span>{gbp(order.amount_pence)}{order.kind==="number"?" / month":""} · {order.status.replaceAll("_"," ")}</span>{order.paid_until&&<small>Paid until {new Date(order.paid_until).toLocaleDateString("en-GB")}{order.cancel_requested?" · Renewal cancelled":""}</small>}{order.error&&<p className="calling-inline-warning">{order.error}</p>}</div><div className="billing-order-actions">{order.checkout_url&&<button className="calling-button" disabled={Boolean(busy)} onClick={()=>{try{stripeRedirect(order.checkout_url);}catch(err){failed(err);}}}>Continue checkout</button>}<button className="calling-button" disabled={Boolean(busy)} onClick={()=>checkOrder(order)}>Check status</button>{order.kind==="number"&&order.status==="completed"&&!order.cancel_requested&&<button className="calling-text-button" disabled={Boolean(busy)} onClick={()=>setCancelOrder(order)}>Cancel renewal</button>}</div></article>):<p className="numbers-empty">Your payments will appear here.</p>}</div></section>
    <section className="calling-panel billing-panel"><header className="calling-panel-heading"><div><h2>Wallet transactions</h2><p>Every confirmed top-up, completed call charge, and refund.</p></div></header><div className="billing-ledger">{data.ledger.length?data.ledger.map(entry=><article key={entry.id}><div><strong>{entry.description}</strong><small>{new Date(entry.created_at).toLocaleString("en-GB")}</small></div><strong className={entry.amount_pence>0?"is-credit":""}>{entry.amount_pence>0?"+":""}{gbp(entry.amount_pence)}</strong></article>):<p className="numbers-empty">{admin?"Admin calls do not debit this wallet.":"No wallet transactions yet. Add balance to begin."}</p>}</div></section>
    {data.call_reservations?.some(row=>row.status==="reserved")&&<section className="calling-panel billing-panel"><header className="calling-panel-heading"><div><h2>Call reservations</h2><p>Held funds remain reserved until provider completion is confirmed.</p></div></header><div className="billing-ledger">{data.call_reservations.filter(row=>row.status==="reserved").map(row=><article key={row.lead_id}><div><strong>{minuteRate(row.rate_gbp)} / minute</strong><small>Maximum duration {row.max_duration_seconds/60} minutes · Pending settlement</small></div><strong>{gbp(row.reserved_pence)}</strong></article>)}</div></section>}
    {admin&&reviews.length>0&&<section className="calling-panel billing-panel"><header className="calling-panel-heading"><div><h2>Payments needing review</h2><p>Customer payment and provisioning requests that need attention.</p></div></header><div className="billing-order-list">{reviews.map(order=><article key={order.id}><div><strong>{order.customer_email}</strong><span>{order.phone_number||"Wallet top-up"} · {order.status.replaceAll("_"," ")}</span><p>{order.error}</p></div><strong>{gbp(order.amount_pence)}</strong></article>)}</div></section>}
    {cancelOrder&&<div className="calling-dialog-backdrop"><section className="calling-dialog billing-approval-dialog" ref={cancelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="cancel-number-title"><header className="calling-dialog-heading"><div><h2 id="cancel-number-title">Cancel number renewal?</h2><p>{cancelOrder.phone_number}</p></div></header><div className="billing-approval-body"><p>The number remains available until the paid period ends. After that, it will be released to Twilio and you may not be able to recover it.</p></div><footer className="calling-dialog-footer"><button className="calling-button" disabled={Boolean(busy)} onClick={()=>setCancelOrder(null)}>Keep number</button><button className="calling-button is-primary" disabled={Boolean(busy)} onClick={cancel}>Cancel renewal</button></footer></section></div>}
  </div>;
}
