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
import ManualBusinessInfoScreen from "./screens/ManualBusinessInfoScreen";
import PaymentSuccessScreen from "./screens/PaymentSuccessScreen";
import PricingPackages from "./components/PricingPackages";
import CreateAccountScreen from "./screens/CreateAccountScreen";
import SignupSurveyScreen from "./screens/SignupSurveyScreen";
import BusinessDetailsScreen from "./screens/BusinessDetailsScreen";
import ProjectsScreen from "./screens/ProjectsScreen";

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
  BUSINESS_DETAILS: "businessDetails",
  BUSINESS_INFO_MANUAL: "businessInfoManual",
  PROJECTS: "projects"
};
const ALLOWED_STAGE_VALUES = new Set(Object.values(STAGES));
const TOOL_IDS = {
  RECEPTIONIST: "ai_receptionist",
  EMAIL: "email_manager",
  SOCIAL: "social_media_manager"
};
const DEFAULT_TOOL_ID = TOOL_IDS.RECEPTIONIST;

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
    agentId: "",
    agentName: "Ultravox Concierge",
    systemPrompt: "",
    voice: "",
    temperature: 0.4,
    greeting: "Hi, I'm your AI receptionist. How can I help today?",
    escalation: "Forward complex questions to the human team.",
    faq: "Hours: 9-6pm PT\nSupport: support@example.com"
  });
  const [ultravoxVoices, setUltravoxVoices] = useState([]);
  const [ultravoxVoicesLoading, setUltravoxVoicesLoading] = useState(false);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [agentSaveStatus, setAgentSaveStatus] = useState({ status: "idle", message: "" });
  const [businessSaveStatus, setBusinessSaveStatus] = useState({ status: "idle", message: "" });
  const [userProfile, setUserProfile] = useState(null);
  const [user, setUser] = useState(null);
  const [callTranscript, setCallTranscript] = useState({
    call: null,
    transcripts: [],
    recordings: [],
    loading: false,
    error: ""
  });
  const [recentCalls, setRecentCalls] = useState([]);
  const [allCalls, setAllCalls] = useState([]);
  const [callsPage, setCallsPage] = useState(1);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [activeTool, setActiveTool] = useState(DEFAULT_TOOL_ID);
  const [toolSubscriptions, setToolSubscriptions] = useState({});
  const [subscriptionsLoading, setSubscriptionsLoading] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [selectedTool, setSelectedTool] = useState(DEFAULT_TOOL_ID);
  const hasActiveSubscription = useMemo(
    () => Object.values(toolSubscriptions || {}).some((entry) => entry?.active),
    [toolSubscriptions]
  );
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
  const stageRef = useRef(stage);
  const [clientData, setClientData] = useState(null);
  const [signupName, setSignupName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupRole, setSignupRole] = useState("");
  const [signupUseCase, setSignupUseCase] = useState("");
  const [signupReferral, setSignupReferral] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [businessPhone, setBusinessPhone] = useState("");
  const [manualBusinessInfo, setManualBusinessInfo] = useState(null);
  const [signupLoading, setSignupLoading] = useState(false);
  const [signupError, setSignupError] = useState("");
  const [businessLoading, setBusinessLoading] = useState(false);
  const [businessError, setBusinessError] = useState("");
  const [paymentInfo, setPaymentInfo] = useState(null);
  const [serviceSlug, setServiceSlug] = useState("receptionist");
  const validStages = useMemo(() => new Set(Object.values(STAGES)), []);
  const [bookingSettings, setBookingSettings] = useState({
    booking_enabled: false,
    booking_duration_minutes: 30,
    booking_buffer_minutes: 5
  });
  const [bookingStatus, setBookingStatus] = useState({ status: "idle", message: "" });
  const [bookingTestStatus, setBookingTestStatus] = useState({ status: "idle", message: "" });
  const aiNumber = useMemo(() => {
    const primary = phoneNumbers?.[0];
    const phoneFromArray =
      (primary && (primary.phone_number || primary.twilio_phone_number)) || primary;
    const phoneFromProvision =
      provisionData?.phone_number ||
      provisionData?.twilio_phone_number ||
      (provisionData?.phone_numbers || [])[0]?.phone_number ||
      (provisionData?.phone_numbers || [])[0]?.twilio_phone_number ||
      (provisionData?.phone_numbers || [])[0];
    const phoneFromBusiness =
      clientData?.business_phone || businessPhone || user?.business_number;

    return phoneFromArray || phoneFromProvision || phoneFromBusiness || null;
  }, [
    businessPhone,
    clientData?.business_phone,
    phoneNumbers,
    provisionData?.phone_number,
    provisionData?.phone_numbers,
    provisionData?.twilio_phone_number,
    user?.business_number
  ]);

  const getSelectedDays = useCallback(() => {
    const match = dateRanges.find((r) => r.label === dateRange);
    return match?.days || 7;
  }, [dateRange, dateRanges]);
  const suppressHistoryRef = useRef(false);
  const hasMountedHistoryRef = useRef(false);
  const hasLoadedPersistedRef = useRef(false);
  const hasLoadedDashboardRef = useRef(false);
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
    setServiceSlug("receptionist");
    setStage(STAGES.LANDING);
    if (typeof window !== "undefined") {
      window.history.replaceState({ stage: STAGES.LANDING }, "", "/");
    }
  };

  const handleGoProjects = (slug = "receptionist") => {
    setStatus("idle");
    setResponseMessage("");
    setResponseLink(null);
    setServiceSlug(slug || "receptionist");
    setStage(STAGES.PROJECTS);
    if (typeof window !== "undefined") {
      const safeSlug = slug || "receptionist";
      window.history.replaceState({ stage: STAGES.PROJECTS }, "", `/${safeSlug}`);
    }
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
      setActiveTool(DEFAULT_TOOL_ID);
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

  const handleManualBusinessSubmit = async (payload) => {
    const emailAddress = signupEmail || email || user?.email || "";
    const summary = payload?.businessSummary || "";
    const hours = payload?.hours || "";
    const services = payload?.services || "";
    const location = payload?.location || "";
    const notes = payload?.notes || "";
    const infoLines = [
      summary && `Summary: ${summary}`,
      services && `Services: ${services}`,
      hours && `Hours: ${hours}`,
      location && `Location: ${location}`,
      notes && `Notes: ${notes}`,
      payload?.businessPhone && `Phone: ${payload.businessPhone}`,
      payload?.businessEmail && `Email: ${payload.businessEmail}`
    ].filter(Boolean);
    const combinedPages = [
      {
        url: "manual-entry",
        content: infoLines.join("\n")
      }
    ];
    const normalized = {
      businessName: payload?.businessName || businessName || "Your business",
      businessPhone: payload?.businessPhone || businessPhone || "",
      businessEmail: payload?.businessEmail || "",
      businessSummary: summary,
      hours,
      services,
      location,
      notes,
      websiteUrl: payload?.websiteUrl || "manual-entry"
    };

    setManualBusinessInfo(normalized);
    setBusinessName(normalized.businessName);
    if (normalized.businessPhone) setBusinessPhone(normalized.businessPhone);
    const nextCrawlData = {
      business_name: normalized.businessName,
      business_phone: normalized.businessPhone,
      website_url: normalized.websiteUrl,
      pages: combinedPages,
      data: normalized
    };
    setCrawlData(nextCrawlData);
    try {
      await fetch(API_URLS.clientsBusinessDetails, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailAddress,
          businessName: normalized.businessName,
          businessPhone: normalized.businessPhone,
          websiteUrl: normalized.websiteUrl,
          websiteData: normalized
        })
      });
    } catch (persistErr) {
      console.warn("Failed to save manual business info", persistErr);
    }
    let hasActive = hasActiveSubscription;
    if (emailAddress) {
      try {
        const subsRes = await fetch(
          `${API_URLS.subscriptionsStatus}?email=${encodeURIComponent(emailAddress)}`
        );
        if (subsRes.ok) {
          const subsJson = await subsRes.json().catch(() => ({}));
          let normalizedSubs = null;
          if (Array.isArray(subsJson?.subscriptions)) {
            normalizedSubs = {};
            subsJson.subscriptions.forEach((entry) => {
              const toolId = (entry?.tool || entry?.toolId || entry?.tool_id || DEFAULT_TOOL_ID).toLowerCase();
              const status = entry?.status || "";
              const active =
                typeof entry?.active === "boolean"
                  ? entry.active
                  : ["active", "trialing"].includes(status.toLowerCase());
              normalizedSubs[toolId] = {
                active,
                status,
                planId: entry?.planId || entry?.plan_id || null,
                currentPeriodEnd: entry?.currentPeriodEnd || entry?.current_period_end || null
              };
            });
            setToolSubscriptions(normalizedSubs);
          }
          if (typeof subsJson?.active === "boolean") {
            hasActive = subsJson.active;
          } else if (normalizedSubs) {
            hasActive = Object.values(normalizedSubs).some((entry) => entry?.active);
          }
        }
      } catch (err) {
        console.warn("Failed to check subscription status", err);
      }
    }
    if (hasActive) {
      await runProvisionFlow({
        emailOverride: emailAddress,
        manualInfoOverride: normalized,
        crawlDataOverride: nextCrawlData
      });
      return;
    }
    setStage(STAGES.PACKAGES);
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    setActiveTool(DEFAULT_TOOL_ID);
    setToolSubscriptions({});
    setSubscriptionsLoading(false);
    setAllCalls([]);
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
    setUltravoxVoices([]);
    setSelectedPlan(null);
    setSelectedTool(DEFAULT_TOOL_ID);
    setManualBusinessInfo(null);
    setAgentSaveStatus({ status: "idle", message: "" });
    setBusinessSaveStatus({ status: "idle", message: "" });
    setCallTranscript({ call: null, transcripts: [], recordings: [], loading: false, error: "" });
    setUserProfile(null);
    setDashboardLoading(false);
    setAgentDetails({
      agentId: "",
      agentName: "Ultravox Concierge",
      systemPrompt: "",
      voice: "",
      temperature: 0.4,
      greeting: "Hi, I'm your AI receptionist. How can I help today?",
      escalation: "Forward complex questions to the human team.",
      faq: "Hours: 9-6pm PT\nSupport: support@example.com"
    });
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY);
      window.history.pushState({ stage: STAGES.LANDING }, "", "/");
    }
  };

  const handleGoToDashboard = () => {
    setActiveTab("dashboard");
    setActiveTool(DEFAULT_TOOL_ID);
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
    if (hasActiveSubscription) {
      setStage(STAGES.DASHBOARD);
      return;
    }
    setSelectedPlan(planId);
    setSelectedTool(activeTool || DEFAULT_TOOL_ID);
    setStage(STAGES.PAYMENT);
  };

  const handlePaymentSubmit = async (info) => {
    setPaymentInfo(info || null);
    setStatus("success");
    setResponseMessage("Payment successful.");
    setStage(STAGES.PAYMENT_SUCCESS);
  };

  const isLandingStage = stage === STAGES.LANDING;
  const isDashboardStage = stage === STAGES.DASHBOARD;
  const pageClassName = `page${isLandingStage ? " page-landing" : ""}`;
  const pageContentClassName = `page-content${isLandingStage ? " page-content-landing" : ""}`;
  const contentClassName = `content${isLandingStage ? " content-landing" : ""}${isDashboardStage ? " content-wide" : ""}`;
  const showGlobalLogo = stage !== STAGES.LANDING;

  const handleEmailSubmit = async (event) => {
    event.preventDefault();
    await runProvisionFlow();
  };

  const runProvisionFlow = async ({
    emailOverride = null,
    manualInfoOverride = null,
    crawlDataOverride = null
  } = {}) => {
    const provisionEmail = emailOverride || signupEmail || email || loginEmail || "";
    const manualInfo = manualInfoOverride || manualBusinessInfo;
    const activeCrawlData = crawlDataOverride || crawlData;
    const provisionWebsite =
      url ||
      activeCrawlData?.website_url ||
      activeCrawlData?.url ||
      clientData?.website_url ||
      manualInfo?.websiteUrl ||
      (manualInfo ? "manual-entry" : "");

    if (!provisionEmail || (!provisionWebsite && !manualInfo)) {
      setStatus("error");
      setResponseMessage("Missing required fields: email and business info.");
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
      const fallbackBusiness =
        activeCrawlData?.business_name ||
        manualInfo?.businessName ||
        businessName ||
        "Horizon Property Group";
      const promptPayload = {
        business_name: fallbackBusiness,
        pages:
          activeCrawlData?.pages ||
          activeCrawlData?.data ||
          activeCrawlData?.raw ||
          (manualInfo
            ? [
                {
                  url: "manual-entry",
                  content: [
                    manualInfo.businessSummary && `Summary: ${manualInfo.businessSummary}`,
                    manualInfo.services && `Services: ${manualInfo.services}`,
                    manualInfo.hours && `Hours: ${manualInfo.hours}`,
                    manualInfo.location && `Location: ${manualInfo.location}`,
                    manualInfo.notes && `Notes: ${manualInfo.notes}`,
                    manualInfo.businessPhone && `Phone: ${manualInfo.businessPhone}`,
                    manualInfo.businessEmail && `Email: ${manualInfo.businessEmail}`
                  ]
                    .filter(Boolean)
                    .join("\n")
                }
              ]
            : [])
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
        system_prompt: derivedPrompt,
        business_name: manualInfo?.businessName || fallbackBusiness,
        business_phone: manualInfo?.businessPhone || businessPhone || "",
        business_email: manualInfo?.businessEmail || "",
        business_summary: manualInfo?.businessSummary || "",
        business_hours: manualInfo?.hours || "",
        business_services: manualInfo?.services || "",
        business_location: manualInfo?.location || "",
        business_notes: manualInfo?.notes || ""
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
      setManualBusinessInfo(null);
      setBusinessName("");
      setBusinessPhone("");
      setSelectedPlan(null);
      setSelectedTool(DEFAULT_TOOL_ID);
      // Go straight to dashboard after provisioning completes
      setActiveTab("dashboard");
      setActiveTool(DEFAULT_TOOL_ID);
      setToolSubscriptions({});
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

  const normalizeToolSubscriptions = useCallback((payload) => {
    const source = Array.isArray(payload?.subscriptions)
      ? payload.subscriptions
      : Array.isArray(payload)
        ? payload
        : [];
    const map = {};
    source.forEach((entry) => {
      const toolId = (entry?.tool || entry?.toolId || entry?.tool_id || DEFAULT_TOOL_ID).toLowerCase();
      const status = entry?.status || "";
      const active =
        typeof entry?.active === "boolean"
          ? entry.active
          : ["active", "trialing"].includes(status.toLowerCase());
      map[toolId] = {
        active,
        status,
        planId: entry?.planId || entry?.plan_id || null,
        currentPeriodEnd: entry?.currentPeriodEnd || entry?.current_period_end || null
      };
    });
    return map;
  }, []);

  const loadDashboard = useCallback(
    async (emailAddress = null) => {
      const targetEmail = emailAddress || user?.email || email || signupEmail || loginEmail;
      if (!targetEmail) {
        setSubscriptionsLoading(false);
        return;
      }
      setDashboardLoading(true);
      setSubscriptionsLoading(true);
      try {
        const [dashRes, clientRes, userRes, subsRes] = await Promise.all([
          fetch(`${API_URLS.dashboard}?email=${encodeURIComponent(targetEmail)}`),
          fetch(`${API_URLS.clientsByEmail}?email=${encodeURIComponent(targetEmail)}`).catch(
            () => null
          ),
          fetch(`${API_URLS.authUserByEmail}?email=${encodeURIComponent(targetEmail)}`).catch(
            () => null
          ),
          fetch(`${API_URLS.subscriptionsStatus}?email=${encodeURIComponent(targetEmail)}`).catch(
            () => null
          )
        ]);

        if (!dashRes.ok) {
          const text = await dashRes.text();
          throw new Error(text || "Unable to load dashboard");
        }

        const dashData = await dashRes.json();
        const clientDetails =
          clientRes && clientRes.ok ? await clientRes.json().catch(() => null) : null;
        const userDetails =
          userRes && userRes.ok ? await userRes.json().catch(() => null) : null;
        let subscriptionPayload = dashData?.subscriptions;
        if (!subscriptionPayload && subsRes && subsRes.ok) {
          const subsJson = await subsRes.json().catch(() => null);
          subscriptionPayload = subsJson?.subscriptions || subsJson;
        }

        setClientData(dashData?.client || clientDetails?.client || clientDetails || null);
        setUserProfile(userDetails || null);
        if (userDetails) {
          setUser((prev) => ({
            ...(prev || {}),
            ...userDetails
          }));
        }

        if (subscriptionPayload !== undefined) {
          const normalizedSubs = normalizeToolSubscriptions(subscriptionPayload);
          setToolSubscriptions(normalizedSubs);
          const firstActiveTool =
            Object.entries(normalizedSubs).find(([, entry]) => entry?.active)?.[0] ||
            null;
          setActiveTool((prev) => {
            if (prev && normalizedSubs[prev]?.active) return prev;
            if (firstActiveTool) return firstActiveTool;
            return prev || DEFAULT_TOOL_ID;
          });
        }

        setBookingSettings((prev) => ({
          booking_enabled: Boolean(
            (dashData?.client && dashData?.client?.booking_enabled) ||
              clientDetails?.booking_enabled ||
              prev.booking_enabled
          ),
          booking_duration_minutes:
            dashData?.client?.booking_duration_minutes ??
            clientDetails?.booking_duration_minutes ??
            prev.booking_duration_minutes ??
            30,
          booking_buffer_minutes:
            dashData?.client?.booking_buffer_minutes ??
            clientDetails?.booking_buffer_minutes ??
            prev.booking_buffer_minutes ??
            5
        }));

        const phones = dashData?.phone_numbers || [];
        const normalizedPhones = Array.isArray(phones)
          ? phones.map((p) =>
              typeof p === "string"
                ? { phone_number: p, twilio_phone_number: p }
                : {
                    ...p,
                    phone_number: p.phone_number || p.twilio_phone_number,
                    twilio_phone_number: p.twilio_phone_number || p.phone_number
                  }
            )
          : [];
        setPhoneNumbers(normalizedPhones);
        setProvisionData((prev) => ({
          ...(prev || {}),
          phone_numbers: normalizedPhones,
          phone_number: normalizedPhones?.[0]?.phone_number || prev?.phone_number
        }));

        const callTemplate =
          dashData?.ultravox_agent?.callTemplate || dashData?.agent?.callTemplate || {};
        const derivedBusinessName =
          clientDetails?.business_name ||
          clientDetails?.client?.business_name ||
          dashData?.client?.business_name ||
          dashData?.client?.name ||
          businessName;
        const derivedBusinessPhone =
          clientDetails?.business_phone ||
          clientDetails?.client?.business_phone ||
          dashData?.client?.business_phone ||
          businessPhone;
        if (derivedBusinessName) setBusinessName(derivedBusinessName);
        if (derivedBusinessPhone) setBusinessPhone(derivedBusinessPhone);

        setAgentDetails((prev) => ({
          ...prev,
          agentId: dashData?.client?.ultravox_agent_id || prev.agentId,
          agentName: dashData?.ultravox_agent?.name || dashData?.agent?.agent_name || prev.agentName,
          systemPrompt: callTemplate?.systemPrompt || dashData?.agent?.system_prompt || prev.systemPrompt,
          voice: callTemplate?.voice || callTemplate?.voiceId || dashData?.agent?.voice || prev.voice,
          temperature:
            typeof callTemplate?.temperature === "number"
              ? callTemplate.temperature
              : typeof dashData?.agent?.temperature === "number"
                ? dashData.agent.temperature
                : prev.temperature,
          greeting: callTemplate?.greeting || dashData?.agent?.greeting || prev.greeting,
          escalation: callTemplate?.fallback || dashData?.agent?.escalation || prev.escalation,
          faq: callTemplate?.faq || dashData?.agent?.faq || prev.faq
        }));
      } catch (error) {
        console.error("Failed to load dashboard", error);
      } finally {
        setDashboardLoading(false);
        setSubscriptionsLoading(false);
      }
    },
    [email, loginEmail, normalizeToolSubscriptions, signupEmail, user?.email]
  );

  const handleAgentSave = useCallback(
    async (updates) => {
      if (!user?.email) return;
      setAgentSaveStatus({ status: "loading", message: "" });
      try {
        const res = await fetch(API_URLS.dashboardAgent, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          mode: "cors",
          body: JSON.stringify({
            email: user.email,
            system_prompt: updates?.systemPrompt ?? agentDetails.systemPrompt,
            voice: updates?.voice ?? agentDetails.voice,
            temperature:
              typeof updates?.temperature === "number"
                ? updates.temperature
                : agentDetails.temperature
          })
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || "Failed to update agent");
        }
        setAgentSaveStatus({ status: "success", message: "Agent updated" });
        await loadDashboard(user.email);
      } catch (error) {
        setAgentSaveStatus({
          status: "error",
          message: error?.message || "Failed to update agent"
        });
      }
    },
    [agentDetails.systemPrompt, agentDetails.temperature, agentDetails.voice, loadDashboard, user?.email]
  );

  const handleBusinessSave = useCallback(
    async ({ businessName: name, businessPhone: phone, websiteUrl }) => {
      if (!user?.email) return;
      setBusinessSaveStatus({ status: "loading", message: "" });
      try {
        const res = await fetch(API_URLS.clientsBusinessDetails, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          mode: "cors",
          body: JSON.stringify({
            email: user.email,
            businessName: name || businessName,
            businessPhone: phone || businessPhone,
            websiteUrl: websiteUrl || clientData?.website_url || url || ""
          })
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || "Failed to save business details");
        }
        setBusinessSaveStatus({ status: "success", message: "Business details saved" });
        setBusinessName(name || businessName);
        setBusinessPhone(phone || businessPhone);
        await loadDashboard(user.email);
      } catch (error) {
        setBusinessSaveStatus({
          status: "error",
          message: error?.message || "Failed to save business details"
        });
      }
    },
    [businessName, businessPhone, clientData?.website_url, loadDashboard, url, user?.email]
  );

  const handleBookingSettingsSave = useCallback(
    async (nextSettings) => {
      if (!user?.email) return;
      setBookingStatus({ status: "loading", message: "" });
      try {
        const res = await fetch(API_URLS.dashboardBookingSettings, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          mode: "cors",
          body: JSON.stringify({
            email: user.email,
            booking_enabled: nextSettings.booking_enabled,
            duration_minutes: nextSettings.booking_duration_minutes,
            buffer_minutes: nextSettings.booking_buffer_minutes
          })
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || "Failed to save booking settings");
        }
        setBookingSettings(nextSettings);
        setBookingStatus({ status: "success", message: "Booking settings saved" });
      } catch (error) {
        setBookingStatus({
          status: "error",
          message: error?.message || "Failed to save booking settings"
        });
      }
    },
    [user?.email]
  );

  const handleTestBooking = useCallback(
    async () => {
      if (!user?.email) return;
      setBookingTestStatus({ status: "loading", message: "" });
      try {
        const start = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        const res = await fetch(API_URLS.calendarBook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          mode: "cors",
          body: JSON.stringify({
            email: user.email,
            start,
            duration_minutes: bookingSettings.booking_duration_minutes || 30,
            buffer_minutes: bookingSettings.booking_buffer_minutes || 5,
            title: "Test booking from dashboard",
            description: "Created from dashboard to verify booking flow."
          })
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || "Failed to book slot");
        }
        setBookingTestStatus({ status: "success", message: "Booked next available slot (check Google Calendar)." });
      } catch (error) {
        setBookingTestStatus({
          status: "error",
          message: error?.message || "Failed to book slot"
        });
      }
    },
    [bookingSettings.booking_buffer_minutes, bookingSettings.booking_duration_minutes, user?.email]
  );

  const loadAllCalls = useCallback(
    async (emailAddress = user?.email) => {
      if (!emailAddress) return;
      try {
        const res = await fetch(
          `${API_URLS.dashboardCalls}?email=${encodeURIComponent(emailAddress)}&limit=500`
        );
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || "Unable to fetch call logs");
        }
        const data = await res.json();
        setAllCalls(data?.calls || []);
      } catch (error) {
        console.error("Failed to load all calls", error);
        setAllCalls([]);
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

  const handleRefreshDashboardAll = useCallback(() => {
    loadDashboard();
    loadCallLogs();
    loadAllCalls();
  }, [loadAllCalls, loadCallLogs, loadDashboard]);

  const loadUltravoxVoices = useCallback(async () => {
    setUltravoxVoicesLoading(true);
    try {
      const res = await fetch(API_URLS.ultravoxVoices);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Unable to fetch Ultravox voices");
      }
      const data = await res.json();
      const voices = Array.isArray(data?.voices) ? data.voices : data;
      setUltravoxVoices(voices || []);
    } catch (error) {
      console.error("Failed to load Ultravox voices", error);
      setUltravoxVoices([]);
    } finally {
      setUltravoxVoicesLoading(false);
    }
  }, []);

  const loadCallTranscript = useCallback(
    async (callSid) => {
      if (!callSid || !user?.email) return;
      setCallTranscript((prev) => ({ ...prev, loading: true, error: "" }));
      try {
        const res = await fetch(
          `${API_URLS.dashboardCallTranscript}?email=${encodeURIComponent(
            user.email
          )}&callSid=${encodeURIComponent(callSid)}`
        );
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || "Unable to fetch transcript");
        }
        const data = await res.json();
        setCallTranscript({
          call: data?.call || { sid: callSid },
          transcripts: data?.transcripts || [],
          recordings: data?.recordings || [],
          loading: false,
          error: ""
        });
      } catch (error) {
        setCallTranscript((prev) => ({
          ...prev,
          loading: false,
          error: error?.message || "Unable to fetch transcript"
        }));
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
    if (typeof window === "undefined") return;
    const path = (window.location.pathname || "").replace(/^\/+/, "");
    const slug = path.split("/")[0];
    const allowedSlugs = new Set([
      "receptionist",
      "social-manager",
      "email-manager",
      "crm-lead-manager"
    ]);
    if (allowedSlugs.has(slug)) {
      setServiceSlug(slug || "receptionist");
      setStage(STAGES.PROJECTS);
    }
  }, []);

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
      if (saved.activeTool) setActiveTool(saved.activeTool);
      if (saved.toolSubscriptions) setToolSubscriptions(saved.toolSubscriptions);
      if (saved.selectedTool) setSelectedTool(saved.selectedTool);
      if (saved.manualBusinessInfo) setManualBusinessInfo(saved.manualBusinessInfo);
      if (saved.serviceSlug) setServiceSlug(saved.serviceSlug);
      if (saved.calendarStatus) setCalendarStatus(saved.calendarStatus);
      if (saved.calendarEvents) setCalendarEvents(saved.calendarEvents);
      if (saved.bookingSettings) setBookingSettings(saved.bookingSettings);
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
      setActiveTool(DEFAULT_TOOL_ID);
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
      STAGES.BUSINESS_INFO_MANUAL,
    ]);
    if (onboardingStages.has(stage)) return;
    if (stage === STAGES.PROJECTS) return;
    if (stage === STAGES.DASHBOARD) return;
    setStage(STAGES.DASHBOARD);
    setActiveTab("dashboard");
    setActiveTool(DEFAULT_TOOL_ID);
    if (typeof window !== "undefined") {
      const path = window.location.pathname || "";
      if (path !== "/dashboard") {
        window.history.replaceState({ stage: STAGES.DASHBOARD }, "", "/dashboard");
      }
    }
  }, [isLoggedIn, stage]);

  useEffect(() => {
    if (stage !== STAGES.DASHBOARD) {
      hasLoadedDashboardRef.current = false;
      return;
    }
    if (hasLoadedDashboardRef.current) return;
    hasLoadedDashboardRef.current = true;
    loadDashboard();
    loadCallLogs();
    loadAllCalls();
    loadUltravoxVoices();
    loadCalendarEvents();
  }, [hasActiveSubscription, loadAllCalls, loadCalendarEvents, loadCallLogs, loadDashboard, loadUltravoxVoices, stage]);

  useEffect(() => {
    if (stage !== STAGES.DASHBOARD) return;
    if (!user?.email && email) {
      setUser((prev) => ({ ...(prev || {}), email }));
      setIsLoggedIn(true);
    }
  }, [stage, user?.email, email]);

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
        activeTool,
        toolSubscriptions,
        serviceSlug,
        selectedPlan,
        selectedTool,
        manualBusinessInfo,
        calendarStatus,
        calendarEvents,
        bookingSettings
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.error("Failed to persist state", error);
    }
  }, [
    stage,
    isLoggedIn,
    user,
    email,
    provisionData,
    phoneNumbers,
    activeTab,
    activeTool,
    toolSubscriptions,
    serviceSlug,
    selectedPlan,
    selectedTool,
    calendarStatus,
    calendarEvents,
    bookingSettings
  ]);

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

  useEffect(() => {
    if (!validStages.has(stage)) {
      setStage(STAGES.LANDING);
      return;
    }
    if (hasActiveSubscription && (stage === STAGES.PACKAGES || stage === STAGES.PAYMENT)) {
      setSelectedPlan(null);
      setStage(STAGES.DASHBOARD);
    }
  }, [hasActiveSubscription, stage, validStages]);

  const handleCalendarDisconnect = () => {
    if (!user?.email) {
      setCalendarStatus(null);
      setCalendarEvents([]);
      setCalendarError("");
      return;
    }
    setCalendarStatus(null);
    setCalendarEvents([]);
    setCalendarError("");
    fetch(API_URLS.googleDisconnect, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: user.email })
    }).catch(() => {});
  };

  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    const scroller = document.querySelector("[data-lenis-wrapper]");
    const content = document.querySelector("[data-lenis-content]");
    if (!scroller || !content) return;

    const isMobile = window.matchMedia("(max-width: 768px)").matches;
    if (isMobile) {
      scroller.style.position = "static";
      scroller.style.overflow = "auto";
      content.style.minHeight = "100%";
      return;
    }

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

    // Hide/show nav on scroll using Lenis scroll position
    const nav = document.querySelector(".nav-card");
    let lastY = 0;
    const handleNav = ({ scroll }) => {
      if (stageRef.current === STAGES.LANDING) {
        nav?.classList.remove("nav-hidden");
        lastY = scroll;
        return;
      }
      const goingDown = scroll > lastY + 4;
      const goingUp = scroll < lastY - 4;
      if (goingDown) {
        nav?.classList.add("nav-hidden");
      } else if (goingUp) {
        nav?.classList.remove("nav-hidden");
      }
      lastY = scroll;
    };
    lenis.on("scroll", handleNav);

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
      lenis.off("scroll", handleNav);
      ScrollTrigger.removeEventListener("refresh", onRefresh);
      animations.forEach((anim) => {
        anim.scrollTrigger?.kill();
        anim.kill();
      });
      gsap.ticker.remove(syncLenis);
      lenis.destroy();
    };
  }, []);

  useEffect(() => {
    // handled via Lenis scroll listener above
  }, []);

  useEffect(() => {
    stageRef.current = stage;
    if (typeof window !== "undefined" && stage === STAGES.LANDING) {
      const nav = document.querySelector(".nav-card");
      if (nav) {
        nav.classList.remove("nav-hidden");
      }
    }
  }, [stage]);

  useEffect(() => {
    if (!ALLOWED_STAGE_VALUES.has(stage)) {
      setStage(STAGES.LANDING);
    }
  }, [stage]);

  return (
    <div className={pageClassName} data-lenis-wrapper>
      <div className="page-video-bg" aria-hidden="true">
        <video
          className="page-video"
          src="/media/Logo_noaudio.mp4"
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
        />
        <div className="page-video-overlay" />
      </div>
      <div className={pageContentClassName} data-lenis-content>
        <div className="background-glow" />
        {showGlobalLogo && (
          <header className="global-logo-bar">
            <button className="logo-link" onClick={handleGoHome} aria-label="Go to home">
              <img src="/media/logo.png" alt="SmartConnect4u logo" className="logo-img" />
              <span className="logo-text">SmartConnect4u</span>
            </button>
          </header>
        )}
        <main className={contentClassName}>
        {stage === STAGES.LANDING && (
          <LandingScreen
            onTry={() => setStage(STAGES.CRAWL_FORM)}
            onLogin={() => setStage(STAGES.LOGIN)}
            onSelectPlan={handleSelectPlan}
            onShowService={handleGoProjects}
          />
        )}
        {stage === STAGES.PROJECTS && (
          <ProjectsScreen serviceSlug={serviceSlug} onStartSignup={goToSignup} />
        )}
        {stage === STAGES.PACKAGES && !hasActiveSubscription && (
          <div className="shell-card screen-panel">
            <PricingPackages onSelectPackage={handleSelectPlan} showCrawlSuccess />
          </div>
        )}

        {stage === STAGES.BUSINESS_INFO_MANUAL && (
          <div className="shell-card screen-panel">
            <ManualBusinessInfoScreen
              name={businessName || signupName}
              phone={businessPhone}
              email={signupEmail || email}
              onSubmit={handleManualBusinessSubmit}
              onBack={() => setStage(STAGES.CRAWL_FORM)}
            />
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
            activeTool={activeTool}
            setActiveTool={setActiveTool}
            toolSubscriptions={toolSubscriptions}
            subscriptionsLoading={subscriptionsLoading}
            analyticsCalls={allCalls}
            dateRange={dateRange}
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
            dashboardLoading={dashboardLoading}
            ultravoxVoices={ultravoxVoices}
            ultravoxVoicesLoading={ultravoxVoicesLoading}
            onAgentSave={handleAgentSave}
            agentSaveStatus={agentSaveStatus}
            businessSaveStatus={businessSaveStatus}
            onBusinessSave={handleBusinessSave}
            clientData={clientData}
            userProfile={userProfile}
            bookingSettings={bookingSettings}
            bookingStatus={bookingStatus}
            bookingTestStatus={bookingTestStatus}
            setBookingSettings={setBookingSettings}
            onBookingSave={handleBookingSettingsSave}
            onTestBooking={handleTestBooking}
            callTranscript={callTranscript}
            onLoadTranscript={loadCallTranscript}
            onRefreshCalls={loadCallLogs}
            onRefreshDashboard={handleRefreshDashboardAll}
            onLogout={handleLogout}
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
              onBack={() => setStage(STAGES.BUSINESS_DETAILS)}
              onSkipWebsite={() => setStage(STAGES.BUSINESS_INFO_MANUAL)}
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
          !hasActiveSubscription ? (
            <div className="shell-card screen-panel">
              <PaymentScreen
                planId={selectedPlan}
                toolId={selectedTool || activeTool || DEFAULT_TOOL_ID}
                onBack={handleGoHome}
                onSubmit={handlePaymentSubmit}
                initialEmail={signupEmail || email}
              />
            </div>
          ) : (
            <div className="shell-card screen-panel">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center text-sm text-white">
                You already have an active subscription. Returning to dashboard...
              </div>
            </div>
          )
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
