import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const [user, setUser] = useState(null);
  const aiNumber = provisionData?.phone_number || "+1 (555) 123-4567";
  const recentCalls = [];
  const [activeTab, setActiveTab] = useState("dashboard");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [dateRange, setDateRange] = useState("Last 14 days");
  const ranges = ["Last 7 days", "Last 14 days", "Last 30 days", "Last 90 days"];
  const [calendarStatus, setCalendarStatus] = useState(null);
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarError, setCalendarError] = useState("");
  const googleStateRef = useRef(null);
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
      setIsLoggedIn(true);
    }, 800);
  };

  const goToCrawl = () => {
    setStage(STAGES.CRAWL_FORM);
    setStatus("idle");
    setResponseMessage("");
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    setStage(STAGES.LANDING);
    setStatus("idle");
    setResponseMessage("");
    setUser(null);
    setCrawlData(null);
    setSystemPrompt("");
    setProvisionData(null);
    setEmail("");
    setUrl("");
    setLoadingPhase("crawl");
    setCalendarStatus(null);
    setCalendarEvents([]);
    setCalendarError("");
    setCalendarLoading(false);
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

  const loadCalendarEvents = useCallback(
    async (emailAddress = user?.email) => {
      if (!emailAddress) return;
      setCalendarLoading(true);
      setCalendarError("");
      try {
        const res = await fetch(
          `${API_URLS.calendarEvents}?email=${encodeURIComponent(emailAddress)}`
        );
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || "Unable to fetch calendar events");
        }
        const data = await res.json();
        setCalendarEvents(data?.events || []);
        setCalendarStatus("Google");
      } catch (error) {
        setCalendarError(error?.message || "Unable to load events");
      } finally {
        setCalendarLoading(false);
      }
    },
    [user?.email]
  );

  const setLoggedInFromOAuth = useCallback(
    (payload) => {
      setUser({
        id: payload?.user_id,
        email: payload?.email,
        name: payload?.profile?.name || payload?.email
      });
      setIsLoggedIn(true);
      setStage(STAGES.DASHBOARD);
      setCalendarStatus("Google");
    },
    [setUser]
  );

  const completeGoogleAuth = useCallback(
    async (code, state) => {
      setStatus("loading");
      setResponseMessage("");
      try {
        const res = await fetch(API_URLS.googleAuthCallback, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, state })
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || "Google authentication failed");
        }
        const data = await res.json();
        setLoggedInFromOAuth(data);
        setResponseMessage("Google account connected.");
        setStatus("success");
        await loadCalendarEvents(data?.email);
      } catch (error) {
        setStatus("error");
        setResponseMessage(error?.message || "Google auth failed");
      }
    },
    [loadCalendarEvents, setLoggedInFromOAuth]
  );

  const beginGoogleLogin = async () => {
    setStatus("loading");
    setResponseMessage("");
    try {
      const res = await fetch(API_URLS.googleAuthUrl);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Unable to start Google sign-in");
      }
      const data = await res.json();
      googleStateRef.current = data?.state;
      const popup = window.open(
        data?.auth_url,
        "google-oauth",
        "width=520,height=640"
      );
      if (!popup) {
        throw new Error("Please allow pop-ups to sign in with Google.");
      }
    } catch (error) {
      setStatus("error");
      setResponseMessage(error?.message || "Google sign-in blocked");
    }
  };

  useEffect(() => {
    const handler = (event) => {
      const payload = event.data || {};
      if (!payload?.user_id || !payload?.email) return;
      if (googleStateRef.current && payload?.state && payload.state !== googleStateRef.current) {
        return;
      }
      setLoggedInFromOAuth(payload);
      setStatus("success");
      setResponseMessage("Google account connected.");
      loadCalendarEvents(payload?.email);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [loadCalendarEvents, setLoggedInFromOAuth]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    if (code) {
      completeGoogleAuth(code, state);
      params.delete("code");
      params.delete("state");
      const newUrl =
        window.location.pathname +
        (params.toString() ? `?${params.toString()}` : "");
      window.history.replaceState({}, document.title, newUrl);
    }
  }, [completeGoogleAuth]);

  const handleCalendarDisconnect = () => {
    setCalendarStatus(null);
    setCalendarEvents([]);
    setCalendarError("");
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
          {isLoggedIn ? (
            <button className="ghost" type="button" onClick={handleLogout}>
              Logout
            </button>
          ) : (
            <button className="ghost" type="button" onClick={() => setStage(STAGES.LOGIN)}>
              Login
            </button>
          )}
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
              <div className="oauth-buttons">
                <div className="divider">
                  <span>or</span>
                </div>
                <button className="oauth-button google" type="button" onClick={beginGoogleLogin} disabled={status === "loading"}>
                  <span className="icon">🔐</span> Continue with Google
                </button>
              </div>
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
                  <div className="nav-user-name">{user?.name || "You"}</div>
                  <div className="hint">{user?.email || "user@example.com"}</div>
                </div>
              </div>
            </aside>
            <div className="dash-main">
              <div className="dash-topbar">
                <div className="top-actions">
                  <div className="dropdown">
                    <button className="ghost small dropdown-toggle">
                      <span role="img" aria-label="calendar">📅</span> {dateRange}
                    </button>
                    <div className="dropdown-menu">
                      {ranges.map((range) => (
                        <button
                          key={range}
                          className={`dropdown-item ${range === dateRange ? "active" : ""}`}
                          onClick={() => setDateRange(range)}
                        >
                          {range}
                          {range === dateRange && <span className="check">✓</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="ai-number">
                    <span className="label">AI Number</span>
                    <span className="value number-link">{aiNumber}</span>
                    <span className="status-dot" aria-label="online" />
                  </div>
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

                  <div className="card-grid metrics">
                    <div className="metric-card">
                      <div>
                        <p className="hint">Total Calls</p>
                        <div className="metric-value">0</div>
                        <p className="hint">Last 14 days</p>
                      </div>
                      <div className="metric-icon">📞</div>
                    </div>
                    <div className="metric-card">
                      <div>
                        <p className="hint">Average Call Length</p>
                        <div className="metric-value">0:00</div>
                        <p className="hint">Last 14 days</p>
                      </div>
                      <div className="metric-icon">⏱</div>
                    </div>
                    <div className="metric-card">
                      <div>
                        <p className="hint">Total Minutes</p>
                        <div className="metric-value">0</div>
                        <p className="hint">Last 14 days</p>
                      </div>
                      <div className="metric-icon">⏲</div>
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
                  <p className="hint">Connect your calendar so your AI Receptionist can share availability and take bookings.</p>
                  {!calendarStatus ? (
                    <div className="calendar-connect">
                      <div className="calendar-header">
                        <div className="bubble">💬</div>
                        <div>
                          <h4>Your AI Receptionist takes messages</h4>
                          <p className="hint">
                            Your AI gathers customer details and lets them know you'll get back to them. You then call or text them back yourself.
                          </p>
                        </div>
                      </div>
                      <div className="calendar-body">
                        <h4>Ready to connect your calendar?</h4>
                        <p className="lead narrow">
                          Use Google to authenticate and we will pull a read-only view of your upcoming events.
                        </p>
                        <div className="calendar-options">
                          <button className="calendar-card" onClick={beginGoogleLogin} disabled={status === "loading"}>
                            <span className="icon">📆</span>
                            <span className="title">Connect Google Calendar</span>
                          </button>
                          <button className="calendar-card" disabled>
                            <span className="icon">📧</span>
                            <span className="title">Outlook (soon)</span>
                          </button>
                        </div>
                        <p className="hint">Takes about 30 seconds</p>
                        {calendarError && <div className="status error inline">{calendarError}</div>}
                      </div>
                      <div className="calendar-footnotes">
                        <span>🔒 Read-only. Your AI can check availability but cannot modify your calendar.</span>
                        <span>👁 Private. Only free/busy status is visible, not event details.</span>
                      </div>
                    </div>
                  ) : (
                    <div className="calendar-success">
                      <div className="bubble success">✓</div>
                      <div>
                        <h4>Connected to {calendarStatus}</h4>
                        <p className="hint">Your AI can now share availability and accept bookings.</p>
                        {calendarLoading ? (
                          <div className="loader small calendar-loader">
                            <span />
                            <span />
                            <span />
                          </div>
                        ) : calendarEvents.length === 0 ? (
                          <div className="empty-state">
                            <div className="icon">🗓</div>
                            <p>No upcoming events found.</p>
                          </div>
                        ) : (
                          <div className="calendar-events">
                            {calendarEvents.map((event) => (
                              <div className="event-row" key={event.id}>
                                <div>
                                  <div className="event-title">{event.summary || "No title"}</div>
                                  <div className="hint">
                                    {event.start?.dateTime || event.start?.date} → {event.end?.dateTime || event.end?.date}
                                  </div>
                                </div>
                                <div className="pill">Google</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="calendar-actions">
                        <button className="ghost small" onClick={() => loadCalendarEvents()}>
                          Refresh
                        </button>
                        <button className="ghost small" onClick={handleCalendarDisconnect}>
                          Disconnect
                        </button>
                      </div>
                      {calendarError && <div className="status error inline">{calendarError}</div>}
                    </div>
                  )}
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
