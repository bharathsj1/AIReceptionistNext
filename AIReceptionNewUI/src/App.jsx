import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Lenis from "lenis";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import API_URLS from "./config/urls.js";
import LandingScreen from "./screens/LandingScreen";
import LoginScreen from "./screens/LoginScreen";
import DashboardScreen from "./screens/DashboardScreen";
import CrawlFormScreen from "./screens/CrawlFormScreen";
import LoadingScreen from "./screens/LoadingScreen";
import EmailCaptureScreen from "./screens/EmailCaptureScreen";
import CompleteScreen from "./screens/CompleteScreen";
import ResetPasswordScreen from "./screens/ResetPasswordScreen";
import PaymentScreen from "./screens/PaymentScreen";
import PaymentSuccessScreen from "./screens/PaymentSuccessScreen";
import StepIndicator from "./components/StepIndicator";
import PricingPackages from "./components/PricingPackages";
import CreateAccountScreen from "./screens/CreateAccountScreen";
import SignupSurveyScreen from "./screens/SignupSurveyScreen";
import BusinessDetailsScreen from "./screens/BusinessDetailsScreen";

const STAGES = {
  LANDING: "landing",
  LOGIN: "login",
  DASHBOARD: "dashboard",
  CRAWL_FORM: "crawlForm",
  LOADING: "loading",
  EMAIL_CAPTURE: "emailCapture",
  COMPLETE: "complete",
  RESET_PASSWORD: "resetPassword",
  PACKAGES: "packages",
  PAYMENT: "payment",
  PAYMENT_SUCCESS: "paymentSuccess",
  SIGNUP: "signup",
  SIGNUP_SURVEY: "signupSurvey",
  BUSINESS_DETAILS: "businessDetails"
};

const ONBOARDING_STEPS = [
  { id: STAGES.LOGIN, label: "Login" },
  { id: STAGES.SIGNUP, label: "Create account" },
  { id: STAGES.BUSINESS_DETAILS, label: "Business info" },
  { id: STAGES.CRAWL_FORM, label: "Website crawl" },
  { id: STAGES.PACKAGES, label: "Pick a plan" },
  { id: STAGES.PAYMENT, label: "Payment" },
  { id: STAGES.PAYMENT_SUCCESS, label: "Provisioning" }
];

