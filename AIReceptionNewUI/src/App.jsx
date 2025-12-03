import { useMemo, useState } from "react";

const STAGES = {
  LANDING: "landing",
  CRAWL: "crawl"
};

// Use a relative path so Vite dev proxy can avoid CORS locally.
const endpoint = "/api/crawl-kb";

export default function App() {
  const [stage, setStage] = useState(STAGES.LANDING);
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("idle");
  const [responseMessage, setResponseMessage] = useState("");

  const heroCtas = useMemo(
    () => [
      "AI receptionist that never misses a visitor",
      "Onboards your site in seconds",
      "Secure hand-offs to your team"
    ],
    []
  );

  const handleSubmit = async (event) => {
    event.preventDefault();
    const trimmed = url.trim();

    if (!trimmed) {
      setResponseMessage("Please enter a website address first.");
      return;
    }

    setStatus("loading");
    setResponseMessage("");

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        mode: "cors",
        body: JSON.stringify({ url: trimmed })
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || "Request failed");
      }

      const text = await res.text();
      setResponseMessage(text || "Crawl request sent successfully.");
      setStatus("success");
    } catch (error) {
      setStatus("error");
      setResponseMessage(
        error?.message || "Unable to send request. Please try again."
      );
    }
  };

  return (
    <div className="page">
      <div className="background-glow" />
      <header className="top-bar">
        <div className="logo">AI Reception</div>
        <button className="ghost">Docs</button>
      </header>

      <main className="content">
        {stage === STAGES.LANDING ? (
          <section className="hero">
            <div className="hero-copy">
              <p className="eyebrow">Smart concierge for your site</p>
              <h1>
                Welcome every visitor <span>with AI precision</span>
              </h1>
              <p className="lead">
                Plug in your website, and our AI receptionist greets guests,
                answers questions, and routes real leads to your team
                instantly.
              </p>
              <ul className="points">
                {heroCtas.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <div className="actions">
                <button className="primary" onClick={() => setStage(STAGES.CRAWL)}>
                  Launch console
                </button>
                <button className="ghost">Watch demo</button>
              </div>
            </div>
            <div className="hero-panel">
              <div className="panel-header">
                <span className="dot red" />
                <span className="dot amber" />
                <span className="dot green" />
              </div>
              <div className="panel-body">
                <h3>24/7 AI Reception</h3>
                <p>
                  Preview the onboarding flow and send a crawl request to your
                  AI receptionist.
                </p>
                <button className="primary full" onClick={() => setStage(STAGES.CRAWL)}>
                  Start with your URL
                </button>
              </div>
            </div>
          </section>
        ) : (
          <section className="form-card">
            <div>
              <p className="eyebrow">Connect your site</p>
              <h2>Share a URL to start the crawl</h2>
              <p className="lead narrow">
                We will send the address to the AI receptionist service running
                locally so it can begin ingesting your content.
              </p>
            </div>

            <form className="url-form" onSubmit={handleSubmit}>
              <label htmlFor="url">Website address</label>
              <div className="input-row">
                <input
                  id="url"
                  type="url"
                  placeholder="https://www.example.com/"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
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
              <p className="hint">POST to {endpoint}</p>
            </form>

            {responseMessage && (
              <div className={`status ${status}`}>
                {responseMessage}
              </div>
            )}

            <button className="ghost small" onClick={() => setStage(STAGES.LANDING)}>
              ← Back to landing
            </button>
          </section>
        )}
      </main>
    </div>
  );
}
