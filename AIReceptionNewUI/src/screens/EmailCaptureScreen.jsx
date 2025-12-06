export default function EmailCaptureScreen({
  email,
  status,
  responseMessage,
  onEmailChange,
  onSubmit,
  onSendDifferentUrl
}) {
  return (
    <section className="email-capture-layout">
      <div className="form-card">
        <div>
          <p className="eyebrow">Success</p>
          <h2>All website data loaded fine</h2>
          <p className="lead narrow">
            Share an email to receive your AI reception report and next steps.
          </p>
        </div>
        <form className="url-form" onSubmit={onSubmit}>
          <label htmlFor="email">Work email</label>
          <div className="input-row">
            <input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => onEmailChange(event.target.value)}
              required
            />
            <button className="primary" type="submit">
              Continue
            </button>
          </div>
        </form>
        <button className="ghost small" onClick={onSendDifferentUrl}>
          ← Send a different URL
        </button>
        {responseMessage && <div className={`status ${status}`}>{responseMessage}</div>}
      </div>

      <aside className="info-card">
        <p className="eyebrow">What happens next</p>
        <h3>We’ll use your email to:</h3>
        <ul>
          <li>Send your crawl summary and the AI receptionist prompt.</li>
          <li>Provision your dashboard with the website you just shared.</li>
          <li>Share booking and calendar setup instructions.</li>
        </ul>
        <div className="pill note">We’ll only contact you about this setup.</div>
      </aside>
    </section>
  );
}