export default function App() {
  const [stage, setStage] = useState(STAGES.LANDING);
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("idle");
  const [responseMessage, setResponseMessage] = useState("");
  const [responseLink, setResponseLink] = useState(null);
  const [showLoader, setShowLoader] = useState(false);
  const [email, setEmail] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [crawlData, setCrawlData] = useState(null);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [loadingPhase, setLoadingPhase] = useState("crawl");
  const [provisionData, setProvisionData] = useState(null);
  const [phoneNumbers, setPhoneNumbers] = useState([]);
  const [agentDetails, setAgentDetails] = useState({
    agentName: "Ultravox Concierge",
    greeting: "Hi, I'm your AI receptionist. How can I help today?",
    escalation: "Forward complex questions to the human team.",
    faq: "Hours: 9-6pm PT\nSupport: support@example.com"
  });
  const [user, setUser] = useState(null);
  const aiNumber =
    (phoneNumbers?.[0]?.phone_number ||
      phoneNumbers?.[0] ||
      provisionData?.phone_number ||
      (provisionData?.phone_numbers || [])[0]?.phone_number ||
      (provisionData?.phone_numbers || [])[0] ||
      null) || "+1 (555) 123-4567";
  const [recentCalls, setRecentCalls] = useState([]);
  const [callsPage, setCallsPage] = useState(1);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const dateRanges = useMemo(
    () => [
      { label: "Last 1 day", days: 1 },
      { label: "Last 7 days", days: 7 },
      { label: "Last 14 days", days: 14 },
      { label: "Last 30 days", days: 30 }
    ],
    []
  );
  const [dateRange, setDateRange] = useState(dateRanges[1].label);
  const [calendarStatus, setCalendarStatus] = useState(null);
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarError, setCalendarError] = useState("");
  const googleStateRef = useRef(null);
  const [clientData, setClientData] = useState(null);
  const [signupName, setSignupName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupRole, setSignupRole] = useState("");
  const [signupUseCase, setSignupUseCase] = useState("");
  const [signupReferral, setSignupReferral] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [businessPhone, setBusinessPhone] = useState("");
  const [signupLoading, setSignupLoading] = useState(false);
  const [signupError, setSignupError] = useState("");
  const [businessLoading, setBusinessLoading] = useState(false);
  const [businessError, setBusinessError] = useState("");
  const [paymentInfo, setPaymentInfo] = useState(null);

  const getSelectedDays = useCallback(() => {
    const match = dateRanges.find((r) => r.label === dateRange);
    return match?.days || 7;
  }, [dateRange, dateRanges]);
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

  // Detect reset token from query string so reset links land on the styled screen.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("reset_token");
    if (token) {
      setResetToken(token);
      setStage(STAGES.RESET_PASSWORD);
      setStatus("idle");
      setResponseMessage("");
      setResponseLink(null);
      // Remove the token from the URL to avoid accidental reuse.
      const url = new URL(window.location.href);
      url.searchParams.delete("reset_token");
      window.history.replaceState({}, document.title, url.toString());
    }
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const trimmed = url.trim();

    if (!trimmed) {
      setResponseMessage("Please enter a website address first.");
      setResponseLink(null);
      return;
    }

    setStatus("loading");
    setResponseMessage("");
    setResponseLink(null);
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
      // Persist website URL to clients table (best-effort)
      const websiteUrl = trimmed;
      const fallbackBusiness = businessName || data?.business_name || "Pending business";
      const fallbackPhone = businessPhone || "+10000000000";
      const payload = {
        email: signupEmail || email || "",
        businessName: fallbackBusiness,
        businessPhone: fallbackPhone,
        websiteUrl,
        websiteData: data || {}
      };
      try {
        await fetch(API_URLS.clientsBusinessDetails, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      } catch (persistErr) {
        console.warn("Failed to save website URL", persistErr);
      }
      setStatus("success");
      // After a successful crawl, send the user to package selection
      setStage(STAGES.PACKAGES);
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
    setResponseLink(null);
    setShowLoader(false);
    setEmail("");
    setUrl("");
    setCrawlData(null);
    setSystemPrompt("");
    setProvisionData(null);
    setLoadingPhase("crawl");
    setStage(STAGES.CRAWL_FORM);
  };

  const handleStartCrawlFlow = () => {
    setStatus("idle");
    setResponseMessage("");
    setResponseLink(null);
    setShowLoader(false);
    setEmail(email || "");
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
    setResponseLink(null);
    setShowLoader(false);
    setEmail("");
    setUrl("");
    setCrawlData(null);
    setSystemPrompt("");
    setProvisionData(null);
    setLoadingPhase("crawl");
    setSelectedPlan(null);
    setStage(STAGES.LANDING);
  };


  const handleLoginSubmit = async (event) => {
    event.preventDefault();
    setStatus("loading");
    setResponseMessage("");
    setResponseLink(null);

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

      const userEmail = data?.email || loginEmail.trim();
      const displayName =
        data?.name ||
        (userEmail && userEmail.includes("@") ? userEmail.split("@")[0] : userEmail);

      setUser({
        id: data?.user_id,
        email: userEmail,
        name: displayName
      });
      setEmail(userEmail || "");
      setSignupEmail(userEmail || "");
      setSignupName(displayName || "");

      // Fetch user profile and client profile to decide where to resume.
      let userProfile = null;
      let clientProfile = null;
      try {
        const userRes = await fetch(
          `${API_URLS.authUserByEmail}?email=${encodeURIComponent(userEmail)}`
        );
        if (userRes.ok) {
          userProfile = await userRes.json().catch(() => null);
        }
        const clientRes = await fetch(
          `${API_URLS.clientsByEmail}?email=${encodeURIComponent(userEmail)}`
        );
        if (clientRes.ok) {
          clientProfile = await clientRes.json().catch(() => null);
        }
      } catch {
        clientProfile = null;
      }

      if (clientProfile) {
        setClientData(clientProfile);
        setBusinessName(clientProfile.business_name || "");
        setBusinessPhone(clientProfile.business_phone || "");
      }

      const businessNameFromProfile =
        userProfile?.business_name ||
        clientProfile?.business_name ||
        clientProfile?.user_business_name ||
        "";
      const businessPhoneFromProfile =
        userProfile?.business_number ||
        clientProfile?.business_phone ||
        clientProfile?.user_business_number ||
        "";
      const websiteUrlFromProfile = clientProfile?.website_url || "";
      const missingBiz =
        !businessNameFromProfile.trim() || !businessPhoneFromProfile.trim();
      const missingWebsite =
        !websiteUrlFromProfile || !String(websiteUrlFromProfile).trim() || websiteUrlFromProfile === "pending";

      setIsLoggedIn(true);
      setActiveTab("dashboard");
      if (missingBiz) {
        setStage(STAGES.BUSINESS_DETAILS);
        setStatus("idle");
        setResponseMessage("");
      } else if (missingWebsite) {
        setUrl("");
        setStage(STAGES.CRAWL_FORM);
        setStatus("idle");
        setResponseMessage("");
      } else {
        setUrl(websiteUrlFromProfile || "");
        setStage(STAGES.DASHBOARD);
        setStatus("success");
        setResponseMessage("Logged in successfully.");
      }
    } catch (error) {
      setStatus("error");
      setResponseMessage(error?.message || "Login failed");
    }
  };

  const handleForgotPassword = async () => {
    const targetEmail = (loginEmail || email || "").trim();
    if (!targetEmail) {
      setStatus("error");
      setResponseMessage("Enter your email first to reset your password.");
      setResponseLink(null);
      return;
    }

    setStatus("loading");
    setResponseMessage("");
    setResponseLink(null);
    try {
      const res = await fetch(API_URLS.authForgotPassword, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: targetEmail })
      });
      const text = await res.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { raw: text };
      }

      if (!res.ok) {
        throw new Error(data?.error || data?.details || text || "Password reset failed");
      }

      const resetLink = data?.reset_link || data?.reset_password_url;
      setStatus("success");
      setResponseMessage(
        resetLink
          ? `Password reset link generated for ${targetEmail}.`
          : data?.message || "If the account exists, a reset link will be sent."
      );
      const normalized = normalizeResetLink(resetLink);
      setResponseLink(normalized);
    } catch (error) {
      setStatus("error");
      setResponseMessage(error?.message || "Unable to process password reset.");
      setResponseLink(null);
    }
  };

  const handleResetPasswordSubmit = async (newPassword) => {
    if (!resetToken) {
      setStatus("error");
      setResponseMessage("Reset token missing. Request a new reset link.");
      setResponseLink(null);
      return;
    }

    setStatus("loading");
    setResponseMessage("");
    setResponseLink(null);
    try {
      const res = await fetch(API_URLS.authResetPassword, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: resetToken, new_password: newPassword })
      });
      const text = await res.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { raw: text };
      }

      if (!res.ok) {
        throw new Error(data?.error || data?.details || text || "Reset failed");
      }

      setStatus("success");
      setResponseMessage("Password reset successful. Please log in with your new password.");
      setResponseLink(null);
      setResetToken("");
      setStage(STAGES.LOGIN);
    } catch (error) {
      setStatus("error");
      setResponseMessage(error?.message || "Unable to reset password.");
      setResponseLink(null);
    }
  };

  const normalizeResetLink = (rawLink) => {
    if (!rawLink) return null;
    try {
      const url = new URL(rawLink, window.location.origin);
      const token = url.searchParams.get("token");
      if (token) {
        return `${window.location.origin}?reset_token=${token}`;
      }
      return url.toString();
    } catch {
      return rawLink;
    }
  };

  const goToCrawl = () => {
    setStage(STAGES.CRAWL_FORM);
    setStatus("idle");
    setResponseMessage("");
  };

  const goToPackages = () => {
    setStage(STAGES.PACKAGES);
    setStatus("idle");
    setResponseMessage("");
  };

  const goToSignup = () => {
    setStage(STAGES.SIGNUP);
    setStatus("idle");
    setResponseMessage("");
    setSignupError("");
  };

  const goToSignupSurvey = () => {
    setStage(STAGES.SIGNUP_SURVEY);
    setStatus("idle");
    setResponseMessage("");
    setSignupError("");
  };

  const goToBusinessDetails = () => {
    setStage(STAGES.BUSINESS_DETAILS);
    setStatus("idle");
    setResponseMessage("");
    setSignupError("");
    setBusinessError("");
  };

  const handleCreateAccountSubmit = async ({ name, email, password }) => {
    setSignupError("");
    setSignupLoading(true);
    try {
      const res = await fetch(API_URLS.authSignup, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
      const msg =
        res.status === 409
          ? "Email is already registered. Please log in or use a different email."
          : data?.error || "Signup failed";
      setSignupError(msg);
        return;
      }
      setSignupName(name);
      setSignupEmail(email);
      setSignupPassword(password);
      goToBusinessDetails();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Signup failed. Please try again.";
      setSignupError(msg);
    } finally {
      setSignupLoading(false);
    }
  };

  const handleBusinessDetailsSubmit = async ({ businessName: nameInput, businessPhone: phoneInput }) => {
    setBusinessError("");
    if (!nameInput || !phoneInput) {
      setBusinessError("Please add your business name and phone number.");
      return;
    }
    setBusinessLoading(true);
    try {
      if (!signupEmail) {
        throw new Error("Please create an account first.");
      }
      const res = await fetch(API_URLS.clientsBusinessDetails, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: signupEmail,
          businessName: nameInput,
          businessPhone: phoneInput
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.error || "Could not save business details.";
        setBusinessError(msg);
        return;
      }
      setStage(STAGES.CRAWL_FORM);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not save business details.";
      setBusinessError(msg);
    } finally {
      setBusinessLoading(false);
    }
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
    setPhoneNumbers([]);
    setClientData(null);
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

  const handleSelectPlan = (planId) => {
    setSelectedPlan(planId);
    setStage(STAGES.PAYMENT);
  };

  const handlePaymentSubmit = async (info) => {
    setPaymentInfo(info || null);
    setStatus("success");
    setResponseMessage("Payment successful.");
    setStage(STAGES.PAYMENT_SUCCESS);
  };

  const currentStepIndex = ONBOARDING_STEPS.findIndex((s) => s.id === stage);
  const progressPercent =
    currentStepIndex >= 0 ? ((currentStepIndex + 1) / ONBOARDING_STEPS.length) * 100 : 0;
  const isOnboardingStage = currentStepIndex >= 0;
  const isLandingStage = stage === STAGES.LANDING;
  const pageClassName = `page${isLandingStage ? " page-landing" : ""}`;
  const pageContentClassName = `page-content${isLandingStage ? " page-content-landing" : ""}`;
  const contentClassName = `content${isLandingStage ? " content-landing" : ""}`;
  const showGlobalLogo = stage !== STAGES.LANDING;

  const handleEmailSubmit = async (event) => {
    event.preventDefault();
    await runProvisionFlow();
  };

  const runProvisionFlow = async () => {
    const provisionEmail = signupEmail || email || loginEmail || "";
    const provisionWebsite =
      url ||
      crawlData?.website_url ||
      crawlData?.url ||
      clientData?.website_url ||
      "";

    if (!provisionEmail || !provisionWebsite) {
      setStatus("error");
      setResponseMessage("Missing required fields: email and website URL.");
      setResponseLink(null);
      setShowLoader(false);
      return;
    }

    setStatus("loading");
    setResponseMessage("");
    setResponseLink(null);
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
        email: provisionEmail,
        website_url: provisionWebsite,
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
        let parsed = {};
        try {
          parsed = provText ? JSON.parse(provText) : {};
        } catch {
          parsed = {};
        }
        const message =
          parsed?.message ||
          parsed?.error ||
          parsed?.details ||
          provText ||
          "Failed to provision client";
        const err = new Error(message);
        err.resetLink = parsed?.reset_password_url || parsed?.reset_link || null;
        throw err;
      }

      const provData = await provisionRes
        .json()
        .catch(async () => ({ raw: await provisionRes.text() }));

      setProvisionData(provData);
      // Attempt to persist agent + number info
      const agentId =
        provData?.agent_id ||
        provData?.agentId ||
        provData?.ultravox_agent_id ||
        null;
      let aiNumber =
        provData?.phone_number ||
        provData?.phone ||
        provData?.twilio_number ||
        null;
      if (!aiNumber) {
        try {
          const dashRes = await fetch(
            `${API_URLS.dashboard}?email=${encodeURIComponent(provisionEmail)}`
          );
          const dashData = await dashRes.json().catch(() => ({}));
          const phones = dashData?.phone_numbers || dashData?.numbers || [];
          aiNumber =
            phones?.[0]?.phone_number ||
            phones?.[0]?.twilio_phone_number ||
            phones?.[0] ||
            aiNumber;
        } catch (err) {
          console.warn("Unable to fetch dashboard numbers", err);
        }
      }
      if (agentId || aiNumber) {
        try {
          await fetch(API_URLS.dashboardAgent, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            mode: "cors",
            body: JSON.stringify({
              email: provisionEmail,
              agent_id: agentId,
              ai_number: aiNumber
            })
          });
        } catch (err) {
          console.warn("Failed to persist agent/number", err);
        }
      }
      setStatus("success");
      setResponseMessage("Your AI receptionist is ready!");
      setResponseLink(null);
      // Clear transient inputs for next run
      setUrl("");
      setCrawlData(null);
      setBusinessName("");
      setBusinessPhone("");
      setSelectedPlan(null);
      // Go straight to dashboard after provisioning completes
      setActiveTab("dashboard");
      setIsLoggedIn(true);
      setStage(STAGES.DASHBOARD);
    } catch (error) {
      setStatus("error");
      setResponseMessage(
        error?.message ||
          "Unable to finish setup. Please try again."
      );
      const hasResetLink = Boolean(error?.resetLink);
      setResponseLink(normalizeResetLink(error?.resetLink) || null);
      if (hasResetLink) {
        setLoginEmail(email || loginEmail);
        setStage(STAGES.LOGIN);
      } else {
        setStage(STAGES.COMPLETE);
      }
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

  const loadCallLogs = useCallback(
    async (emailAddress = user?.email, daysOverride = null) => {
      if (!emailAddress) return;
      try {
        const days = typeof daysOverride === "number" ? daysOverride : getSelectedDays();
        const res = await fetch(
          `${API_URLS.dashboardCalls}?email=${encodeURIComponent(emailAddress)}&days=${days}`
        );
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || "Unable to fetch call logs");
        }
        const data = await res.json();
        setRecentCalls(data?.calls || []);
        setCallsPage(1);
      } catch (error) {
        console.error("Failed to load calls", error);
        setRecentCalls([]);
      }
    },
    [user?.email, getSelectedDays]
  );

  const loadDashboard = useCallback(
    async (emailAddress = user?.email) => {
      if (!emailAddress) return;
      try {
        const res = await fetch(`${API_URLS.dashboard}?email=${encodeURIComponent(emailAddress)}`);
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || "Unable to load dashboard");
        }
        const data = await res.json();
        setClientData(data?.client || null);
        const phones = data?.phone_numbers || [];
        setPhoneNumbers(Array.isArray(phones) ? phones : []);
        // persist provision data extras if available
        setProvisionData((prev) => ({
          ...(prev || {}),
          phone_numbers: phones,
          phone_number: phones?.[0]?.phone_number || prev?.phone_number
        }));
      } catch (error) {
        console.error("Failed to load dashboard", error);
        setPhoneNumbers([]);
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
      if (saved.phoneNumbers) setPhoneNumbers(saved.phoneNumbers);
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
    const onboardingStages = new Set([
      STAGES.BUSINESS_DETAILS,
      STAGES.CRAWL_FORM,
      STAGES.SIGNUP,
      STAGES.SIGNUP_SURVEY,
      STAGES.PACKAGES,
      STAGES.PAYMENT,
      STAGES.PAYMENT_SUCCESS,
    ]);
    if (onboardingStages.has(stage)) return;
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
    if (stage !== STAGES.DASHBOARD) return;
    loadDashboard();
    loadCallLogs();
  }, [stage, loadCallLogs, loadDashboard]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const payload = {
        stage,
        isLoggedIn,
        user,
        email,
        provisionData,
        phoneNumbers,
        activeTab,
        selectedPlan
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.error("Failed to persist state", error);
    }
  }, [stage, isLoggedIn, user, email, provisionData, phoneNumbers, activeTab, selectedPlan]);

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

  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    const scroller = document.querySelector("[data-lenis-wrapper]");
    const content = document.querySelector("[data-lenis-content]");
    if (!scroller || !content) return;

    const lenis = new Lenis({
      wrapper: scroller,
      content,
      duration: 1.1,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      smoothTouch: true,
      wheelMultiplier: 1.05
    });

    ScrollTrigger.scrollerProxy(scroller, {
      scrollTop(value) {
        if (typeof value !== "undefined") {
          lenis.scrollTo(value, { immediate: true });
        }
        return lenis.scroll;
      },
      getBoundingClientRect() {
        return { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight };
      },
      pinType: "transform"
    });

    ScrollTrigger.defaults({ scroller });

    const syncLenis = (time) => {
      lenis.raf(time * 1000);
    };

    gsap.ticker.add(syncLenis);
    lenis.on("scroll", ScrollTrigger.update);

    const sections = gsap.utils.toArray(".reveal-section");
    gsap.set(sections, { opacity: 0, y: 40 });

    const animations = sections.map((section) =>
      gsap.to(section, {
        opacity: 1,
        y: 0,
        duration: 1,
        ease: "power3.out",
        scrollTrigger: {
          trigger: section,
          start: "top 80%",
          end: "top 30%",
          toggleActions: "play none none reverse"
        }
      })
    );

    const onRefresh = () => lenis.resize();
    ScrollTrigger.addEventListener("refresh", onRefresh);
    ScrollTrigger.refresh();

    return () => {
      ScrollTrigger.removeEventListener("refresh", onRefresh);
      animations.forEach((anim) => {
        anim.scrollTrigger?.kill();
        anim.kill();
      });
      gsap.ticker.remove(syncLenis);
      lenis.destroy();
    };
  }, []);

  return (
    <div className={pageClassName} data-lenis-wrapper>
      <div className="page-video-bg" aria-hidden="true">
        <video
          className="page-video"
          src="/Logo_noaudio.mp4"
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
        />
        <div className="page-video-overlay" />
      </div>
      {showGlobalLogo && (
        <header className="global-logo-bar">
          <button className="logo-link" onClick={handleGoHome} aria-label="Go to home">
            <span className="logo-text">SmartConnect4u</span>
          </button>
        </header>
      )}
      <div className={pageContentClassName} data-lenis-content>
        <div className="background-glow" />
        <main className={contentClassName}>
        {isOnboardingStage && (
          <div className="screen-panel narrow" style={{ marginBottom: 16 }}>
            <StepIndicator steps={ONBOARDING_STEPS} currentStep={stage} />
          </div>
        )}
        {stage === STAGES.LANDING && (
          <LandingScreen
            onTry={() => setStage(STAGES.CRAWL_FORM)}
            onLogin={() => setStage(STAGES.LOGIN)}
            onSelectPlan={handleSelectPlan}
          />
        )}
        {stage === STAGES.PACKAGES && (
          <div className="shell-card screen-panel">
            <PricingPackages onSelectPackage={handleSelectPlan} showCrawlSuccess />
          </div>
        )}

        {stage === STAGES.LOGIN && (
          <div className="shell-card screen-panel narrow">
            <LoginScreen
              loginEmail={loginEmail}
              loginPassword={loginPassword}
              status={status}
              responseMessage={responseMessage}
              responseLink={responseLink}
              onLoginSubmit={handleLoginSubmit}
              onEmailChange={setLoginEmail}
              onPasswordChange={setLoginPassword}
              onGoogleLogin={beginGoogleLogin}
              onCreateAccount={goToSignup}
              onForgotPassword={handleForgotPassword}
            />
          </div>
        )}

        {stage === STAGES.SIGNUP && (
          <div className="shell-card screen-panel narrow">
            <CreateAccountScreen
              name={signupName}
              email={signupEmail}
              password={signupPassword}
              onNameChange={setSignupName}
              onEmailChange={setSignupEmail}
              onPasswordChange={setSignupPassword}
              onSubmit={handleCreateAccountSubmit}
              onBackToLogin={() => setStage(STAGES.LOGIN)}
              loading={signupLoading}
              error={signupError}
            />
          </div>
        )}

        {stage === STAGES.SIGNUP_SURVEY && (
          <div className="shell-card screen-panel">
            <SignupSurveyScreen
              name={signupName}
              role={signupRole}
              useCase={signupUseCase}
              referral={signupReferral}
              onRoleChange={setSignupRole}
              onUseCaseChange={setSignupUseCase}
              onReferralChange={setSignupReferral}
              onContinue={goToBusinessDetails}
            />
          </div>
        )}

        {stage === STAGES.BUSINESS_DETAILS && (
          <div className="shell-card screen-panel">
            <BusinessDetailsScreen
              userName={signupName}
              name={businessName}
              phone={businessPhone}
              onNameChange={setBusinessName}
              onPhoneChange={setBusinessPhone}
              onContinue={() =>
                handleBusinessDetailsSubmit({
                  businessName: businessName,
                  businessPhone: businessPhone
                })
              }
              onBack={goToSignup}
              loading={businessLoading}
              error={businessError}
            />
          </div>
        )}

        {stage === STAGES.RESET_PASSWORD && (
          <ResetPasswordScreen
            status={status}
            responseMessage={responseMessage}
            onSubmit={handleResetPasswordSubmit}
            onBackToLogin={() => setStage(STAGES.LOGIN)}
          />
        )}

        {stage === STAGES.DASHBOARD && (
          <DashboardScreen
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            dateRange={dateRange}
            setDateRange={setDateRange}
            dateRanges={dateRanges}
            onRangeChange={(range) => {
              setDateRange(range.label);
              loadCallLogs(user?.email, range.days);
            }}
            aiNumber={aiNumber}
            recentCalls={recentCalls}
            callsPage={callsPage}
            setCallsPage={setCallsPage}
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
          <div className="shell-card screen-panel">
            <CrawlFormScreen
              url={url}
              status={status}
              responseMessage={responseMessage}
              onSubmit={handleSubmit}
              onUrlChange={setUrl}
              onBack={() => setStage(STAGES.LANDING)}
              onSkipWebsite={() => setStage(STAGES.PACKAGES)}
            />
          </div>
        )}

        {stage === STAGES.LOADING && (
          <div className="shell-card screen-panel">
            <LoadingScreen
              status={status}
              loadingPhase={loadingPhase}
              loadingSteps={loadingSteps}
              responseMessage={responseMessage}
            />
          </div>
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
            responseLink={responseLink}
            provisionData={provisionData}
            email={email}
            onGoHome={handleGoHome}
            onGoToDashboard={handleGoToDashboard}
            onStartCrawl={handleStartCrawlFlow}
          />
        )}

        {stage === STAGES.PAYMENT && (
          <div className="shell-card screen-panel">
            <PaymentScreen
              planId={selectedPlan}
              onBack={handleGoHome}
              onSubmit={handlePaymentSubmit}
              initialEmail={signupEmail || email}
            />
          </div>
        )}
        {stage === STAGES.PAYMENT_SUCCESS && (
          <div className="shell-card screen-panel">
            <PaymentSuccessScreen
              paymentInfo={paymentInfo}
              onContinue={runProvisionFlow}
            />
          </div>
        )}
        </main>
      </div>
    </div>
  );
}
