import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Lenis from "lenis";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import API_URLS from "./config/urls.js";
import Aurora from "./components/Aurora";
import Orb from "./components/Orb";
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
import NumberSelectionScreen from "./screens/NumberSelectionScreen";
import PricingPackages from "./components/PricingPackages";
import CreateAccountScreen from "./screens/CreateAccountScreen";
import SignupSurveyScreen from "./screens/SignupSurveyScreen";
import BusinessDetailsScreen from "./screens/BusinessDetailsScreen";
import BusinessTypeScreen from "./screens/BusinessTypeScreen";
import ProjectsScreen from "./screens/ProjectsScreen";
import BusinessReviewScreen from "./screens/BusinessReviewScreen";
import ChatWidget from "./components/chat/ChatWidget";

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
  NUMBER_SELECT: "numberSelect",
  SIGNUP: "signup",
  SIGNUP_SURVEY: "signupSurvey",
  BUSINESS_DETAILS: "businessDetails",
  BUSINESS_TYPE: "businessType",
  BUSINESS_INFO_MANUAL: "businessInfoManual",
  BUSINESS_INFO_REVIEW: "businessInfoReview",
  PROJECTS: "projects"
};
const ALLOWED_STAGE_VALUES = new Set(Object.values(STAGES));
const TOOL_IDS = {
  RECEPTIONIST: "ai_receptionist",
  EMAIL: "email_manager",
  SOCIAL: "social_media_manager"
};
const DEFAULT_TOOL_ID = TOOL_IDS.RECEPTIONIST;
const TOOL_ID_ALIASES = {
  "ai receptionist": "ai_receptionist",
  "ai-receptionist": "ai_receptionist",
  "email manager": "email_manager",
  "email-manager": "email_manager",
  "social media manager": "social_media_manager",
  "social-media-manager": "social_media_manager"
};
const normalizeToolId = (value) => {
  const base = (value || DEFAULT_TOOL_ID).toString().toLowerCase().trim();
  if (!base) return DEFAULT_TOOL_ID;
  if (TOOL_ID_ALIASES[base]) return TOOL_ID_ALIASES[base];
  return base.replace(/[\s-]+/g, "_");
};
const scrollToId = (id) => {
  if (typeof window === "undefined") return;
  const el = document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
};
const isStrongPassword = (value) => {
  if (!value) return false;
  const hasLower = /[a-z]/.test(value);
  const hasUpper = /[A-Z]/.test(value);
  const hasNumber = /\d/.test(value);
  const hasSymbol = /[^A-Za-z0-9]/.test(value);
  return value.length >= 8 && hasLower && hasUpper && hasNumber && hasSymbol;
};

