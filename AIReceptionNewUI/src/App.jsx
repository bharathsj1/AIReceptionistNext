import { useMemo, useState } from "react";
import API_URLS from "./config/urls";

const STAGES = {
  LANDING: "landing",
  CRAWL_FORM: "crawlForm",
  LOADING: "loading",
  EMAIL_CAPTURE: "emailCapture",
  COMPLETE: "complete"
};

export default function App() {
  const [stage, setStage] = useState(STAGES.LANDING);
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("idle");
  const [responseMessage, setResponseMessage] = useState("");
  const [showLoader, setShowLoader] = useState(false);
  const [email, setEmail] = useState("");
  const loadingSteps = useMemo(
    () => [
      "Packaging your website URL",
      "Notifying AI Reception service",
      "Crawling and ingesting content"
    ],
    []
  );

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
    setShowLoader(true);
    setStage(STAGES.LOADING);

    try {
      const res = await fetch(API_URLS.crawlKnowledgeBase, {
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

      setResponseMessage("All website data loaded fine.");
      setStatus("success");
      setStage(STAGES.EMAIL_CAPTURE);
    } catch (error) {
      setStatus("error");
      setResponseMessage(
        error?.message || "Unable to send request. Please try again."
      );
    }
    setShowLoader(false);
  };

  const handleNewUrl = () => {
    setStatus("idle");
    setResponseMessage("");
    setShowLoader(false);
    setEmail("");
    setStage(STAGES.CRAWL_FORM);
  };

  const handleEmailSubmit = (event) => {
    event.preventDefault();
    setStage(STAGES.COMPLETE);
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
                <button className="primary" onClick={() => setStage(STAGES.CRAWL_FORM)}>
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
                <button className="primary full" onClick={() => setStage(STAGES.CRAWL_FORM)}>
                  Start with your URL
                </button>
              </div>
            </div>
          </section>
        ) : stage === STAGES.CRAWL_FORM ? (
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
              <p className="hint">POST to {API_URLS.crawlKnowledgeBase}</p>
            </form>

            <button className="ghost small" onClick={() => setStage(STAGES.LANDING)}>
              ← Back to landing
            </button>
          </section>
        ) : stage === STAGES.LOADING ? (
          <section className="progress-card">
            <div className="progress-header">
              <p className="eyebrow">AI Reception</p>
              <h2>
                {status === "loading"
                  ? "Sending to AI Reception"
                  : status === "success"
                  ? "All website data loaded fine"
                  : "Unable to send request"}
              </h2>
              <p className="lead narrow">
                {status === "loading"
                  ? "We are dispatching your URL and preparing the crawl."
                  : status === "success"
                  ? "Your site was ingested successfully. You can send another URL anytime."
                  : responseMessage || "Please try again with a valid URL."}
              </p>
            </div>

            {status === "loading" && (
              <div className="loading-block">
                <div className="loader large">
                  <span />
                  <span />
                  <span />
                </div>
                <ul className="loading-steps">
                  {loadingSteps.map((step, index) => (
                    <li key={step}>
                      <div className="bar">
                        <div
                          className="bar-fill"
                          style={{ animationDelay: `${index * 160}ms` }}
                        />
                      </div>
                      <span>{step}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {status !== "loading" && responseMessage && (
              <div className={`status ${status}`}>
                {responseMessage}
              </div>
            )}

            <div className="actions">
              <button className="primary" onClick={handleNewUrl} disabled={status === "loading"}>
                Send another URL
              </button>
              <button className="ghost" onClick={() => setStage(STAGES.LANDING)} disabled={status === "loading"}>
                Back to landing
              </button>
            </div>
          </section>
        ) : stage === STAGES.EMAIL_CAPTURE ? (
          <section className="form-card">
            <div>
              <p className="eyebrow">Success</p>
              <h2>All website data loaded fine</h2>
              <p className="lead narrow">
                Share an email to receive your AI reception report and next steps.
              </p>
            </div>
            <form className="url-form" onSubmit={handleEmailSubmit}>
              <label htmlFor="email">Work email</label>
              <div className="input-row">
                <input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
                <button className="primary" type="submit">
                  Continue
                </button>
              </div>
            </form>
            <button className="ghost small" onClick={handleNewUrl}>
              ← Send a different URL
            </button>
          </section>
        ) : (
          <section className="progress-card">
            <div className="progress-header">
              <p className="eyebrow">All set</p>
              <h2>Thanks! We’ll reach out shortly.</h2>
              <p className="lead narrow">
                Your crawl has been queued and linked to {email || "your email"}.
                You can return to the landing page or send another URL.
              </p>
            </div>
            <div className="actions">
              <button className="primary" onClick={handleNewUrl}>
                Send another URL
              </button>
              <button className="ghost" onClick={() => setStage(STAGES.LANDING)}>
                Back to landing
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
