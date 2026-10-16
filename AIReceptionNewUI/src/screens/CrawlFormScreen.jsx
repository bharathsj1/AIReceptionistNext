export default function CrawlFormScreen({
  url,
  status,
  responseMessage,
  onSubmit,
  onUrlChange,
  onBack,
  onSkipWebsite,
}) {
  return (
    <section className="crawl-layout screen-panel">
      <div className="form-card">
        <div>
          <p className="eyebrow">Connect your site</p>
          <h2>Let’s get to know your business.</h2>
          <p className="lead narrow">
            Share your website and we’ll find the company information your AI
            needs for a useful first introduction. You’ll review it before continuing.
          </p>
        </div>

        <form className="url-form crawl-form" onSubmit={onSubmit}>
          <label htmlFor="url">Website address</label>
          <div className="input-row">
            <input
              id="url"
              type="url"
              placeholder="https://www.example.com/"
              value={url}
              onChange={(event) => onUrlChange(event.target.value)}
              required
            />
            <button
              className="primary"
              type="submit"
              disabled={status === "loading"}
            >
              {status === "loading" ? "Sending..." : "Find my business details"}
            </button>
          </div>
          <p className="hint">
            We use publicly available pages. You can edit the details in the
            next step.
          </p>
        </form>

        <div
          className="input-row"
          style={{ justifyContent: "space-between", alignItems: "center" }}
        >
          <button className="ghost small" onClick={onBack}>
            ← Back
          </button>
          <button type="button" className="ghost small" onClick={onSkipWebsite}>
            I don't have a website
          </button>
        </div>

        {responseMessage && (
          <div className={`status ${status}`}>{responseMessage}</div>
        )}
      </div>
      <aside className="crawl-aside">
        <p className="eyebrow">What happens next</p>
        <h3>A head start, made for you.</h3>
        <ul>
          <li>Find your services, opening hours, and contact details.</li>
          <li>Review and refine how your AI speaks about your business.</li>
          <li>Create a campaign and review your contacts before making calls.</li>
        </ul>
        <p className="hint">
          No website yet? Add your details yourself — you’ll get the same guided
          setup.
        </p>
      </aside>
    </section>
  );
}