const countryCodeToFlag = (code) => {
  if (!code || typeof code !== "string" || code.length !== 2) return "🌐";
  const base = 127397; // Unicode regional indicator symbol offset
  return String.fromCodePoint(...code.toUpperCase().split("").map((char) => char.charCodeAt(0) + base));
};

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
    agentName: "S4U-v3 Concierge",
    systemPrompt: "",
    voice: "",
    temperature: 0.4,
    greeting: "Hi, I'm your AI receptionist. How can I help today?",
    escalation: "Forward complex questions to the human team.",
    faq: "Hours: 9-6pm PT\nSupport: support@smartconnect4u.com"
  });
  const [ultravoxVoices, setUltravoxVoices] = useState([]);
  const [ultravoxVoicesLoading, setUltravoxVoicesLoading] = useState(false);
  const [selectedVoiceId, setSelectedVoiceId] = useState("");
  const [welcomeMessage, setWelcomeMessage] = useState("Hi! Thanks for calling. How can I help today?");
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [agentSaveStatus, setAgentSaveStatus] = useState({ status: "idle", message: "" });
  const [businessSaveStatus, setBusinessSaveStatus] = useState({ status: "idle", message: "" });
  const [userProfile, setUserProfile] = useState(null);
  const [user, setUser] = useState(null);
  const [countryCode, setCountryCode] = useState(null);
  const [countryName, setCountryName] = useState(null);
  const [fxRates, setFxRates] = useState({ USD: 1, CAD: null, GBP: null });
  const [callTranscript, setCallTranscript] = useState({
    call: null,
    transcripts: [],
    recordings: [],
    messages: [],
    transcript: "",
    loading: false,
    error: ""
  });
  const [recentCalls, setRecentCalls] = useState([]);
  const [allCalls, setAllCalls] = useState([]);
  const [callsPage, setCallsPage] = useState(1);
  const [activeTab, setActiveTab] = useState("agents");
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
  const [calendarAccountEmail, setCalendarAccountEmail] = useState("");
  const [calendarDiagnostics, setCalendarDiagnostics] = useState(null);
  const googleStateRef = useRef(null);
  const outlookStateRef = useRef(null);
  const [outlookAccountEmail, setOutlookAccountEmail] = useState("");
  const stageRef = useRef(stage);
  const pendingAnchorRef = useRef(null);
  const [clientData, setClientData] = useState(null);
  const [signupName, setSignupName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupRole, setSignupRole] = useState("");
  const [signupUseCase, setSignupUseCase] = useState("");
  const [signupReferral, setSignupReferral] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [businessPhone, setBusinessPhone] = useState("");
  const [businessCategory, setBusinessCategory] = useState("");
  const [businessSubType, setBusinessSubType] = useState("");
  const [businessCustomType, setBusinessCustomType] = useState("");
  const [manualBusinessInfo, setManualBusinessInfo] = useState(null);
  const [signupLoading, setSignupLoading] = useState(false);
  const [signupError, setSignupError] = useState("");
  const [businessLoading, setBusinessLoading] = useState(false);
  const [businessError, setBusinessError] = useState("");
  const [businessTypeLoading, setBusinessTypeLoading] = useState(false);
  const [businessTypeError, setBusinessTypeError] = useState("");
  const [paymentInfo, setPaymentInfo] = useState(null);
  const [twilioAvailableNumbers, setTwilioAvailableNumbers] = useState([]);
  const [twilioNumbersLoading, setTwilioNumbersLoading] = useState(false);
  const [twilioNumbersError, setTwilioNumbersError] = useState("");
  const [twilioNumbersCountry, setTwilioNumbersCountry] = useState("");
  const [twilioAssignedNumber, setTwilioAssignedNumber] = useState("");
  const [selectedTwilioNumber, setSelectedTwilioNumber] = useState("");
  const [detectedCountry, setDetectedCountry] = useState("");
  const [isMobile, setIsMobile] = useState(false);
  const [serviceSlug, setServiceSlug] = useState("receptionist");
  const validStages = useMemo(() => new Set(Object.values(STAGES)), []);
  const [bookingSettings, setBookingSettings] = useState({
    booking_enabled: false,
    booking_duration_minutes: 30,
    booking_buffer_minutes: 5
  });
  const [bookingStatus, setBookingStatus] = useState({ status: "idle", message: "" });
  const [bookingTestStatus, setBookingTestStatus] = useState({ status: "idle", message: "" });
  const [assignNumberStatus, setAssignNumberStatus] = useState({ status: "idle", message: "" });
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
    return phoneFromArray || phoneFromProvision || null;
  }, [
    phoneNumbers,
    provisionData?.phone_number,
    provisionData?.phone_numbers,
    provisionData?.twilio_phone_number
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
        "Building S4U-v3 prompt",
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

  useEffect(() => {
    let cancelled = false;
    const fetchGeo = async () => {
      if (typeof window === "undefined") return;
      try {
        const res = await fetch("https://ipapi.co/json/");
        if (!res.ok) throw new Error("Geo lookup failed");
        const data = await res.json();
        if (cancelled) return;
        setCountryCode(data?.country_code || null);
        setCountryName(data?.country_name || null);
      } catch (err) {
        console.warn("Unable to fetch geo location", err);
        if (!cancelled) {
          setCountryCode((prev) => prev || "GB");
          setCountryName((prev) => prev || "United Kingdom");
        }
      }
    };
    fetchGeo();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetchFx = async () => {
      if (typeof window === "undefined") return;
      try {
        const res = await fetch("https://open.er-api.com/v6/latest/USD");
        if (!res.ok) throw new Error("FX lookup failed");
        const data = await res.json();
        if (cancelled) return;
        const rates = data?.rates || {};
        setFxRates({
          USD: 1,
          CAD: rates.CAD || null,
          GBP: rates.GBP || null
        });
      } catch (err) {
        console.warn("Unable to fetch FX rates", err);
      }
    };
    fetchFx();
    return () => {
      cancelled = true;
    };
  }, []);

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
      let profile = null;
      try {
        const profileRes = await fetch(API_URLS.businessProfile, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          mode: "cors",
          body: JSON.stringify({
            email: signupEmail || email || loginEmail || user?.email || "",
            website_url: websiteUrl,
            pages: data?.pages || data?.data || data?.raw || []
          })
        });
        const profileJson = await profileRes.json().catch(() => ({}));
        if (profileRes.ok) {
          profile = profileJson?.profile || null;
        } else {
          console.warn("Business profile extraction failed", profileJson);
        }
      } catch (profileErr) {
        console.warn("Business profile extraction request failed", profileErr);
      }
      const defaults = buildReviewDefaults(websiteUrl, data);
      const reviewInfo = mergeProfileIntoReview(defaults, profile);
      setManualBusinessInfo(reviewInfo);
      if (reviewInfo.businessName) setBusinessName(reviewInfo.businessName);
      if (reviewInfo.businessPhone) setBusinessPhone(reviewInfo.businessPhone);
      setStatus("success");
      // After a successful crawl, confirm business details before packages
      setStage(STAGES.BUSINESS_INFO_REVIEW);
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

  const handleNavToSection = (id) => {
    pendingAnchorRef.current = id || null;
    if (stage !== STAGES.LANDING) {
      handleGoHome();
      return;
    }
    if (pendingAnchorRef.current) {
      scrollToId(pendingAnchorRef.current);
      pendingAnchorRef.current = null;
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
      setActiveTab("agents");
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

  const buildReviewDefaults = (websiteUrl, data) => {
    let nameGuess =
      businessName ||
      data?.business_name ||
      data?.pages?.[0]?.title ||
      "";
    if (!nameGuess && websiteUrl) {
      try {
        nameGuess = new URL(websiteUrl).hostname.replace(/^www\./, "");
      } catch (err) {
        nameGuess = websiteUrl;
      }
    }
    return {
      businessName: nameGuess,
      businessPhone: businessPhone || "",
      businessEmail: signupEmail || email || "",
      websiteUrl: websiteUrl || "",
      businessSummary: "",
      location: "",
      hours: "",
      openings: "",
      services: "",
      notes: ""
    };
  };

  const mergeProfileIntoReview = (defaults, profile) => {
    if (!profile) return defaults;
    return {
      ...defaults,
      businessName: profile.business_name || defaults.businessName,
      businessPhone: profile.contact_phone || defaults.businessPhone,
      businessEmail: profile.contact_email || defaults.businessEmail,
      businessSummary: profile.business_summary || defaults.businessSummary,
      location: profile.business_location || defaults.location,
      hours: profile.business_hours || defaults.hours,
      openings: profile.business_openings || defaults.openings,
      services: profile.business_services || defaults.services,
      notes: profile.business_notes || defaults.notes
    };
  };

  const handleCreateAccountSubmit = async ({ name, email, password }) => {
    setSignupError("");
    if (!isStrongPassword(password)) {
      setSignupError(
        "Password must be at least 8 characters and include uppercase, lowercase, a number, and a symbol."
      );
      return;
    }
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
      const targetEmail = signupEmail || user?.email || email || loginEmail || "";
      if (!targetEmail) {
        throw new Error("Please log in before adding business details.");
      }
      const res = await fetch(API_URLS.clientsBusinessDetails, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: targetEmail,
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
      setStage(STAGES.BUSINESS_TYPE);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not save business details.";
      setBusinessError(msg);
    } finally {
      setBusinessLoading(false);
    }
  };

  const handleBusinessTypeSubmit = async ({
    category,
    subType,
    customType,
    businessName: nameInput
  }) => {
    setBusinessTypeError("");
    setBusinessTypeLoading(true);
    try {
      const targetEmail = signupEmail || user?.email || email || loginEmail || "";
      if (!targetEmail) {
        throw new Error("Please log in before adding business details.");
      }
      const normalizedName = (nameInput || businessName || "").trim();
      const normalizedPhone = (businessPhone || "").trim();
      const normalizedCustom = (customType || "").trim();

      if (normalizedName && normalizedName !== businessName) {
        setBusinessName(normalizedName);
      }
      if (category && category !== businessCategory) {
        setBusinessCategory(category);
      }
      if (subType && subType !== businessSubType) {
        setBusinessSubType(subType);
      }
      if (normalizedCustom !== businessCustomType) {
        setBusinessCustomType(normalizedCustom);
      }

      const res = await fetch(API_URLS.clientsBusinessDetails, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: targetEmail,
          businessName: normalizedName || businessName,
          businessPhone: normalizedPhone,
          businessCategory: category,
          businessSubType: subType,
          businessCustomType: normalizedCustom
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.error || "Could not save business type.";
        setBusinessTypeError(msg);
        return;
      }
      setStage(STAGES.CRAWL_FORM);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not save business type.";
      setBusinessTypeError(msg);
    } finally {
      setBusinessTypeLoading(false);
    }
  };

  const handleBusinessTypeSkip = () => {
    setBusinessTypeError("");
    setStage(STAGES.CRAWL_FORM);
  };

  const handleManualBusinessSubmit = async (payload) => {
    const emailAddress = signupEmail || email || user?.email || "";
    const summary = payload?.businessSummary || "";
    const hours = payload?.hours || "";
    const services = payload?.services || "";
    const location = payload?.location || "";
    const notes = payload?.notes || "";
    const openings = payload?.openings || "";
    const infoLines = [
      summary && `Summary: ${summary}`,
      services && `Services: ${services}`,
      hours && `Hours: ${hours}`,
      openings && `Openings: ${openings}`,
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
      openings,
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

  const handleBusinessReviewSubmit = async (payload) => {
    const emailAddress = signupEmail || email || user?.email || "";
    const normalized = {
      businessName: payload?.businessName || businessName || "Your business",
      businessPhone: payload?.businessPhone || businessPhone || "",
      businessEmail: payload?.businessEmail || signupEmail || email || "",
      businessSummary: payload?.businessSummary || "",
      hours: payload?.hours || "",
      openings: payload?.openings || "",
      location: payload?.location || "",
      services: payload?.services || "",
      notes: payload?.notes || "",
      websiteUrl:
        payload?.websiteUrl || url || crawlData?.website_url || crawlData?.start_url || ""
    };
    setManualBusinessInfo(normalized);
    setBusinessName(normalized.businessName);
    if (normalized.businessPhone) setBusinessPhone(normalized.businessPhone);

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
      console.warn("Failed to save reviewed business info", persistErr);
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
        crawlDataOverride: crawlData
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
    setCalendarAccountEmail("");
    setCalendarDiagnostics(null);
    setCalendarAccountEmail("");
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
      agentName: "S4U-v3 Concierge",
      systemPrompt: "",
      voice: "",
      temperature: 0.4,
      greeting: "Hi, I'm your AI receptionist. How can I help today?",
      escalation: "Forward complex questions to the human team.",
      faq: "Hours: 9-6pm PT\nSupport: support@smartconnect4u.com"
    });
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY);
      window.history.pushState({ stage: STAGES.LANDING }, "", "/");
    }
  };

  const handleGoToDashboard = () => {
    setActiveTab("agents");
    setActiveTool(DEFAULT_TOOL_ID);
    setIsLoggedIn(true);
    setUser((current) => {
      if (current) return current;
      return {
        name: provisionData?.name || email || "You",
        email: email || provisionData?.email || "you@smartconnect4u.com"
      };
    });
    setStage(STAGES.DASHBOARD);
  };

  const handleResumeBusinessDetails = useCallback(() => {
    const targetEmail = signupEmail || user?.email || email || loginEmail || "";
    if (targetEmail) {
      if (!signupEmail) setSignupEmail(targetEmail);
      if (!email) setEmail(targetEmail);
    }
    if (!signupName && user?.name) {
      setSignupName(user.name);
    }
    setActiveTab("agents");
    setActiveTool(DEFAULT_TOOL_ID);
    setStage(STAGES.BUSINESS_DETAILS);
    setStatus("idle");
    setResponseMessage("");
  }, [email, loginEmail, signupEmail, signupName, user?.email, user?.name]);

  const handleSelectPlan = (planId, options = {}) => {
    const { source } = options;
    if (hasActiveSubscription) {
      setStage(STAGES.DASHBOARD);
      return;
    }
    setSelectedPlan(planId);
    setSelectedTool(activeTool || DEFAULT_TOOL_ID);
    if (source === "landing") {
      setStage(STAGES.SIGNUP);
    } else {
      setStage(STAGES.PAYMENT);
    }
  };

  const handlePaymentSubmit = async (info) => {
    setPaymentInfo(info || null);
    setStatus("success");
    setResponseMessage("Payment successful.");
    setStage(STAGES.PAYMENT_SUCCESS);
  };

  const handlePaymentBack = () => {
    setStage(STAGES.PACKAGES);
  };

  const handlePaymentSuccessContinue = () => {
    setStage(STAGES.NUMBER_SELECT);
  };

  const isLandingStage = stage === STAGES.LANDING;
  const isDashboardStage = stage === STAGES.DASHBOARD;
  const showHeader = stage !== STAGES.DASHBOARD;
  const pageClassName = `page${isLandingStage ? " page-landing" : ""}`;
  const pageContentClassName = `page-content${isLandingStage ? " page-content-landing" : ""}${
    showHeader ? " page-content-with-header" : ""
  }`;
  const contentClassName = `content${isLandingStage ? " content-landing" : ""}${isDashboardStage ? " content-wide" : ""}`;

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
    let manualInfo = manualInfoOverride || manualBusinessInfo;
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
      if (
        (!manualInfo || !manualInfo.businessSummary) &&
        (Array.isArray(activeCrawlData?.pages) || Array.isArray(activeCrawlData?.data))
      ) {
        try {
          const profileRes = await fetch(API_URLS.businessProfile, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            mode: "cors",
            body: JSON.stringify({
              email: provisionEmail,
              website_url: provisionWebsite,
              pages: activeCrawlData?.pages || activeCrawlData?.data || []
            })
          });
          const profileJson = await profileRes.json().catch(() => ({}));
          if (profileRes.ok && profileJson?.profile) {
            const profile = profileJson.profile;
            manualInfo = {
              businessName: profile.business_name || manualInfo?.businessName || businessName || "",
              businessPhone: profile.contact_phone || manualInfo?.businessPhone || businessPhone || "",
              businessEmail: profile.contact_email || manualInfo?.businessEmail || "",
              businessSummary: profile.business_summary || manualInfo?.businessSummary || "",
              hours: profile.business_hours || manualInfo?.hours || "",
              openings: profile.business_openings || manualInfo?.openings || "",
              location: profile.business_location || manualInfo?.location || "",
              services: profile.business_services || manualInfo?.services || "",
              notes: profile.business_notes || manualInfo?.notes || "",
              websiteUrl: provisionWebsite || manualInfo?.websiteUrl || ""
            };
            setManualBusinessInfo(manualInfo);
          }
        } catch (profileErr) {
          console.warn("Business profile extraction before provision failed", profileErr);
        }
      }

      const fallbackBusiness =
        activeCrawlData?.business_name ||
        manualInfo?.businessName ||
        businessName ||
        "Horizon Property Group";
      const infoLines = manualInfo
        ? [
            manualInfo.businessSummary && `Summary: ${manualInfo.businessSummary}`,
            manualInfo.services && `Services: ${manualInfo.services}`,
            manualInfo.hours && `Hours: ${manualInfo.hours}`,
            manualInfo.openings && `Openings: ${manualInfo.openings}`,
            manualInfo.location && `Location: ${manualInfo.location}`,
            manualInfo.notes && `Notes: ${manualInfo.notes}`,
            manualInfo.businessPhone && `Phone: ${manualInfo.businessPhone}`,
            manualInfo.businessEmail && `Email: ${manualInfo.businessEmail}`
          ]
            .filter(Boolean)
            .join("\n")
        : "";
      const manualPages = infoLines
        ? [
            {
              url: "manual-entry",
              content: infoLines
            }
          ]
        : [];
      const promptPayload = {
        business_name: fallbackBusiness,
        pages: manualPages
      };

      const promptRes = await fetch(API_URLS.ultravoxPrompt, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        mode: "cors",
        body: JSON.stringify(promptPayload)
      });

      if (!promptRes.ok) {
        const promptText = await promptRes.text();
        throw new Error(promptText || "Failed to generate S4U-v3 prompt");
      }

      const promptData = await promptRes
        .json()
        .catch(async () => ({ prompt: await promptRes.text() }));
      const derivedPrompt =
        promptData?.system_prompt ||
        promptData?.prompt ||
        promptData?.message ||
        promptData?.raw ||
        "Your custom S4U-v3 system prompt here...";

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
        business_notes: manualInfo?.notes || "",
        voice: selectedVoiceId || "",
        welcome_message: welcomeMessage || "",
        selected_twilio_number: selectedTwilioNumber || ""
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
      setActiveTab("agents");
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
    async (emailAddress = user?.email, range = null) => {
      if (!emailAddress) return;
      setCalendarLoading(true);
      setCalendarError("");
      try {
        const params = new URLSearchParams({
          email: emailAddress,
          max_results: "200",
          ts: String(Date.now())
        });
        if (range?.start) params.set("from", range.start);
        if (range?.end) params.set("to", range.end);
        const res = await fetch(
          `${API_URLS.calendarEvents}?${params.toString()}`
        );
        if (!res.ok) {
          const text = await res.text();
          let parsed = null;
          try {
            parsed = text ? JSON.parse(text) : null;
          } catch {
            parsed = null;
          }
          const detail = parsed?.error || parsed?.details || text || "Unable to fetch calendar events";
          const detailText = String(detail || "");
          const isDisconnected =
            res.status === 404 || detailText.includes("No Google account connected");
          const isAuthExpired =
            res.status === 401 ||
            detailText.includes("Invalid Credentials") ||
            detailText.includes("UNAUTHENTICATED");
          if (isDisconnected || isAuthExpired) {
            setCalendarStatus(null);
            setCalendarEvents([]);
            setCalendarAccountEmail("");
            setCalendarDiagnostics(null);
          }
          if (isAuthExpired) {
            setCalendarError("Google Calendar connection expired. Please reconnect.");
            return;
          }
          throw new Error(detail);
        }
        const data = await res.json();
        setCalendarEvents(data?.events || []);
        setCalendarStatus("Google");
        setCalendarAccountEmail(data?.account_email || data?.accountEmail || "");
        setCalendarDiagnostics(data?.diagnostics || null);
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
      const toolId = normalizeToolId(entry?.tool || entry?.toolId || entry?.tool_id || DEFAULT_TOOL_ID);
      const status = entry?.status || "";
      const active =
        typeof entry?.active === "boolean"
          ? entry.active
          : ["active", "trialing"].includes(status.toLowerCase());
      const existing = map[toolId];
      if (existing?.active) {
        return;
      }
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
          greeting:
            callTemplate?.firstSpeakerSettings?.agent?.text ||
            callTemplate?.greeting ||
            dashData?.agent?.greeting ||
            prev.greeting,
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

  const handleAssignNumber = useCallback(async () => {
    const targetEmail = user?.email || email || signupEmail || loginEmail;
    if (!targetEmail) {
      setAssignNumberStatus({ status: "error", message: "Missing user email." });
      return;
    }
    setAssignNumberStatus({ status: "loading", message: "" });
    try {
      const payload = { email: targetEmail };
      const res = await fetch(API_URLS.assignAiNumber, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        mode: "cors",
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = data?.error || data?.details || "Failed to assign AI number";
        throw new Error(message);
      }
      setAssignNumberStatus({ status: "success", message: "AI number assigned." });
      setProvisionData((prev) => ({ ...(prev || {}), ...data }));
      await loadDashboard(targetEmail);
    } catch (error) {
      setAssignNumberStatus({
        status: "error",
        message: error?.message || "Failed to assign AI number"
      });
    }
  }, [
    email,
    loadDashboard,
    loginEmail,
    signupEmail,
    user?.email
  ]);

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
            greeting: updates?.greeting ?? agentDetails.greeting,
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

  const triggerPromptGeneration = useCallback(
    async ({ businessProfile, knowledgeText } = {}) => {
      if (!user?.email) return;
      const clientId = clientData?.id || clientData?.client_id;
      const subType = clientData?.business_sub_type;
      if (!clientId || !subType) return;
      try {
        await fetch(API_URLS.promptsGenerate, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          mode: "cors",
          body: JSON.stringify({
            email: user.email,
            clientId,
            category: clientData?.business_category || null,
            subType,
            taskType: null,
            businessProfile: businessProfile || {},
            knowledgeText: knowledgeText || ""
          })
        });
      } catch (error) {
        console.warn("Prompt generation failed", error);
      }
    },
    [clientData?.business_category, clientData?.business_sub_type, clientData?.client_id, clientData?.id, user?.email]
  );

  const handleBusinessSave = useCallback(
    async ({ businessName: name, businessPhone: phone, websiteUrl, websiteData } = {}) => {
      if (!user?.email) return;
      setBusinessSaveStatus({ status: "loading", message: "" });
      try {
        const payload = {
          email: user.email,
          businessName: name || businessName,
          businessPhone: phone || businessPhone,
          websiteUrl: websiteUrl || clientData?.website_url || url || ""
        };
        if (websiteData !== undefined) {
          payload.websiteData = websiteData;
        }
        const res = await fetch(API_URLS.clientsBusinessDetails, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          mode: "cors",
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || "Failed to save business details");
        }
        setBusinessSaveStatus({ status: "success", message: "Business details saved" });
        setBusinessName(name || businessName);
        setBusinessPhone(phone || businessPhone);
        await loadDashboard(user.email);
        triggerPromptGeneration({
          businessProfile: websiteData || {},
          knowledgeText: websiteData?.businessSummary || websiteData?.business_summary || ""
        });
      } catch (error) {
        setBusinessSaveStatus({
          status: "error",
          message: error?.message || "Failed to save business details"
        });
      }
    },
    [businessName, businessPhone, clientData?.website_url, loadDashboard, triggerPromptGeneration, url, user?.email]
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
        const callsRes = await fetch(
          `${API_URLS.calls}?email=${encodeURIComponent(emailAddress)}`
        );
        if (callsRes.ok) {
          const callsJson = await callsRes.json().catch(() => ({}));
          const calls = Array.isArray(callsJson?.calls) ? callsJson.calls : [];
          if (calls.length) {
            setRecentCalls(calls);
            setCallsPage(1);
            return;
          }
        }

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
        throw new Error(text || "Unable to fetch S4U-v3 voices");
      }
      const data = await res.json();
      const voices = Array.isArray(data?.voices) ? data.voices : data;
      setUltravoxVoices(voices || []);
    } catch (error) {
      console.error("Failed to load S4U-v3 voices", error);
      setUltravoxVoices([]);
    } finally {
      setUltravoxVoicesLoading(false);
    }
  }, []);

  const loadTwilioAvailableNumbers = useCallback(async () => {
    const emailAddress = signupEmail || email || loginEmail || paymentInfo?.email || "";
    if (!emailAddress) return;
    setTwilioNumbersLoading(true);
    setTwilioNumbersError("");
    try {
      const params = new URLSearchParams({ email: emailAddress });
      if (detectedCountry) {
        params.set("country", detectedCountry);
      }
      const res = await fetch(`${API_URLS.twilioAvailableNumbers}?${params.toString()}`);
      if (!res.ok) {
        const text = await res.text();
        let parsed = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = null;
        }
        throw new Error(parsed?.error || parsed?.details || text || "Unable to fetch numbers");
      }
      const data = await res.json().catch(() => ({}));
      const numbers = Array.isArray(data?.numbers) ? data.numbers : [];
      setTwilioAvailableNumbers(numbers);
      setTwilioNumbersCountry(data?.country || "");
      setTwilioAssignedNumber(data?.assigned_number || "");
      setSelectedTwilioNumber((prev) => {
        if (prev) return prev;
        if (data?.assigned_number) return data.assigned_number;
        return numbers?.[0]?.phone_number || "";
      });
    } catch (error) {
      setTwilioNumbersError(error?.message || "Unable to fetch numbers");
      setTwilioAvailableNumbers([]);
    } finally {
      setTwilioNumbersLoading(false);
    }
  }, [detectedCountry, email, loginEmail, paymentInfo?.email, signupEmail]);

  const detectCountryFromClient = useCallback(async () => {
    if (detectedCountry) return detectedCountry;
    try {
      const res = await fetch("https://ipapi.co/json/");
      if (!res.ok) return "";
      const data = await res.json().catch(() => ({}));
      const code = String(data?.country_code || "").trim().toUpperCase();
      if (code && code.length === 2) {
        setDetectedCountry(code);
        return code;
      }
    } catch (error) {
      console.warn("Failed to detect country from client", error);
    }
    return "";
  }, [detectedCountry]);

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
          messages: data?.messages || [],
          transcript: "",
          loading: false,
          error: ""
        });
      } catch (error) {
        const message = error?.message || "Unable to fetch transcript";
        setCallTranscript((prev) => ({
          ...prev,
          loading: false,
          error: message
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
      setCalendarAccountEmail(payload?.google_account_email || payload?.account_email || "");
    },
    [
      setCalendarAccountEmail,
      setCalendarError,
      setCalendarEvents,
      setCalendarStatus,
      setEmail,
      setResponseMessage,
      setStatus,
      setUser
    ]
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
          setCalendarEvents([]);
          await loadCalendarEvents(data?.email);
        }
      } catch (error) {
        setStatus("error");
        setResponseMessage(error?.message || "Google auth failed");
      }
    },
    [loadCalendarEvents, setLoggedInFromOAuth]
  );

  const completeOutlookAuth = useCallback(async (code, state) => {
    setStatus("loading");
    setResponseMessage("");
    try {
      const res = await fetch(API_URLS.outlookAuthCallback, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, state })
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Outlook authentication failed");
      }
      const data = await res.json();
      setOutlookAccountEmail(data?.outlook_account_email || data?.account_email || "");
      setStatus("success");
      setResponseMessage("Outlook account connected.");
      if (window.opener && window.opener !== window) {
        window.opener.postMessage(data, "*");
        window.close();
      }
    } catch (error) {
      setStatus("error");
      setResponseMessage(error?.message || "Outlook auth failed");
    }
  }, []);

  const decodeOAuthState = (stateValue) => {
    if (!stateValue) return null;
    try {
      const base = stateValue.replace(/-/g, "+").replace(/_/g, "/");
      const padded = base + "=".repeat((4 - (base.length % 4)) % 4);
      const decoded = atob(padded);
      return JSON.parse(decoded);
    } catch (error) {
      return null;
    }
  };

  const beginGoogleLogin = async (options = {}) => {
    const force = Boolean(options?.force);
    setStatus("loading");
    setResponseMessage("");
    try {
      const targetEmail = isLoggedIn ? user?.email : "";
      const query = new URLSearchParams();
      if (targetEmail) query.set("email", targetEmail);
      if (force) query.set("force", "true");
      const url = query.toString()
        ? `${API_URLS.googleAuthUrl}?${query.toString()}`
        : API_URLS.googleAuthUrl;
      const res = await fetch(url);
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
      if (payload?.outlook_account_email) {
        if (outlookStateRef.current && payload?.state && payload.state !== outlookStateRef.current) {
          return;
        }
        setOutlookAccountEmail(payload?.outlook_account_email || payload?.account_email || "");
        setStatus("success");
        setResponseMessage("Outlook account connected.");
        return;
      }
      if (!payload?.user_id || !payload?.email) return;
      if (googleStateRef.current && payload?.state && payload.state !== googleStateRef.current) {
        return;
      }
      const isNewUser = Boolean(payload?.is_new_user);
      setLoggedInFromOAuth(payload);
      setStatus("success");
      setResponseMessage("Google account connected.");
      setCalendarAccountEmail(payload?.google_account_email || payload?.account_email || "");
      if (!isNewUser) {
        setCalendarEvents([]);
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
      const decodedState = decodeOAuthState(state);
      if (decodedState?.provider === "outlook") {
        completeOutlookAuth(code, state);
      } else {
        completeGoogleAuth(code, state);
      }
      params.delete("code");
      params.delete("state");
      const newUrl =
        window.location.pathname +
        (params.toString() ? `?${params.toString()}` : "");
      window.history.replaceState({}, document.title, newUrl);
    }
  }, [completeGoogleAuth, completeOutlookAuth]);

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
      if (saved.selectedVoiceId) setSelectedVoiceId(saved.selectedVoiceId);
      if (saved.welcomeMessage) setWelcomeMessage(saved.welcomeMessage);
      if (saved.activeTab) setActiveTab(saved.activeTab);
      if (saved.activeTool) setActiveTool(saved.activeTool);
      if (saved.toolSubscriptions) {
        const normalized = {};
        Object.entries(saved.toolSubscriptions).forEach(([key, value]) => {
          normalized[normalizeToolId(key)] = value;
        });
        setToolSubscriptions(normalized);
      }
      if (saved.selectedTool) setSelectedTool(saved.selectedTool);
      if (saved.manualBusinessInfo) setManualBusinessInfo(saved.manualBusinessInfo);
      if (saved.serviceSlug) setServiceSlug(saved.serviceSlug);
      if (saved.calendarStatus) setCalendarStatus(saved.calendarStatus);
      if (saved.calendarEvents) setCalendarEvents(saved.calendarEvents);
      if (saved.calendarAccountEmail) setCalendarAccountEmail(saved.calendarAccountEmail);
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
      setActiveTab("agents");
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
      STAGES.BUSINESS_TYPE,
      STAGES.CRAWL_FORM,
      STAGES.LOADING,
      STAGES.EMAIL_CAPTURE,
      STAGES.SIGNUP,
      STAGES.SIGNUP_SURVEY,
      STAGES.PACKAGES,
      STAGES.PAYMENT,
      STAGES.PAYMENT_SUCCESS,
      STAGES.NUMBER_SELECT,
      STAGES.BUSINESS_INFO_MANUAL,
      STAGES.BUSINESS_INFO_REVIEW,
    ]);
    if (onboardingStages.has(stage)) return;
    if (stage === STAGES.PROJECTS) return;
    if (stage === STAGES.DASHBOARD) return;
    setStage(STAGES.DASHBOARD);
    setActiveTab("agents");
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
    if (stage !== STAGES.PAYMENT_SUCCESS) return;
    if (ultravoxVoices.length) return;
    loadUltravoxVoices();
  }, [loadUltravoxVoices, stage, ultravoxVoices.length]);

  useEffect(() => {
    if (stage !== STAGES.NUMBER_SELECT) return;
    detectCountryFromClient().finally(loadTwilioAvailableNumbers);
  }, [detectCountryFromClient, loadTwilioAvailableNumbers, stage]);

  useEffect(() => {
    if (selectedVoiceId) return;
    if (!ultravoxVoices.length) return;
    const sampleFirst =
      ultravoxVoices.find((voice) =>
        [
          voice?.sample,
          voice?.sample_url,
          voice?.sampleUrl,
          voice?.preview_url,
          voice?.previewUrl,
          voice?.audio_url,
          voice?.audioUrl,
          voice?.demo_url,
          voice?.demoUrl
        ].some(Boolean)
      ) || ultravoxVoices[0];
    const first = sampleFirst || ultravoxVoices[0];
    const voiceId = first?.id || first?.voiceId || first?.voice_id || first?.name;
    if (voiceId) setSelectedVoiceId(voiceId);
  }, [selectedVoiceId, ultravoxVoices]);

  useEffect(() => {
    if (stage !== STAGES.DASHBOARD) return;
    if (!user?.email && email) {
      setUser((prev) => ({ ...(prev || {}), email }));
      setIsLoggedIn(true);
    }
  }, [stage, user?.email, email]);

  useEffect(() => {
    if (stage !== STAGES.BUSINESS_DETAILS && stage !== STAGES.BUSINESS_TYPE) return;
    const targetEmail = signupEmail || user?.email || email || loginEmail || "";
    if (targetEmail) {
      if (!signupEmail) setSignupEmail(targetEmail);
      if (!email) setEmail(targetEmail);
    }
    if (!signupName) {
      const fallbackName =
        user?.name ||
        userProfile?.business_name ||
        clientData?.business_name ||
        "";
      if (fallbackName) setSignupName(fallbackName);
    }
  }, [
    clientData?.business_name,
    email,
    loginEmail,
    signupEmail,
    signupName,
    stage,
    user?.email,
    user?.name,
    userProfile?.business_name
  ]);

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
        selectedVoiceId,
        welcomeMessage,
        activeTab,
        activeTool,
        toolSubscriptions,
        serviceSlug,
        selectedPlan,
        selectedTool,
        manualBusinessInfo,
        calendarStatus,
        calendarEvents,
        calendarAccountEmail,
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
    selectedVoiceId,
    welcomeMessage,
    activeTab,
    activeTool,
    toolSubscriptions,
    serviceSlug,
    selectedPlan,
    selectedTool,
    calendarStatus,
    calendarEvents,
    calendarAccountEmail,
    bookingSettings
  ]);

  useEffect(() => {
    if (!calendarAccountEmail || !user?.email) return;
    loadCalendarEvents(user.email);
  }, [calendarAccountEmail, loadCalendarEvents, user?.email]);

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
    const updateMobile = () => setIsMobile(typeof window !== "undefined" && window.innerWidth <= 768);
    updateMobile();
    window.addEventListener("resize", updateMobile);
    return () => window.removeEventListener("resize", updateMobile);
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

    const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const isSafari = /safari/i.test(userAgent) && !/chrome|crios|android|fxios/i.test(userAgent);
    const isMobile = window.matchMedia("(max-width: 768px)").matches;
    const isDashboard = stage === STAGES.DASHBOARD;
    if (isMobile || isSafari || isDashboard) {
      const prevOverflow = document.body.style.overflow;
      scroller.style.position = "static";
      scroller.style.overflow = isDashboard ? "hidden" : "auto";
      scroller.style.webkitOverflowScrolling = "touch";
      scroller.style.inset = "auto";
      document.body.style.overflow = isDashboard ? "hidden" : "auto";
      content.style.minHeight = "100%";
      return () => {
        document.body.style.overflow = prevOverflow;
        scroller.style.position = "";
        scroller.style.overflow = "";
        scroller.style.webkitOverflowScrolling = "";
        scroller.style.inset = "";
        content.style.minHeight = "";
      };
    }

    scroller.style.position = "";
    scroller.style.overflow = "";
    scroller.style.webkitOverflowScrolling = "";
    scroller.style.inset = "";
    content.style.minHeight = "";

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
  }, [stage]);

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
      if (pendingAnchorRef.current) {
        // Ensure the DOM has the landing sections before scrolling.
        requestAnimationFrame(() => {
          scrollToId(pendingAnchorRef.current);
          pendingAnchorRef.current = null;
        });
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
      {stage !== STAGES.DASHBOARD && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 0,
            pointerEvents: "none",
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#000000"
          }}
          aria-hidden="true"
        >
          <div style={{ width: "100%", height: "600px", maxWidth: "100%", position: "relative" }}>
            <Orb hoverIntensity={2} rotateOnHover hue={248} forceHoverState={false} backgroundColor="#000000" />
          </div>
        </div>
      )}
      <div className={pageContentClassName} data-lenis-content style={{ position: "relative", zIndex: 1 }}>
        {showHeader && (
          <header className="nav-card screen-panel">
            <div className="nav-brand">
              <button type="button" className="brand brand-main" onClick={handleGoHome} aria-label="Go to home">
                <img src="/media/sc_logo_main.png" alt="SmartConnect4u logo" className="brand-logo brand-logo-main" />
              </button>
            </div>
            <div className="nav-links">
              <button className="nav-link" onClick={() => handleNavToSection("capabilities")}>Our purpose</button>
              <div className="nav-item-with-sub">
                <button className="nav-link" type="button">Services</button>
                <div className="nav-submenu">
                  <button className="nav-subitem" type="button" onClick={() => handleGoProjects("receptionist")}>
                    AI Receptionist
                  </button>
                  <button className="nav-subitem" type="button" onClick={() => handleGoProjects("social-manager")}>
                    AI Social Media Manager
                  </button>
                  <button className="nav-subitem" type="button" onClick={() => handleGoProjects("email-manager")}>
                    Email Manager
                  </button>
                  <button className="nav-subitem" type="button" onClick={() => handleGoProjects("crm-lead-manager")}>
                    CRM &amp; Lead Manager
                  </button>
                </div>
              </div>
              <div className="nav-item-with-sub">
                <button className="nav-link" type="button">Legal</button>
                <div className="nav-submenu">
                  <a className="nav-subitem" href="/terms.html">
                    Terms &amp; Conditions
                  </a>
                  </div>
                </div>
              <a className="nav-link" href="/contact.html">Contact</a>
              <a className="nav-link" href="/blog.html">Blog</a>
            </div>
            <div className="nav-actions">
              <div
                className="nav-geo"
                aria-label={`Detected location: ${countryName || "Detecting location"}`}
                title={countryName || "Detecting location"}
              >
                <span className="nav-geo-flag" aria-hidden>
                  {countryCodeToFlag(countryCode || "GB")}
                </span>
                {!isMobile && <span className="nav-geo-label">{countryName || "Detecting..."}</span>}
              </div>
              <button className="login-cta" onClick={() => setStage(STAGES.LOGIN)}>
                <span aria-hidden>→</span>
                <span>Login</span>
              </button>
            </div>
          </header>
        )}
        <main className={contentClassName}>
        {stage === STAGES.LANDING && (
          <LandingScreen
            onTry={() => setStage(STAGES.CRAWL_FORM)}
            onLogin={() => setStage(STAGES.LOGIN)}
            onSelectPlan={handleSelectPlan}
            onShowService={handleGoProjects}
            geoCountryCode={countryCode}
            fxRates={fxRates}
          />
        )}
        {stage === STAGES.PROJECTS && (
          <ProjectsScreen serviceSlug={serviceSlug} onStartSignup={goToSignup} />
        )}
        {stage === STAGES.PACKAGES && !hasActiveSubscription && (
          <div className="shell-card screen-panel">
            <PricingPackages
              onSelectPackage={handleSelectPlan}
              showCrawlSuccess
              geoCountryCode={countryCode}
              fxRates={fxRates}
            />
          </div>
        )}

        {stage === STAGES.BUSINESS_INFO_REVIEW && (
          <div className="shell-card screen-panel">
            <BusinessReviewScreen
              initialData={manualBusinessInfo || {}}
              onSubmit={handleBusinessReviewSubmit}
              onBack={() => setStage(STAGES.CRAWL_FORM)}
            />
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
          <div className="shell-card screen-panel narrow login-shell">
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
              geoCountryCode={countryCode}
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

        {stage === STAGES.BUSINESS_TYPE && (
          <div className="shell-card screen-panel">
            <BusinessTypeScreen
              businessName={businessName}
              category={businessCategory}
              subType={businessSubType}
              customType={businessCustomType}
              onBusinessNameChange={setBusinessName}
              onCategoryChange={setBusinessCategory}
              onSubTypeChange={setBusinessSubType}
              onCustomTypeChange={setBusinessCustomType}
              onContinue={handleBusinessTypeSubmit}
              onBack={() => setStage(STAGES.BUSINESS_DETAILS)}
              onSkip={handleBusinessTypeSkip}
              loading={businessTypeLoading}
              error={businessTypeError}
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
            calendarAccountEmail={calendarAccountEmail}
            calendarDiagnostics={calendarDiagnostics}
            ultravoxVoices={ultravoxVoices}
            ultravoxVoicesLoading={ultravoxVoicesLoading}
            onAgentSave={handleAgentSave}
            agentSaveStatus={agentSaveStatus}
            businessSaveStatus={businessSaveStatus}
            onBusinessSave={handleBusinessSave}
            clientData={clientData}
            manualBusinessInfo={manualBusinessInfo}
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
            assignNumberStatus={assignNumberStatus}
            onAssignNumber={handleAssignNumber}
            hasActiveSubscription={hasActiveSubscription}
            onResumeBusinessDetails={handleResumeBusinessDetails}
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
              onBack={() => setStage(STAGES.BUSINESS_TYPE)}
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
                onBack={handlePaymentBack}
                onSubmit={handlePaymentSubmit}
                initialEmail={signupEmail || email}
                geoCountryCode={countryCode}
                fxRates={fxRates}
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
              voices={ultravoxVoices}
              selectedVoiceId={selectedVoiceId}
              onSelectVoice={setSelectedVoiceId}
              welcomeMessage={welcomeMessage}
              onWelcomeMessageChange={setWelcomeMessage}
              onContinue={handlePaymentSuccessContinue}
            />
          </div>
        )}
        {stage === STAGES.NUMBER_SELECT && (
          <div className="shell-card screen-panel">
            <NumberSelectionScreen
              paymentInfo={paymentInfo}
              availableNumbers={twilioAvailableNumbers}
              numbersLoading={twilioNumbersLoading}
              numbersError={twilioNumbersError}
              numbersCountry={twilioNumbersCountry}
              assignedNumber={twilioAssignedNumber}
              selectedNumber={selectedTwilioNumber}
              onSelectNumber={setSelectedTwilioNumber}
              onRefreshNumbers={loadTwilioAvailableNumbers}
              onContinue={runProvisionFlow}
            />
          </div>
        )}
        <ChatWidget />
        </main>
      </div>
    </div>
  );
}
