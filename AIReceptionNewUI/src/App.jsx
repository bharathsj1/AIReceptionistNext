import { useMemo, useState } from "react";
import API_URLS from "./config/urls";
import ThreeHero from "./components/ThreeHero";

const STAGES = {
  LANDING: "landing",
  LOGIN: "login",
  DASHBOARD: "dashboard",
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
  const [agentDetails, setAgentDetails] = useState({
    agentName: "Ultravox Concierge",
    greeting: "Hi, I'm your AI receptionist. How can I help today?",
    escalation: "Forward complex questions to the human team.",
    faq: "Hours: 9-6pm PT\nSupport: support@example.com"
  });
  const aiNumber = provisionData?.phone_number || "+1 (555) 123-4567";
  const recentCalls = [];
  const [activeTab, setActiveTab] = useState("dashboard");
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

  const handleLoginSubmit = (event) => {
    event.preventDefault();
    setStatus("loading");
    setResponseMessage("");

    setTimeout(() => {
      setStatus("success");
      setResponseMessage("Logged in (demo).");
      setStage(STAGES.DASHBOARD);
    }, 800);
  };

  const goToCrawl = () => {
    setStage(STAGES.CRAWL_FORM);
    setStatus("idle");
    setResponseMessage("");
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
          <button className="ghost" type="button" onClick={() => setStage(STAGES.LOGIN)}>
            Login
          </button>
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
                <button className="ghost" onClick={() => setStage(STAGES.LOGIN)}>
                  Login
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
        ) : stage === STAGES.LOGIN ? (
          <section className="login-layout">
            <div className="form-card login-card">
              <div>
                <p className="eyebrow">Welcome back</p>
                <h2>Login to AI Receptionist</h2>
                <p className="lead narrow">
                  Access your concierge dashboard and manage your reception flows.
                </p>
              </div>
              <form className="url-form" onSubmit={handleLoginSubmit}>
                <label htmlFor="login-email">Email</label>
                <input
                  id="login-email"
                  type="email"
                  placeholder="you@example.com"
                  required
                />
                <label htmlFor="login-password">Password</label>
                <input
                  id="login-password"
                  type="password"
                  placeholder="••••••••"
                  required
                />
                <button className="primary full" type="submit" disabled={status === "loading"}>
                  {status === "loading" ? "Signing in..." : "Login"}
                </button>
              </form>
              <div className="link-row">
                <button className="text-link" type="button">
                  Forgot password?
                </button>
                <button className="text-link" type="button" onClick={goToCrawl}>
                  Create an account
                </button>
              </div>
              {responseMessage && <div className={`status ${status}`}>{responseMessage}</div>}
            </div>
            <aside className="login-aside">
              <p className="eyebrow">How it works</p>
              <h3>AI Reception, on autopilot</h3>
              <ul>
                <li>Drop your website URL, we ingest your content in seconds.</li>
                <li>Generate conversational prompts tailored to your brand.</li>
                <li>Route real leads via voice, chat, or hand-offs to your team.</li>
              </ul>
              <p className="hint">New here? Hit Create an account to start with your URL.</p>
            </aside>
          </section>
        ) : stage === STAGES.DASHBOARD ? (
          <section className="dashboard-shell">
            <aside className="dash-nav">
              <div className="nav-brand">
                <span className="brand-mark">AI</span>
                <div>
                  <div className="brand-name">Reception</div>
                  <div className="tag pill">User</div>
                </div>
              </div>
              <nav className="nav-list">
                <button className={`nav-item ${activeTab === "dashboard" ? "active" : ""}`} onClick={() => setActiveTab("dashboard")}>
                  Dashboard
                </button>
                <button className={`nav-item ${activeTab === "calls" ? "active" : ""}`} onClick={() => setActiveTab("calls")}>
                  Calls
                </button>
                <button className={`nav-item ${activeTab === "bookings" ? "active" : ""}`} onClick={() => setActiveTab("bookings")}>
                  Bookings
                </button>
                <button className={`nav-item ${activeTab === "business" ? "active" : ""}`} onClick={() => setActiveTab("business")}>
                  My Business
                </button>
                <button className={`nav-item ${activeTab === "settings" ? "active" : ""}`} onClick={() => setActiveTab("settings")}>
                  Receptionist Settings
                </button>
                <button className={`nav-item ${activeTab === "routing" ? "active" : ""}`} onClick={() => setActiveTab("routing")}>
                  Call Routing
                </button>
              </nav>
              <div className="nav-user">
                <div className="avatar">U</div>
                <div>
                  <div className="nav-user-name">You</div>
                  <div className="hint">user@example.com</div>
                </div>
              </div>
            </aside>
            <div className="dash-main">
              <div className="dash-topbar">
                <div className="pill info-pill">Limited time: lock in 20% off forever</div>
                <div className="top-actions">
                  <button className="ghost small">Last 14 days</button>
                  <div className="ai-number">
                    <span className="label">AI Number</span>
                    <span className="value">{aiNumber}</span>
                  </div>
                  <button className="primary small">Upgrade</button>
                </div>
              </div>

              <div className="dashboard-header">
                <div>
                  <p className="eyebrow">Dashboard & Analytics</p>
                  <h2>Monitor calls and agent performance</h2>
                  <p className="lead narrow">
                    Track your receptionist, tune prompts, and keep admins in the loop.
                  </p>
                </div>
              </div>

              {activeTab === "dashboard" && (
                <>
                  <div className="card">
                    <div className="card-header">
                      <h3>Recent Calls</h3>
                      <button className="text-link">View all calls</button>
                    </div>
                    <div className="table">
                      <div className="table-head">
                        <span>Start Time</span>
                        <span>Caller</span>
                        <span>Phone</span>
                        <span>Duration</span>
                        <span>Call Reason</span>
                        <span>Lead Score</span>
                        <span>Action</span>
                      </div>
                      {recentCalls.length === 0 ? (
                        <div className="table-empty">
                          No calls yet — incoming calls will appear here.
                        </div>
                      ) : (
                        recentCalls.map((call) => (
                          <div className="table-row" key={call.id}>
                            <span>{call.startTime}</span>
                            <span>{call.caller}</span>
                            <span>{call.phone}</span>
                            <span>{call.duration}</span>
                            <span>{call.reason}</span>
                            <span>{call.score}</span>
                            <button className="ghost small">View</button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="card-grid">
                    <div className="card">
                      <h3>Call Reasons</h3>
                      <p className="hint">Last 14 days</p>
                      <div className="empty-state">
                        <div className="icon">📊</div>
                        <p>Reasons will populate after your first calls.</p>
                      </div>
                    </div>
                    <div className="card">
                      <h3>Daily Call Volume</h3>
                      <p className="hint">Last 14 days</p>
                      <div className="empty-state">
                        <div className="icon">📈</div>
                        <p>Call trends will display here.</p>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {activeTab === "settings" && (
                <div className="card-grid wide">
                  <div className="panel">
                    <h3>Receptionist settings</h3>
                    <label>Agent name</label>
                    <input
                      type="text"
                      value={agentDetails.agentName}
                      onChange={(e) => setAgentDetails({ ...agentDetails, agentName: e.target.value })}
                    />
                    <label>Greeting</label>
                    <textarea
                      rows={3}
                      value={agentDetails.greeting}
                      onChange={(e) => setAgentDetails({ ...agentDetails, greeting: e.target.value })}
                    />
                    <label>Escalation rule</label>
                    <textarea
                      rows={2}
                      value={agentDetails.escalation}
                      onChange={(e) => setAgentDetails({ ...agentDetails, escalation: e.target.value })}
                    />
                    <label>FAQs</label>
                    <textarea
                      rows={3}
                      value={agentDetails.faq}
                      onChange={(e) => setAgentDetails({ ...agentDetails, faq: e.target.value })}
                    />
                    <div className="button-row">
                      <button className="ghost small" type="button" onClick={handleGoHome}>
                        ← Back to home
                      </button>
                      <button className="primary" type="button">
                        Save changes
                      </button>
                    </div>
                  </div>
                  <div className="panel admin-panel">
                    <h3>Admin oversight</h3>
                    <p className="hint">Admins can review all agents and monitor edits.</p>
                    <div className="admin-table">
                      <div className="admin-row header">
                        <span>User</span>
                        <span>Agent</span>
                        <span>Status</span>
                      </div>
                      {["Alex", "Jordan", "Sam"].map((user) => (
                        <div className="admin-row" key={user}>
                          <span>{user}</span>
                          <span>Ultravox Concierge</span>
                          <span className="pill">Active</span>
                        </div>
                      ))}
                    </div>
                    <div className="admin-actions">
                      <button className="ghost small" type="button">Switch to admin view</button>
                      <button className="ghost small" type="button">Monitor changes</button>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "calls" && (
                <div className="card">
                  <div className="card-header">
                    <h3>Calls</h3>
                  </div>
                  <div className="table">
                    <div className="table-head">
                      <span>Start Time</span>
                      <span>Caller</span>
                      <span>Phone</span>
                      <span>Duration</span>
                      <span>Reason</span>
                      <span>Outcome</span>
                    </div>
                    <div className="table-empty">No calls yet.</div>
                  </div>
                </div>
              )}

              {activeTab === "bookings" && (
                <div className="card">
                  <h3>Bookings</h3>
                  <div className="empty-state">
                    <div className="icon">📅</div>
                    <p>Your bookings will appear here.</p>
                  </div>
                </div>
              )}

              {activeTab === "business" && (
                <div className="card">
                  <h3>My Business</h3>
                  <div className="empty-state">
                    <div className="icon">🏢</div>
                    <p>Configure business info, hours, and teams.</p>
                  </div>
                </div>
              )}

              {activeTab === "routing" && (
                <div className="card">
                  <h3>Call Routing</h3>
                  <div className="empty-state">
                    <div className="icon">🔀</div>
                    <p>Set routing rules and fallbacks.</p>
                  </div>
                </div>
              )}
            </div>
          </section>
        ) : stage === STAGES.CRAWL_FORM ? (
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

              <form className="url-form crawl-form" onSubmit={handleSubmit}>
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
                  {provisionData?.temp_password && (
                    <div className="credential">
                      <span className="label">Temp password</span>
                      <span className="value">{provisionData.temp_password}</span>
                    </div>
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
