export default function CrawlFormScreen({
  url,
  status,
  responseMessage,
  onSubmit,
  onUrlChange,
  onBack,
  onSkipWebsite
}) {
  return (
    <section className="crawl-layout">
      <div className="form-card">
        <div>
          <p className="eyebrow">Connect your site</p>
          <h2>Share a URL to start the crawl</h2>
          <p className="lead narrow">
            We will send the address to the AI receptionist service running
            locally so it can begin ingesting your content.
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
              {status === "loading" ? "Sending..." : "Send to AI Reception"}
            </button>
          </div>
          <p className="hint">POST to /api/crawl-kb</p>
        </form>

        <div className="input-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <button className="ghost small" onClick={onBack}>
            ← Back
          </button>
          <button type="button" className="ghost small" onClick={onSkipWebsite}>
            I don't have a website
          </button>
        </div>

        {responseMessage && <div className={`status ${status}`}>{responseMessage}</div>}
      </div>
      <aside className="crawl-aside">
        <p className="eyebrow">What happens next</p>
        <h3>We ingest and wire your concierge</h3>
        <ul>
          <li>Fetch your pages and structure them for AI-ready knowledge.</li>
          <li>Generate a tailored prompt that mirrors your brand voice.</li>
          <li>Provision the receptionist to greet, route, and capture leads.</li>
        </ul>
        <p className="hint">
          Need a new account? Use the login page “Create an account” link to jump here automatically.
        </p>
      </aside>
    </section>
  );
}
