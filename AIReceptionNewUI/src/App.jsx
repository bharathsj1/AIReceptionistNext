import { useMemo, useState } from "react";
import API_URLS from "./config/urls";
import ThreeHero from "./components/ThreeHero";

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
  const [crawlData, setCrawlData] = useState(null);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [loadingPhase, setLoadingPhase] = useState("crawl");
  const [provisionData, setProvisionData] = useState(null);
  const loadingSteps = useMemo(
    () => ({
      crawl: [
        "Packaging your website URL",
        "Notifying AI Reception service",
        "Crawling and ingesting content"
      ],
      provision: [
        "Building Ultravox prompt",
        "Provisioning AI reception client",
        "Finalizing setup"
      ]
    }),
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
    setLoadingPhase("crawl");
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

      const data = await res
        .json()
        .catch(async () => ({ raw: await res.text() }));

      setCrawlData(data);
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
    setUrl("");
    setCrawlData(null);
    setSystemPrompt("");
    setProvisionData(null);
    setLoadingPhase("crawl");
    setStage(STAGES.CRAWL_FORM);
  };

  const handleGoHome = () => {
    setStatus("idle");
    setResponseMessage("");
    setShowLoader(false);
    setEmail("");
    setUrl("");
    setCrawlData(null);
    setSystemPrompt("");
    setProvisionData(null);
    setLoadingPhase("crawl");
    setStage(STAGES.LANDING);
  };

  const handleEmailSubmit = async (event) => {
    event.preventDefault();
    setStatus("loading");
    setResponseMessage("");
    setShowLoader(true);
    setLoadingPhase("provision");
    setStage(STAGES.LOADING);

    try {
      const promptPayload = {
        business_name: crawlData?.business_name || "Horizon Property Group",
        pages:
          crawlData?.pages ||
          crawlData?.data ||
          crawlData?.raw ||
          []
      };

      const promptRes = await fetch(API_URLS.ultravoxPrompt, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        mode: "cors",
        body: JSON.stringify(promptPayload)
      });

      if (!promptRes.ok) {
        const promptText = await promptRes.text();
        throw new Error(promptText || "Failed to generate Ultravox prompt");
      }

      const promptData = await promptRes
        .json()
        .catch(async () => ({ prompt: await promptRes.text() }));
      const derivedPrompt =
        promptData?.system_prompt ||
        promptData?.prompt ||
        promptData?.message ||
        promptData?.raw ||
        "Your custom Ultravox system prompt here...";

      setSystemPrompt(derivedPrompt);

      const provisionPayload = {
        email,
        website_url: url,
        system_prompt: derivedPrompt
      };

      const provisionRes = await fetch(API_URLS.provisionClient, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        mode: "cors",
        body: JSON.stringify(provisionPayload)
      });

      if (!provisionRes.ok) {
        const provText = await provisionRes.text();
        throw new Error(provText || "Failed to provision client");
      }

      const provData = await provisionRes
        .json()
        .catch(async () => ({ raw: await provisionRes.text() }));

      setProvisionData(provData);
      setStatus("success");
      setResponseMessage("Your AI receptionist is ready!");
      setStage(STAGES.COMPLETE);
    } catch (error) {
      setStatus("error");
      setResponseMessage(
        error?.message ||
          "Unable to finish setup. Please try again."
      );
      setStage(STAGES.COMPLETE);
    } finally {
      setShowLoader(false);
    }
  };

  return (
    <div className="page">
      <div className="background-glow" />
      <header className="top-bar">
        <div
          className="brand"
          onClick={handleGoHome}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              handleGoHome();
            }
          }}
          role="button"
          tabIndex={0}
        >
          <span className="brand-mark">AI</span>
          <span className="brand-name">Reception</span>
        </div>
        <nav className="nav-links" aria-label="Primary">
          <button type="button" className="nav-link">Overview</button>
          <button type="button" className="nav-link">Benefits</button>
          <button type="button" className="nav-link">Customers</button>
          <button type="button" className="nav-link">Products</button>
          <button type="button" className="nav-link">Pricing</button>
        </nav>
        <div className="header-actions">
          <button className="ghost" type="button">Find a plan</button>
          <button className="primary" type="button" onClick={() => setStage(STAGES.CRAWL_FORM)}>
            Try for free
          </button>
        </div>
      </header>

      <main className="content">
        {stage === STAGES.LANDING ? (
          <section className="hero">
            <div className="hero-copy">
              <p className="eyebrow">AI support suite</p>
              <h1>Build faster, together.</h1>
              <p className="lead">
                Design, build, debug and ship your next AI receptionist in one suite.
              </p>
              <div className="actions hero-actions">
                <button className="primary" onClick={() => setStage(STAGES.CRAWL_FORM)}>
                  Try for free
                </button>
                <button className="ghost" onClick={() => setStage(STAGES.CRAWL_FORM)}>
                  Book a demo
                </button>
              </div>
            </div>
            <div className="hero-visual" aria-hidden="true">
              <ThreeHero />
            </div>
          </section>
        ) : null}

        {stage === STAGES.LANDING ? (
          <section className="logo-row" aria-label="Trusted by">
            <div className="logo-track">
              <span>AMD</span>
              <span>Canon</span>
              <span>Unity</span>
              <span>JetBrains</span>
              <span>GitHub</span>
              <span>AMD</span>
              <span>Canon</span>
              <span>Unity</span>
              <span>JetBrains</span>
              <span>GitHub</span>
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
                {status === "loading" && loadingPhase === "crawl"
                  ? "Sending to AI Reception"
                  : status === "loading" && loadingPhase === "provision"
                  ? "Finalizing your AI reception setup"
                  : status === "success"
                  ? "All website data loaded fine"
                  : "Unable to complete request"}
              </h2>
              <p className="lead narrow">
                {status === "loading" && loadingPhase === "crawl"
                  ? "We are dispatching your URL and preparing the crawl."
                  : status === "loading" && loadingPhase === "provision"
                  ? "Generating your Ultravox prompt and provisioning the client."
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
                  {(loadingSteps[loadingPhase] || []).map((step, index) => (
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
              <h2>
                {status === "success"
                  ? "Congratulations! Your AI receptionist is live."
                  : "We could not finish setup"}
              </h2>
              <p className="lead narrow">
                {status === "success"
                  ? `Linked to ${email || "your email"}.`
                  : responseMessage || "Please try again or adjust your inputs."}
              </p>
            </div>
            {status === "success" && (
              <div className="celebrate">
                <div className="light-beam" aria-hidden="true" />
                <div className="orb one" aria-hidden="true" />
                <div className="orb two" aria-hidden="true" />
                <div className="ribbon left" aria-hidden="true" />
                <div className="ribbon right" aria-hidden="true" />
                <div className="ready-card">
                  <p className="eyebrow">AI receptionist ready</p>
                  <h3>{provisionData?.name || "Your AI Reception"}</h3>
                  <p className="lead">
                    You can start connecting callers and visitors.
                  </p>
                  {provisionData?.phone_number && (
                    <div className="big-number">{provisionData.phone_number}</div>
                  )}
                  <div className="badge">
                    {responseMessage || "Your AI receptionist is ready!"}
                  </div>
                </div>
              </div>
            )}
            {status !== "success" && responseMessage && (
              <div className={`status ${status}`}>
                {responseMessage}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
