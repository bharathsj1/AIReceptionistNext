import { useEffect, useRef, useState } from "react";
import { outreachRequest } from "../../lib/api/outreach";
import { SignInRequiredError } from "../../lib/authSession";

export default function EmailDeliverySettings({ user, onAuthRequired, onSaved }) {
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState({ host: "", port: "587", username: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const inFlight = useRef(false);
  useEffect(() => {
    let active = true;
    outreachRequest("email-verification/settings", user).then((data) => {
      if (!active) return;
      setSettings(data);
      setForm({ host: data.host, port: String(data.port), username: data.username, password: "" });
      setError("");
    }).catch((err) => {
      if (!active) return;
      if (err instanceof SignInRequiredError) onAuthRequired?.(err);
      else setError(err.message);
    });
    return () => { active = false; };
  }, [user, reload]);
  const save = async (event) => {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(""); setNotice("");
    const body = { host: form.host, port: Number(form.port), username: form.username,
      ...(form.password ? { password: form.password } : {}) };
    try {
      const result = await outreachRequest("email-verification/settings", user, body);
      setSettings(result);
      setNotice("SMTP login and sender accepted. Settings saved. Send a verification code below to check your inbox.");
      onSaved();
    } catch (err) {
      if (err instanceof SignInRequiredError) onAuthRequired?.(err);
      else setError(err.message);
    } finally {
      setForm((current) => ({ ...current, password: "" }));
      inFlight.current = false; setBusy(false);
    }
  };
  const update = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  return <details className="calling-email-settings">
    <summary>Email delivery settings <span>Platform administrator</span></summary>
    <p>Use the SMTP credentials for <strong>support@vedoraeats.com</strong>. Saving checks the secure connection, login and sender without sending an email.</p>
    {settings ? <form onSubmit={save}>
      <fieldset disabled={busy}>
        <legend>Secure SMTP connection</legend>
        <label>SMTP host<input required autoComplete="off" placeholder="smtp.your-provider.com" value={form.host} onChange={update("host")} /></label>
        <label>Connection<select value={form.port} onChange={update("port")}><option value="587">587 · STARTTLS</option><option value="465">465 · SSL/TLS</option></select></label>
        <label>SMTP username<input required autoComplete="off" value={form.username} onChange={update("username")} /></label>
        <label>SMTP password or app password<input type="password" autoComplete="new-password" required={!settings.password_configured || form.host !== settings.host || form.username !== settings.username}
          value={form.password} onChange={update("password")} placeholder={settings.password_configured ? "Leave blank to keep the saved password" : "Enter the provider password"} /></label>
      </fieldset>
      <p>Your password is encrypted on the backend. It is never returned to the browser.</p>
      <button type="submit" className="calling-button is-primary" disabled={busy}>{busy ? "Checking connection…" : "Validate & save email settings"}</button>
    </form> : !error && <p role="status">Loading email settings…</p>}
    {error && <p role="alert" className="calling-alert is-error">{error}</p>}
    {!settings && error && <button className="calling-button" onClick={() => setReload((value) => value + 1)}>Retry email settings</button>}
    {notice && <p role="status" className="calling-email-notice">{notice}</p>}
  </details>;
}
