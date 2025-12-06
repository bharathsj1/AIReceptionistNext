import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import API_URLS from "./config/urls";
import LandingScreen from "./screens/LandingScreen";
import LoginScreen from "./screens/LoginScreen";
import DashboardScreen from "./screens/DashboardScreen";
import CrawlFormScreen from "./screens/CrawlFormScreen";
import LoadingScreen from "./screens/LoadingScreen";
import EmailCaptureScreen from "./screens/EmailCaptureScreen";
import CompleteScreen from "./screens/CompleteScreen";

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
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
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
  const suppressHistoryRef = useRef(false);
  const hasMountedHistoryRef = useRef(false);
  const hasLoadedPersistedRef = useRef(false);
  const STORAGE_KEY = "ai-reception-app-state";
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

  const handleLoginSubmit = async (event) => {
    event.preventDefault();
    setStatus("loading");
    setResponseMessage("");

    try {
      const res = await fetch(API_URLS.authLogin, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail.trim(), password: loginPassword })
      });
      const text = await res.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { raw: text };
      }

      if (!res.ok) {
        throw new Error(data?.error || data?.details || "Login failed");
      }

      setUser({
        id: data?.user_id,
        email: data?.email,
        name: data?.email
      });
      setEmail(data?.email || "");
      setIsLoggedIn(true);
      setActiveTab("dashboard");
      setStage(STAGES.DASHBOARD);
      setStatus("success");
      setResponseMessage("Logged in successfully.");
    } catch (error) {
      setStatus("error");
      setResponseMessage(error?.message || "Login failed");
    }
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
    setLoginEmail("");
    setLoginPassword("");
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
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY);
      window.history.pushState({ stage: STAGES.LANDING }, "", "/");
    }
  };

  const handleGoToDashboard = () => {
    setActiveTab("dashboard");
    setIsLoggedIn(true);
    setUser((current) => {
      if (current) return current;
      return {
        name: provisionData?.name || email || "You",
        email: email || provisionData?.email || "user@example.com"
      };
    });
    setStage(STAGES.DASHBOARD);
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
      const isNewUser = Boolean(payload?.is_new_user);
      setUser({
        id: payload?.user_id,
        email: payload?.email,
        name: payload?.profile?.name || payload?.email
      });
      setIsLoggedIn(true);

      if (isNewUser) {
        setEmail(payload?.email || "");
        setStage(STAGES.CRAWL_FORM);
        setStatus("idle");
        setResponseMessage("Welcome! Enter your website to finish setup.");
        setCalendarStatus(null);
        setCalendarEvents([]);
        setCalendarError("");
        return;
      }

      setStage(STAGES.DASHBOARD);
      setCalendarStatus("Google");
    },
    [setCalendarError, setCalendarEvents, setCalendarStatus, setEmail, setResponseMessage, setStatus, setUser]
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
        const isNewUser = Boolean(data?.is_new_user);
        setLoggedInFromOAuth(data);
        setResponseMessage("Google account connected.");
        setStatus("success");
        if (!isNewUser) {
          await loadCalendarEvents(data?.email);
        }
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
      const isNewUser = Boolean(payload?.is_new_user);
      setLoggedInFromOAuth(payload);
      setStatus("success");
      setResponseMessage("Google account connected.");
      if (!isNewUser) {
        loadCalendarEvents(payload?.email);
      }
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

  useEffect(() => {
    if (hasLoadedPersistedRef.current) return;
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved.stage) setStage(saved.stage);
      if (saved.isLoggedIn) setIsLoggedIn(true);
      if (saved.user) setUser(saved.user);
      if (saved.email) setEmail(saved.email);
      if (saved.provisionData) setProvisionData(saved.provisionData);
      if (saved.activeTab) setActiveTab(saved.activeTab);
    } catch (error) {
      console.error("Failed to load persisted state", error);
    } finally {
      hasLoadedPersistedRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const path = window.location.pathname || "";
    const isDashboardPath = path === "/dashboard" || path.endsWith("/dashboard");
    if (!isDashboardPath) return;

    const hasSession = isLoggedIn || Boolean(user?.email);
    if (hasSession) {
      setStage(STAGES.DASHBOARD);
      setActiveTab("dashboard");
      return;
    }

    setStage(STAGES.LOGIN);
    setStatus("idle");
    setResponseMessage("");
    window.history.replaceState({ stage: STAGES.LOGIN }, "", "/login");
  }, [isLoggedIn, user]);

  // Ensure logged-in users retain access to dashboard across refreshes
  useEffect(() => {
    if (!isLoggedIn) return;
    if (stage === STAGES.DASHBOARD) return;
    setStage(STAGES.DASHBOARD);
    setActiveTab("dashboard");
    if (typeof window !== "undefined") {
      const path = window.location.pathname || "";
      if (path !== "/dashboard") {
        window.history.replaceState({ stage: STAGES.DASHBOARD }, "", "/dashboard");
      }
    }
  }, [isLoggedIn, stage]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const payload = {
        stage,
        isLoggedIn,
        user,
        email,
        provisionData,
        activeTab
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.error("Failed to persist state", error);
    }
  }, [stage, isLoggedIn, user, email, provisionData, activeTab]);

  useEffect(() => {
    if (!hasMountedHistoryRef.current) {
      window.history.replaceState({ stage }, "");
      hasMountedHistoryRef.current = true;
      return;
    }
    if (suppressHistoryRef.current) {
      suppressHistoryRef.current = false;
      return;
    }
    window.history.pushState({ stage }, "");
  }, [stage]);

  useEffect(() => {
    const handlePopState = (event) => {
      const nextStage = event.state?.stage || STAGES.LANDING;
      suppressHistoryRef.current = true;
      setStage(nextStage);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

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
          ) : stage === STAGES.LANDING ? (
            <button className="ghost" type="button" onClick={() => setStage(STAGES.LOGIN)}>
              Login
            </button>
          ) : null}
        </div>
      </header>

      <main className="content">
        {stage === STAGES.LANDING && (
          <LandingScreen
            onTry={() => setStage(STAGES.CRAWL_FORM)}
            onLogin={() => setStage(STAGES.LOGIN)}
          />
        )}

        {stage === STAGES.LOGIN && (
          <LoginScreen
            loginEmail={loginEmail}
            loginPassword={loginPassword}
            status={status}
            responseMessage={responseMessage}
            onLoginSubmit={handleLoginSubmit}
            onEmailChange={setLoginEmail}
            onPasswordChange={setLoginPassword}
            onGoogleLogin={beginGoogleLogin}
            onCreateAccount={goToCrawl}
            onForgotPassword={() => {}}
          />
        )}

        {stage === STAGES.DASHBOARD && (
          <DashboardScreen
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            ranges={ranges}
            dateRange={dateRange}
            setDateRange={setDateRange}
            aiNumber={aiNumber}
            recentCalls={recentCalls}
            user={user}
            agentDetails={agentDetails}
            setAgentDetails={setAgentDetails}
            handleGoHome={handleGoHome}
            calendarStatus={calendarStatus}
            calendarLoading={calendarLoading}
            calendarEvents={calendarEvents}
            calendarError={calendarError}
            loadCalendarEvents={loadCalendarEvents}
            handleCalendarDisconnect={handleCalendarDisconnect}
            beginGoogleLogin={beginGoogleLogin}
            status={status}
          />
        )}

        {stage === STAGES.CRAWL_FORM && (
          <CrawlFormScreen
            url={url}
            status={status}
            responseMessage={responseMessage}
            onSubmit={handleSubmit}
            onUrlChange={setUrl}
            onBack={() => setStage(STAGES.LANDING)}
          />
        )}

        {stage === STAGES.LOADING && (
          <LoadingScreen
            status={status}
            loadingPhase={loadingPhase}
            loadingSteps={loadingSteps}
            responseMessage={responseMessage}
          />
        )}

        {stage === STAGES.EMAIL_CAPTURE && (
          <EmailCaptureScreen
            email={email}
            status={status}
            responseMessage={responseMessage}
            onEmailChange={setEmail}
            onSubmit={handleEmailSubmit}
            onSendDifferentUrl={handleNewUrl}
          />
        )}

        {stage === STAGES.COMPLETE && (
          <CompleteScreen
            status={status}
            responseMessage={responseMessage}
            provisionData={provisionData}
            email={email}
            onGoHome={handleGoHome}
            onGoToDashboard={handleGoToDashboard}
          />
        )}
      </main>
    </div>
  );
}
