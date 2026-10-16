import { useEffect, useRef, useState } from "react";
import { BadgeCheck, LoaderCircle, MailCheck } from "lucide-react";
import { outreachRequest } from "../../lib/api/outreach";
import { authToken, SignInRequiredError } from "../../lib/authSession";
import "./EmailVerificationPanel.css";

export default function EmailVerificationPanel({ user, onAuthRequired }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [reloadVersion, setReloadVersion] = useState(0);
  const inFlight = useRef(false);
  const token = authToken(user);
  const apply = (payload) => {
    setStatus(payload);
    setSeconds(payload.resend_after_seconds || 0);
  };
  useEffect(() => {
    let active = true;
    setLoading(true);
    setStatus(null);
    setError("");
    setCode("");
    setNotice("");
    outreachRequest("email-verification", user).then((payload) => {
      if (active) apply(payload);
    }).catch((err) => {
      if (!active) return;
      if (err instanceof SignInRequiredError) onAuthRequired?.(err);
      else setError(err.message);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user?.email, token, reloadVersion]);
  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [seconds > 0]);
  const submit = async (operation) => {
    if (inFlight.current) return;
    if (operation === "verify" && !/^[0-9]{6}$/.test(code.trim())) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    inFlight.current = true;
    setBusy(operation);
    setError("");
    setNotice("");
    try {
      const payload = await outreachRequest(`email-verification/${operation}`, user,
        { email: status.email, ...(operation === "verify" ? { code: code.trim() } : {}) });
      apply(payload);
      setCode("");
      setNotice(operation === "send" ? `A 6-digit code was sent to ${payload.email}. It expires in 10 minutes.` : "Your email is verified.");
    } catch (err) {
      if (err instanceof SignInRequiredError) onAuthRequired?.(err);
      else {
        setError(err.message);
        if (err.payload?.resend_after_seconds > 0) setSeconds(err.payload.resend_after_seconds);
        if (operation === "send") {
          try { apply(await outreachRequest("email-verification", user)); }
          catch { /* Keep the original delivery error; do not repeat the send. */ }
        }
      }
    } finally {
      inFlight.current = false;
      setBusy("");
    }
  };
  return (
    <div className="calling-email-verification">
      <div className="calling-email-heading">
        <div>
          <h3>Your email verification</h3>
          <p>{status?.email || user?.email}</p>
        </div>
        {status?.is_email_verified ? <span className="calling-email-badge is-verified"><BadgeCheck size={18} />Verified</span>
          : <span className="calling-email-badge"><MailCheck size={18} />{loading ? "Checking…" : status ? "Not verified" : "Unavailable"}</span>}
      </div>
      {loading ? <p role="status">Checking verification status…</p> : status && !status.is_email_verified && <>
        <p>Confirm that you can receive emails at your signed-in address.</p>
        {!status.delivery_configured && <p className="calling-alert">Email delivery is not configured. Your administrator needs to configure SMTP or SendGrid to send verification codes.</p>}
        <button type="button" className="calling-button" disabled={Boolean(busy) || seconds > 0 || !status.delivery_configured} onClick={() => submit("send")}>
          {busy === "send" && <LoaderCircle size={16} className="calling-spin" />}
          {busy === "send" ? "Sending code…" : seconds > 0 ? `Resend in ${seconds}s` : status.challenge_pending ? "Send a new code" : "Send verification code"}
        </button>
        {status.challenge_pending && <form className="calling-email-code" onSubmit={(event) => { event.preventDefault(); submit("verify"); }}>
          <label>Verification code<input name="email-verification-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required
            placeholder="6-digit code" value={code} onChange={(event) => setCode(event.target.value.replace(/[^0-9]/g, ""))} disabled={Boolean(busy)} /></label>
          <button className="calling-button is-primary" disabled={Boolean(busy) || code.length !== 6}>{busy === "verify" ? "Verifying…" : "Verify email"}</button>
        </form>}
      </>}
      <div aria-live="polite">{notice && <p className="calling-email-notice" role="status">{notice}</p>}</div>
      {error && <p className="calling-alert is-error" role="alert">{error}</p>}
      {!loading && !status && <button type="button" className="calling-button" onClick={() => setReloadVersion((value) => value + 1)}>Retry verification status</button>}
    </div>
  );
}
