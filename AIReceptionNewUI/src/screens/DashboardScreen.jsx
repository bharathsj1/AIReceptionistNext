import { useEffect, useMemo, useRef, useState } from "react";
import "@fullcalendar/react/dist/vdom";
import FullCalendar from "@fullcalendar/react";
import interactionPlugin from "@fullcalendar/interaction";
import timeGridPlugin from "@fullcalendar/timegrid";
import dayGridPlugin from "@fullcalendar/daygrid";
import "@fullcalendar/common/main.css";
import "@fullcalendar/timegrid/main.css";
import {
  Activity,
  AlertTriangle,
  Archive,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Edit3,
  FileText,
  Globe2,
  Inbox,
  LayoutGrid,
  Link2,
  LogOut,
  Mail,
  MailOpen,
  MailPlus,
  Megaphone,
  MessageSquare,
  Mic,
  Pause,
  Paperclip,
  Pin,
  PinOff,
  PhoneCall,
  Play,
  Plug,
  RefreshCw,
  Reply,
  Settings,
  Shield,
  Sparkles,
  Star,
  Tag,
  Trash2,
  X,
  User as UserIcon,
  Users,
  Building2
} from "lucide-react";
import { API_URLS } from "../config/urls";
import TaskBoard from "./tasks/TaskBoard";
import TaskManagerScreen from "./TaskManagerScreen";
import ContactsScreen from "./ContactsScreen";
import { createTaskManagerItem } from "../lib/api/taskManager";

const resolveFeatureFlag = (value) => {
  if (value === undefined || value === null) return false;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
};
const TASKS_ENABLED = true;
const TASKS_LIVE_ENABLED = (() => {
  const raw =
    import.meta.env.VITE_ENABLE_TASKS_LIVE ??
    import.meta.env.NEXT_PUBLIC_ENABLE_TASKS_LIVE;
  if (raw === undefined || raw === null || raw === "") return TASKS_ENABLED;
  return resolveFeatureFlag(raw);
})();

const formatDuration = (seconds) => {
  if (seconds === null || seconds === undefined || seconds === "") return "—";
  const totalSeconds = Number(seconds);
  if (Number.isNaN(totalSeconds)) return "—";
  const mins = Math.floor(totalSeconds / 60);
  const rawSecs = totalSeconds % 60;
  const trimmedSecs = rawSecs
    .toFixed(3)
    .replace(/\.?0+$/, "");
  const [secWhole, secFrac] = trimmedSecs.split(".");
  const paddedWhole = (secWhole || "0").padStart(2, "0");
  const displaySecs = secFrac ? `${paddedWhole}.${secFrac}` : paddedWhole;
  return `${mins}m ${displaySecs}s`;
};

const formatDate = (iso) => {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
};

const pad2 = (value) => String(value).padStart(2, "0");

const toDateTimeInput = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(
    date.getHours()
  )}:${pad2(date.getMinutes())}`;
};

const buildDefaultSchedule = () => {
  const start = new Date();
  start.setSeconds(0, 0);
  const roundedMinutes = Math.ceil(start.getMinutes() / 15) * 15;
  start.setMinutes(roundedMinutes % 60);
  if (roundedMinutes >= 60) {
    start.setHours(start.getHours() + 1);
  }
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return { start: toDateTimeInput(start), end: toDateTimeInput(end) };
};

const formatStatusLabel = (value) => {
  if (!value) return "Inactive";
  return String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const formatMessageTimestamp = (message) => {
  const internalDate = Number(message?.internalDate || 0);
  if (internalDate) {
    return new Date(internalDate).toLocaleString();
  }
  if (message?.date) return message.date;
  return "—";
};

const formatInboxTimestamp = (message) => {
  const internalDate = Number(message?.internalDate || 0);
  let dateValue = null;
  if (internalDate) {
    dateValue = new Date(internalDate);
  } else if (message?.date) {
    const parsed = new Date(message.date);
    if (!Number.isNaN(parsed.getTime())) {
      dateValue = parsed;
    }
  }
  if (!dateValue) return "—";
  return dateValue.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
};

const parseSender = (raw) => {
  if (!raw) return { name: "Unknown", email: "" };
  const match = raw.match(/^(.*)<(.+)>$/);
  if (match) {
    const name = match[1].replace(/["']/g, "").trim() || match[2].trim();
    return { name, email: match[2].trim() };
  }
  if (raw.includes("@")) {
    const [name] = raw.split("@");
    return { name: name.trim() || raw.trim(), email: raw.trim() };
  }
  return { name: raw.trim(), email: "" };
};

const decodeHtmlEntities = (value) => {
  if (!value || typeof value !== "string") return value || "";
  if (!value.includes("&")) return value;
  if (typeof document !== "undefined") {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = value;
    return textarea.value;
  }
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#x60;/g, "`")
    .replace(/&#x3D;/g, "=");
};

const formatBytes = (value) => {
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB"];
  let total = size / 1024;
  let unitIndex = 0;
  while (total >= 1024 && unitIndex < units.length - 1) {
    total /= 1024;
    unitIndex += 1;
  }
  return `${total.toFixed(total < 10 ? 1 : 0)} ${units[unitIndex]}`;
};

const base64ToBlob = (base64, mimeType) => {
  const binary = typeof atob === "function" ? atob(base64) : "";
  const length = binary.length;
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType || "application/octet-stream" });
};

const initialsFromName = (name) => {
  const safe = (name || "").trim();
  if (!safe) return "U";
  const parts = safe.split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase()).join("") || "U";
};

const formatHourLabel = (hour) => {
  const normalized = Number(hour) || 0;
  const period = normalized >= 12 ? "PM" : "AM";
  const base = normalized % 12 || 12;
  return `${base} ${period}`;
};

const formatSummaryBullets = (summary) => {
  const cleaned = String(summary || "").replace(/\r/g, "").trim();
  if (!cleaned) return [];
  let lines = cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length <= 1) {
    const sentenceParts = cleaned.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [cleaned];
    lines = sentenceParts.map((line) => line.trim()).filter(Boolean);
  }
  const bullets = lines
    .map((line) => line.replace(/^(\u2022|-|\*|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
  return bullets.length ? bullets : [cleaned];
};

const EMAIL_TAG_OPTIONS = [
  "Security",
  "Support",
  "Billing",
  "Jobs",
  "Newsletter",
  "Personal",
  "Other"
];

const REPLY_TONE_PRESETS = ["Professional", "Friendly", "Short", "Empathetic"];
const EMAIL_REFRESH_INTERVAL_MS = 30000;
const EMAIL_AUTO_CLASSIFY_BATCH_SIZE = 4;
const EMAIL_AUTO_CLASSIFY_STAGGER_MS = 350;

const BASE_DASHBOARD_TABS = [
  { id: "agents", label: "Agents", icon: Users },
  { id: "calls", label: "Calls", icon: PhoneCall },
  { id: "business", label: "Business", icon: Building2 },
  { id: "integrations", label: "Integrations", icon: Plug }
];
const DASHBOARD_TABS = TASKS_ENABLED
  ? [
      ...BASE_DASHBOARD_TABS.slice(0, 2),
      { id: "tasks", label: "Tasks", icon: ClipboardList },
      ...BASE_DASHBOARD_TABS.slice(2)
    ]
  : BASE_DASHBOARD_TABS;
const DASHBOARD_TAB_IDS = new Set(DASHBOARD_TABS.map((tab) => tab.id));

const priorityBadgeStyles = {
  Urgent: "border-rose-400/60 bg-rose-500/20 text-rose-100",
  Normal: "border-indigo-400/60 bg-indigo-500/15 text-indigo-200",
  Low: "border-sky-400/50 bg-sky-500/10 text-sky-100"
};

const sentimentStyles = {
  Concerned: "text-amber-200",
  Neutral: "text-slate-200",
  Positive: "text-emerald-200"
};

const socialPlatformStyles = {
  facebook: "bg-blue-500/20 text-blue-200 border-blue-400/40",
  instagram: "bg-rose-500/20 text-rose-200 border-rose-400/40",
  whatsapp_meta: "bg-emerald-500/20 text-emerald-200 border-emerald-400/40",
  x: "bg-slate-500/20 text-slate-200 border-slate-400/40"
};

const formatSocialTimestamp = (value) => {
  if (!value) return "—";
  try {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString(undefined, {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return value;
  }
};

const trimText = (value, max = 2000) => {
  if (!value) return "";
  const text = String(value).trim();
  if (text.length <= max) return text;
  const clipped = text.slice(0, max);
  const lastSpace = clipped.lastIndexOf(" ");
  const safe = lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped;
  return `${safe}...`;
};

const SendIcon = ({ className = "", ...props }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    {...props}
  >
    <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
    <path d="m21.854 2.147-10.94 10.939" />
  </svg>
);

const getMessageTimestampValue = (message) => {
  const internalDate = Number(message?.internalDate || 0);
  if (internalDate) return internalDate;
  if (message?.date) {
    const parsed = new Date(message.date);
    if (!Number.isNaN(parsed.getTime())) return parsed.getTime();
  }
  return 0;
};

const languageDisplayNames =
  typeof Intl !== "undefined" && typeof Intl.DisplayNames === "function"
    ? new Intl.DisplayNames(["en"], { type: "language" })
    : null;
const regionDisplayNames =
  typeof Intl !== "undefined" && typeof Intl.DisplayNames === "function"
    ? new Intl.DisplayNames(["en"], { type: "region" })
    : null;
const scriptDisplayNames =
  typeof Intl !== "undefined" && typeof Intl.DisplayNames === "function"
    ? new Intl.DisplayNames(["en"], { type: "script" })
    : null;

const formatLanguageLabel = (code) => {
  const normalized = String(code || "").replace(/_/g, "-").trim();
  if (!normalized) return "";
  if (!languageDisplayNames) return normalized;

  const parts = normalized.split("-");
  const languageCode = parts[0];
  const detailParts = parts.slice(1);
  const languageLabel = languageDisplayNames.of(languageCode) || normalized;
  if (!detailParts.length) return languageLabel;

  const details = detailParts
    .map((part) => {
      if (part.length === 4 && scriptDisplayNames) {
        return scriptDisplayNames.of(part) || part;
      }
      if (regionDisplayNames) {
        return regionDisplayNames.of(part.toUpperCase()) || part;
      }
      return part;
    })
    .filter(Boolean);

  return details.length ? `${languageLabel} (${details.join(", ")})` : languageLabel;
};

const SUMMARY_LIMIT = 5000;
const FIELD_LIMIT = 1000;

const parseWebsiteData = (value) => {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const extractBusinessProfile = (websiteData) => {
  if (!websiteData || typeof websiteData !== "object") return {};
  let profile = websiteData.business_profile || websiteData.businessProfile || websiteData.profile;
  if (!profile && websiteData.raw_website_data && typeof websiteData.raw_website_data === "object") {
    profile = websiteData.raw_website_data;
  }
  if (typeof profile === "string") {
    profile = parseWebsiteData(profile);
  }
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    profile = websiteData;
  }
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return {};
  return profile;
};

const StatCard = ({ label, value, hint, icon: Icon, tone = "default" }) => {
  const toneClass = `stat-card--${tone}`;
  return (
    <div className={`stat-card ${toneClass}`}>
      {Icon ? (
        <span className="stat-card-icon">
          <Icon className="h-5 w-5" />
        </span>
      ) : null}
      <div className="stat-card-body">
        <p className="stat-card-label">{label}</p>
        <div className="stat-card-value">{value}</div>
        {hint ? <p className="stat-card-hint">{hint}</p> : null}
      </div>
    </div>
  );
};

const InlineLoader = ({ label = "Loading..." }) => (
  <div className="flex items-center gap-2 text-xs text-slate-300">
    <span className="inline-flex h-4 w-4 animate-spin items-center justify-center rounded-full border border-white/20 border-t-transparent" />
    <span>{label}</span>
  </div>
);

const AiDots = ({ label = "Thinking..." }) => (
  <div className="flex items-center gap-2 text-xs text-slate-200" role="status" aria-live="polite">
    <span className="ai-dot" />
    <span className="ai-dot" style={{ animationDelay: "0.15s" }} />
    <span className="ai-dot" style={{ animationDelay: "0.3s" }} />
    <span className="ml-1">{label}</span>
  </div>
);

const AiSkeleton = ({ lines = ["w-5/6", "w-2/3", "w-4/5"] }) => (
  <div className="space-y-2">
    {lines.map((width, index) => (
      <div key={`${width}-${index}`} className={`ai-shimmer h-2 ${width} rounded`} />
    ))}
  </div>
);

const AiLoadingCard = ({ label, lines }) => (
  <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
    <AiDots label={label} />
    <div className="mt-2">
      <AiSkeleton lines={lines} />
    </div>
  </div>
);

const ToolGate = ({ locked, loading, message, children, className = "" }) => (
  <div className={`relative ${className}`.trim()}>
    <div className={locked ? "pointer-events-none blur-[2px] opacity-60 transition h-full min-h-0" : "transition h-full min-h-0"}>
      {children}
    </div>
    {locked && (
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="rounded-2xl border border-white/10 bg-slate-950/85 px-5 py-4 text-center shadow-2xl">
          <p className="text-sm font-semibold text-white">Subscription required</p>
          <p className="mt-1 text-xs text-slate-300">
            {message || "Purchase this tool to unlock the workspace."}
          </p>
        </div>
      </div>
    )}
    {loading && !locked && (
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-3xl dashboard-modal-backdrop dashboard-modal-backdrop--soft">
        <p className="text-xs font-semibold text-slate-200">Checking access...</p>
      </div>
    )}
  </div>
);

export default function DashboardScreen({
  activeTab,
  setActiveTab,
  activeTool,
  setActiveTool,
  toolSubscriptions,
  subscriptionsLoading,
  analyticsCalls = [],
  dateRange,
  dateRanges,
  onRangeChange,
  aiNumber,
  recentCalls,
  callsPage,
  setCallsPage,
  user,
  agentDetails,
  setAgentDetails,
  calendarStatus,
  calendarLoading,
  calendarEvents,
  calendarError,
  calendarAccountEmail,
  calendarDiagnostics,
  loadCalendarEvents,
  handleCalendarDisconnect,
  beginGoogleLogin,
  status,
  dashboardLoading,
  ultravoxVoices,
  ultravoxVoicesLoading,
  onAgentSave,
  agentSaveStatus,
  businessSaveStatus,
  onBusinessSave,
  clientData,
  manualBusinessInfo,
  userProfile,
  bookingSettings,
  bookingStatus,
  bookingTestStatus,
  setBookingSettings,
  onBookingSave,
  onTestBooking,
  callTranscript,
  onLoadTranscript,
  onRefreshCalls,
  onRefreshDashboard,
  assignNumberStatus,
  onAssignNumber,
  hasActiveSubscription,
  onResumeBusinessDetails,
  onLogout,
  handleGoHome
}) {
  const pageSize = 8;
  const totalPages = Math.max(1, Math.ceil((recentCalls?.length || 0) / pageSize));
  const safePage = Math.min(Math.max(callsPage || 1, 1), totalPages);
  const pagedCalls = recentCalls.slice((safePage - 1) * pageSize, safePage * pageSize);

  const [selectedCall, setSelectedCall] = useState(pagedCalls[0] || null);
  useEffect(() => {
    if (!TASKS_ENABLED && activeTab === "tasks") {
      setActiveTab?.("agents");
    }
  }, [activeTab, setActiveTab]);

  useEffect(() => {
    const resolvedTool = activeTool || "ai_receptionist";
    if (resolvedTool !== "ai_receptionist") return;
    if (!DASHBOARD_TAB_IDS.has(activeTab)) {
      setActiveTab?.(DASHBOARD_TABS[0]?.id || "agents");
    }
  }, [activeTab, activeTool, setActiveTab]);
  const [businessForm, setBusinessForm] = useState({
    name: clientData?.business_name || clientData?.name || "",
    phone: clientData?.business_phone || "",
    website: clientData?.website_url || ""
  });
  const [isBusinessEditing, setIsBusinessEditing] = useState(false);
  const [businessProfileForm, setBusinessProfileForm] = useState({
    businessName: clientData?.business_name || clientData?.name || "",
    contactNumber: clientData?.business_phone || "",
    contactEmail: manualBusinessInfo?.businessEmail || user?.email || "",
    websiteUrl: manualBusinessInfo?.websiteUrl || clientData?.website_url || "",
    businessSummary: "",
    hours: "",
    location: "",
    services: "",
    notes: "",
    openings: ""
  });
  const [isBusinessProfileEditing, setIsBusinessProfileEditing] = useState(false);
  const [promptStatus, setPromptStatus] = useState({ status: "idle", message: "", prompt: null });
  const [promptHistory, setPromptHistory] = useState([]);
  const [promptHistoryOpen, setPromptHistoryOpen] = useState(false);
  const [promptHistoryStatus, setPromptHistoryStatus] = useState({ status: "idle", message: "" });
  const [promptActionStatus, setPromptActionStatus] = useState({ status: "idle", message: "" });
  const [userForm, setUserForm] = useState({
    email: user?.email || "",
    businessName: userProfile?.business_name || "",
    businessNumber: userProfile?.business_number || ""
  });
  const [editingEvent, setEditingEvent] = useState(null);
  const [calendarEditForm, setCalendarEditForm] = useState({
    title: "",
    start: "",
    end: "",
    description: ""
  });
  const [calendarUpdateStatus, setCalendarUpdateStatus] = useState({
    status: "idle",
    message: ""
  });
  const [selectedCalendarProvider, setSelectedCalendarProvider] = useState("google");
  const [calendarEditMode, setCalendarEditMode] = useState("edit");
  const [analyticsTab, setAnalyticsTab] = useState("ai_receptionist");
  const [dashboardAnalyticsData, setDashboardAnalyticsData] = useState(null);
  const [dashboardAnalyticsStatus, setDashboardAnalyticsStatus] = useState({
    status: "idle",
    message: ""
  });
  const [emailSubTab, setEmailSubTab] = useState("email");
  const [settingsSection, setSettingsSection] = useState("automation");
  const [emailMailbox, setEmailMailbox] = useState("INBOX");
  const [emailUnreadOnly, setEmailUnreadOnly] = useState(false);
  const [emailAutoSummarize, setEmailAutoSummarize] = useState(true);
  const [emailAutoTagEnabled, setEmailAutoTagEnabled] = useState(true);
  const [emailUrgentThreshold, setEmailUrgentThreshold] = useState(0.75);
  const [emailSettingsStatus, setEmailSettingsStatus] = useState({ status: "idle", message: "" });
  const [emailPanelOpen, setEmailPanelOpen] = useState(false);
  const [emailPanelContentVisible, setEmailPanelContentVisible] = useState(false);
  const [emailMessages, setEmailMessages] = useState([]);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [emailAccountEmail, setEmailAccountEmail] = useState("");
  const [emailPageTokens, setEmailPageTokens] = useState([null]);
  const [emailCurrentPage, setEmailCurrentPage] = useState(1);
  const [emailQuery, setEmailQuery] = useState("");
  const [emailSelectedIds, setEmailSelectedIds] = useState(new Set());
  const [emailLabels, setEmailLabels] = useState([]);
  const [emailLabelAction, setEmailLabelAction] = useState("");
  const [emailMoveAction, setEmailMoveAction] = useState("");
  const [emailActionStatus, setEmailActionStatus] = useState({ status: "idle", message: "" });
  const [emailMessageBodies, setEmailMessageBodies] = useState({});
  const [emailMessageHtml, setEmailMessageHtml] = useState({});
  const [emailMessageAttachments, setEmailMessageAttachments] = useState({});
  const [emailMessageLoading, setEmailMessageLoading] = useState(false);
  const [emailMessageError, setEmailMessageError] = useState("");
  const [emailAttachmentStatus, setEmailAttachmentStatus] = useState({ status: "idle", message: "" });
  const [emailSummaryVisible, setEmailSummaryVisible] = useState(true);
  const [emailInlineReplyOpen, setEmailInlineReplyOpen] = useState(false);
  const [emailInlineReplyMessageId, setEmailInlineReplyMessageId] = useState(null);
  const [emailInlineAttachments, setEmailInlineAttachments] = useState([]);
  const [emailComposerAttachments, setEmailComposerAttachments] = useState([]);
  const [taskManagerEmailTarget, setTaskManagerEmailTarget] = useState(null);
  const [taskManagerEmailForm, setTaskManagerEmailForm] = useState({
    title: "",
    description: "",
    start: "",
    end: ""
  });
  const [taskManagerEmailStatus, setTaskManagerEmailStatus] = useState({
    status: "idle",
    message: ""
  });
  const [emailComposerOpen, setEmailComposerOpen] = useState(false);
  const [emailComposerMode, setEmailComposerMode] = useState("new");
  const [emailTheme, setEmailTheme] = useState(() => {
    if (typeof window === "undefined") return "dark";
    const storedTheme = window.localStorage.getItem("email-theme");
    return storedTheme === "light" || storedTheme === "dark" ? storedTheme : "dark";
  });
  const [emailComposerForm, setEmailComposerForm] = useState({
    to: "",
    cc: "",
    bcc: "",
    subject: "",
    body: "",
    threadId: "",
    inReplyTo: "",
    references: ""
  });
  const [emailComposerStatus, setEmailComposerStatus] = useState({ status: "idle", message: "" });
  const [emailComposerAiStatus, setEmailComposerAiStatus] = useState({ status: "idle", message: "" });
  const [contactSuggestions, setContactSuggestions] = useState([]);
  const [contactSuggestOpen, setContactSuggestOpen] = useState(false);
  const [contactSuggestField, setContactSuggestField] = useState("");
  const [contactSuggestQuery, setContactSuggestQuery] = useState("");
  const [contactSuggestLoading, setContactSuggestLoading] = useState(false);
  const [contactSuggestError, setContactSuggestError] = useState("");
  const contactSuggestTimer = useRef(null);
  const [selectedEmailMessage, setSelectedEmailMessage] = useState(null);
  const [emailSummaries, setEmailSummaries] = useState({});
  const [emailSummaryStatus, setEmailSummaryStatus] = useState({
    status: "idle",
    message: ""
  });
  const [emailTagFilter, setEmailTagFilter] = useState("all");
  const [emailSort, setEmailSort] = useState("date");
  const [emailClassifications, setEmailClassifications] = useState({});
  const [emailClassifyStatus, setEmailClassifyStatus] = useState({});
  const [emailActionsById, setEmailActionsById] = useState({});
  const [emailActionsStatus, setEmailActionsStatus] = useState({});
  const [emailActionChecks, setEmailActionChecks] = useState({});
  const [emailReplyVariantsById, setEmailReplyVariantsById] = useState({});
  const [emailReplyVariantsStatus, setEmailReplyVariantsStatus] = useState({});
  const [emailReplyTone, setEmailReplyTone] = useState("Professional");
  const [emailFeedbackOpen, setEmailFeedbackOpen] = useState(false);
  const [emailFeedbackForm, setEmailFeedbackForm] = useState({
    tags: [],
    priorityLabel: "Normal",
    sentiment: "Neutral",
    notes: ""
  });
  const [emailFeedbackStatus, setEmailFeedbackStatus] = useState({ status: "idle", message: "" });
  const [socialTab, setSocialTab] = useState("connect");
  const [socialConnections, setSocialConnections] = useState([]);
  const [socialConnectionsLoading, setSocialConnectionsLoading] = useState(false);
  const [socialConnectionsError, setSocialConnectionsError] = useState("");
  const [socialConnectStatus, setSocialConnectStatus] = useState({ status: "idle", message: "" });
  const [whatsappForm, setWhatsappForm] = useState({
    phoneNumberId: "",
    wabaId: "",
    token: ""
  });
  const [whatsappStatus, setWhatsappStatus] = useState({ status: "idle", message: "" });
  const [showWhatsappManual, setShowWhatsappManual] = useState(false);
  const [whatsappSendForm, setWhatsappSendForm] = useState({
    connectionId: "",
    to: "",
    text: ""
  });
  const [whatsappSendStatus, setWhatsappSendStatus] = useState({ status: "idle", message: "" });
  const [socialConversations, setSocialConversations] = useState([]);
  const [socialInboxLoading, setSocialInboxLoading] = useState(false);
  const [socialInboxError, setSocialInboxError] = useState("");
  const [socialSearch, setSocialSearch] = useState("");
  const [socialSelectedConversation, setSocialSelectedConversation] = useState(null);
  const [socialMessages, setSocialMessages] = useState([]);
  const [socialMessagesLoading, setSocialMessagesLoading] = useState(false);
  const [socialMessagesError, setSocialMessagesError] = useState("");
  const [socialReplyText, setSocialReplyText] = useState("");
  const [socialReplyStatus, setSocialReplyStatus] = useState({ status: "idle", message: "" });
  const [socialSuggestStatus, setSocialSuggestStatus] = useState({ status: "idle", message: "" });
  const [socialDrafts, setSocialDrafts] = useState([]);
  const [socialDraftsLoading, setSocialDraftsLoading] = useState(false);
  const [socialDraftsError, setSocialDraftsError] = useState("");
  const [socialDraftId, setSocialDraftId] = useState(null);
  const [socialDraftForm, setSocialDraftForm] = useState({
    caption: "",
    mediaUrls: [""]
  });
  const [socialUploadStatus, setSocialUploadStatus] = useState({ status: "idle", message: "" });
  const [socialTargets, setSocialTargets] = useState({
    facebook_page_id: "",
    instagram_user_id: ""
  });
  const [socialPublishStatus, setSocialPublishStatus] = useState({ status: "idle", message: "" });
  const [socialScheduleStatus, setSocialScheduleStatus] = useState({ status: "idle", message: "" });
  const [socialScheduleAt, setSocialScheduleAt] = useState("");
  const [socialScheduledPosts, setSocialScheduledPosts] = useState([]);
  const [socialScheduledLoading, setSocialScheduledLoading] = useState(false);
  const [socialScheduledError, setSocialScheduledError] = useState("");
  const [selectedCallDay, setSelectedCallDay] = useState("All days");
  const [sideNavOpen, setSideNavOpen] = useState(false);
  const [sideNavPinned, setSideNavPinned] = useState(false);
  const [sideNavContentVisible, setSideNavContentVisible] = useState(false);
  const [sideNavHidden, setSideNavHidden] = useState(false);
  const [voiceSamplePlaying, setVoiceSamplePlaying] = useState(false);
  const [showHolidayCalendars, setShowHolidayCalendars] = useState(true);
  const [showBirthdayEvents, setShowBirthdayEvents] = useState(true);
  const calendarRef = useRef(null);
  const calendarRangeCacheRef = useRef(new Set());
  const calendarFetchTimerRef = useRef(null);
  const emailLoadedRef = useRef(false);
  const emailLabelsLoadedRef = useRef(false);
  const emailClassifyTimerRef = useRef(null);
  const emailActionsTimerRef = useRef(null);
  const emailAutoTagTimerRef = useRef(null);
  const emailRefreshTimerRef = useRef(null);
  const emailAutoClassifySeenRef = useRef(new Set());
  const socialConnectionsLoadedRef = useRef(false);
  const socialDraftsLoadedRef = useRef(false);
  const socialScheduledLoadedRef = useRef(false);
  const socialUploadInputRef = useRef(null);
  const sideNavCloseTimerRef = useRef(null);
  const sideNavContentTimerRef = useRef(null);
  const emailPanelCloseTimerRef = useRef(null);
  const emailPanelContentTimerRef = useRef(null);
  const voiceSampleRef = useRef(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("email-theme", emailTheme);
  }, [emailTheme]);

  useEffect(() => {
    const timer = setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 200);
    return () => clearTimeout(timer);
  }, [sideNavOpen, sideNavHidden]);

  useEffect(() => {
    return () => {
      if (sideNavCloseTimerRef.current) {
        clearTimeout(sideNavCloseTimerRef.current);
      }
      if (sideNavContentTimerRef.current) {
        clearTimeout(sideNavContentTimerRef.current);
      }
      if (emailPanelCloseTimerRef.current) {
        clearTimeout(emailPanelCloseTimerRef.current);
      }
      if (emailPanelContentTimerRef.current) {
        clearTimeout(emailPanelContentTimerRef.current);
      }
    };
  }, []);

  const openSideNav = () => {
    if (sideNavCloseTimerRef.current) {
      clearTimeout(sideNavCloseTimerRef.current);
    }
    if (sideNavContentTimerRef.current) {
      clearTimeout(sideNavContentTimerRef.current);
    }
    setSideNavOpen(true);
    setSideNavContentVisible(true);
  };

  const closeSideNav = () => {
    if (sideNavCloseTimerRef.current) {
      clearTimeout(sideNavCloseTimerRef.current);
    }
    if (sideNavContentTimerRef.current) {
      clearTimeout(sideNavContentTimerRef.current);
    }
    sideNavCloseTimerRef.current = setTimeout(() => {
      setSideNavOpen(false);
      setSideNavContentVisible(false);
    }, 120);
  };

  const openEmailPanel = () => {
    if (emailPanelCloseTimerRef.current) {
      clearTimeout(emailPanelCloseTimerRef.current);
    }
    if (emailPanelContentTimerRef.current) {
      clearTimeout(emailPanelContentTimerRef.current);
    }
    setEmailPanelOpen(true);
    setEmailPanelContentVisible(true);
  };

  const closeEmailPanel = () => {
    if (emailPanelCloseTimerRef.current) {
      clearTimeout(emailPanelCloseTimerRef.current);
    }
    if (emailPanelContentTimerRef.current) {
      clearTimeout(emailPanelContentTimerRef.current);
    }
    emailPanelCloseTimerRef.current = setTimeout(() => {
      setEmailPanelOpen(false);
      emailPanelContentTimerRef.current = setTimeout(() => {
        setEmailPanelContentVisible(false);
      }, 200);
    }, 120);
  };


  const filteredCalendarEvents = useMemo(() => {
    return (calendarEvents || []).filter((event) => {
      const calendarId = event.calendarId || "";
      const eventType = event.eventType || "";
      const isHolidayCalendar = calendarId.includes("holiday@group.v.calendar.google.com");
      const isBirthday = eventType === "birthday";
      if (!showHolidayCalendars && isHolidayCalendar) return false;
      if (!showBirthdayEvents && isBirthday) return false;
      return true;
    });
  }, [calendarEvents, showBirthdayEvents, showHolidayCalendars]);

  const calendarItems = useMemo(
    () =>
      filteredCalendarEvents.map((event) => {
        const start = event.start?.dateTime || event.start?.date || null;
        const end = event.end?.dateTime || event.end?.date || null;
        const allDay = Boolean(event.start?.date && !event.start?.dateTime);
        return {
          id: event.id,
          title: event.summary || "No title",
          start,
          end,
          allDay,
          display: "block",
          backgroundColor: allDay ? "rgba(124, 58, 237, 0.75)" : "rgba(124, 58, 237, 0.92)",
          borderColor: allDay ? "rgba(109, 40, 217, 0.9)" : "rgba(109, 40, 217, 1)",
          textColor: "#f8fafc",
          className: "calendar-event",
          extendedProps: { raw: event, provider: "google" }
        };
      }),
    [filteredCalendarEvents]
  );

  const visibleCalendarItems = useMemo(() => {
    if (selectedCalendarProvider === "google") return calendarItems;
    return [];
  }, [calendarItems, selectedCalendarProvider]);

  const calendarFocusDate = useMemo(() => {
    if (!visibleCalendarItems.length) return null;
    const now = new Date();
    const parsed = visibleCalendarItems
      .map((item) => (item?.start ? new Date(item.start) : null))
      .filter((d) => d && !Number.isNaN(d.getTime()));
    if (!parsed.length) return null;
    const upcoming = parsed.filter((d) => d >= now).sort((a, b) => a - b);
    const target = upcoming[0] || parsed.sort((a, b) => b - a)[0];
    return target.toISOString();
  }, [visibleCalendarItems]);

  const jumpToNextEvent = () => {
    if (!calendarRef.current || !visibleCalendarItems.length) return;
    const now = new Date();
    const upcoming = visibleCalendarItems
      .map((item) => (item?.start ? new Date(item.start) : null))
      .filter((d) => d && !Number.isNaN(d.getTime()))
      .filter((d) => d >= now)
      .sort((a, b) => a - b);
    const target = upcoming[0];
    if (!target) return;
    const api = calendarRef.current.getApi?.();
    api?.gotoDate(target);
  };

  const handleCalendarRangeFetch = (range) => {
    if (!range?.startStr || !range?.endStr) return;
    const key = `${range.startStr}|${range.endStr}`;
    if (calendarRangeCacheRef.current.has(key)) return;
    calendarRangeCacheRef.current.add(key);
    if (calendarFetchTimerRef.current) {
      clearTimeout(calendarFetchTimerRef.current);
    }
    calendarFetchTimerRef.current = setTimeout(() => {
      loadCalendarEvents?.(user?.email, { start: range.startStr, end: range.endStr });
    }, 350);
  };

  const toLocalInputValue = (value) => {
    if (!value) return "";
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return "";
    const offset = dt.getTimezoneOffset() * 60000;
    const local = new Date(dt.getTime() - offset);
    return local.toISOString().slice(0, 16);
  };

  const toIsoValue = (value) => {
    if (!value) return null;
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return null;
    return dt.toISOString();
  };

  const openCalendarEdit = (event) => {
    if (!event) return;
    const startValue = event.start?.dateTime || event.start?.date || "";
    const endValue = event.end?.dateTime || event.end?.date || "";
    setEditingEvent(event);
    setCalendarEditMode("edit");
    setCalendarEditForm({
      title: event.summary || "",
      start: toLocalInputValue(startValue),
      end: toLocalInputValue(endValue),
      description: event.description || ""
    });
    setCalendarUpdateStatus({ status: "idle", message: "" });
  };

  const openCalendarCreate = (start, end) => {
    setEditingEvent(null);
    setCalendarEditMode("create");
    setCalendarEditForm({
      title: "",
      start: toLocalInputValue(start),
      end: toLocalInputValue(end),
      description: ""
    });
    setCalendarUpdateStatus({ status: "idle", message: "" });
  };

  const ensureEndTime = (startIso, endIso) => {
    if (endIso) return endIso;
    if (!startIso) return null;
    const startDate = new Date(startIso);
    if (Number.isNaN(startDate.getTime())) return null;
    return new Date(startDate.getTime() + 30 * 60 * 1000).toISOString();
  };

  const handleCalendarSave = async () => {
    if (!user?.email) return;
    setCalendarUpdateStatus({ status: "loading", message: "Saving changes..." });
    try {
      const startIso = toIsoValue(calendarEditForm.start);
      const endIso = ensureEndTime(startIso, toIsoValue(calendarEditForm.end));
      if (!startIso) {
        throw new Error("Start time is required.");
      }
      const payload = {
        email: user.email,
        summary: calendarEditForm.title || "New event",
        start: startIso,
        end: endIso,
        description: calendarEditForm.description || ""
      };
      const endpoint =
        calendarEditMode === "create" ? API_URLS.calendarCreate : API_URLS.calendarUpdate;
      if (calendarEditMode === "edit") {
        payload.eventId = editingEvent?.id;
      }
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || data?.details || "Failed to save event");
      }
      setCalendarUpdateStatus({
        status: "success",
        message: calendarEditMode === "create" ? "Event created." : "Event updated."
      });
      await loadCalendarEvents?.(user.email);
      setEditingEvent(null);
      setCalendarEditMode("edit");
    } catch (err) {
      setCalendarUpdateStatus({
        status: "error",
        message: err?.message || "Failed to save event"
      });
    }
  };

  const loadEmailMessages = async ({
    page = 1,
    query = null,
    resetTokens = false,
    unreadOnly = null,
    mailbox = null,
    append = false
  } = {}) => {
    const emailAddress = user?.email || userForm.email;
    if (!emailAddress) {
      setEmailError("Missing user email.");
      return;
    }
    setEmailLoading(true);
    setEmailError("");
    try {
      const targetMailbox = mailbox ?? emailMailbox;
      const targetUnreadOnly = typeof unreadOnly === "boolean" ? unreadOnly : emailUnreadOnly;
      const safePage = Math.max(1, page || 1);
      const tokens = resetTokens ? [null] : emailPageTokens;
      const tokenForPage = tokens[safePage - 1] || null;
      if (safePage > 1 && !tokenForPage) {
        setEmailLoading(false);
        return;
      }
      const params = new URLSearchParams({
        email: emailAddress,
        max_results: "10",
        ts: String(Date.now())
      });
      const queryValue = (query ?? emailQuery).trim();
      const unreadQuery = targetUnreadOnly
        ? queryValue
          ? `is:unread ${queryValue}`
          : "is:unread"
        : queryValue;
      if (unreadQuery) params.set("q", unreadQuery);
      if (targetMailbox && targetMailbox !== "ALL") {
        params.set("label_ids", targetMailbox);
      }
      if (tokenForPage) params.set("page_token", tokenForPage);
      const res = await fetch(`${API_URLS.inbox}?${params.toString()}`);
      if (!res.ok) {
        const text = await res.text();
        let parsed = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = null;
        }
        const detail = parsed?.details || parsed?.error || text || "Unable to fetch messages";
        const detailText = String(detail || "");
        const isDisconnected =
          res.status === 404 || detailText.includes("No Google account connected");
        const isAuthExpired =
          res.status === 401 ||
          detailText.includes("Invalid Credentials") ||
          detailText.includes("UNAUTHENTICATED");
        const needsConsent =
          detailText.includes("insufficientAuthenticationScopes") ||
          detailText.includes("insufficientPermissions");
        if (isDisconnected || isAuthExpired) {
          setEmailMessages([]);
          setEmailAccountEmail("");
          setEmailPageTokens([null]);
          setEmailCurrentPage(1);
          setEmailError(
            isAuthExpired
              ? "Gmail connection expired. Please reconnect."
              : "Connect Gmail to load inbox messages."
          );
          return;
        }
        if (needsConsent) {
          setEmailError("Gmail permissions missing. Click Force re-connect to grant access.");
          return;
        }
        throw new Error(detail);
      }
      const data = await res.json();
      const incoming = Array.isArray(data?.messages) ? data.messages : [];
      const normalizedIncoming = incoming.map((message) => ({
        ...message,
        subject: decodeHtmlEntities(message?.subject),
        snippet: decodeHtmlEntities(message?.snippet),
        from: decodeHtmlEntities(message?.from),
        to: decodeHtmlEntities(message?.to),
        cc: decodeHtmlEntities(message?.cc),
        bcc: decodeHtmlEntities(message?.bcc)
      }));
      const incomingClassifications = data?.classifications || {};
      setEmailMessages((prev) => (append ? [...prev, ...normalizedIncoming] : normalizedIncoming));
      setEmailClassifications((prev) => (append ? { ...prev, ...incomingClassifications } : incomingClassifications));
      if (data?.settings) {
        setEmailAutoTagEnabled(Boolean(data.settings.auto_tag_enabled));
        setEmailUrgentThreshold(Number(data.settings.urgent_conf_threshold) || 0.75);
      }
      setEmailAccountEmail(data?.account_email || data?.accountEmail || "");
      const nextToken = data?.nextPageToken || null;
      setEmailPageTokens((prev) => {
        const base = resetTokens ? [null] : [...prev];
        base[safePage - 1] = tokenForPage || null;
        base[safePage] = nextToken;
        return base;
      });
      setEmailCurrentPage(safePage);
      if (mailbox !== null) setEmailMailbox(targetMailbox);
      if (typeof unreadOnly === "boolean") setEmailUnreadOnly(targetUnreadOnly);
    } catch (err) {
      setEmailError(err?.message || "Unable to load inbox messages");
    } finally {
      setEmailLoading(false);
    }
  };

  const loadEmailLabels = async () => {
    const emailAddress = user?.email || userForm.email;
    if (!emailAddress) return;
    try {
      const params = new URLSearchParams({ email: emailAddress, ts: String(Date.now()) });
      const res = await fetch(`${API_URLS.emailLabels}?${params.toString()}`);
      if (!res.ok) {
        const text = await res.text();
        let parsed = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = null;
        }
        const detail = parsed?.details || parsed?.error || text || "Unable to load labels";
        const detailText = String(detail || "");
        const isDisconnected =
          res.status === 404 || detailText.includes("No Google account connected");
        const needsConsent =
          detailText.includes("insufficientAuthenticationScopes") ||
          detailText.includes("insufficientPermissions");
        if (isDisconnected) {
          emailLabelsLoadedRef.current = false;
          return;
        }
        if (needsConsent) {
          setEmailActionStatus({
            status: "error",
            message: "Gmail permissions missing. Click Force re-connect to grant access."
          });
          return;
        }
        throw new Error(detail);
      }
      const data = await res.json().catch(() => ({}));
      setEmailLabels(Array.isArray(data?.labels) ? data.labels : []);
      setEmailAccountEmail(data?.account_email || data?.accountEmail || "");
    } catch (err) {
      setEmailActionStatus({ status: "error", message: err?.message || "Unable to load labels." });
    }
  };

  const normalizeActionError = (detailText) => {
    const needsConsent =
      detailText.includes("insufficientAuthenticationScopes") ||
      detailText.includes("insufficientPermissions");
    if (needsConsent) {
      return "Gmail permissions missing. Click Force re-connect to grant access.";
    }
    return detailText || "Unable to complete action.";
  };

  const applyLabelUpdates = (ids, addLabelIds = [], removeLabelIds = []) => {
    const selectedSet = new Set(ids);
    const addSet = new Set(addLabelIds);
    const removeSet = new Set(removeLabelIds);
    setEmailMessages((prev) => {
      const updated = prev.map((message) => {
        if (!selectedSet.has(message.id)) return message;
        const nextLabels = new Set(message.labelIds || []);
        removeSet.forEach((label) => nextLabels.delete(label));
        addSet.forEach((label) => nextLabels.add(label));
        return { ...message, labelIds: Array.from(nextLabels) };
      });
      let filtered = updated;
      if (emailMailbox !== "ALL_MAIL") {
        filtered = filtered.filter((message) => (message.labelIds || []).includes(emailMailbox));
      }
      if (emailUnreadOnly) {
        filtered = filtered.filter((message) => (message.labelIds || []).includes("UNREAD"));
      }
      return filtered;
    });
  };

  const runEmailModify = async ({
    messageIds,
    addLabelIds = [],
    removeLabelIds = [],
    successMessage = "Messages updated.",
    clearSelection = true,
    silent = false
  }) => {
    const emailAddress = user?.email || userForm.email;
    const ids = messageIds?.length ? messageIds : Array.from(emailSelectedIds);
    if (!emailAddress || !ids.length) return;
    if (!silent) {
      setEmailActionStatus({ status: "loading", message: "Applying changes..." });
    }
    try {
      const res = await fetch(API_URLS.emailModify, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailAddress,
          message_ids: ids,
          add_label_ids: addLabelIds,
          remove_label_ids: removeLabelIds
        })
      });
      if (!res.ok) {
        const text = await res.text();
        let parsed = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = null;
        }
        const detail = parsed?.details || parsed?.error || text || "Unable to update messages";
        throw new Error(normalizeActionError(String(detail || "")));
      }
      applyLabelUpdates(ids, addLabelIds, removeLabelIds);
      if (clearSelection) setEmailSelectedIds(new Set());
      if (!silent) {
        setEmailActionStatus({ status: "success", message: successMessage });
      }
    } catch (err) {
      if (!silent) {
        setEmailActionStatus({ status: "error", message: err?.message || "Unable to update messages." });
      }
    }
  };

  const markMessageAsRead = async (message) => {
    if (!message?.id) return;
    const isUnread = (message.labelIds || []).includes("UNREAD");
    if (!isUnread) return;
    applyLabelUpdates([message.id], [], ["UNREAD"]);
    await runEmailModify({
      messageIds: [message.id],
      removeLabelIds: ["UNREAD"],
      successMessage: "Marked as read.",
      clearSelection: false,
      silent: true
    });
  };

  const runEmailBulkAction = async ({
    endpoint,
    successMessage,
    removeFromList = true
  }) => {
    const emailAddress = user?.email || userForm.email;
    const ids = Array.from(emailSelectedIds);
    if (!emailAddress || !ids.length) return;
    setEmailActionStatus({ status: "loading", message: "Working..." });
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailAddress, message_ids: ids })
      });
      if (!res.ok) {
        const text = await res.text();
        let parsed = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = null;
        }
        const detail = parsed?.details || parsed?.error || text || "Unable to complete action";
        throw new Error(normalizeActionError(String(detail || "")));
      }
      if (removeFromList) {
        setEmailMessages((prev) => prev.filter((message) => !ids.includes(message.id)));
      }
      setEmailSelectedIds(new Set());
      setEmailActionStatus({ status: "success", message: successMessage });
    } catch (err) {
      setEmailActionStatus({ status: "error", message: err?.message || "Unable to complete action." });
    }
  };

  const toggleEmailSelection = (messageId) => {
    setEmailSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  };

  const toggleEmailSelectAll = () => {
    setEmailSelectedIds((prev) => {
      if (!emailMessages.length) return new Set();
      if (prev.size === emailMessages.length) return new Set();
      return new Set(emailMessages.map((message) => message.id));
    });
  };

  const handleVoiceSampleToggle = () => {
    const audio = voiceSampleRef.current;
    if (!audio || !selectedVoice?.sampleUrl) return;
    if (voiceSamplePlaying) {
      audio.pause();
      setVoiceSamplePlaying(false);
      return;
    }
    const playPromise = audio.play();
    setVoiceSamplePlaying(true);
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {
        setVoiceSamplePlaying(false);
      });
    }
  };

  const extractContactQuery = (value = "") => {
    const parts = String(value).split(",");
    return parts[parts.length - 1].trim();
  };

  const fetchContactSuggestions = async (query) => {
    const emailAddress = user?.email || userForm.email;
    if (!emailAddress) return;
    setContactSuggestLoading(true);
    setContactSuggestError("");
    try {
      const params = new URLSearchParams({ email: emailAddress, limit: "8" });
      if (query) params.set("q", query);
      const res = await fetch(`${API_URLS.contactsSuggest}?${params.toString()}`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Unable to load contacts.");
      }
      const data = await res.json();
      const items = Array.isArray(data?.contacts) ? data.contacts : [];
      setContactSuggestions(items.filter((item) => item.email));
    } catch (err) {
      setContactSuggestError(err?.message || "Unable to load contacts.");
    } finally {
      setContactSuggestLoading(false);
    }
  };

  const scheduleContactSuggestions = (query) => {
    if (contactSuggestTimer.current) clearTimeout(contactSuggestTimer.current);
    contactSuggestTimer.current = setTimeout(() => {
      fetchContactSuggestions(query);
    }, 200);
  };

  const handleContactFieldFocus = (field, value) => {
    setContactSuggestField(field);
    setContactSuggestOpen(true);
    const query = extractContactQuery(value);
    setContactSuggestQuery(query);
    scheduleContactSuggestions(query);
  };

  const handleContactFieldChange = (field, value) => {
    setEmailComposerForm((prev) => ({ ...prev, [field]: value }));
    setContactSuggestField(field);
    setContactSuggestOpen(true);
    const query = extractContactQuery(value);
    setContactSuggestQuery(query);
    scheduleContactSuggestions(query);
  };

  const handleContactSelect = (field, contact) => {
    const value = emailComposerForm[field] || "";
    const parts = value.split(",").map((part) => part.trim());
    const display = contact.name ? `${contact.name} <${contact.email}>` : contact.email;
    if (!parts.length) {
      setEmailComposerForm((prev) => ({ ...prev, [field]: display }));
      setContactSuggestOpen(false);
      return;
    }
    parts[parts.length - 1] = display;
    const nextValue = parts.filter(Boolean).join(", ") + ", ";
    setEmailComposerForm((prev) => ({ ...prev, [field]: nextValue }));
    setContactSuggestOpen(false);
  };

  const openComposer = async (mode = "new", message = null) => {
    setEmailComposerMode(mode);
    setEmailComposerStatus({ status: "idle", message: "" });
    setEmailComposerAiStatus({ status: "idle", message: "" });
    setContactSuggestOpen(false);
    setEmailComposerAttachments([]);
    if (!message || mode === "new") {
      setEmailComposerForm({
        to: "",
        cc: "",
        bcc: "",
        subject: "",
        body: "",
        threadId: "",
        inReplyTo: "",
        references: ""
      });
      setEmailComposerOpen(true);
      return;
    }

    const subject =
      mode === "reply"
        ? message.subject?.startsWith("Re:")
          ? message.subject
          : `Re: ${message.subject || ""}`.trim()
        : message.subject?.startsWith("Fwd:")
          ? message.subject
          : `Fwd: ${message.subject || ""}`.trim();

    if (mode === "forward") {
      setEmailComposerForm({
        to: "",
        cc: "",
        bcc: "",
        subject,
        body: "",
        threadId: "",
        inReplyTo: "",
        references: ""
      });
      setEmailComposerOpen(true);
      const fallbackBody = `\n\n---\n${message.snippet || ""}`.trim();
      if (!message.threadId) {
        setEmailComposerForm((prev) => ({ ...prev, body: fallbackBody }));
        return;
      }
      setEmailComposerStatus({ status: "loading", message: "Loading thread..." });
      try {
        const data = await fetchEmailThread(message.threadId);
        const forwardBody = formatForwardThreadBody(data?.messages || []);
        setEmailComposerForm((prev) => ({
          ...prev,
          body: forwardBody || fallbackBody
        }));
        setEmailComposerStatus({ status: "idle", message: "" });
      } catch (err) {
        setEmailComposerForm((prev) => ({ ...prev, body: fallbackBody }));
        setEmailComposerStatus({
          status: "error",
          message: err?.message || "Unable to load email thread."
        });
      }
      return;
    }

    const replyBody = `\n\n---\n${message.snippet || ""}`.trim();
    setEmailComposerForm(buildReplyForm(message, replyBody, "reply"));
    setEmailComposerOpen(true);
  };

  const closeComposer = () => {
    setEmailComposerOpen(false);
    setContactSuggestOpen(false);
    setEmailComposerAttachments([]);
    setEmailComposerStatus({ status: "idle", message: "" });
    setEmailComposerAiStatus({ status: "idle", message: "" });
  };

  const handleSendEmail = async (attachments = []) => {
    const safeAttachments = Array.isArray(attachments) ? attachments : [];
    const emailAddress = user?.email || userForm.email;
    if (!emailAddress) {
      setEmailComposerStatus({ status: "error", message: "Missing user email." });
      return false;
    }
    if (!emailComposerForm.to || !emailComposerForm.body) {
      setEmailComposerStatus({ status: "error", message: "To and message body are required." });
      return false;
    }
    setEmailComposerStatus({ status: "loading", message: "Sending..." });
    try {
      const attachmentPayload = safeAttachments
        .filter((item) => item?.data)
        .map((item) => ({
          filename: item.name,
          mime_type: item.type,
          data: item.data
        }));
      const res = await fetch(API_URLS.emailSend, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailAddress,
          to: emailComposerForm.to,
          cc: emailComposerForm.cc,
          bcc: emailComposerForm.bcc,
          subject: emailComposerForm.subject,
          body: emailComposerForm.body,
          thread_id: emailComposerForm.threadId,
          in_reply_to: emailComposerForm.inReplyTo,
          references: emailComposerForm.references,
          attachments: attachmentPayload
        })
      });
      if (!res.ok) {
        const text = await res.text();
        let parsed = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = null;
        }
        const detail = parsed?.details || parsed?.error || text || "Unable to send email";
        throw new Error(normalizeActionError(String(detail || "")));
      }
      setEmailComposerStatus({ status: "success", message: "Email sent." });
      setEmailComposerOpen(false);
      setEmailComposerAttachments([]);
      if (emailMailbox === "SENT" || emailMailbox === "ALL_MAIL") {
        handleEmailRefresh();
      }
      return true;
    } catch (err) {
      setEmailComposerStatus({ status: "error", message: err?.message || "Unable to send email." });
      return false;
    }
  };

  const handleGenerateEmailDraft = async () => {
    const emailAddress = user?.email || userForm.email;
    if (!emailAddress) {
      setEmailComposerAiStatus({ status: "error", message: "Missing user email." });
      return;
    }
    const currentDraft = (emailComposerForm.body || "").trim();
    if (!currentDraft) {
      setEmailComposerAiStatus({
        status: "error",
        message: "Add a draft message to generate."
      });
      return;
    }
    setEmailComposerAiStatus({ status: "loading", message: "Generating..." });
    try {
      const res = await fetch(API_URLS.emailComposeDraft, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailAddress,
          draft: currentDraft,
          subject: emailComposerForm.subject,
          to: emailComposerForm.to
        })
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Unable to generate email draft"));
      }
      const data = await res.json().catch(() => ({}));
      const draftText = String(data?.draft || data?.body || "").trim();
      if (!draftText) {
        throw new Error("OpenAI returned an empty draft.");
      }
      setEmailComposerForm((prev) => ({ ...prev, body: draftText }));
      setEmailComposerAiStatus({ status: "success", message: "AI draft ready." });
    } catch (err) {
      setEmailComposerAiStatus({
        status: "error",
        message: err?.message || "Unable to generate email draft."
      });
    }
  };

  const fetchEmailAttachment = async (messageId, attachmentId) => {
    const emailAddress = user?.email || userForm.email;
    if (!emailAddress) return null;
    const params = new URLSearchParams({
      email: emailAddress,
      message_id: messageId,
      attachment_id: attachmentId,
      ts: String(Date.now())
    });
    const res = await fetch(`${API_URLS.emailAttachment}?${params.toString()}`);
    if (!res.ok) {
      return null;
    }
    const data = await res.json().catch(() => ({}));
    return data?.data || null;
  };

  const handleDownloadAttachment = async (messageId, attachment) => {
    if (!messageId || !attachment) return;
    if (!attachment.id && !attachment.data) return;
    setEmailAttachmentStatus({ status: "loading", message: "Downloading attachment..." });
    try {
      let data = attachment.data;
      if (!data && attachment.id) {
        data = await fetchEmailAttachment(messageId, attachment.id);
      }
      if (!data) {
        throw new Error("Attachment data missing.");
      }
      const mimeType = attachment.mimeType || "application/octet-stream";
      const filename = decodeHtmlEntities(attachment.filename || "attachment");
      const blob = base64ToBlob(data, mimeType);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setEmailAttachmentStatus({ status: "idle", message: "" });
    } catch (err) {
      setEmailAttachmentStatus({
        status: "error",
        message: err?.message || "Unable to download attachment."
      });
    }
  };

  const resolveInlineImages = async (messageId, html, attachments) => {
    if (!html) return "";
    let resolved = html;
    const inlineAttachments = (attachments || []).filter((item) => item?.isInline && item?.contentId);
    for (const attachment of inlineAttachments) {
      const cid = attachment.contentId;
      if (!cid) continue;
      const cidRef = `cid:${cid}`;
      if (!resolved.includes(cidRef)) continue;
      let data = attachment.data;
      if (!data && attachment.id) {
        data = await fetchEmailAttachment(messageId, attachment.id);
      }
      if (!data) continue;
      const mimeType = attachment.mimeType || "application/octet-stream";
      const dataUrl = `data:${mimeType};base64,${data}`;
      resolved = resolved.split(cidRef).join(dataUrl);
    }
    return resolved;
  };

  const loadEmailMessageDetail = async (message) => {
    if (!message?.id) return;
    const emailAddress = user?.email || userForm.email;
    if (!emailAddress) {
      setEmailMessageError("Missing user email.");
      return;
    }
    setEmailMessageLoading(true);
    setEmailMessageError("");
    setEmailAttachmentStatus({ status: "idle", message: "" });
    try {
      const params = new URLSearchParams({
        email: emailAddress,
        message_id: message.id,
        ts: String(Date.now())
      });
      const res = await fetch(`${API_URLS.emailMessage}?${params.toString()}`);
      if (!res.ok) {
        const text = await res.text();
        let parsed = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = null;
        }
        const detail = parsed?.details || parsed?.error || text || "Unable to fetch email";
        const detailText = String(detail || "");
        const needsConsent =
          detailText.includes("insufficientAuthenticationScopes") ||
          detailText.includes("insufficientPermissions");
        if (needsConsent) {
          throw new Error("Gmail permissions missing. Click Force re-connect to grant access.");
        }
        throw new Error(detail);
      }
      const data = await res.json().catch(() => ({}));
      const bodyText = decodeHtmlEntities(data?.body || data?.snippet || "");
      const rawHtml = data?.html || "";
      const attachments = Array.isArray(data?.attachments) ? data.attachments : [];
      const resolvedHtml = await resolveInlineImages(message.id, rawHtml, attachments);
      setEmailMessageBodies((prev) => ({ ...prev, [message.id]: bodyText }));
      if (rawHtml) {
        setEmailMessageHtml((prev) => ({ ...prev, [message.id]: resolvedHtml || rawHtml }));
      }
      setEmailMessageAttachments((prev) => ({ ...prev, [message.id]: attachments }));
      setEmailAccountEmail(data?.account_email || data?.accountEmail || "");
    } catch (err) {
      setEmailMessageError(err?.message || "Unable to fetch email details.");
    } finally {
      setEmailMessageLoading(false);
    }
  };

  const fetchEmailThread = async (threadId) => {
    const emailAddress = user?.email || userForm.email;
    if (!emailAddress || !threadId) return null;
    const params = new URLSearchParams({
      email: emailAddress,
      thread_id: threadId,
      ts: String(Date.now())
    });
    const res = await fetch(`${API_URLS.emailThread}?${params.toString()}`);
    if (!res.ok) {
      throw new Error(await parseApiError(res, "Unable to fetch email thread"));
    }
    return res.json().catch(() => ({}));
  };

  const buildReplyReferences = (message) => {
    if (!message) return "";
    const inReplyTo = message.messageIdHeader || message.inReplyTo || "";
    const base = String(message.references || "").trim();
    if (!inReplyTo) return base;
    if (!base) return inReplyTo;
    const parts = base.split(/\s+/).filter(Boolean);
    if (!parts.includes(inReplyTo)) parts.push(inReplyTo);
    return parts.join(" ").trim();
  };

  const buildReplyForm = (message, draftText, mode = "reply") => {
    if (!message) return null;
    const sender = parseSender(message.from);
    const subject =
      mode === "reply"
        ? message.subject?.startsWith("Re:")
          ? message.subject
          : `Re: ${message.subject || ""}`.trim()
        : message.subject?.startsWith("Fwd:")
          ? message.subject
          : `Fwd: ${message.subject || ""}`.trim();
    const inReplyTo = message.messageIdHeader || message.inReplyTo || "";
    const references = mode === "reply" ? buildReplyReferences(message) : "";
    return {
      to: mode === "reply" ? sender.email : "",
      cc: "",
      bcc: "",
      subject,
      body: draftText || "",
      threadId: mode === "reply" ? message.threadId || "" : "",
      inReplyTo: mode === "reply" ? inReplyTo : "",
      references
    };
  };

  const formatForwardThreadBody = (messages) => {
    if (!Array.isArray(messages) || !messages.length) return "";
    return messages
      .map((message, index) => {
        const header = index === 0 ? "---------- Forwarded message ----------" : "----------";
        const from = decodeHtmlEntities(message?.from || "unknown");
        const to = decodeHtmlEntities(message?.to || "unknown");
        const subject = decodeHtmlEntities(message?.subject || "No subject");
        const date = decodeHtmlEntities(message?.date || "unknown");
        const ccValue = decodeHtmlEntities(message?.cc || "");
        const cc = ccValue ? `Cc: ${ccValue}` : "";
        const body = decodeHtmlEntities(String(message?.body || message?.snippet || "").trim());
        const lines = [
          header,
          `From: ${from}`,
          `Date: ${date}`,
          `Subject: ${subject}`,
          `To: ${to}`
        ];
        if (cc) lines.push(cc);
        lines.push("", body || "");
        return lines.join("\n");
      })
      .join("\n\n");
  };

  const readFileAsBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === "string" ? reader.result : "";
        const base64 = result.split(",")[1] || "";
        resolve(base64);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  const buildAttachmentItems = async (files) =>
    Promise.all(
      files.map(async (file) => ({
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        data: await readFileAsBase64(file)
      }))
    );

  const handleInlineAttachmentChange = async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    const items = await buildAttachmentItems(files);
    setEmailInlineAttachments((prev) => [...prev, ...items]);
    event.target.value = "";
  };

  const removeInlineAttachment = (index) => {
    setEmailInlineAttachments((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleComposerAttachmentChange = async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    const items = await buildAttachmentItems(files);
    setEmailComposerAttachments((prev) => [...prev, ...items]);
    event.target.value = "";
  };

  const removeComposerAttachment = (index) => {
    setEmailComposerAttachments((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleInlineReplySend = async () => {
    const success = await handleSendEmail(emailInlineAttachments);
    if (success) {
      setEmailInlineReplyOpen(false);
      setEmailInlineReplyMessageId(null);
      setEmailInlineAttachments([]);
    }
  };

  const handleReplyWithAi = async (message, draftOverride = null, options = {}) => {
    if (!message?.id) return;
    const inlineActiveForMessage =
      emailInlineReplyOpen && emailInlineReplyMessageId === message.id;
    const draftValue =
      typeof draftOverride === "string"
        ? draftOverride
        : inlineActiveForMessage
          ? emailComposerForm.body
          : "";
    setEmailSummaryVisible(true);
    const { tone = emailReplyTone, intent = "reply" } = options;
    await requestReplyVariants(message, {
      tone,
      intent,
      currentDraft: draftValue
    });
  };

  const summarizeEmailMessage = async (message, options = {}) => {
    if (!message?.id) return;
    const { force = false } = options;
    const emailAddress = user?.email || userForm.email;
    if (!emailAddress) {
      setEmailSummaryStatus({ status: "error", message: "Missing user email." });
      return;
    }
    if (!force && emailSummaries?.[message.id]) return;
    setEmailSummaryStatus({ status: "loading", message: "Summarizing..." });
    setEmailSummaryVisible(true);
    try {
      const res = await fetch(API_URLS.emailSummary, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailAddress,
          message_id: message.id
        })
      });
      if (!res.ok) {
        const text = await res.text();
        let parsed = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = null;
        }
        const detail = parsed?.details || parsed?.error || text || "Unable to summarize email";
        const detailText = String(detail || "");
        const needsConsent =
          detailText.includes("insufficientAuthenticationScopes") ||
          detailText.includes("insufficientPermissions");
        if (needsConsent) {
          throw new Error("Gmail permissions missing. Click Force re-connect to grant access.");
        }
        throw new Error(detail);
      }
      const data = await res.json().catch(() => ({}));
      const summaryText = data?.summary || "";
      setEmailSummaries((prev) => ({ ...prev, [message.id]: summaryText }));
      setEmailAccountEmail(data?.account_email || data?.accountEmail || "");
      setEmailSummaryStatus({ status: "success", message: "Summary ready." });
      setEmailSummaryVisible(true);
    } catch (err) {
      setEmailSummaryStatus({
        status: "error",
        message: err?.message || "Unable to summarize email"
      });
    }
  };

  const openEmailTaskManager = (message) => {
    if (!message?.id) return;
    const defaults = buildDefaultSchedule();
    const summaryText = emailSummaries?.[message.id] || "";
    setTaskManagerEmailForm({
      title: message.subject || "Email follow-up",
      description: summaryText || message.snippet || "",
      start: defaults.start,
      end: defaults.end
    });
    setTaskManagerEmailTarget(message);
    setTaskManagerEmailStatus({ status: "idle", message: "" });
  };

  const handleEmailTaskManagerSave = async () => {
    const emailAddress = user?.email || userForm.email;
    if (!emailAddress) {
      setTaskManagerEmailStatus({ status: "error", message: "Missing user email." });
      return;
    }
    if (!taskManagerEmailTarget?.id) return;
    if (!taskManagerEmailForm.title || !taskManagerEmailForm.start) {
      setTaskManagerEmailStatus({
        status: "error",
        message: "Title and start time are required."
      });
      return;
    }
    setTaskManagerEmailStatus({ status: "loading", message: "Saving..." });
    try {
      await createTaskManagerItem({
        email: emailAddress,
        title: taskManagerEmailForm.title,
        description: taskManagerEmailForm.description,
        start: taskManagerEmailForm.start,
        end: taskManagerEmailForm.end,
        sourceType: "email_summary",
        sourceId: taskManagerEmailTarget.id
      });
      setTaskManagerEmailStatus({
        status: "success",
        message: "Task added to Task Manager."
      });
      setTaskManagerEmailTarget(null);
    } catch (err) {
      setTaskManagerEmailStatus({
        status: "error",
        message: err?.message || "Failed to add task."
      });
    }
  };

  const buildEmailAiPayload = (message, overrides = {}) => {
    const emailAddress = user?.email || userForm.email;
    const bodyText = trimText(emailMessageBodies?.[message.id] || "", 3000);
    return {
      email: emailAddress,
      message_id: message.id,
      threadId: message.threadId || "",
      headers: {
        subject: message.subject || "",
        from: message.from || "",
        date: message.date || "",
        to: message.to || "",
        cc: message.cc || ""
      },
      snippet: message.snippet || "",
      optionalBodyIfAlreadyAvailable: bodyText,
      urgent_conf_threshold: emailUrgentThreshold,
      ...overrides
    };
  };

  const parseApiError = async (res, fallback) => {
    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    const detail = parsed?.details || parsed?.error || text || fallback;
    const detailText = String(detail || "");
    const needsConsent =
      detailText.includes("insufficientAuthenticationScopes") ||
      detailText.includes("insufficientPermissions");
    if (needsConsent) {
      return "Gmail permissions missing. Click Force re-connect to grant access.";
    }
    return detailText || fallback;
  };

  const requestEmailClassification = async (message, options = {}) => {
    if (!message?.id) return;
    const { force = false } = options;
    if (!force && emailClassifications?.[message.id]) return;
    const emailAddress = user?.email || userForm.email;
    if (!emailAddress) {
      setEmailClassifyStatus((prev) => ({
        ...prev,
        [message.id]: { status: "error", message: "Missing user email." }
      }));
      return;
    }
    setEmailClassifyStatus((prev) => ({
      ...prev,
      [message.id]: { status: "loading", message: "Classifying..." }
    }));
    try {
      const payload = buildEmailAiPayload(message, force ? { force: true } : {});
      const res = await fetch(API_URLS.emailClassify, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        if (res.status === 429) {
          let retryAfter = 0;
          try {
            const payload = await res.json();
            retryAfter = Number(payload?.retry_after) || 0;
          } catch {
            retryAfter = Number(res.headers.get("retry-after")) || 0;
          }
          setEmailClassifyStatus((prev) => ({
            ...prev,
            [message.id]: {
              status: "rate_limited",
              message: retryAfter
                ? `Rate limited. Try again in ${retryAfter}s.`
                : "Rate limited. Try again in a moment."
            }
          }));
          return;
        }
        throw new Error(await parseApiError(res, "Unable to classify email"));
      }
      const data = await res.json().catch(() => ({}));
      const next = {
        tags: Array.isArray(data?.tags) ? data.tags : [],
        priorityScore: Number(data?.priorityScore) || 0,
        priorityLabel: data?.priorityLabel || "Normal",
        sentiment: data?.sentiment || "Neutral",
        confidence: Number(data?.confidence) || 0,
        reasoningShort: data?.reasoningShort || ""
      };
      if (data?.account_email || data?.accountEmail) {
        setEmailAccountEmail(data.account_email || data.accountEmail);
      }
      setEmailClassifications((prev) => ({ ...prev, [message.id]: next }));
      setEmailClassifyStatus((prev) => ({
        ...prev,
        [message.id]: { status: "success", message: "Insights ready." }
      }));
    } catch (err) {
      setEmailClassifyStatus((prev) => ({
        ...prev,
        [message.id]: { status: "error", message: err?.message || "Unable to classify email." }
      }));
    }
  };

  const openEmailFeedback = (message, classification = {}) => {
    if (!message?.id) return;
    setEmailFeedbackForm({
      tags: Array.isArray(classification?.tags) ? classification.tags : [],
      priorityLabel: classification?.priorityLabel || "Normal",
      sentiment: classification?.sentiment || "Neutral",
      notes: ""
    });
    setEmailFeedbackStatus({ status: "idle", message: "" });
    setEmailFeedbackOpen(true);
  };

  const toggleEmailFeedbackTag = (tag) => {
    setEmailFeedbackForm((prev) => {
      const nextTags = new Set(prev.tags || []);
      if (nextTags.has(tag)) {
        nextTags.delete(tag);
      } else {
        nextTags.add(tag);
      }
      return { ...prev, tags: Array.from(nextTags) };
    });
  };

  const submitEmailFeedback = async (message) => {
    if (!message?.id) return;
    const emailAddress = user?.email || userForm.email;
    if (!emailAddress) {
      setEmailFeedbackStatus({ status: "error", message: "Missing user email." });
      return;
    }
    setEmailFeedbackStatus({ status: "loading", message: "Sending feedback..." });
    try {
      const res = await fetch(API_URLS.emailFeedback, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailAddress,
          message_id: message.id,
          threadId: message.threadId || "",
          corrected_tags: emailFeedbackForm.tags,
          corrected_priority_label: emailFeedbackForm.priorityLabel,
          corrected_sentiment: emailFeedbackForm.sentiment,
          notes: emailFeedbackForm.notes
        })
      });
      if (!res.ok) {
        throw new Error(await parseSimpleError(res, "Unable to send feedback"));
      }
      setEmailClassifications((prev) => ({
        ...prev,
        [message.id]: {
          ...(prev?.[message.id] || {}),
          tags: emailFeedbackForm.tags,
          priorityLabel: emailFeedbackForm.priorityLabel,
          sentiment: emailFeedbackForm.sentiment
        }
      }));
      setEmailFeedbackStatus({ status: "success", message: "Thanks for the feedback." });
      setTimeout(() => {
        setEmailFeedbackOpen(false);
      }, 700);
    } catch (err) {
      setEmailFeedbackStatus({ status: "error", message: err?.message || "Unable to send feedback." });
    }
  };

  const requestEmailActions = async (message, options = {}) => {
    if (!message?.id) return;
    const { force = false } = options;
    if (!force && emailActionsById?.[message.id]) return;
    const emailAddress = user?.email || userForm.email;
    if (!emailAddress) {
      setEmailActionsStatus((prev) => ({
        ...prev,
        [message.id]: { status: "error", message: "Missing user email." }
      }));
      return;
    }
    setEmailActionsStatus((prev) => ({
      ...prev,
      [message.id]: { status: "loading", message: "Extracting actions..." }
    }));
    try {
      const payload = buildEmailAiPayload(message);
      const res = await fetch(API_URLS.emailActions, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Unable to extract action items"));
      }
      const data = await res.json().catch(() => ({}));
      const items = Array.isArray(data?.actionItems) ? data.actionItems : [];
      if (data?.account_email || data?.accountEmail) {
        setEmailAccountEmail(data.account_email || data.accountEmail);
      }
      setEmailActionsById((prev) => ({ ...prev, [message.id]: items }));
      setEmailActionsStatus((prev) => ({
        ...prev,
        [message.id]: { status: "success", message: "Action items ready." }
      }));
      setEmailActionChecks((prev) => {
        const current = prev?.[message.id] || {};
        const nextChecks = { ...current };
        items.forEach((_, index) => {
          if (nextChecks[index] === undefined) {
            nextChecks[index] = false;
          }
        });
        return { ...prev, [message.id]: nextChecks };
      });
    } catch (err) {
      setEmailActionsStatus((prev) => ({
        ...prev,
        [message.id]: { status: "error", message: err?.message || "Unable to extract action items." }
      }));
    }
  };

  const requestReplyVariants = async (message, options = {}) => {
    if (!message?.id) return;
    const { tone = emailReplyTone, intent = "reply", currentDraft = "" } = options;
    const emailAddress = user?.email || userForm.email;
    if (!emailAddress) {
      setEmailReplyVariantsStatus((prev) => ({
        ...prev,
        [message.id]: { status: "error", message: "Missing user email." }
      }));
      return;
    }
    setEmailReplyVariantsStatus((prev) => ({
      ...prev,
      [message.id]: { status: "loading", message: "Drafting variants..." }
    }));
    try {
      const payload = buildEmailAiPayload(message, {
        tone,
        intent,
        currentDraft
      });
      const res = await fetch(API_URLS.emailReplyVariants, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Unable to draft reply variants"));
      }
      const data = await res.json().catch(() => ({}));
      const variants = Array.isArray(data?.variants) ? data.variants : [];
      if (data?.account_email || data?.accountEmail) {
        setEmailAccountEmail(data.account_email || data.accountEmail);
      }
      setEmailReplyVariantsById((prev) => ({
        ...prev,
        [message.id]: {
          tone: data?.tone || tone,
          intent: data?.intent || intent,
          variants
        }
      }));
      setEmailReplyVariantsStatus((prev) => ({
        ...prev,
        [message.id]: { status: "success", message: "Reply variants ready." }
      }));
    } catch (err) {
      setEmailReplyVariantsStatus((prev) => ({
        ...prev,
        [message.id]: { status: "error", message: err?.message || "Unable to draft reply variants." }
      }));
    }
  };

  const insertReplyVariant = (message, text) => {
    if (!message?.id) return;
    const nextForm = buildReplyForm(message, text, "reply");
    if (!nextForm) return;
    setEmailComposerForm(nextForm);
    setEmailComposerStatus({ status: "idle", message: "" });
    setEmailInlineReplyOpen(true);
    setEmailInlineReplyMessageId(message.id);
    setEmailInlineAttachments([]);
  };

  const toggleActionItem = (messageId, index) => {
    if (!messageId && messageId !== 0) return;
    setEmailActionChecks((prev) => {
      const current = prev?.[messageId] || {};
      return {
        ...prev,
        [messageId]: { ...current, [index]: !current?.[index] }
      };
    });
  };

  const handleEmailDisconnect = () => {
    handleCalendarDisconnect?.();
    emailLoadedRef.current = false;
    emailLabelsLoadedRef.current = false;
    setEmailMessages([]);
    setEmailLabels([]);
    setEmailAccountEmail("");
    setEmailPageTokens([null]);
    setEmailCurrentPage(1);
    setEmailSummaries({});
    setEmailClassifications({});
    setEmailClassifyStatus({});
    setEmailActionsById({});
    setEmailActionsStatus({});
    setEmailActionChecks({});
    setEmailReplyVariantsById({});
    setEmailReplyVariantsStatus({});
    setSelectedEmailMessage(null);
    setEmailSelectedIds(new Set());
    setEmailMessageBodies({});
    setEmailMessageHtml({});
    setEmailMessageAttachments({});
    setEmailError("");
    setEmailSummaryStatus({ status: "idle", message: "" });
    setEmailMessageError("");
    setEmailActionStatus({ status: "idle", message: "" });
    setEmailInlineReplyOpen(false);
    setEmailInlineReplyMessageId(null);
    setEmailInlineAttachments([]);
    setEmailAutoTagEnabled(false);
    setEmailUrgentThreshold(0.75);
    setEmailSettingsStatus({ status: "idle", message: "" });
    setEmailFeedbackOpen(false);
    setEmailFeedbackForm({
      tags: [],
      priorityLabel: "Normal",
      sentiment: "Neutral",
      notes: ""
    });
    setEmailFeedbackStatus({ status: "idle", message: "" });
  };

  const handleMailboxSelect = (mailboxId) => {
    if (mailboxId === emailMailbox) return;
    setEmailMailbox(mailboxId);
    setEmailSelectedIds(new Set());
    setEmailCurrentPage(1);
    loadEmailMessages({
      page: 1,
      resetTokens: true,
      mailbox: mailboxId,
      unreadOnly: emailUnreadOnly
    });
  };

  const handleUnreadToggle = () => {
    const nextValue = !emailUnreadOnly;
    setEmailUnreadOnly(nextValue);
    setEmailSelectedIds(new Set());
    setEmailCurrentPage(1);
    loadEmailMessages({
      page: 1,
      resetTokens: true,
      unreadOnly: nextValue,
      mailbox: emailMailbox,
      query: emailQuery
    });
  };

  const handleEmailRefresh = () => {
    setEmailSelectedIds(new Set());
    setEmailCurrentPage(1);
    loadEmailMessages({
      page: 1,
      resetTokens: true,
      mailbox: emailMailbox,
      unreadOnly: emailUnreadOnly,
      query: emailQuery
    });
  };

  const handleEmailSearch = () => {
    setEmailSelectedIds(new Set());
    setEmailCurrentPage(1);
    loadEmailMessages({
      page: 1,
      resetTokens: true,
      query: emailQuery,
      mailbox: emailMailbox,
      unreadOnly: emailUnreadOnly
    });
  };

  const parseSimpleError = async (res, fallback) => {
    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    return parsed?.details || parsed?.error || text || fallback;
  };

  const saveEmailSettings = async (overrides = {}) => {
    const emailAddress = user?.email || userForm.email;
    if (!emailAddress) {
      setEmailSettingsStatus({ status: "error", message: "Missing user email." });
      return;
    }
    setEmailSettingsStatus({ status: "loading", message: "Saving..." });
    try {
      const res = await fetch(API_URLS.emailSettings, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailAddress,
          auto_tag_enabled: emailAutoTagEnabled,
          urgent_conf_threshold: emailUrgentThreshold,
          ...overrides
        })
      });
      if (!res.ok) {
        throw new Error(await parseSimpleError(res, "Unable to save email settings"));
      }
      const data = await res.json().catch(() => ({}));
      if (data?.auto_tag_enabled !== undefined) {
        setEmailAutoTagEnabled(Boolean(data.auto_tag_enabled));
      } else {
        setEmailAutoTagEnabled(true);
      }
      if (data?.urgent_conf_threshold !== undefined) {
        setEmailUrgentThreshold(Number(data.urgent_conf_threshold) || 0.75);
      }
      setEmailSettingsStatus({ status: "success", message: "Settings saved." });
    } catch (err) {
      setEmailSettingsStatus({ status: "error", message: err?.message || "Unable to save email settings." });
    }
  };

  const getSocialIdentity = () => ({
    email: user?.email || userForm.email || "",
    userId: user?.id || ""
  });

  const loadSocialConnections = async () => {
    const { email: emailAddress } = getSocialIdentity();
    if (!emailAddress) return;
    setSocialConnectionsLoading(true);
    setSocialConnectionsError("");
    try {
      const params = new URLSearchParams({ email: emailAddress });
      const res = await fetch(`${API_URLS.socialConnections}?${params.toString()}`);
      if (!res.ok) {
        throw new Error(await parseSimpleError(res, "Unable to load connections"));
      }
      const data = await res.json().catch(() => ({}));
      setSocialConnections(Array.isArray(data?.connections) ? data.connections : []);
    } catch (err) {
      setSocialConnectionsError(err?.message || "Unable to load connections.");
    } finally {
      setSocialConnectionsLoading(false);
    }
  };

  const beginMetaConnect = async () => {
    const { email: emailAddress } = getSocialIdentity();
    if (!emailAddress) {
      setSocialConnectStatus({ status: "error", message: "Missing user email." });
      return;
    }
    setSocialConnectStatus({ status: "loading", message: "" });
    try {
      const params = new URLSearchParams({ email: emailAddress });
      const res = await fetch(`${API_URLS.socialMetaAuthUrl}?${params.toString()}`);
      if (!res.ok) {
        throw new Error(await parseSimpleError(res, "Unable to start Meta connection"));
      }
      const data = await res.json().catch(() => ({}));
      const authUrl = data?.auth_url;
      if (!authUrl) {
        throw new Error("Missing auth URL");
      }
      const popup = window.open(authUrl, "meta-oauth", "width=600,height=720");
      if (!popup) {
        throw new Error("Popup blocked. Please allow popups to connect Meta.");
      }

      const handleMessage = (event) => {
        if (!event?.data || event.data?.status !== "connected") return;
        setSocialConnectStatus({ status: "success", message: "Meta connected." });
        loadSocialConnections();
        window.removeEventListener("message", handleMessage);
      };
      window.addEventListener("message", handleMessage);

      const timer = setInterval(() => {
        if (popup.closed) {
          clearInterval(timer);
          window.removeEventListener("message", handleMessage);
          setSocialConnectStatus((prev) =>
            prev.status === "success" ? prev : { status: "idle", message: "" }
          );
          loadSocialConnections();
        }
      }, 600);
    } catch (err) {
      setSocialConnectStatus({ status: "error", message: err?.message || "Meta connect failed." });
    }
  };

  const beginWhatsAppConnect = async () => {
    const { email: emailAddress } = getSocialIdentity();
    if (!emailAddress) {
      setWhatsappStatus({ status: "error", message: "Missing user email." });
      return;
    }
    setWhatsappStatus({ status: "loading", message: "" });
    try {
      const params = new URLSearchParams({ email: emailAddress });
      const res = await fetch(`${API_URLS.socialWhatsAppAuthUrl}?${params.toString()}`);
      if (!res.ok) {
        throw new Error(await parseSimpleError(res, "Unable to start WhatsApp connection"));
      }
      const data = await res.json().catch(() => ({}));
      const authUrl = data?.auth_url;
      if (!authUrl) {
        throw new Error("Missing auth URL");
      }
      const popup = window.open(authUrl, "whatsapp-oauth", "width=600,height=720");
      if (!popup) {
        throw new Error("Popup blocked. Please allow popups to connect WhatsApp.");
      }

      const handleMessage = (event) => {
        if (!event?.data || event.data?.status !== "connected") return;
        setWhatsappStatus({ status: "success", message: "WhatsApp connected." });
        loadSocialConnections();
        window.removeEventListener("message", handleMessage);
      };
      window.addEventListener("message", handleMessage);

      const timer = setInterval(() => {
        if (popup.closed) {
          clearInterval(timer);
          window.removeEventListener("message", handleMessage);
          setWhatsappStatus((prev) =>
            prev.status === "success" ? prev : { status: "idle", message: "" }
          );
          loadSocialConnections();
        }
      }, 600);
    } catch (err) {
      setWhatsappStatus({ status: "error", message: err?.message || "WhatsApp connect failed." });
    }
  };

  const disconnectSocialConnection = async (connectionId) => {
    const { email: emailAddress } = getSocialIdentity();
    if (!emailAddress) return;
    try {
      const res = await fetch(API_URLS.socialDisconnect, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailAddress, connection_id: connectionId })
      });
      if (!res.ok) {
        throw new Error(await parseSimpleError(res, "Unable to disconnect"));
      }
      loadSocialConnections();
    } catch (err) {
      setSocialConnectionsError(err?.message || "Unable to disconnect connection.");
    }
  };

  const handleWhatsAppConnect = async () => {
    const { email: emailAddress } = getSocialIdentity();
    if (!emailAddress) {
      setWhatsappStatus({ status: "error", message: "Missing user email." });
      return;
    }
    if (!whatsappForm.phoneNumberId || !whatsappForm.token) {
      setWhatsappStatus({ status: "error", message: "Phone number ID and token are required." });
      return;
    }
    setWhatsappStatus({ status: "loading", message: "" });
    try {
      const res = await fetch(API_URLS.socialWhatsAppConnect, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailAddress,
          phone_number_id: whatsappForm.phoneNumberId,
          waba_id: whatsappForm.wabaId,
          permanent_token: whatsappForm.token
        })
      });
      if (!res.ok) {
        throw new Error(await parseSimpleError(res, "Unable to connect WhatsApp"));
      }
      setWhatsappStatus({ status: "success", message: "WhatsApp connected." });
      setWhatsappForm({ phoneNumberId: "", wabaId: "", token: "" });
      loadSocialConnections();
    } catch (err) {
      setWhatsappStatus({ status: "error", message: err?.message || "WhatsApp connect failed." });
    }
  };

  const sendWhatsAppMessage = async () => {
    const { email: emailAddress } = getSocialIdentity();
    if (!emailAddress) {
      setWhatsappSendStatus({ status: "error", message: "Missing user email." });
      return;
    }
    const trimmedTo = whatsappSendForm.to.trim();
    const trimmedText = whatsappSendForm.text.trim();
    if (!trimmedTo || !trimmedText) {
      setWhatsappSendStatus({ status: "error", message: "Phone number and message are required." });
      return;
    }
    setWhatsappSendStatus({ status: "loading", message: "" });
    try {
      const payload = {
        email: emailAddress,
        to: trimmedTo,
        text: trimmedText
      };
      if (whatsappSendForm.connectionId) {
        payload.connection_id = whatsappSendForm.connectionId;
      }
      const res = await fetch(API_URLS.socialWhatsAppSend, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        throw new Error(await parseSimpleError(res, "Unable to send WhatsApp message"));
      }
      setWhatsappSendStatus({ status: "success", message: "Message sent." });
      setWhatsappSendForm((prev) => ({ ...prev, to: "", text: "" }));
      loadSocialConversations();
    } catch (err) {
      setWhatsappSendStatus({ status: "error", message: err?.message || "Send failed." });
    }
  };

  const loadSocialConversations = async () => {
    const { email: emailAddress } = getSocialIdentity();
    if (!emailAddress) return;
    setSocialInboxLoading(true);
    setSocialInboxError("");
    try {
      const params = new URLSearchParams({ email: emailAddress, limit: "50" });
      const res = await fetch(`${API_URLS.socialInboxConversations}?${params.toString()}`);
      if (!res.ok) {
        throw new Error(await parseSimpleError(res, "Unable to load conversations"));
      }
      const data = await res.json().catch(() => ({}));
      const items = Array.isArray(data?.conversations) ? data.conversations : [];
      setSocialConversations(items);
      if (items.length && !socialSelectedConversation) {
        setSocialSelectedConversation(items[0]);
      }
    } catch (err) {
      setSocialInboxError(err?.message || "Unable to load conversations.");
    } finally {
      setSocialInboxLoading(false);
    }
  };

  const loadSocialMessages = async (conversation) => {
    const { email: emailAddress } = getSocialIdentity();
    if (!emailAddress || !conversation?.id) return;
    setSocialMessagesLoading(true);
    setSocialMessagesError("");
    try {
      const params = new URLSearchParams({ email: emailAddress });
      const res = await fetch(
        `${API_URLS.socialInboxMessages}/${conversation.id}/messages?${params.toString()}`
      );
      if (!res.ok) {
        throw new Error(await parseSimpleError(res, "Unable to load messages"));
      }
      const data = await res.json().catch(() => ({}));
      setSocialMessages(Array.isArray(data?.messages) ? data.messages : []);
    } catch (err) {
      setSocialMessagesError(err?.message || "Unable to load messages.");
    } finally {
      setSocialMessagesLoading(false);
    }
  };

  const sendSocialReply = async () => {
    const { email: emailAddress } = getSocialIdentity();
    if (!emailAddress || !socialSelectedConversation?.id) return;
    if (!socialReplyText.trim()) return;
    setSocialReplyStatus({ status: "loading", message: "" });
    try {
      const res = await fetch(
        `${API_URLS.socialInboxReply}/${socialSelectedConversation.id}/reply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: emailAddress, text: socialReplyText.trim() })
        }
      );
      if (!res.ok) {
        throw new Error(await parseSimpleError(res, "Unable to send reply"));
      }
      setSocialReplyText("");
      setSocialReplyStatus({ status: "success", message: "Reply sent." });
      loadSocialMessages(socialSelectedConversation);
      loadSocialConversations();
    } catch (err) {
      setSocialReplyStatus({ status: "error", message: err?.message || "Reply failed." });
    }
  };

  const requestSocialSuggestion = async () => {
    const { email: emailAddress } = getSocialIdentity();
    if (!emailAddress || !socialSelectedConversation?.id) return;
    setSocialSuggestStatus({ status: "loading", message: "" });
    try {
      const res = await fetch(API_URLS.socialSuggestReply, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailAddress,
          conversation_id: socialSelectedConversation.id
        })
      });
      if (!res.ok) {
        throw new Error(await parseSimpleError(res, "Unable to suggest reply"));
      }
      const data = await res.json().catch(() => ({}));
      if (data?.suggestion) {
        setSocialReplyText(data.suggestion);
      }
      setSocialSuggestStatus({ status: "success", message: "Suggestion ready." });
    } catch (err) {
      setSocialSuggestStatus({ status: "error", message: err?.message || "Suggestion failed." });
    }
  };

  const loadSocialDrafts = async () => {
    const { email: emailAddress } = getSocialIdentity();
    if (!emailAddress) return;
    setSocialDraftsLoading(true);
    setSocialDraftsError("");
    try {
      const params = new URLSearchParams({ email: emailAddress });
      const res = await fetch(`${API_URLS.socialDrafts}?${params.toString()}`);
      if (!res.ok) {
        throw new Error(await parseSimpleError(res, "Unable to load drafts"));
      }
      const data = await res.json().catch(() => ({}));
      setSocialDrafts(Array.isArray(data?.drafts) ? data.drafts : []);
    } catch (err) {
      setSocialDraftsError(err?.message || "Unable to load drafts.");
    } finally {
      setSocialDraftsLoading(false);
    }
  };

  const loadSocialScheduled = async () => {
    const { email: emailAddress } = getSocialIdentity();
    if (!emailAddress) return;
    setSocialScheduledLoading(true);
    setSocialScheduledError("");
    try {
      const params = new URLSearchParams({ email: emailAddress });
      const res = await fetch(`${API_URLS.socialScheduledPosts}?${params.toString()}`);
      if (!res.ok) {
        throw new Error(await parseSimpleError(res, "Unable to load schedule"));
      }
      const data = await res.json().catch(() => ({}));
      setSocialScheduledPosts(Array.isArray(data?.scheduled_posts) ? data.scheduled_posts : []);
    } catch (err) {
      setSocialScheduledError(err?.message || "Unable to load scheduled posts.");
    } finally {
      setSocialScheduledLoading(false);
    }
  };

  const handleSocialMediaUpload = async (event) => {
    const file = event?.target?.files?.[0];
    if (!file) return;
    setSocialUploadStatus({ status: "loading", message: "Uploading..." });
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("File read failed"));
        reader.readAsDataURL(file);
      });
      const res = await fetch(API_URLS.socialMediaUpload, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data_url: dataUrl,
          filename: file.name
        })
      });
      if (!res.ok) {
        const text = await res.text();
        let parsed = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = null;
        }
        throw new Error(parsed?.error || parsed?.details || text || "Upload failed");
      }
      const data = await res.json().catch(() => ({}));
      const mediaUrl = data?.media_url || "";
      if (!mediaUrl) {
        throw new Error("Upload succeeded but no media URL returned.");
      }
      setSocialDraftForm((prev) => {
        const next = [...(prev.mediaUrls || [])];
        const emptyIdx = next.findIndex((item) => !item);
        if (emptyIdx >= 0) {
          next[emptyIdx] = mediaUrl;
        } else {
          next.push(mediaUrl);
        }
        return { ...prev, mediaUrls: next };
      });
      setSocialUploadStatus({ status: "success", message: "Image uploaded." });
    } catch (err) {
      setSocialUploadStatus({ status: "error", message: err?.message || "Upload failed." });
    } finally {
      if (socialUploadInputRef.current) {
        socialUploadInputRef.current.value = "";
      }
    }
  };

  const saveSocialDraft = async () => {
    const { email: emailAddress } = getSocialIdentity();
    if (!emailAddress) return;
    const payload = {
      email: emailAddress,
      caption: socialDraftForm.caption || "",
      media_urls: socialDraftForm.mediaUrls.filter(Boolean)
    };
    setSocialPublishStatus({ status: "idle", message: "" });
    setSocialScheduleStatus({ status: "idle", message: "" });
    try {
      if (socialDraftId) {
        const res = await fetch(`${API_URLS.socialDraftUpdate}/${socialDraftId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          throw new Error(await parseSimpleError(res, "Unable to update draft"));
        }
      } else {
        const res = await fetch(API_URLS.socialDraftCreate, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          throw new Error(await parseSimpleError(res, "Unable to save draft"));
        }
        const data = await res.json().catch(() => ({}));
        setSocialDraftId(data?.id || null);
      }
      loadSocialDrafts();
    } catch (err) {
      setSocialDraftsError(err?.message || "Unable to save draft.");
    }
  };

  const publishSocialPost = async () => {
    const { email: emailAddress } = getSocialIdentity();
    if (!emailAddress || !socialDraftId) {
      setSocialPublishStatus({ status: "error", message: "Select or save a draft first." });
      return;
    }
    setSocialPublishStatus({ status: "loading", message: "" });
    try {
      const res = await fetch(API_URLS.socialPublish, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailAddress,
          draft_id: socialDraftId,
          targets: socialTargets
        })
      });
      if (!res.ok) {
        throw new Error(await parseSimpleError(res, "Publish failed"));
      }
      setSocialPublishStatus({ status: "success", message: "Published." });
      loadSocialScheduled();
    } catch (err) {
      setSocialPublishStatus({ status: "error", message: err?.message || "Publish failed." });
    }
  };

  const scheduleSocialPost = async () => {
    const { email: emailAddress } = getSocialIdentity();
    if (!emailAddress || !socialDraftId || !socialScheduleAt) {
      setSocialScheduleStatus({
        status: "error",
        message: "Select a draft and schedule time."
      });
      return;
    }
    setSocialScheduleStatus({ status: "loading", message: "" });
    try {
      const res = await fetch(API_URLS.socialSchedule, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailAddress,
          draft_id: socialDraftId,
          scheduled_for: socialScheduleAt,
          targets: socialTargets
        })
      });
      if (!res.ok) {
        throw new Error(await parseSimpleError(res, "Schedule failed"));
      }
      setSocialScheduleStatus({ status: "success", message: "Scheduled." });
      setSocialScheduleAt("");
      loadSocialScheduled();
    } catch (err) {
      setSocialScheduleStatus({ status: "error", message: err?.message || "Schedule failed." });
    }
  };

  const dashboardMenuItems = [
    {
      id: "dashboard_analytics",
      label: "Dashboard",
      eyebrow: "Analytics",
      icon: LayoutGrid,
      copy: "Track performance across all AI tools."
    }
  ];

  const toolTabs = [
    {
      id: "ai_receptionist",
      label: "AI receptionist",
      eyebrow: "Voice + calls",
      icon: Shield,
      copy: "Route, transcribe, and analyze every customer conversation."
    },
    {
      id: "email_manager",
      label: "Email Manager",
      eyebrow: "Email",
      icon: Mail,
      copy: "Auto-triage, draft replies, and keep your inbox SLA clean."
    },
    {
      id: "social_media_manager",
      label: "Social media manager",
      eyebrow: "Content ops",
      icon: Megaphone,
      copy: "Plan content, enforce brand safety, and schedule multi-channel posts."
    },
    {
      id: "task_manager",
      label: "Task Manager",
      eyebrow: "Schedule",
      icon: CalendarClock,
      copy: "Organize tasks on a shared calendar and keep timelines visible."
    },
    {
      id: "contacts",
      label: "Contacts",
      eyebrow: "Directory",
      icon: Users,
      copy: "Sync Gmail + Outlook contacts, plus AI receptionist leads."
    }
  ];

  const analyticsTabs = [
    { id: "ai_receptionist", label: "AI Receptionist", icon: Shield },
    { id: "email_manager", label: "Email Manager", icon: Mail },
    { id: "social_media_manager", label: "Social Media Manager", icon: Megaphone }
  ];

  const baseMailboxItems = [
    { id: "INBOX", label: "Inbox", icon: Inbox },
    { id: "IMPORTANT", label: "Important", icon: Star, requiresLabel: true },
    { id: "CATEGORY_UPDATES", label: "Updates", icon: Activity, requiresLabel: true },
    { id: "STARRED", label: "Starred", icon: Star },
    { id: "SENT", label: "Sent mail", icon: SendIcon },
    { id: "DRAFT", label: "Drafts", icon: FileText },
    { id: "ALL_MAIL", label: "Archive", icon: Archive },
    { id: "SPAM", label: "Spam", icon: AlertTriangle },
    { id: "TRASH", label: "Trash", icon: Trash2 }
  ];
  const socialSubTabs = [
    { id: "connect", label: "Connect" },
    { id: "inbox", label: "Inbox" },
    { id: "posts", label: "Posts" }
  ];
  const settingsSections = [
    { id: "automation", label: "Automation summary" },
    { id: "business", label: "Business profile" },
    { id: "user", label: "User profile" }
  ];

  const isToolLocked = (toolId) => {
    if (toolId === "dashboard_analytics") return false;
    if (toolId === "task_manager") return false;
    if (toolId === "contacts") return false;
    const entry = toolSubscriptions?.[toolId];
    if (entry && typeof entry.active === "boolean") return !entry.active;
    if (subscriptionsLoading) return false;
    return true;
  };

  const currentTool = activeTool || "ai_receptionist";
  const isEmailManager = currentTool === "email_manager";
  const activeToolLocked = isToolLocked(currentTool);
  const navTabs = [...dashboardMenuItems, ...toolTabs];
  const activeToolMeta = navTabs.find((tool) => tool.id === currentTool);
  const activeToolLabel = activeToolMeta?.label || "AI tool";
  const activeToolCopy =
    activeToolMeta?.copy || "Full control over your AI agents, analytics, and automations.";
  const ActiveIcon = activeToolMeta?.icon || Shield;
  const isLightTheme = emailTheme === "light";
  const lightThemeActive = isLightTheme;
  const settingsActive = currentTool === "email_manager" && emailSubTab === "settings";
  const showEmailSidePanel = emailSubTab !== "settings";
  const hasTwilioNumber = Boolean(aiNumber);
  const hasReceptionistSubscription = !subscriptionsLoading && !isToolLocked("ai_receptionist");
  const needsNumberAssignment = !hasTwilioNumber;
  const showAssignCta = hasReceptionistSubscription && needsNumberAssignment;
  const showNumberGate = currentTool === "ai_receptionist" && showAssignCta;
  const assignBusy = assignNumberStatus?.status === "loading";
  const assignError =
    assignNumberStatus?.status === "error" ? assignNumberStatus?.message : "";
  const showResumeBusinessAction = !subscriptionsLoading && !hasActiveSubscription;
  const selectedEmailSummary = selectedEmailMessage ? emailSummaries[selectedEmailMessage.id] : "";
  const emailSummaryLoading = emailSummaryStatus.status === "loading";
  const emailSummaryError = emailSummaryStatus.status === "error" ? emailSummaryStatus.message : "";
  const gmailConnected = Boolean(emailAccountEmail || emailMessages.length);
  const googleConnected = Boolean(calendarAccountEmail || calendarStatus === "Google");
  const gmailAccountLabel = emailAccountEmail || calendarAccountEmail || "";
  const inboxProviderLabel = gmailConnected
    ? emailAccountEmail && /outlook|hotmail|live/i.test(emailAccountEmail)
      ? "Outlook"
      : "Gmail"
    : "Not connected";
  const gmailStatusLabel = gmailConnected
    ? "Gmail connected"
    : googleConnected
      ? "Google connected (calendar only)"
      : "Not connected";
  const emailActionButtonClass = lightThemeActive
    ? "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
    : "border-white/10 bg-white/10 text-white hover:border-white/30 hover:bg-white/20";
  const emailHasNext = Boolean(emailPageTokens[emailCurrentPage]);
  const selectedEmailIds = Array.from(emailSelectedIds);
  const emailSelectionCount = selectedEmailIds.length;
  const emailAllSelected = Boolean(emailMessages.length && emailSelectionCount === emailMessages.length);
  const emailActionLoading = emailActionStatus.status === "loading";
  const websiteData = useMemo(
    () => parseWebsiteData(clientData?.website_data),
    [clientData?.website_data]
  );
  const businessProfileData = useMemo(
    () => extractBusinessProfile(websiteData),
    [websiteData]
  );
  const derivedBusinessProfile = useMemo(
    () => ({
      businessName:
        businessProfileData.business_name ||
        businessProfileData.businessName ||
        clientData?.business_name ||
        clientData?.name ||
        manualBusinessInfo?.businessName ||
        "",
      contactNumber:
        businessProfileData.contact_phone ||
        businessProfileData.business_phone ||
        businessProfileData.businessPhone ||
        clientData?.business_phone ||
        manualBusinessInfo?.businessPhone ||
        "",
      contactEmail:
        businessProfileData.contact_email ||
        businessProfileData.businessEmail ||
        manualBusinessInfo?.businessEmail ||
        user?.email ||
        "",
      websiteUrl:
        clientData?.website_url ||
        businessProfileData.website_url ||
        businessProfileData.websiteUrl ||
        manualBusinessInfo?.websiteUrl ||
        "",
      businessSummary:
        businessProfileData.business_summary ||
        businessProfileData.businessSummary ||
        manualBusinessInfo?.businessSummary ||
        "",
      hours:
        businessProfileData.business_hours ||
        businessProfileData.hours ||
        manualBusinessInfo?.hours ||
        "",
      location:
        businessProfileData.business_location ||
        businessProfileData.location ||
        manualBusinessInfo?.location ||
        "",
      services:
        businessProfileData.business_services ||
        businessProfileData.services ||
        manualBusinessInfo?.services ||
        "",
      notes:
        businessProfileData.business_notes ||
        businessProfileData.notes ||
        manualBusinessInfo?.notes ||
        "",
      openings:
        businessProfileData.business_openings ||
        businessProfileData.openings ||
        manualBusinessInfo?.openings ||
        ""
    }),
    [
      businessProfileData.business_name,
      businessProfileData.businessName,
      businessProfileData.contact_phone,
      businessProfileData.business_phone,
      businessProfileData.businessPhone,
      businessProfileData.contact_email,
      businessProfileData.businessEmail,
      businessProfileData.business_summary,
      businessProfileData.businessSummary,
      businessProfileData.business_hours,
      businessProfileData.hours,
      businessProfileData.business_location,
      businessProfileData.location,
      businessProfileData.business_services,
      businessProfileData.services,
      businessProfileData.business_notes,
      businessProfileData.notes,
      businessProfileData.business_openings,
      businessProfileData.openings,
      businessProfileData.website_url,
      businessProfileData.websiteUrl,
      clientData?.business_name,
      clientData?.name,
      clientData?.business_phone,
      clientData?.website_url,
      manualBusinessInfo?.businessName,
      manualBusinessInfo?.businessPhone,
      manualBusinessInfo?.businessEmail,
      manualBusinessInfo?.websiteUrl,
      manualBusinessInfo?.businessSummary,
      manualBusinessInfo?.hours,
      manualBusinessInfo?.location,
      manualBusinessInfo?.services,
      manualBusinessInfo?.notes,
      manualBusinessInfo?.openings,
      user?.email
    ]
  );
  const businessProfileFieldClass = `w-full rounded-xl border border-white/10 px-3 py-2 text-sm outline-none transition ${
    isBusinessProfileEditing
      ? "bg-slate-900/60 text-slate-100 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
      : "bg-slate-900/40 text-slate-200"
  }`;
  const subscriptionDetails = useMemo(() => {
    if (!toolSubscriptions) return [];
    const list = Object.entries(toolSubscriptions)
      .map(([toolId, entry]) => {
        if (!entry) return null;
        const toolMeta = toolTabs.find((tool) => tool.id === toolId);
        return {
          id: toolId,
          label: toolMeta?.label || toolId.replace(/_/g, " "),
          active: Boolean(entry.active),
          status: entry.status,
          planId: entry.planId,
          currentPeriodEnd: entry.currentPeriodEnd
        };
      })
      .filter(Boolean);
    return list.sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return String(a.label || "").localeCompare(String(b.label || ""));
    });
  }, [toolSubscriptions, toolTabs]);

  useEffect(() => {
    const root = document.documentElement;
    if (lightThemeActive) {
      root.classList.add("theme-light");
    } else {
      root.classList.remove("theme-light");
    }
    return () => root.classList.remove("theme-light");
  }, [lightThemeActive]);

  useEffect(() => {
    if (!user?.email) return;
    let cancelled = false;

    const loadAnalytics = async () => {
      setDashboardAnalyticsStatus({ status: "loading", message: "" });
      try {
        const res = await fetch(
          `${API_URLS.dashboardAnalytics}?email=${encodeURIComponent(user.email)}`
        );
        const payload = await res.json();
        if (!res.ok) {
          throw new Error(payload?.error || "Unable to load analytics");
        }
        if (!cancelled) {
          setDashboardAnalyticsData(payload);
          setDashboardAnalyticsStatus({ status: "success", message: "" });
        }
      } catch (err) {
        if (!cancelled) {
          setDashboardAnalyticsStatus({
            status: "error",
            message: err?.message || "Unable to load analytics"
          });
        }
      }
    };

    loadAnalytics();
    return () => {
      cancelled = true;
    };
  }, [user?.email]);

  useEffect(() => {
    if (currentTool === "dashboard_analytics") {
      setAnalyticsTab("ai_receptionist");
    }
  }, [currentTool]);
  const emailActionError = emailActionStatus.status === "error" ? emailActionStatus.message : "";
  const emailActionSuccess = emailActionStatus.status === "success" ? emailActionStatus.message : "";
  const dashboardAnalyticsMessage =
    dashboardAnalyticsStatus.status === "error"
      ? dashboardAnalyticsStatus.message
      : dashboardAnalyticsStatus.status === "loading"
        ? "Syncing analytics..."
        : "";
  const emailAnalyticsData = dashboardAnalyticsData?.email || null;
  const socialAnalyticsData = dashboardAnalyticsData?.social || null;
  const emailSummaryCountLocal = Object.values(emailSummaries || {}).filter(
    (summary) => summary && String(summary).trim()
  ).length;
  const emailActionCountLocal = Object.values(emailActionsById || {}).reduce((sum, items) => {
    if (!Array.isArray(items)) return sum;
    return sum + items.length;
  }, 0);
  const emailDraftCountLocal = Object.values(emailReplyVariantsById || {}).reduce((sum, entry) => {
    const variants = entry?.variants;
    if (!Array.isArray(variants)) return sum;
    return sum + variants.length;
  }, 0);
  const emailUnreadCount = (emailMessages || []).filter((message) =>
    (message?.labelIds || []).includes("UNREAD")
  ).length;
  const emailLeadCountLocal = Object.values(emailClassifications || {}).reduce((sum, entry) => {
    const tags = Array.isArray(entry?.tags) ? entry.tags : [];
    const hasLead = tags.some((tag) =>
      /lead|opportunity|demo|quote|pricing|trial/i.test(String(tag || ""))
    );
    return sum + (hasLead ? 1 : 0);
  }, 0);
  const emailTagCountsLocal = Object.values(emailClassifications || {}).reduce((acc, entry) => {
    const tags = Array.isArray(entry?.tags) ? entry.tags : [];
    tags.forEach((tag) => {
      const key = String(tag || "").trim();
      if (!key) return;
      acc[key] = (acc[key] || 0) + 1;
    });
    return acc;
  }, {});
  const emailSummaryCount = emailAnalyticsData?.summaryCount ?? emailSummaryCountLocal;
  const emailActionCount = emailAnalyticsData?.actionItemCount ?? emailActionCountLocal;
  const emailDraftCount = emailAnalyticsData?.draftCount ?? emailDraftCountLocal;
  const emailLeadCount = emailAnalyticsData?.leadCount ?? emailLeadCountLocal;
  const emailTagCounts = emailAnalyticsData?.tagCounts || emailTagCountsLocal;
  const emailTopTags = Object.entries(emailTagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const socialLeadCountLocal = (socialConversations || []).reduce((sum, convo) => {
    const hint = `${convo?.subject || ""} ${convo?.name || ""} ${convo?.snippet || ""}`.trim();
    if (!hint) return sum;
    return sum + (/lead|demo|quote|pricing|inquiry|interested/i.test(hint) ? 1 : 0);
  }, 0);
  const socialTaskCountLocal = (socialConversations || []).reduce((sum, convo) => {
    if (!Array.isArray(convo?.tasks)) return sum;
    return sum + convo.tasks.length;
  }, 0);
  const socialConnectionsCount = socialAnalyticsData?.connections ?? socialConnections.length;
  const socialConversationsCount = socialAnalyticsData?.conversations ?? socialConversations.length;
  const socialDraftCount = socialAnalyticsData?.drafts ?? socialDrafts.length;
  const socialScheduledCount = socialAnalyticsData?.scheduled ?? socialScheduledPosts.length;
  const socialMessagesOutboundCount =
    socialAnalyticsData?.messagesOutbound ?? socialMessages.length;
  const socialLeadCount = socialAnalyticsData?.leadSignals ?? socialLeadCountLocal;
  const socialTaskCount = socialAnalyticsData?.tasks ?? socialTaskCountLocal;
  const gmailLabelOptions = emailLabels
    .filter((label) => label?.id && label?.type !== "system")
    .map((label) => ({ id: label.id, name: label.name }));
  const gmailLabelIds = new Set(emailLabels.map((label) => label?.id).filter(Boolean));
  const mailboxItems = baseMailboxItems.filter((item) => !item.requiresLabel || gmailLabelIds.has(item.id));
  const activeMailboxLabel =
    mailboxItems.find((item) => item.id === emailMailbox)?.label || "Inbox";
  const emailComposerTitle =
    emailComposerMode === "reply"
      ? "Reply"
      : emailComposerMode === "forward"
        ? "Forward"
        : "New mail";
  const headerSender = selectedEmailMessage ? parseSender(selectedEmailMessage.from) : null;
  const headerSenderLabel = headerSender
    ? `From: ${headerSender.name}${headerSender.email ? ` <${headerSender.email}>` : ""}`
    : "Select an email to view details.";

  const filteredEmailMessages = useMemo(() => {
    let items = [...emailMessages];
    if (emailTagFilter && emailTagFilter !== "all") {
      items = items.filter((message) => {
        const tags = emailClassifications?.[message.id]?.tags || [];
        return tags.includes(emailTagFilter);
      });
    }
    const getPriorityScore = (message) =>
      Number(emailClassifications?.[message.id]?.priorityScore) || 0;
    if (emailSort === "priority") {
      items.sort((a, b) => {
        const diff = getPriorityScore(b) - getPriorityScore(a);
        if (diff !== 0) return diff;
        return getMessageTimestampValue(b) - getMessageTimestampValue(a);
      });
    } else {
      items.sort((a, b) => getMessageTimestampValue(b) - getMessageTimestampValue(a));
    }
    return items;
  }, [emailClassifications, emailMessages, emailSort, emailTagFilter]);

  const facebookConnections = useMemo(
    () =>
      socialConnections.filter(
        (conn) => conn.platform === "meta" && conn.metadata?.meta_type === "facebook_page"
      ),
    [socialConnections]
  );
  const instagramConnections = useMemo(
    () =>
      socialConnections.filter(
        (conn) => conn.platform === "meta" && conn.metadata?.meta_type === "instagram_business"
      ),
    [socialConnections]
  );
  const whatsappConnections = useMemo(
    () => socialConnections.filter((conn) => conn.platform === "whatsapp_meta"),
    [socialConnections]
  );
  const whatsappConnected = whatsappConnections.length > 0;
  useEffect(() => {
    if (!whatsappConnections.length) return;
    setWhatsappSendForm((prev) =>
      prev.connectionId ? prev : { ...prev, connectionId: String(whatsappConnections[0].id) }
    );
  }, [whatsappConnections]);
  const filteredSocialConversations = useMemo(() => {
    const base = [...socialConversations];
    const query = socialSearch.trim().toLowerCase();
    if (!query) return base;
    return base.filter((item) => {
      const text = `${item.participant_name || ""} ${item.participant_handle || ""} ${item.last_message_text || ""}`;
      return text.toLowerCase().includes(query);
    });
  }, [socialConversations, socialSearch]);

  const handleInboxScroll = (event) => {
    if (emailLoading || !emailHasNext) return;
    const target = event.currentTarget;
    if (target.scrollTop + target.clientHeight >= target.scrollHeight - 120) {
      loadEmailMessages({ page: emailCurrentPage + 1, append: true });
    }
  };

  const promptClientId = clientData?.id || clientData?.client_id || null;
  const promptSubType = clientData?.business_sub_type || "";
  const promptCategory = clientData?.business_category || "";

  const buildPromptKnowledgeText = (profile) => {
    const lines = [
      profile?.businessSummary ? `Summary: ${profile.businessSummary}` : "",
      profile?.services ? `Services: ${profile.services}` : "",
      profile?.hours ? `Hours: ${profile.hours}` : "",
      profile?.location ? `Location: ${profile.location}` : "",
      profile?.notes ? `Notes: ${profile.notes}` : "",
      profile?.openings ? `Openings: ${profile.openings}` : ""
    ];
    return lines.filter(Boolean).join("\n");
  };

  const loadPromptStatus = async () => {
    if (!user?.email || !promptClientId || !promptSubType) {
      setPromptStatus({ status: "idle", message: "", prompt: null });
      return;
    }
    setPromptStatus((prev) => ({ ...prev, status: "loading", message: "" }));
    try {
      const query = new URLSearchParams({
        clientId: String(promptClientId),
        subType: promptSubType,
        email: user.email,
        includeStatus: "true"
      });
      const res = await fetch(`${API_URLS.promptsActive}?${query.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to load prompt status");
      }
      setPromptStatus({ status: "success", message: "", prompt: data?.prompt || null });
    } catch (error) {
      setPromptStatus({
        status: "error",
        message: error?.message || "Failed to load prompt status",
        prompt: null
      });
    }
  };

  const loadPromptHistory = async () => {
    if (!user?.email || !promptClientId || !promptSubType) return;
    setPromptHistoryStatus({ status: "loading", message: "" });
    try {
      const query = new URLSearchParams({
        clientId: String(promptClientId),
        subType: promptSubType,
        email: user.email
      });
      const res = await fetch(`${API_URLS.promptsHistory}?${query.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to load prompt history");
      }
      setPromptHistory(data?.prompts || []);
      setPromptHistoryStatus({ status: "success", message: "" });
    } catch (error) {
      setPromptHistoryStatus({
        status: "error",
        message: error?.message || "Failed to load prompt history"
      });
    }
  };

  const handlePromptRegenerate = async () => {
    if (!user?.email || !promptClientId || !promptSubType) return;
    setPromptActionStatus({ status: "loading", message: "Generating prompt..." });
    const profilePayload = {
      businessName: derivedBusinessProfile.businessName || "",
      businessPhone: derivedBusinessProfile.contactNumber || "",
      businessEmail: derivedBusinessProfile.contactEmail || "",
      businessSummary: derivedBusinessProfile.businessSummary || "",
      location: derivedBusinessProfile.location || "",
      hours: derivedBusinessProfile.hours || "",
      services: derivedBusinessProfile.services || "",
      notes: derivedBusinessProfile.notes || "",
      openings: derivedBusinessProfile.openings || "",
      websiteUrl: derivedBusinessProfile.websiteUrl || ""
    };
    try {
      const res = await fetch(API_URLS.promptsGenerate, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: user.email,
          clientId: promptClientId,
          category: promptCategory || null,
          subType: promptSubType,
          taskType: null,
          businessProfile: profilePayload,
          knowledgeText: buildPromptKnowledgeText(profilePayload)
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to generate prompt");
      }
      setPromptActionStatus({ status: "success", message: "Prompt generated" });
      loadPromptStatus();
      loadPromptHistory();
    } catch (error) {
      setPromptActionStatus({
        status: "error",
        message: error?.message || "Failed to generate prompt"
      });
    }
  };

  const handlePromptActivate = async (version) => {
    if (!user?.email || !promptClientId || !promptSubType) return;
    setPromptActionStatus({ status: "loading", message: "Activating prompt..." });
    try {
      const res = await fetch(API_URLS.promptsActivate, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: user.email,
          clientId: promptClientId,
          subType: promptSubType,
          taskType: null,
          version
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to activate prompt");
      }
      setPromptActionStatus({ status: "success", message: `Activated v${version}` });
      loadPromptStatus();
      loadPromptHistory();
    } catch (error) {
      setPromptActionStatus({
        status: "error",
        message: error?.message || "Failed to activate prompt"
      });
    }
  };

  useEffect(() => {
    setBusinessForm({
      name: clientData?.business_name || clientData?.name || "",
      phone: clientData?.business_phone || "",
      website: clientData?.website_url || ""
    });
  }, [clientData?.business_name, clientData?.business_phone, clientData?.name, clientData?.website_url]);

  useEffect(() => {
    if (businessSaveStatus?.status === "success") {
      setIsBusinessEditing(false);
      setIsBusinessProfileEditing(false);
    }
  }, [businessSaveStatus?.status]);

  useEffect(() => {
    if (settingsSection !== "business") return;
    if (!promptClientId || !promptSubType || !user?.email) {
      setPromptStatus({ status: "idle", message: "", prompt: null });
      return;
    }
    loadPromptStatus();
  }, [promptClientId, promptSubType, settingsSection, user?.email]);

  useEffect(() => {
    if (businessSaveStatus?.status !== "success") return;
    if (!promptClientId || !promptSubType || !user?.email) return;
    loadPromptStatus();
  }, [businessSaveStatus?.status, promptClientId, promptSubType, user?.email]);

  useEffect(() => {
    if (isBusinessProfileEditing) return;
    setBusinessProfileForm({
      businessName: derivedBusinessProfile.businessName || "",
      contactNumber: derivedBusinessProfile.contactNumber || "",
      contactEmail: derivedBusinessProfile.contactEmail || user?.email || "",
      websiteUrl: derivedBusinessProfile.websiteUrl || "",
      businessSummary: derivedBusinessProfile.businessSummary || "",
      hours: derivedBusinessProfile.hours || "",
      location: derivedBusinessProfile.location || "",
      services: derivedBusinessProfile.services || "",
      notes: derivedBusinessProfile.notes || "",
      openings: derivedBusinessProfile.openings || ""
    });
  }, [
    derivedBusinessProfile.businessName,
    derivedBusinessProfile.contactNumber,
    derivedBusinessProfile.contactEmail,
    derivedBusinessProfile.websiteUrl,
    derivedBusinessProfile.businessSummary,
    derivedBusinessProfile.hours,
    derivedBusinessProfile.location,
    derivedBusinessProfile.services,
    derivedBusinessProfile.notes,
    derivedBusinessProfile.openings,
    isBusinessProfileEditing,
    user?.email
  ]);

  useEffect(() => {
    setUserForm({
      email: user?.email || "",
      businessName: userProfile?.business_name || "",
      businessNumber: userProfile?.business_number || ""
    });
  }, [user?.email, userProfile?.business_name, userProfile?.business_number]);

  useEffect(() => {
    emailLoadedRef.current = false;
    emailLabelsLoadedRef.current = false;
  }, [user?.email]);

  useEffect(() => {
    if (currentTool !== "email_manager" || activeToolLocked) return;
    if (emailSubTab !== "email") return;
    const emailAddress = user?.email || userForm.email;
    if (!emailAddress) return;
    if (emailLoadedRef.current) return;
    emailLoadedRef.current = true;
    loadEmailMessages({ page: 1, resetTokens: true });
  }, [activeToolLocked, currentTool, emailSubTab, user?.email, userForm.email]);

  useEffect(() => {
    if (currentTool !== "email_manager" || activeToolLocked) return;
    if (emailSubTab !== "email") return;
    const emailAddress = user?.email || userForm.email;
    if (!emailAddress) return;
    if (emailLabelsLoadedRef.current) return;
    emailLabelsLoadedRef.current = true;
    loadEmailLabels();
  }, [activeToolLocked, currentTool, emailSubTab, user?.email, userForm.email]);

  useEffect(() => {
    socialConnectionsLoadedRef.current = false;
    socialDraftsLoadedRef.current = false;
    socialScheduledLoadedRef.current = false;
  }, [user?.email]);

  useEffect(() => {
    if (currentTool !== "social_media_manager" || activeToolLocked) return;
    const emailAddress = user?.email || userForm.email;
    if (!emailAddress) return;
    if (!socialConnectionsLoadedRef.current) {
      socialConnectionsLoadedRef.current = true;
      loadSocialConnections();
    }
    if (!socialDraftsLoadedRef.current) {
      socialDraftsLoadedRef.current = true;
      loadSocialDrafts();
    }
    if (!socialScheduledLoadedRef.current) {
      socialScheduledLoadedRef.current = true;
      loadSocialScheduled();
    }
  }, [activeToolLocked, currentTool, user?.email, userForm.email]);

  useEffect(() => {
    if (currentTool !== "social_media_manager" || activeToolLocked) return;
    if (socialTab !== "inbox") return;
    loadSocialConversations();
  }, [activeToolLocked, currentTool, socialTab, user?.email, userForm.email]);

  useEffect(() => {
    if (!socialConversations.length) {
      setSocialSelectedConversation(null);
      setSocialMessages([]);
      return;
    }
    if (
      !socialSelectedConversation ||
      !socialConversations.find((item) => item.id === socialSelectedConversation.id)
    ) {
      setSocialSelectedConversation(socialConversations[0]);
    }
  }, [socialConversations, socialSelectedConversation]);

  useEffect(() => {
    if (!socialSelectedConversation?.id) return;
    loadSocialMessages(socialSelectedConversation);
  }, [socialSelectedConversation?.id]);

  useEffect(() => {
    if (!gmailConnected || emailLabelsLoadedRef.current) return;
    emailLabelsLoadedRef.current = true;
    loadEmailLabels();
  }, [gmailConnected]);

  useEffect(() => {
    const activeMessages = filteredEmailMessages.length ? filteredEmailMessages : emailMessages;
    if (!activeMessages.length) {
      setSelectedEmailMessage(null);
      setEmailSelectedIds(new Set());
      return;
    }
    if (!selectedEmailMessage || !activeMessages.find((m) => m.id === selectedEmailMessage.id)) {
      setSelectedEmailMessage(activeMessages[0]);
    }
    setEmailSelectedIds((prev) => {
      if (!prev.size) return prev;
      const available = new Set(emailMessages.map((message) => message.id));
      const next = new Set();
      prev.forEach((id) => {
        if (available.has(id)) next.add(id);
      });
      return next;
    });
  }, [emailMessages, filteredEmailMessages, selectedEmailMessage]);

  useEffect(() => {
    if (!selectedEmailMessage) return;
    setEmailSummaryVisible(emailAutoSummarize);
    setEmailMessageError("");
    setEmailInlineReplyOpen(false);
    setEmailInlineReplyMessageId(null);
    setEmailInlineAttachments([]);
    setEmailFeedbackOpen(false);
    setEmailFeedbackStatus({ status: "idle", message: "" });
    loadEmailMessageDetail(selectedEmailMessage);
  }, [emailAutoSummarize, selectedEmailMessage?.id]);

  useEffect(() => {
    if (!selectedEmailMessage) {
      setEmailSummaryStatus({ status: "idle", message: "" });
      return;
    }
    if (emailSummaries?.[selectedEmailMessage.id]) {
      setEmailSummaryStatus({ status: "success", message: "Summary ready." });
    } else {
      setEmailSummaryStatus({ status: "idle", message: "" });
    }
  }, [emailSummaries, selectedEmailMessage]);

  useEffect(() => {
    if (currentTool !== "email_manager" || activeToolLocked) return;
    if (!emailAutoSummarize) return;
    if (!selectedEmailMessage) return;
    if (emailSummaries?.[selectedEmailMessage.id]) return;
    if (emailSummaryLoading) return;
    summarizeEmailMessage(selectedEmailMessage);
  }, [
    activeToolLocked,
    currentTool,
    emailAutoSummarize,
    emailSummaryLoading,
    emailSummaries,
    selectedEmailMessage
  ]);

  useEffect(() => {
    if (emailAutoSummarize) return;
    setEmailSummaryVisible(false);
  }, [emailAutoSummarize]);

  useEffect(() => {
    if (emailAutoTagTimerRef.current) {
      clearInterval(emailAutoTagTimerRef.current);
      emailAutoTagTimerRef.current = null;
    }
    if (!emailAutoTagEnabled || emailSubTab !== "email") return;
    emailAutoTagTimerRef.current = setInterval(() => {
      if (emailLoading) return;
      loadEmailMessages({
        page: emailCurrentPage,
        mailbox: emailMailbox,
        unreadOnly: emailUnreadOnly,
        query: emailQuery
      });
    }, EMAIL_REFRESH_INTERVAL_MS);
    return () => {
      if (emailAutoTagTimerRef.current) {
        clearInterval(emailAutoTagTimerRef.current);
        emailAutoTagTimerRef.current = null;
      }
    };
  }, [emailAutoTagEnabled, emailCurrentPage, emailMailbox, emailUnreadOnly, emailQuery, emailSubTab, emailLoading]);

  useEffect(() => {
    if (emailRefreshTimerRef.current) {
      clearInterval(emailRefreshTimerRef.current);
      emailRefreshTimerRef.current = null;
    }
    if (currentTool !== "email_manager" || emailSubTab !== "email") return;
    if (emailAutoTagEnabled) return;
    if (!emailAccountEmail && !emailMessages.length) return;
    emailRefreshTimerRef.current = setInterval(() => {
      if (emailLoading) return;
      if (emailCurrentPage !== 1) return;
      loadEmailMessages({
        page: 1,
        resetTokens: true,
        mailbox: emailMailbox,
        unreadOnly: emailUnreadOnly,
        query: emailQuery
      });
    }, EMAIL_REFRESH_INTERVAL_MS);
    return () => {
      if (emailRefreshTimerRef.current) {
        clearInterval(emailRefreshTimerRef.current);
        emailRefreshTimerRef.current = null;
      }
    };
  }, [
    currentTool,
    emailSubTab,
    emailAutoTagEnabled,
    emailAccountEmail,
    emailMessages.length,
    emailLoading,
    emailCurrentPage,
    emailMailbox,
    emailUnreadOnly,
    emailQuery
  ]);

  useEffect(() => {
    if (currentTool !== "email_manager" || emailSubTab !== "email") return;
    if (!emailAutoTagEnabled) return;
    if (emailLoading) return;
    if (!emailMessages.length) return;
    const candidates = emailMessages.filter((message) => {
      if (!message?.id) return false;
      if (emailClassifications?.[message.id]) return false;
      if (emailAutoClassifySeenRef.current.has(message.id)) return false;
      const status = emailClassifyStatus?.[message.id]?.status;
      if (status && status !== "idle") return false;
      return true;
    });
    if (!candidates.length) return;
    candidates.slice(0, EMAIL_AUTO_CLASSIFY_BATCH_SIZE).forEach((message, index) => {
      emailAutoClassifySeenRef.current.add(message.id);
      setTimeout(() => {
        requestEmailClassification(message);
      }, index * EMAIL_AUTO_CLASSIFY_STAGGER_MS);
    });
  }, [
    currentTool,
    emailSubTab,
    emailAutoTagEnabled,
    emailLoading,
    emailMessages,
    emailClassifications,
    emailClassifyStatus
  ]);

  useEffect(() => {
    if (currentTool !== "email_manager" || emailSubTab !== "email") return;
    if (!selectedEmailMessage?.id) return;
    const status = emailClassifyStatus?.[selectedEmailMessage.id]?.status;
    if (emailClassifications?.[selectedEmailMessage.id]) return;
    if (status && status !== "idle") return;
    if (emailClassifyTimerRef.current) {
      clearTimeout(emailClassifyTimerRef.current);
    }
    emailClassifyTimerRef.current = setTimeout(() => {
      requestEmailClassification(selectedEmailMessage);
    }, 400);
    return () => {
      if (emailClassifyTimerRef.current) {
        clearTimeout(emailClassifyTimerRef.current);
      }
    };
  }, [
    currentTool,
    emailClassifications,
    emailClassifyStatus,
    emailSubTab,
    selectedEmailMessage?.id
  ]);

  useEffect(() => {
    if (currentTool !== "email_manager" || emailSubTab !== "email") return;
    if (!selectedEmailMessage?.id) return;
    const status = emailActionsStatus?.[selectedEmailMessage.id]?.status;
    if (emailActionsById?.[selectedEmailMessage.id]) return;
    if (status === "loading") return;
    if (emailActionsTimerRef.current) {
      clearTimeout(emailActionsTimerRef.current);
    }
    emailActionsTimerRef.current = setTimeout(() => {
      requestEmailActions(selectedEmailMessage);
    }, 500);
    return () => {
      if (emailActionsTimerRef.current) {
        clearTimeout(emailActionsTimerRef.current);
      }
    };
  }, [
    currentTool,
    emailActionsById,
    emailActionsStatus,
    emailSubTab,
    selectedEmailMessage?.id
  ]);

  useEffect(() => {
    if (calendarStatus || calendarAccountEmail) return;
    if (!emailMessages.length && !emailAccountEmail) return;
    emailLoadedRef.current = false;
    setEmailMessages([]);
    setEmailAccountEmail("");
    setEmailPageTokens([null]);
    setEmailCurrentPage(1);
    setEmailSummaries({});
    setEmailClassifications({});
    setEmailClassifyStatus({});
    setEmailActionsById({});
    setEmailActionsStatus({});
    setEmailActionChecks({});
    setEmailReplyVariantsById({});
    setEmailReplyVariantsStatus({});
    emailAutoClassifySeenRef.current = new Set();
    setSelectedEmailMessage(null);
    setEmailError("");
    setEmailSummaryStatus({ status: "idle", message: "" });
    setEmailAutoTagEnabled(true);
    setEmailUrgentThreshold(0.75);
    setEmailSettingsStatus({ status: "idle", message: "" });
  }, [calendarAccountEmail, calendarStatus, emailAccountEmail, emailMessages.length]);

  useEffect(() => {
    if (pagedCalls.length === 0) {
      setSelectedCall(null);
      return;
    }
    if (!selectedCall || !pagedCalls.find((c) => c.sid === selectedCall.sid)) {
      setSelectedCall(pagedCalls[0]);
    }
  }, [pagedCalls, selectedCall]);

  useEffect(() => {
    if (!selectedCall?.sid || !onLoadTranscript) return;
    if (callTranscript?.call?.sid === selectedCall.sid && !callTranscript?.error) return;
    onLoadTranscript(selectedCall.sid);
  }, [callTranscript?.call?.sid, onLoadTranscript, selectedCall?.sid]);

  const emailAnalytics = useMemo(() => {
    const now = Date.now();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

    const processedToday = emailMessages.filter(
      (message) => getMessageTimestampValue(message) >= startOfToday.getTime()
    ).length;
    const processedWeek = emailMessages.filter(
      (message) => getMessageTimestampValue(message) >= weekAgo
    ).length;

    const localTagCounts = EMAIL_TAG_OPTIONS.reduce((acc, tag) => {
      acc[tag] = 0;
      return acc;
    }, {});
    const localPriorityCounts = {
      Urgent: 0,
      Normal: 0,
      Low: 0
    };

    Object.values(emailClassifications || {}).forEach((classification) => {
      const tags = classification?.tags || [];
      tags.forEach((tag) => {
        if (localTagCounts[tag] !== undefined) {
          localTagCounts[tag] += 1;
        }
      });
      const label = classification?.priorityLabel;
      if (label && localPriorityCounts[label] !== undefined) {
        localPriorityCounts[label] += 1;
      }
    });

    return {
      processedToday,
      processedWeek,
      totalLoaded: emailMessages.length,
      tagCounts: emailAnalyticsData?.tagCounts || localTagCounts,
      priorityCounts: emailAnalyticsData?.priorityCounts || localPriorityCounts
    };
  }, [emailAnalyticsData, emailClassifications, emailMessages]);

  const analytics = useMemo(() => {
    const sourceCalls = (analyticsCalls?.length ? analyticsCalls : recentCalls) || [];
    const totalCalls = sourceCalls.length;
    const answered = sourceCalls.filter((c) => (c.status || "").toLowerCase() === "completed").length;
    const totalSeconds = sourceCalls.reduce(
      (acc, curr) => acc + (Number(curr.duration) || 0),
      0
    );
    const avgDuration = totalCalls ? totalSeconds / totalCalls : 0;
    const totalMinutes = Math.round(totalSeconds / 60);
    const inbound = sourceCalls.filter((c) => (c.direction || "").includes("inbound")).length;
    const outbound = sourceCalls.filter((c) => (c.direction || "").includes("outbound")).length;
    return {
      totalCalls,
      answeredRate: totalCalls ? Math.round((answered / totalCalls) * 100) : 0,
      avgDuration,
      totalMinutes,
      inbound,
      outbound
    };
  }, [analyticsCalls, recentCalls]);

  const callDayOptions = useMemo(
    () => [
      { label: "All days", value: "All days", dayIndex: null },
      { label: "Monday", value: "Monday", dayIndex: 1 },
      { label: "Tuesday", value: "Tuesday", dayIndex: 2 },
      { label: "Wednesday", value: "Wednesday", dayIndex: 3 },
      { label: "Thursday", value: "Thursday", dayIndex: 4 },
      { label: "Friday", value: "Friday", dayIndex: 5 },
      { label: "Saturday", value: "Saturday", dayIndex: 6 },
      { label: "Sunday", value: "Sunday", dayIndex: 0 }
    ],
    []
  );

  const callTimeInsights = useMemo(() => {
    const sourceCalls = (analyticsCalls?.length ? analyticsCalls : recentCalls) || [];
    const hours = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      count: 0
    }));
    const selected = callDayOptions.find((option) => option.value === selectedCallDay);
    const targetDay = selected?.dayIndex ?? null;

    sourceCalls.forEach((call) => {
      const raw = call?.start_time || call?.date_created || call?.created_at || call?.startTime;
      if (!raw) return;
      const dt = new Date(raw);
      if (Number.isNaN(dt.getTime())) return;
      if (targetDay !== null && dt.getDay() !== targetDay) return;
      const hour = dt.getHours();
      if (hour >= 0 && hour <= 23) {
        hours[hour].count += 1;
      }
    });

    const maxCount = Math.max(...hours.map((entry) => entry.count), 0);
    const peakHour = hours.reduce((best, entry) => (entry.count > best.count ? entry : best), hours[0]);
    return {
      hours,
      maxCount,
      totalCalls: hours.reduce((sum, entry) => sum + entry.count, 0),
      peakLabel: peakHour?.count ? formatHourLabel(peakHour.hour) : "—"
    };
  }, [analyticsCalls, callDayOptions, recentCalls, selectedCallDay]);

  const [voiceLanguageFilter, setVoiceLanguageFilter] = useState("all");
  const primaryVoice = agentDetails.voice;
  const resolveSampleUrl = (rawUrl) => {
    const url = String(rawUrl || "").trim();
    if (!url) return "";
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
    if (url.startsWith("//")) {
      const host = url.slice(2).split("/")[0];
      if (!host.includes(".")) return "";
      return `https:${url}`;
    }
    if (url.startsWith("/")) return "";
    const host = url.split("/")[0];
    if (!host.includes(".")) return "";
    return `https://${url}`;
  };
  const voiceOptions = useMemo(
    () =>
      (ultravoxVoices || []).map((v) => ({
        id: v.id || v.voiceId || v.voice_id,
        name: v.name || v.label || v.voice || v.id,
        locale: v.locale || v.language || "",
        gender: v.gender || v.style || "",
        primaryLanguage: v.primaryLanguage || v.primary_language || "",
        sampleUrl: resolveSampleUrl(
          v.previewUrl ||
            v.preview_url ||
            v.sample ||
            v.sample_url ||
            v.sampleUrl ||
            v.audio_url ||
            v.audioUrl ||
            v.demo_url ||
            v.demoUrl ||
            ""
        )
      })),
    [ultravoxVoices]
  );
  const voiceLanguageOptions = useMemo(() => {
    const set = new Set();
    voiceOptions.forEach((voice) => {
      if (voice.primaryLanguage) set.add(voice.primaryLanguage);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [voiceOptions]);
  const filteredVoiceOptions = useMemo(() => {
    if (voiceLanguageFilter === "all") return voiceOptions;
    return voiceOptions.filter((voice) => voice.primaryLanguage === voiceLanguageFilter);
  }, [voiceLanguageFilter, voiceOptions]);
  const selectedVoice =
    voiceOptions.find((voice) => voice.id === primaryVoice) || filteredVoiceOptions[0];

  useEffect(() => {
    if (voiceLanguageFilter !== "all" || !primaryVoice) return;
    const voice = voiceOptions.find((item) => item.id === primaryVoice);
    if (voice?.primaryLanguage) {
      setVoiceLanguageFilter(voice.primaryLanguage);
    }
  }, [primaryVoice, voiceLanguageFilter, voiceOptions]);

  useEffect(() => {
    if (voiceLanguageFilter === "all") return;
    if (!filteredVoiceOptions.length) return;
    if (filteredVoiceOptions.some((voice) => voice.id === primaryVoice)) return;
    setAgentDetails((prev) => ({ ...prev, voice: filteredVoiceOptions[0].id }));
  }, [filteredVoiceOptions, primaryVoice, voiceLanguageFilter, setAgentDetails]);

  useEffect(() => {
    const audio = voiceSampleRef.current;
    if (!audio) return;
    const handleEnded = () => setVoiceSamplePlaying(false);
    const handlePause = () => setVoiceSamplePlaying(false);
    const handlePlay = () => setVoiceSamplePlaying(true);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("play", handlePlay);
    return () => {
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("play", handlePlay);
    };
  }, [selectedVoice?.sampleUrl]);

  useEffect(() => {
    const audio = voiceSampleRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setVoiceSamplePlaying(false);
  }, [selectedVoice?.sampleUrl]);

  const integrationStatus = calendarStatus || (calendarEvents?.length ? "Google" : null);
  const selectedProviderLabel = selectedCalendarProvider === "google" ? "Google" : "Outlook";
  const selectedProviderConnected =
    selectedCalendarProvider === "google" ? Boolean(integrationStatus) : false;
  const googleContactsConnected = Boolean(calendarAccountEmail || calendarStatus === "Google");
  const sideNavWidthClass = sideNavHidden
    ? "w-0 min-w-0 max-w-0"
    : sideNavOpen
      ? "w-[240px]"
      : "w-14";
  const aiReceptionistDashboardPanel = (
    <>
      <section className="grid gap-4 md:grid-cols-4">
        <StatCard label="Total Calls" value={analytics.totalCalls} hint="All time" icon={PhoneCall} />
        <StatCard
          label="Answered"
          value={`${analytics.answeredRate}%`}
          hint="Completed calls"
          icon={CheckCircle2}
        />
        <StatCard
          label="Avg Duration"
          value={formatDuration(analytics.avgDuration)}
          hint={`${analytics.totalMinutes} minutes total`}
          icon={Activity}
        />
        <StatCard
          label="Inbound vs Outbound"
          value={`${analytics.inbound} / ${analytics.outbound}`}
          hint="Direction split"
          icon={Mic}
        />
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-2xl backdrop-blur">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-white">Overview</div>
              <p className="text-xs text-slate-400">
                Typical call times based on recent activity.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span>Day view</span>
              <select
                value={selectedCallDay}
                onChange={(event) => setSelectedCallDay(event.target.value)}
                className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs text-slate-100 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
              >
                {callDayOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4 shadow-inner">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>
                Peak window:{" "}
                <span className="text-slate-200">{callTimeInsights.peakLabel}</span>
              </span>
              <span>{callTimeInsights.totalCalls} calls tracked</span>
            </div>
            <div className="mt-4 flex h-28 items-end gap-1">
              {callTimeInsights.hours.map((entry) => {
                const height = callTimeInsights.maxCount
                  ? Math.max(12, Math.round((entry.count / callTimeInsights.maxCount) * 100))
                  : 12;
                return (
                  <div
                    key={entry.hour}
                    className="flex-1 rounded-full bg-gradient-to-t from-purple-500/30 via-purple-500/60 to-purple-600/80"
                    style={{ height: `${height}%`, minWidth: 6 }}
                    title={`${formatHourLabel(entry.hour)} • ${entry.count} calls`}
                  />
                );
              })}
            </div>
            <div className="mt-3 flex items-center justify-between text-[10px] uppercase tracking-[0.3em] text-slate-500">
              <span>12A</span>
              <span>4A</span>
              <span>8A</span>
              <span>12P</span>
              <span>4P</span>
              <span>8P</span>
            </div>
          </div>
        </div>
        <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-xl backdrop-blur">
          <div className="mb-2 flex items-center gap-2">
            <Activity className="h-5 w-5 text-indigo-200" />
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-indigo-200">Data</p>
              <h4 className="text-lg font-semibold text-white">Analysis snapshot</h4>
            </div>
          </div>
          <div className="grid gap-3 text-xs text-slate-200">
            <div className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-900/40 px-3 py-2">
              <span>Total minutes</span>
              <span className="font-semibold">{analytics.totalMinutes} min</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-900/40 px-3 py-2">
              <span>Inbound</span>
              <span className="font-semibold">{analytics.inbound}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-900/40 px-3 py-2">
              <span>Outbound</span>
              <span className="font-semibold">{analytics.outbound}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-900/40 px-3 py-2">
              <span>Average length</span>
              <span className="font-semibold">{formatDuration(analytics.avgDuration)}</span>
            </div>
          </div>
        </div>
      </section>
    </>
  );
  const renderToolButton = (tool) => {
    const Icon = tool.icon;
    const locked = isToolLocked(tool.id);
    const isToolActive =
      currentTool === tool.id && !(settingsActive && tool.id === "email_manager");
    const toolAccentMap = {
      dashboard_analytics: "from-indigo-500/80 via-sky-400/70 to-blue-400/70",
      ai_receptionist: "from-emerald-500/80 via-lime-400/70 to-emerald-300/70",
      email_manager: "from-sky-500/80 via-cyan-400/70 to-blue-400/70",
      social_media_manager: "from-fuchsia-500/80 via-pink-400/70 to-rose-400/70",
      task_manager: "from-amber-500/80 via-orange-400/70 to-rose-400/60",
      contacts: "from-rose-500/80 via-red-400/70 to-orange-300/70"
    };
    const accent = toolAccentMap[tool.id] || "from-slate-500/70 to-slate-400/70";
    const toolActiveClass = lightThemeActive
      ? "bg-slate-200/80 text-slate-900 shadow-[0_10px_22px_rgba(15,23,42,0.08)]"
      : "bg-white/15 text-white";
    return (
      <button
        key={tool.id}
        onClick={() => {
          setActiveTool?.(tool.id);
          if (tool.id === "ai_receptionist") setActiveTab?.("agents");
          if (tool.id === "email_manager") setEmailSubTab("email");
        }}
        className={`dashboard-nav-item group flex h-10 w-full items-center gap-0.5 rounded-2xl text-left transition ${
          sideNavContentVisible
            ? "text-slate-200 hover:bg-white/10 hover:text-white"
            : "text-slate-300 hover:bg-white/10 hover:text-white hover:shadow-[0_10px_22px_rgba(79,70,229,0.25)]"
        } ${isToolActive ? toolActiveClass : ""}`}
        data-active={isToolActive}
        aria-disabled={locked ? "true" : undefined}
      >
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-xl bg-gradient-to-br ${accent} shadow-sm`}
        >
          <Icon className="h-[18px] w-[18px] text-white" />
        </span>
        <div
          className={`min-w-0 transition-opacity ${
            sideNavContentVisible
              ? "flex-1 opacity-100"
              : "max-w-0 overflow-hidden opacity-0"
          }`}
        >
          <p className="text-sm font-semibold text-white leading-none whitespace-nowrap">
            {tool.label}
          </p>
        </div>
      </button>
    );
  };

  return (
    <section
      className={`relative p-0 dashboard-theme ${lightThemeActive ? "" : "dashboard-theme--dark"} ${
        isEmailManager ? "min-h-screen sm:h-screen sm:overflow-hidden" : "min-h-screen"
      }`}
    >
      <div className="absolute inset-0 dashboard-bg" />
      <div className="absolute -left-6 -right-6 -top-6 bottom-0 dashboard-bg-overlay" />
      <div className={`relative mx-auto w-full max-w-none ${isEmailManager ? "h-full" : ""}`}>
        {sideNavHidden && (
          <div
            className="absolute left-0 top-0 z-30 flex flex-col items-start gap-2"
            onMouseEnter={() => setSideNavHidden(false)}
            onTouchStart={() => setSideNavHidden(false)}
          >
            <button
              type="button"
              onClick={() => setSideNavHidden(false)}
              className={`mt-3 -translate-x-1/2 rounded-full border px-2 py-1 text-[11px] transition ${
                lightThemeActive
                  ? "border-slate-300 bg-white text-slate-600 shadow-sm opacity-100"
                  : "border-white/5 bg-white/5 text-slate-400 opacity-40"
              }`}
              aria-label="Show menu"
            >
              ⟩
            </button>
            <div
              className="h-24 w-6 cursor-pointer"
              role="button"
              tabIndex={0}
              aria-label="Show menu"
              onFocus={() => setSideNavHidden(false)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSideNavHidden(false);
                }
              }}
            />
          </div>
        )}
        <div className={`flex h-screen overflow-hidden ${sideNavHidden ? "gap-0" : "gap-1"}`}>
          <aside
            aria-hidden={sideNavHidden}
            inert={sideNavHidden ? "" : undefined}
            onMouseEnter={openSideNav}
            onMouseLeave={() => {
              if (!sideNavPinned) closeSideNav();
            }}
            className={`dashboard-sidenav sticky top-0 flex h-screen flex-none flex-col gap-3 overflow-hidden p-2 transition-[width] duration-200 ${sideNavWidthClass} ${
              sideNavHidden
                ? "pointer-events-none overflow-hidden p-0 opacity-0"
                : ""
            } ${lightThemeActive ? "bg-slate-50/90" : ""}`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center">
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="flex h-[40px] w-[180px] flex-none shrink-0 items-center justify-center rounded-xl bg-transparent pl-[5px]"
                  aria-label="SmartConnect4u"
                >
                  <img
                    src={lightThemeActive ? "/media/SC_logo_light1.png" : "/media/SC_logo_dark1.png"}
                    alt="SmartConnect4u"
                    className="h-full w-full shrink-0 object-contain"
                  />
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSideNavPinned((prev) => !prev);
                  if (!sideNavPinned) openSideNav();
                }}
                className={`flex h-8 w-8 flex-none shrink-0 items-center justify-center rounded-full text-xs transition ${
                  sideNavPinned
                    ? "bg-white/10 text-indigo-100"
                    : "text-slate-300 hover:bg-white/10 hover:text-white"
                } ${sideNavContentVisible ? "opacity-100" : "pointer-events-none opacity-0"}`}
                aria-label={sideNavPinned ? "Unpin menu" : "Pin menu"}
              >
                {sideNavPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
              </button>
            </div>
            <div className="mt-2 grid gap-3">
              <div className="dashboard-nav-section">
                <p className={`dashboard-nav-heading ${sideNavContentVisible ? "opacity-100" : "opacity-0"}`}>
                  Dashboard
                </p>
                <div className="grid gap-2">
                  {dashboardMenuItems.map((tool) => renderToolButton(tool))}
                </div>
              </div>
              <div className="dashboard-nav-section">
                <p className={`dashboard-nav-heading ${sideNavContentVisible ? "opacity-100" : "opacity-0"}`}>
                  Tools
                </p>
                <div className="grid gap-2">
                  {toolTabs.map((tool) => renderToolButton(tool))}
                </div>
              </div>
            </div>
            {showResumeBusinessAction && (
              <button
                type="button"
                onClick={onResumeBusinessDetails}
                className={`dashboard-cta mt-2 inline-flex items-center justify-center rounded-2xl border border-indigo-400/60 bg-indigo-500/15 px-3 py-2 text-xs font-semibold text-indigo-100 transition hover:-translate-y-0.5 hover:border-indigo-300 hover:bg-indigo-500/25 ${
                  sideNavContentVisible ? "" : "px-0"
                }`}
              >
                {sideNavContentVisible ? "Enter business details" : "Go"}
              </button>
            )}
            <div className="mt-auto border-t border-white/10 pt-3">
              {(() => {
                const settingsActiveClass = lightThemeActive
                  ? "bg-slate-200/80 text-slate-900 shadow-[0_10px_22px_rgba(15,23,42,0.08)]"
                  : "bg-white/15 text-white";
                const settingsBaseClass = sideNavContentVisible
                  ? "text-slate-200 hover:bg-white/10 hover:text-white"
                  : "text-slate-300 hover:bg-white/10 hover:text-white hover:shadow-[0_10px_22px_rgba(79,70,229,0.25)]";
                return (
              <button
                type="button"
                onClick={() => {
                  setActiveTool?.("email_manager");
                  setEmailSubTab("settings");
                }}
                aria-current={settingsActive ? "page" : undefined}
                className={`dashboard-nav-item group flex h-10 w-full items-center gap-0.5 rounded-2xl text-left transition ${settingsBaseClass} ${
                  settingsActive ? settingsActiveClass : ""
                }`}
                data-active={settingsActive}
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/80 via-violet-400/70 to-sky-400/70 shadow-sm">
                  <Settings className="h-[18px] w-[18px] text-white" />
                </span>
                <div
                  className={`min-w-0 transition-opacity ${
                    sideNavContentVisible
                      ? "flex-1 opacity-100"
                      : "max-w-0 overflow-hidden opacity-0"
                  }`}
                >
                  <p className="text-sm font-semibold text-white leading-none whitespace-nowrap">
                    Settings
                  </p>
                </div>
              </button>
                );
              })()}
              {onLogout && (
                <button
                  type="button"
                  onClick={onLogout}
                  className={`dashboard-nav-item dashboard-nav-item--danger group mt-2 flex h-10 w-full items-center gap-0.5 rounded-2xl text-left transition ${
                    sideNavContentVisible
                      ? "text-rose-200 hover:bg-rose-500/10 hover:text-rose-100"
                      : "text-rose-200 hover:bg-rose-500/10 hover:text-rose-100"
                  }`}
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-gradient-to-br from-rose-500/80 via-rose-400/70 to-orange-400/70 shadow-sm">
                    <LogOut className="h-[18px] w-[18px] text-white" />
                  </span>
                  <div
                    className={`min-w-0 transition-opacity ${
                      sideNavContentVisible
                        ? "flex-1 opacity-100"
                        : "max-w-0 overflow-hidden opacity-0"
                    }`}
                  >
                    <p className="text-sm font-semibold leading-none whitespace-nowrap">
                      Logout
                    </p>
                  </div>
                </button>
              )}
            </div>
          </aside>

          <div
            className={`dashboard-main flex h-full min-h-0 flex-1 flex-col ${
              isEmailManager
                ? "dashboard-main--full gap-0 overflow-hidden"
                : "gap-5 overflow-y-auto"
            }`}
          >
            {currentTool !== "email_manager" && currentTool !== "task_manager" && (
            <header className="dashboard-hero flex flex-col gap-3 rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <ActiveIcon className="h-10 w-10 text-indigo-300" />
                  <div>
                    <h1 className="text-3xl font-semibold text-white">
                      {clientData?.business_name || clientData?.name || "Your AI Receptionist"}
                    </h1>
                    <p className="text-sm text-slate-300">
                      {activeToolCopy}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {currentTool === "ai_receptionist" && (
                    <div
                      className={`rounded-2xl border px-4 py-3 text-sm font-semibold shadow ${
                        hasTwilioNumber
                          ? "border-emerald-400/40 bg-emerald-900/40 text-emerald-100"
                          : "border-slate-700/60 bg-slate-900/60 text-slate-100"
                      }`}
                    >
                      <p
                        className={`text-xs uppercase tracking-[0.2em] ${
                          hasTwilioNumber ? "text-emerald-200" : "text-slate-300"
                        }`}
                      >
                        AI Number
                      </p>
                      {hasTwilioNumber ? (
                        <div className="flex items-center gap-2 text-lg">
                          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
                          {aiNumber}
                        </div>
                      ) : (
                        <div className="mt-2 flex flex-col gap-2">
                          <div className="relative text-lg">
                            <span className="select-none blur-[2px]">000 000 0000</span>
                            <span className="absolute inset-0 flex items-center text-xs text-slate-300">
                              Number not assigned
                            </span>
                          </div>
                          {showAssignCta ? (
                            <button
                              type="button"
                              onClick={onAssignNumber}
                              disabled={assignBusy || !onAssignNumber}
                              className="inline-flex items-center justify-center rounded-xl border border-emerald-400/60 bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-100 transition hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {assignBusy ? "Assigning..." : "Assign AI number"}
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400">
                              Activate AI Receptionist to assign a number.
                            </span>
                          )}
                          {assignError && (
                            <span className="text-xs text-rose-300">{assignError}</span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              {currentTool === "ai_receptionist" && (
                <div className="flex flex-wrap items-center gap-2">
                  {DASHBOARD_TABS.map((tab) => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab?.(tab.id)}
                        className={`inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-xs font-semibold tracking-tight transition sm:text-sm ${
                          isActive
                            ? "border-indigo-300/80 bg-white/15 text-indigo-50 shadow-[0_12px_24px_rgba(15,23,42,0.35)]"
                            : "border-white/10 bg-white/5 text-slate-200 hover:border-white/30 hover:bg-white/10"
                        }`}
                      >
                        <Icon className={`h-4 w-4 ${isActive ? "text-indigo-100" : "text-slate-300"}`} />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                  <span className="ml-auto text-xs text-slate-400">
                    {subscriptionsLoading
                      ? "Checking access..."
                      : dashboardLoading
                        ? "Syncing data..."
                        : activeToolLocked
                          ? "Locked"
                          : "Live"}
                  </span>
                </div>
              )}
            </header>
            )}

        {currentTool === "dashboard_analytics" && (
          <div className="dashboard-analytics">
            <div className="dashboard-analytics-header">
              <div>
                <p className="dashboard-analytics-eyebrow">Performance overview</p>
                <h2 className="dashboard-analytics-title">Dashboard analytics</h2>
                <p className="dashboard-analytics-subtitle">
                  Track outcomes across AI Receptionist, Email Manager, and Social Media Manager.
                </p>
                {dashboardAnalyticsMessage ? (
                  <p
                    className={`mt-2 text-xs ${
                      dashboardAnalyticsStatus.status === "error"
                        ? "text-rose-300"
                        : "text-slate-400"
                    }`}
                  >
                    {dashboardAnalyticsMessage}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="analytics-tabs">
              {analyticsTabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = analyticsTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setAnalyticsTab(tab.id)}
                    className={`analytics-tab ${isActive ? "is-active" : ""}`}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="dashboard-analytics-body">
              {analyticsTab === "ai_receptionist" && aiReceptionistDashboardPanel}
              {analyticsTab === "email_manager" && (
                <>
                  <section className="analytics-grid">
                    <div className="analytics-card analytics-card--purple">
                      <div className="analytics-card-head">
                        <MailOpen className="h-5 w-5" />
                        <span>Summaries generated</span>
                      </div>
                      <div className="analytics-card-value">{emailSummaryCount}</div>
                      <p className="analytics-card-meta">Auto summaries and manual refreshes.</p>
                    </div>
                    <div className="analytics-card analytics-card--emerald">
                      <div className="analytics-card-head">
                        <Users className="h-5 w-5" />
                        <span>Leads identified</span>
                      </div>
                      <div className="analytics-card-value">{emailLeadCount}</div>
                      <p className="analytics-card-meta">Tagged as lead, demo, or pricing.</p>
                    </div>
                    <div className="analytics-card analytics-card--blue">
                      <div className="analytics-card-head">
                        <ClipboardList className="h-5 w-5" />
                        <span>Action items extracted</span>
                      </div>
                      <div className="analytics-card-value">{emailActionCount}</div>
                      <p className="analytics-card-meta">Checklist items from AI extraction.</p>
                    </div>
                    <div className="analytics-card analytics-card--amber">
                      <div className="analytics-card-head">
                        <Sparkles className="h-5 w-5" />
                        <span>Draft replies created</span>
                      </div>
                      <div className="analytics-card-value">{emailDraftCount}</div>
                      <p className="analytics-card-meta">AI reply variants generated.</p>
                    </div>
                    <div className="analytics-card analytics-card--indigo">
                      <div className="analytics-card-head">
                        <Inbox className="h-5 w-5" />
                        <span>Inbox loaded</span>
                      </div>
                      <div className="analytics-card-value">{emailMessages.length}</div>
                      <p className="analytics-card-meta">Messages synced in the inbox.</p>
                    </div>
                    <div className="analytics-card analytics-card--rose">
                      <div className="analytics-card-head">
                        <AlertTriangle className="h-5 w-5" />
                        <span>Unread in view</span>
                      </div>
                      <div className="analytics-card-value">{emailUnreadCount}</div>
                      <p className="analytics-card-meta">Unread messages in current sync.</p>
                    </div>
                  </section>
                  <section className="analytics-split">
                    <div className="analytics-card analytics-card--glass">
                      <div className="analytics-card-head">
                        <Tag className="h-5 w-5" />
                        <span>Top tags</span>
                      </div>
                      {emailTopTags.length ? (
                        <div className="analytics-tag-list">
                          {emailTopTags.map(([tag, count]) => (
                            <span key={tag} className="analytics-tag">
                              {tag} <span>{count}</span>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="analytics-card-meta">No tags extracted yet.</p>
                      )}
                    </div>
                    <div className="analytics-card analytics-card--glass">
                      <div className="analytics-card-head">
                        <Activity className="h-5 w-5" />
                        <span>Automation status</span>
                      </div>
                      <div className="analytics-status-grid">
                        <div>
                          <p>Auto summarize</p>
                          <strong>{emailAutoSummarize ? "On" : "Off"}</strong>
                        </div>
                        <div>
                          <p>Unread filter</p>
                          <strong>{emailUnreadOnly ? "On" : "Off"}</strong>
                        </div>
                        <div>
                          <p>Mailbox</p>
                          <strong>{activeMailboxLabel || "Inbox"}</strong>
                        </div>
                      </div>
                    </div>
                  </section>
                </>
              )}
              {analyticsTab === "social_media_manager" && (
                <>
                  <section className="analytics-grid">
                    <div className="analytics-card analytics-card--purple">
                      <div className="analytics-card-head">
                        <Plug className="h-5 w-5" />
                        <span>Connected channels</span>
                      </div>
                      <div className="analytics-card-value">{socialConnectionsCount}</div>
                      <p className="analytics-card-meta">Active social integrations.</p>
                    </div>
                    <div className="analytics-card analytics-card--blue">
                      <div className="analytics-card-head">
                        <MessageSquare className="h-5 w-5" />
                        <span>Active conversations</span>
                      </div>
                      <div className="analytics-card-value">{socialConversationsCount}</div>
                      <p className="analytics-card-meta">Conversations synced in inbox.</p>
                    </div>
                    <div className="analytics-card analytics-card--emerald">
                      <div className="analytics-card-head">
                        <Users className="h-5 w-5" />
                        <span>Lead signals</span>
                      </div>
                      <div className="analytics-card-value">{socialLeadCount}</div>
                      <p className="analytics-card-meta">Messages flagged as inquiries.</p>
                    </div>
                    <div className="analytics-card analytics-card--amber">
                      <div className="analytics-card-head">
                        <Edit3 className="h-5 w-5" />
                        <span>Draft posts</span>
                      </div>
                      <div className="analytics-card-value">{socialDraftCount}</div>
                      <p className="analytics-card-meta">Content drafts ready to publish.</p>
                    </div>
                    <div className="analytics-card analytics-card--indigo">
                      <div className="analytics-card-head">
                        <CalendarClock className="h-5 w-5" />
                        <span>Scheduled posts</span>
                      </div>
                      <div className="analytics-card-value">{socialScheduledCount}</div>
                      <p className="analytics-card-meta">Upcoming scheduled content.</p>
                    </div>
                    <div className="analytics-card analytics-card--rose">
                      <div className="analytics-card-head">
                        <ClipboardList className="h-5 w-5" />
                        <span>Tasks created</span>
                      </div>
                      <div className="analytics-card-value">{socialTaskCount}</div>
                      <p className="analytics-card-meta">Tasks spawned from social threads.</p>
                    </div>
                  </section>
                  <section className="analytics-split">
                    <div className="analytics-card analytics-card--glass">
                      <div className="analytics-card-head">
                        <Megaphone className="h-5 w-5" />
                        <span>Publishing pipeline</span>
                      </div>
                      <div className="analytics-status-grid">
                        <div>
                          <p>Drafts</p>
                          <strong>{socialDraftCount}</strong>
                        </div>
                        <div>
                          <p>Scheduled</p>
                          <strong>{socialScheduledCount}</strong>
                        </div>
                        <div>
                          <p>Replies sent</p>
                          <strong>{socialMessagesOutboundCount}</strong>
                        </div>
                      </div>
                    </div>
                    <div className="analytics-card analytics-card--glass">
                      <div className="analytics-card-head">
                        <Sparkles className="h-5 w-5" />
                        <span>Automation coverage</span>
                      </div>
                      <p className="analytics-card-meta">
                        Automations track replies, lead signals, and scheduled content. Connect more
                        channels to increase coverage.
                      </p>
                    </div>
                  </section>
                </>
              )}
            </div>
          </div>
        )}

        {currentTool === "task_manager" && (
          <TaskManagerScreen
            email={user?.email}
            businessName={clientData?.business_name || clientData?.name}
          />
        )}

        {currentTool === "contacts" && (
          <ToolGate
            locked={activeToolLocked}
            loading={subscriptionsLoading}
            message="Subscribe to Contacts to sync and manage your directory."
          >
            <ContactsScreen
              email={user?.email}
              onConnectGoogle={beginGoogleLogin}
              googleConnected={googleContactsConnected}
              googleAccountEmail={calendarAccountEmail}
            />
          </ToolGate>
        )}

        {currentTool === "ai_receptionist" && (
          <ToolGate
            locked={activeToolLocked}
            loading={subscriptionsLoading}
            message="Purchase the AI Receptionist to unlock live calls, agents, and integrations."
          >
            <div className="relative">
              <div className={showNumberGate ? "pointer-events-none blur-[2px] opacity-60 transition" : "transition"}>
        {activeTab === "agents" && (
          <section className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-xl backdrop-blur">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-indigo-200">Agent control</p>
                <h3 className="text-xl font-semibold text-white">AI Receptionist</h3>
                <p className="text-sm text-slate-300">
                  Edit prompt, choose a voice, and tune the temperature for your live agent.
                </p>
              </div>
              <button
                type="button"
                onClick={onRefreshDashboard}
                className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:border-white/40 hover:bg-white/20"
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </button>
            </div>
            <div className="grid gap-3">
              <label className="text-sm text-slate-200">Voice</label>
              <div className="flex flex-wrap items-center gap-3">
                <select
                  value={voiceLanguageFilter}
                  onChange={(e) => setVoiceLanguageFilter(e.target.value)}
                  className="w-full min-w-[180px] rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40 sm:w-auto"
                >
                  <option value="all">All languages</option>
                  {voiceLanguageOptions.map((lang) => (
                    <option key={lang} value={lang}>
                      {formatLanguageLabel(lang)}
                    </option>
                  ))}
                </select>
                <select
                  value={primaryVoice || ""}
                  onChange={(e) => setAgentDetails({ ...agentDetails, voice: e.target.value })}
                  className="w-full min-w-[220px] rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40 sm:w-auto"
                  disabled={ultravoxVoicesLoading}
                >
                  <option value="">Select a voice</option>
                  {filteredVoiceOptions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} {v.locale ? `• ${v.locale}` : ""} {v.gender ? `(${v.gender})` : ""}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-slate-400">
                  {ultravoxVoicesLoading
                    ? "Loading S4U-v3 voices..."
                    : `${filteredVoiceOptions.length} voices available`}
                </span>
                {selectedVoice?.sampleUrl ? (
                  <button
                    type="button"
                    onClick={handleVoiceSampleToggle}
                    className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:border-white/30 hover:bg-white/10"
                  >
                    {voiceSamplePlaying ? "Pause sample" : "Play sample"}
                    {voiceSamplePlaying ? (
                      <Pause className="h-3 w-3" />
                    ) : (
                      <Play className="h-3 w-3" />
                    )}
                  </button>
                ) : null}
              </div>
              {selectedVoice?.sampleUrl ? (
                <audio ref={voiceSampleRef} preload="none" src={selectedVoice.sampleUrl} className="hidden">
                  Your browser does not support audio playback.
                </audio>
              ) : null}

              <div className="grid gap-3 rounded-2xl border border-white/10 bg-slate-900/40 p-3 md:grid-cols-2">
                <div>
                  <p className="text-sm text-slate-200">Temperature</p>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={agentDetails.temperature ?? 0.4}
                    onChange={(e) =>
                      setAgentDetails({ ...agentDetails, temperature: Number(e.target.value) })
                    }
                    className="w-full accent-indigo-400"
                  />
                  <p className="text-xs text-slate-400">
                    Lower = concise, higher = more creative ({agentDetails.temperature ?? 0.4})
                  </p>
                </div>
                <div className="grid gap-2">
                  <label className="text-sm text-slate-200">Quick greeting</label>
                  <input
                    type="text"
                    value={agentDetails.greeting || ""}
                    onChange={(e) => setAgentDetails({ ...agentDetails, greeting: e.target.value })}
                    className="rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
                  />
                  <label className="text-sm text-slate-200">Escalation rule</label>
                  <input
                    type="text"
                    value={agentDetails.escalation || ""}
                    onChange={(e) =>
                      setAgentDetails({ ...agentDetails, escalation: e.target.value })
                    }
                    className="rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => onAgentSave?.(agentDetails)}
                  disabled={agentSaveStatus?.status === "loading"}
                  className="inline-flex items-center gap-2 rounded-xl border border-indigo-300/60 bg-indigo-500/20 px-4 py-2 text-sm font-semibold text-indigo-50 transition hover:-translate-y-0.5 hover:border-indigo-200 hover:bg-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Edit3 className="h-4 w-4" />
                  Save agent
                </button>
                <button
                  type="button"
                  onClick={onRefreshDashboard}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/20"
                >
                  Reset changes
                </button>
                {agentSaveStatus?.message && (
                  <span
                    className={`text-xs ${
                      agentSaveStatus.status === "error" ? "text-rose-300" : "text-emerald-200"
                    }`}
                  >
                    {agentSaveStatus.message}
                  </span>
                )}
              </div>
            </div>
          </section>
        )}

        {activeTab === "business" && (
          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-xl backdrop-blur">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-indigo-200">Business</p>
                  <h4 className="text-lg font-semibold text-white">Business profile</h4>
                </div>
              </div>
              <div className="grid gap-3">
                <div className="grid gap-1">
                  <label className="text-xs uppercase tracking-[0.2em] text-slate-400">Business name</label>
                  <input
                    type="text"
                    value={businessForm.name}
                    onChange={(e) => setBusinessForm({ ...businessForm, name: e.target.value })}
                    placeholder="Business name"
                    readOnly={!isBusinessEditing}
                    className={`rounded-xl border border-white/10 px-3 py-2 text-sm outline-none transition ${
                      isBusinessEditing
                        ? "bg-slate-900/60 text-slate-100 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
                        : "bg-slate-900/40 text-slate-200"
                    }`}
                  />
                </div>
                <div className="grid gap-1">
                  <label className="text-xs uppercase tracking-[0.2em] text-slate-400">Business phone</label>
                  <input
                    type="tel"
                    value={businessForm.phone}
                    onChange={(e) => setBusinessForm({ ...businessForm, phone: e.target.value })}
                    placeholder="Business phone"
                    readOnly={!isBusinessEditing}
                    className={`rounded-xl border border-white/10 px-3 py-2 text-sm outline-none transition ${
                      isBusinessEditing
                        ? "bg-slate-900/60 text-slate-100 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
                        : "bg-slate-900/40 text-slate-200"
                    }`}
                  />
                </div>
                <div className="grid gap-1">
                  <label className="text-xs uppercase tracking-[0.2em] text-slate-400">Website URL</label>
                  <input
                    type="url"
                    value={businessForm.website}
                    onChange={(e) => setBusinessForm({ ...businessForm, website: e.target.value })}
                    placeholder="Website URL"
                    readOnly={!isBusinessEditing}
                    className={`rounded-xl border border-white/10 px-3 py-2 text-sm outline-none transition ${
                      isBusinessEditing
                        ? "bg-slate-900/60 text-slate-100 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
                        : "bg-slate-900/40 text-slate-200"
                    }`}
                  />
                </div>
                <div className="flex items-center gap-2">
                  {isBusinessEditing ? (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          onBusinessSave?.({
                            businessName: businessForm.name,
                            businessPhone: businessForm.phone,
                            websiteUrl: businessForm.website
                          })
                        }
                        className="inline-flex items-center gap-2 rounded-xl border border-emerald-300/60 bg-emerald-500/20 px-3 py-2 text-xs font-semibold text-emerald-50 transition hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-emerald-500/30"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Save business
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setBusinessForm({
                            name: clientData?.business_name || clientData?.name || "",
                            phone: clientData?.business_phone || "",
                            website: clientData?.website_url || ""
                          });
                          setIsBusinessEditing(false);
                        }}
                        className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/20"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setIsBusinessEditing(true)}
                      className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/20"
                    >
                      Edit business
                    </button>
                  )}
                  {businessSaveStatus?.message && (
                    <span
                      className={`text-xs ${
                        businessSaveStatus.status === "error"
                          ? "text-rose-300"
                          : "text-emerald-200"
                      }`}
                    >
                      {businessSaveStatus.message}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {activeTab === "tasks" && TASKS_ENABLED && (
          <TaskBoard
            email={user?.email}
            businessName={clientData?.business_name || clientData?.name}
            liveEnabled={TASKS_LIVE_ENABLED}
          />
        )}

        {activeTab === "calls" && (
          <section className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-2xl backdrop-blur">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-indigo-200">Calls</p>
                <h4 className="text-lg font-semibold text-white">Live calls & transcripts</h4>
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <select
                  value={dateRange}
                  onChange={(e) => {
                    const range = dateRanges.find((r) => r.label === e.target.value);
                    onRangeChange?.(range || dateRanges[0]);
                  }}
                  className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs text-slate-100 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
                >
                  {dateRanges.map((r) => (
                    <option key={r.label} value={r.label}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => onRefreshCalls?.()}
                  className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-semibold text-white transition hover:border-white/30 hover:bg-white/20"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Refresh
                </button>
              </div>
            </div>
            <div className="grid gap-3">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
                Streaming transcripts from Twilio + S4U-v3 (polling on select)
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="space-y-2">
                  {pagedCalls.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-slate-900/40 p-4 text-sm text-slate-300">
                      No calls yet — inbound and outbound calls will appear here.
                    </div>
                  ) : (
                    pagedCalls.map((call) => {
                      const isActive = selectedCall?.sid === call.sid;
                      const fromLabel =
                        call.caller_number ||
                        call.from ||
                        call.from_display ||
                        call.from_raw ||
                        call.from_number ||
                        "Unknown";
                      const startLabel = call.start_time || call.started_at || call.startTime || null;
                      const endLabel =
                        call.end_time ||
                        call.ended_at ||
                        call.endTime ||
                        call.endedAt ||
                        null;
                      return (
                        <button
                          key={call.sid}
                          className={`w-full rounded-2xl border p-3 text-left transition hover:-translate-y-0.5 ${
                            isActive
                              ? "border-indigo-300/70 bg-indigo-500/15 text-indigo-50"
                              : "border-white/10 bg-slate-900/50 text-slate-100 hover:border-white/25"
                          }`}
                          onClick={() => setSelectedCall(call)}
                        >
                          <div className="flex items-start justify-between text-sm font-semibold">
                            <span>{fromLabel}</span>
                            <div className="text-right text-xs text-slate-300">
                              <div>Start {formatDate(startLabel)}</div>
                              <div>End {formatDate(endLabel)}</div>
                            </div>
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-xs text-slate-300">
                            <PhoneCall className="h-3.5 w-3.5" />
                            <span>{call.direction || "—"}</span>
                            <span className="h-1 w-1 rounded-full bg-white/40" />
                            <span>{call.status || "—"}</span>
                            <span className="h-1 w-1 rounded-full bg-white/40" />
                            <span>{formatDuration(call.duration)}</span>
                          </div>
                        </button>
                      );
                    })
                  )}
                  {recentCalls.length > pageSize && (
                    <div className="flex items-center justify-between text-xs text-slate-300">
                      <button
                        className="rounded-lg border border-white/10 bg-white/10 px-2 py-1 text-xs text-white disabled:opacity-50"
                        disabled={safePage <= 1}
                        onClick={() => setCallsPage(safePage - 1)}
                      >
                        Prev
                      </button>
                      <span>
                        Page {safePage} of {totalPages}
                      </span>
                      <button
                        className="rounded-lg border border-white/10 bg-white/10 px-2 py-1 text-xs text-white disabled:opacity-50"
                        disabled={safePage >= totalPages}
                        onClick={() => setCallsPage(safePage + 1)}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-3 shadow-inner">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-sm font-semibold text-white">Transcript</div>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <button
                        type="button"
                        className="rounded-lg border border-white/10 bg-white/10 px-2 py-1 text-xs text-white transition hover:border-white/30 hover:bg-white/20"
                        onClick={() => {
                          const text = callTranscript?.transcript
                            || (callTranscript?.messages || [])
                              .map((m) => `${m.role || "system"}: ${m.text || ""}`)
                              .join("\n")
                            || "";
                          if (text) navigator.clipboard?.writeText(text);
                        }}
                      >
                        Copy
                      </button>
                      <span>{callTranscript?.recordings?.length || 0} recording(s)</span>
                    </div>
                  </div>
                  <div
                    className="transcript-scroll rounded-xl border border-white/5 bg-slate-950/60 p-3 text-sm text-slate-200"
                    data-lenis-prevent
                  >
                    {callTranscript?.loading ? (
                      <p className="text-slate-400">Loading transcript...</p>
                    ) : callTranscript?.error ? (
                      <p className="text-rose-300">{callTranscript.error}</p>
                    ) : (callTranscript?.messages || []).length > 0 ? (
                      callTranscript.messages.map((msg, idx) => (
                        <div key={`${msg.id || msg.ordinal || idx}`} className="mb-2 rounded-lg bg-white/5 p-2">
                          <div className="flex items-center justify-between text-xs text-slate-400">
                            <span>{msg.role || "system"}</span>
                            <span>{formatDate(msg.timestamp)}</span>
                          </div>
                          <p className="text-slate-100">{msg.text || "No text returned"}</p>
                        </div>
                      ))
                    ) : (callTranscript?.transcripts || []).length === 0 ? (
                      <p className="text-slate-400">
                        No transcript available for this call yet. If you record calls with Twilio
                        transcriptions enabled, they will appear here.
                      </p>
                    ) : (
                      callTranscript.transcripts.map((line) => (
                        <div key={line.sid} className="mb-2 rounded-lg bg-white/5 p-2">
                          <div className="flex items-center justify-between text-xs text-slate-400">
                            <span>{line.status || "complete"}</span>
                            <span>{formatDate(line.date_created)}</span>
                          </div>
                          <p className="text-slate-100">{line.text || "No text returned"}</p>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="mt-3 rounded-xl border border-white/10 bg-slate-900/40 p-3">
                    <div className="text-xs font-semibold text-slate-200">Recordings</div>
                    {callTranscript?.recordings?.length ? (
                      <div className="mt-2 space-y-3">
                        {callTranscript.recordings.map((rec, idx) => {
                          const emailParam = user?.email ? encodeURIComponent(user.email) : "";
                          const playbackUrl = emailParam
                            ? `${API_URLS.dashboardRecordingMedia}/${rec.sid}/media?email=${emailParam}`
                            : "";
                          return (
                            <div
                              key={rec.sid || `recording-${idx}`}
                              className="rounded-lg border border-white/10 bg-slate-950/50 p-2"
                            >
                              <div className="flex items-center justify-between text-xs text-slate-400">
                                <span>Recording {idx + 1}</span>
                                <span>
                                  {rec.duration ? `${rec.duration}s` : "—"} · {formatDate(rec.date_created)}
                                </span>
                              </div>
                              {playbackUrl ? (
                                <audio controls preload="none" className="mt-2 w-full">
                                  <source src={playbackUrl} type="audio/mpeg" />
                                </audio>
                              ) : (
                                <p className="mt-2 text-xs text-slate-400">
                                  Recording available once the account email is loaded.
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-slate-400">No recordings available yet.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {activeTab === "integrations" && (
          <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-xl backdrop-blur">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Globe2 className="h-5 w-5 text-indigo-200" />
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-indigo-200">Integrations</p>
                    <h4 className="text-lg font-semibold text-white">Google & Outlook</h4>
                  </div>
                </div>
                <div className="text-xs text-slate-300">
                  {selectedProviderConnected
                    ? `Connected: ${selectedProviderLabel}`
                    : `Selected: ${selectedProviderLabel}`}
                </div>
              </div>
              <div className="grid gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCalendarProvider("google");
                    beginGoogleLogin?.();
                  }}
                  disabled={status === "loading" || calendarLoading}
                  className={`inline-flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/20 disabled:opacity-60 ${
                    selectedCalendarProvider === "google"
                      ? "border-emerald-300/50 bg-emerald-500/15"
                      : "border-white/15 bg-white/10"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <CalendarClock className="h-4 w-4" />
                    Connect Google Calendar
                  </span>
                  {calendarStatus ? <span className="text-emerald-200">Connected</span> : null}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedCalendarProvider("outlook")}
                  className={`inline-flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                    selectedCalendarProvider === "outlook"
                      ? "border-emerald-300/50 bg-emerald-500/15 text-white"
                      : "border-white/10 bg-slate-900/40 text-slate-300"
                  }`}
                >
                  Outlook integration
                  <span className="text-xs text-slate-400">Coming soon</span>
                </button>
                {calendarStatus && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => loadCalendarEvents?.()}
                      className="rounded-lg border border-white/10 bg-white/10 px-3 py-1 text-xs text-white"
                    >
                      Refresh events
                    </button>
                    <button
                      type="button"
                      onClick={() => beginGoogleLogin?.({ force: true })}
                      className="rounded-lg border border-white/10 bg-white/10 px-3 py-1 text-xs text-white"
                    >
                      Force re-connect
                    </button>
                    <button
                      type="button"
                      onClick={handleCalendarDisconnect}
                      className="rounded-lg border border-white/10 bg-white/10 px-3 py-1 text-xs text-white"
                    >
                      Disconnect
                    </button>
                  </div>
                )}
                {calendarAccountEmail ? (
                  <div className="text-xs text-emerald-200">
                    Connected account: {calendarAccountEmail}
                  </div>
                ) : null}
                {calendarDiagnostics ? (
                  <div className="text-[11px] text-slate-400">
                    Calendars: {calendarDiagnostics.calendarListCount || 0} · Selected:{" "}
                    {(calendarDiagnostics.selectedCalendarIds || []).length} · Events:{" "}
                    {Object.values(calendarDiagnostics.perCalendarCounts || {}).reduce(
                      (sum, val) => sum + Number(val || 0),
                      0
                    )}
                  </div>
                ) : null}
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-300">
                  <button
                    type="button"
                    onClick={jumpToNextEvent}
                    className="rounded-lg border border-white/10 bg-white/10 px-2 py-1 text-xs text-white"
                  >
                    Jump to next event
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowHolidayCalendars((prev) => !prev)}
                    className="rounded-lg border border-white/10 bg-white/10 px-2 py-1 text-xs text-white"
                  >
                    {showHolidayCalendars ? "Hide holidays" : "Show holidays"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowBirthdayEvents((prev) => !prev)}
                    className="rounded-lg border border-white/10 bg-white/10 px-2 py-1 text-xs text-white"
                  >
                    {showBirthdayEvents ? "Hide birthdays" : "Show birthdays"}
                  </button>
                </div>
                {calendarError && <div className="text-xs text-rose-300">{calendarError}</div>}
                <div className="mt-2 rounded-2xl border border-white/10 bg-slate-900/40 p-3 text-xs text-slate-300">
                  {selectedCalendarProvider === "google"
                    ? "Google Calendar is selected. Refresh events to keep the week up to date."
                    : "Outlook is selected. Sync is coming soon; switch back to Google to see events."}
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-xl backdrop-blur">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CalendarClock className="h-5 w-5 text-indigo-200" />
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-indigo-200">
                      {selectedProviderLabel} calendar
                    </p>
                    <h4 className="text-lg font-semibold text-white">Weekly schedule</h4>
                  </div>
                </div>
                <div className="text-xs text-slate-300">
                  {selectedProviderConnected ? "Connected" : "Not connected"}
                </div>
              </div>
              {selectedCalendarProvider === "google" && selectedProviderConnected ? (
                <div className="relative rounded-2xl border border-white/10 bg-slate-950/40 p-2">
                  {calendarLoading ? (
                    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl dashboard-modal-backdrop">
                      <InlineLoader label="Loading events..." />
                    </div>
                  ) : null}
                  <div className="calendar-shell" data-lenis-prevent>
                    <FullCalendar
                      key={calendarFocusDate || "today"}
                      ref={calendarRef}
                      plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
                      initialView="timeGridWeek"
                      initialDate={calendarFocusDate || undefined}
                      datesSet={(range) => handleCalendarRangeFetch(range)}
                      eventDisplay="block"
                      eventDidMount={(info) => {
                        info.el.style.opacity = "1";
                        info.el.style.visibility = "visible";
                      }}
                      headerToolbar={{
                        left: "prev,next today",
                        center: "title",
                        right: "dayGridMonth,timeGridWeek,timeGridDay"
                      }}
                      events={visibleCalendarItems}
                      height={520}
                      contentHeight={520}
                      editable={false}
                      selectable={selectedCalendarProvider === "google"}
                      selectMirror
                      nowIndicator
                      scrollTime="09:00:00"
                      slotMinTime="00:00:00"
                      slotMaxTime="24:00:00"
                      businessHours={{
                        startTime: "09:00",
                        endTime: "18:00",
                        daysOfWeek: [1, 2, 3, 4, 5]
                      }}
                      eventClick={(info) => {
                        if (selectedCalendarProvider !== "google") return;
                        openCalendarEdit(info.event.extendedProps?.raw);
                      }}
                      select={(selection) => {
                        if (selectedCalendarProvider !== "google") return;
                        openCalendarCreate(selection.start, selection.end);
                      }}
                      eventTimeFormat={{
                        hour: "numeric",
                        minute: "2-digit",
                        meridiem: "short"
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4 text-sm text-slate-300">
                  {selectedCalendarProvider === "google"
                    ? "Connect Google Calendar to view and manage your schedule."
                    : "Outlook calendar sync is not enabled yet. Switch to Google to view events."}
                </div>
              )}
            </div>
          </section>
        )}
              </div>
              {showNumberGate && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="max-w-md rounded-3xl border border-white/10 bg-slate-950/90 px-6 py-5 text-center shadow-2xl">
                    <p className="text-sm font-semibold text-white">Assign your AI number</p>
                    <p className="mt-1 text-xs text-slate-300">
                      We need a Twilio number before calls and agents can go live.
                    </p>
                    {showAssignCta && (
                      <button
                        type="button"
                        onClick={onAssignNumber}
                        disabled={assignBusy || !onAssignNumber}
                        className="mt-3 inline-flex items-center justify-center rounded-xl border border-emerald-400/60 bg-emerald-500/20 px-4 py-2 text-xs font-semibold text-emerald-100 transition hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {assignBusy ? "Assigning..." : "Assign AI number"}
                      </button>
                    )}
                    {assignError && (
                      <p className="mt-2 text-xs text-rose-300">{assignError}</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </ToolGate>
        )}

        {currentTool === "email_manager" && (
          <ToolGate
            locked={activeToolLocked}
            loading={subscriptionsLoading}
            message="Subscribe to the Email Manager to unlock inbox automation."
            className="flex-1 min-h-0"
          >
            <div
              className={`email-manager-shell min-h-screen sm:h-full sm:min-h-0 ${lightThemeActive ? "email-theme-light" : ""}`}
            >
              <div className="relative grid gap-4 sm:h-full sm:min-h-0 sm:grid-rows-[auto,1fr] sm:overflow-hidden">
              <section
                className={`grid gap-4 transition-[grid-template-columns] duration-200 ease-out sm:h-full sm:min-h-0 sm:overflow-hidden ${
                  showEmailSidePanel
                    ? emailSubTab === "email"
                      ? emailPanelOpen
                        ? "lg:grid-cols-[180px_1.25fr_1.6fr]"
                        : "lg:grid-cols-[64px_1.41fr_1.6fr]"
                      : emailPanelOpen
                        ? "lg:grid-cols-[180px_1.55fr]"
                        : "lg:grid-cols-[64px_1.84fr]"
                    : "lg:grid-cols-1"
                }`}
              >
                {showEmailSidePanel && (
                <aside
                  className="rounded-3xl border border-white/10 bg-white/5 shadow-xl backdrop-blur overflow-hidden flex flex-col p-3 sm:p-4 sm:min-h-0 sm:h-full"
                >
                  <div className="flex min-h-[32px] items-center justify-between gap-2">
                    <span
                      className={`text-[11px] font-semibold uppercase tracking-[0.24em] text-indigo-300 transition-[max-width,opacity] duration-300 ease-out ${
                        emailPanelContentVisible && gmailConnected
                          ? "max-w-[140px] opacity-100"
                          : "max-w-0 overflow-hidden opacity-0"
                      }`}
                    >
                      {inboxProviderLabel}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (emailPanelOpen) {
                          closeEmailPanel();
                        } else {
                          openEmailPanel();
                        }
                      }}
                      className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-white/10 bg-white/5 text-sm text-slate-200 transition hover:border-white/30"
                      aria-label={emailPanelOpen ? "Collapse inbox panel" : "Expand inbox panel"}
                    >
                      {emailPanelOpen ? "⟨" : "⟩"}
                    </button>
                  </div>

                  {emailSubTab === "email" ? (
                    <div className="mt-4 border-t border-white/10 pt-4">
                      <div className={`mt-2 grid gap-1 ${emailPanelOpen ? "" : "justify-items-center"}`}>
                        <button
                          type="button"
                          onClick={() => openComposer("new")}
                          className="flex h-10 w-full items-center gap-2 rounded-xl px-2 text-xs font-semibold text-emerald-100 transition hover:bg-white/10 hover:text-emerald-200"
                          aria-label="New mail"
                        >
                          <span className="flex h-7 w-7 items-center justify-center">
                            <MailPlus className="h-4 w-4" />
                          </span>
                          <span
                            className={`whitespace-nowrap transition-[max-width,opacity] duration-300 ease-out ${
                              emailPanelContentVisible
                                ? "max-w-[140px] opacity-100"
                                : "max-w-0 overflow-hidden opacity-0"
                            }`}
                          >
                            New mail
                          </span>
                        </button>
                        {mailboxItems.map((item) => {
                          const Icon = item.icon;
                          const isActive = emailMailbox === item.id;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => handleMailboxSelect(item.id)}
                              className={`flex h-10 w-full items-center gap-2 rounded-xl px-2 text-xs transition ${
                                isActive
                                  ? lightThemeActive
                                    ? "bg-slate-200/80 text-slate-900 shadow-[0_10px_22px_rgba(15,23,42,0.08)]"
                                    : "bg-white/15 text-white"
                                  : "text-slate-200 hover:bg-white/10 hover:text-white"
                              }`}
                              aria-label={item.label}
                              title={item.label}
                            >
                              <span className="flex h-7 w-7 items-center justify-center">
                                <Icon
                                  className={`h-4 w-4 ${
                                    isActive
                                      ? lightThemeActive
                                        ? "text-slate-900"
                                        : "text-indigo-100"
                                      : lightThemeActive
                                        ? "text-slate-700"
                                        : "text-slate-200"
                                  }`}
                                />
                              </span>
                              <span
                                className={`whitespace-nowrap transition-[max-width,opacity] duration-300 ease-out ${
                                  emailPanelContentVisible
                                    ? "max-w-[140px] opacity-100"
                                    : "max-w-0 overflow-hidden opacity-0"
                                }`}
                              >
                                {item.label}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </aside>
                )}

                {emailSubTab === "email" ? (
                  <div className="contents">
                    <div className="rounded-3xl border border-white/10 bg-white/5 p-3 shadow-xl backdrop-blur flex flex-col overflow-hidden sm:min-h-0 sm:h-full sm:p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-xs uppercase tracking-[0.24em] text-indigo-200">Inbox</p>
                        <h4 className="text-lg font-semibold text-white">{activeMailboxLabel}</h4>
                        <p className="text-xs text-slate-400">
                          {emailMessages.length
                            ? `${emailMessages.length} message${emailMessages.length === 1 ? "" : "s"}`
                            : "No messages"}
                          {emailHasNext ? " · scroll to load more" : ""}
                        </p>
                      </div>
                      <div className="flex w-full flex-wrap items-center justify-between gap-3 text-xs text-slate-300 sm:w-auto sm:justify-end">
                        <button
                          type="button"
                          onClick={handleEmailRefresh}
                          className={`rounded-lg border p-2 ${emailActionButtonClass}`}
                          aria-label="Refresh inbox"
                        >
                          <RefreshCw className="h-4 w-4" />
                        </button>
                        <div className="flex items-center gap-2">
                          <span>Unread</span>
                          <button
                            type="button"
                            onClick={handleUnreadToggle}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${
                              emailUnreadOnly ? "bg-emerald-400" : "bg-white/10"
                            }`}
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                                emailUnreadOnly ? "translate-x-4" : "translate-x-1"
                              }`}
                            />
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-nowrap items-center gap-2 overflow-x-auto rounded-xl border border-white/10 bg-slate-900/40 px-2 py-2 text-xs text-slate-200 sm:flex-wrap sm:overflow-visible">
                      <label className="flex shrink-0 items-center gap-2">
                        <input
                          type="checkbox"
                          checked={emailAllSelected}
                          onChange={toggleEmailSelectAll}
                          className="h-4 w-4 rounded border border-white/20 bg-transparent text-indigo-400"
                          aria-label="Select all messages"
                        />
                      </label>
                      <div className="hidden h-5 w-px shrink-0 bg-white/10 sm:block" />
                      <button
                        type="button"
                        onClick={() =>
                          runEmailModify({
                            removeLabelIds: ["INBOX"],
                            successMessage: "Archived selected messages."
                          })
                        }
                        disabled={!emailSelectionCount || emailActionLoading}
                        className={`shrink-0 rounded-lg border p-2 disabled:cursor-not-allowed disabled:opacity-50 ${emailActionButtonClass}`}
                        aria-label="Archive"
                        title="Archive"
                      >
                        <Archive className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          runEmailModify({
                            addLabelIds: ["SPAM"],
                            removeLabelIds: ["INBOX"],
                            successMessage: "Reported as spam."
                          })
                        }
                        disabled={!emailSelectionCount || emailActionLoading}
                        className={`shrink-0 rounded-lg border p-2 disabled:cursor-not-allowed disabled:opacity-50 ${emailActionButtonClass}`}
                        aria-label="Report spam"
                        title="Report spam"
                      >
                        <AlertTriangle className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          runEmailBulkAction({
                            endpoint: API_URLS.emailTrash,
                            successMessage: "Moved to trash."
                          })
                        }
                        disabled={!emailSelectionCount || emailActionLoading}
                        className={`shrink-0 rounded-lg border p-2 disabled:cursor-not-allowed disabled:opacity-50 ${emailActionButtonClass}`}
                        aria-label="Delete"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          runEmailModify({
                            removeLabelIds: ["UNREAD"],
                            successMessage: "Marked as read."
                          })
                        }
                        disabled={!emailSelectionCount || emailActionLoading}
                        className={`shrink-0 rounded-lg border p-2 disabled:cursor-not-allowed disabled:opacity-50 ${emailActionButtonClass}`}
                        aria-label="Mark as read"
                        title="Mark as read"
                      >
                        <MailOpen className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          runEmailModify({
                            addLabelIds: ["UNREAD"],
                            successMessage: "Marked as unread."
                          })
                        }
                        disabled={!emailSelectionCount || emailActionLoading}
                        className={`shrink-0 rounded-lg border p-2 disabled:cursor-not-allowed disabled:opacity-50 ${emailActionButtonClass}`}
                        aria-label="Mark as unread"
                        title="Mark as unread"
                      >
                        <Mail className="h-4 w-4" />
                      </button>
                      <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                        <div className="flex shrink-0 items-center gap-1 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5">
                          <Tag className="h-3 w-3 text-slate-300" />
                          <select
                            value={emailLabelAction}
                            onChange={(event) => {
                              const value = event.target.value;
                              setEmailLabelAction("");
                              if (!value) return;
                              runEmailModify({
                                addLabelIds: [value],
                                successMessage: "Label applied."
                              });
                            }}
                            disabled={!emailSelectionCount || emailActionLoading}
                            className="bg-transparent text-[10px] text-slate-200 focus:outline-none"
                          >
                            <option value="">Label</option>
                            {gmailLabelOptions.map((label) => (
                              <option key={label.id} value={label.id}>
                                {label.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex shrink-0 items-center gap-1 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5">
                          <Archive className="h-3 w-3 text-slate-300" />
                          <select
                            value={emailMoveAction}
                            onChange={(event) => {
                              const value = event.target.value;
                              setEmailMoveAction("");
                              if (!value) return;
                              const removeLabels =
                                emailMailbox && emailMailbox !== "ALL_MAIL" ? [emailMailbox] : [];
                              runEmailModify({
                                addLabelIds: [value],
                                removeLabelIds: removeLabels,
                                successMessage: "Moved to mailbox."
                              });
                            }}
                            disabled={!emailSelectionCount || emailActionLoading}
                            className="bg-transparent text-[10px] text-slate-200 focus:outline-none"
                          >
                            <option value="">Move to</option>
                            {gmailLabelOptions.map((label) => (
                              <option key={label.id} value={label.id}>
                                {label.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                    {emailActionError ? (
                      <div className="mt-2 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                        {emailActionError}
                      </div>
                    ) : null}
                    {emailActionSuccess ? (
                      <div className="mt-2 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                        {emailActionSuccess}
                      </div>
                    ) : null}
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        type="text"
                        value={emailQuery}
                        onChange={(event) => setEmailQuery(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") handleEmailSearch();
                        }}
                        placeholder="Search inbox (e.g. from:client subject:invoice)"
                        className="w-full rounded-xl border border-white/10 bg-slate-900/50 px-3 py-2 text-xs text-white placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none sm:min-w-[220px] sm:flex-1"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="flex shrink-0 items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1">
                          <Tag className="h-3 w-3 text-slate-300" />
                          <select
                            value={emailTagFilter}
                            onChange={(event) => setEmailTagFilter(event.target.value)}
                            className="bg-transparent text-[10px] text-slate-200 focus:outline-none"
                          >
                            <option value="all">All tags</option>
                            {EMAIL_TAG_OPTIONS.map((tag) => (
                              <option key={tag} value={tag}>
                                {tag}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex shrink-0 items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1">
                          <span className="text-[10px] text-slate-300">Sort</span>
                          <select
                            value={emailSort}
                            onChange={(event) => setEmailSort(event.target.value)}
                            className="bg-transparent text-[10px] text-slate-200 focus:outline-none"
                          >
                            <option value="date">Date</option>
                            <option value="priority">Priority</option>
                          </select>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleEmailSearch}
                        disabled={emailLoading}
                        className="w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60 sm:w-auto"
                      >
                        Search
                      </button>
                    </div>
                    <div
                      className="mt-3 flex-1 min-h-0 space-y-2 overflow-y-auto pr-1 overscroll-contain"
                      data-lenis-prevent
                      onScroll={handleInboxScroll}
                      onWheel={(event) => event.stopPropagation()}
                      onTouchMove={(event) => event.stopPropagation()}
                    >
                      {emailLoading && !emailMessages.length ? (
                        <div className="rounded-xl border border-white/10 bg-slate-900/40 px-3 py-2">
                          <InlineLoader label="Loading inbox..." />
                        </div>
                      ) : emailError && !emailMessages.length ? (
                        <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                          {emailError}
                        </div>
                      ) : filteredEmailMessages.length ? (
                        filteredEmailMessages.map((message) => {
                          const isSelected = selectedEmailMessage?.id === message.id;
                          const isUnread = (message.labelIds || []).includes("UNREAD");
                          const isStarred = (message.labelIds || []).includes("STARRED");
                          const isChecked = emailSelectedIds.has(message.id);
                          const classification = emailClassifications?.[message.id] || {};
                          const tags = Array.isArray(classification.tags) ? classification.tags : [];
                          const priorityLabel = classification.priorityLabel;
                          return (
                            <div
                              key={message.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => {
                                setSelectedEmailMessage(message);
                                markMessageAsRead(message);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  setSelectedEmailMessage(message);
                                  markMessageAsRead(message);
                                }
                              }}
                              className={`w-full rounded-xl border px-3 py-2 text-left transition cursor-pointer ${
                                isSelected
                                  ? "border-indigo-400/50 bg-indigo-500/15"
                                  : "border-white/10 bg-slate-900/40 hover:border-white/30 hover:bg-slate-900/60"
                              }`}
                            >
                              <div className="flex flex-wrap items-start gap-2 sm:flex-nowrap sm:items-center sm:gap-3">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => toggleEmailSelection(message.id)}
                                  onClick={(event) => event.stopPropagation()}
                                  className="h-4 w-4 rounded border border-white/20 bg-transparent text-indigo-400"
                                  aria-label={`Select ${message.subject || "email"}`}
                                />
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    runEmailModify({
                                      messageIds: [message.id],
                                      addLabelIds: isStarred ? [] : ["STARRED"],
                                      removeLabelIds: isStarred ? ["STARRED"] : [],
                                      successMessage: isStarred ? "Star removed." : "Star added.",
                                      clearSelection: false
                                    });
                                  }}
                                  className={`rounded-lg border border-white/10 p-1 text-slate-300 transition hover:text-amber-200 ${
                                    isStarred ? "bg-amber-400/20 text-amber-200" : "bg-white/5"
                                  }`}
                                  aria-label={isStarred ? "Remove star" : "Star email"}
                                >
                                  <Star className="h-3.5 w-3.5" />
                                </button>
                                <span
                                  className={`h-2 w-2 rounded-full ${isUnread ? "bg-emerald-400" : "bg-transparent"} ${
                                    isUnread ? "" : "border border-white/10"
                                  }`}
                                  aria-hidden="true"
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-col">
                                    <span
                                      className={`truncate text-sm ${
                                        isUnread ? "font-semibold text-white" : "text-slate-200"
                                      }`}
                                    >
                                      {message.subject || "No subject"}
                                    </span>
                                    <span className={`truncate text-xs ${isUnread ? "text-slate-300" : "text-slate-500"}`}>
                                      {message.snippet || ""}
                                    </span>
                                    {priorityLabel || tags.length ? (
                                      <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-slate-300">
                                        {priorityLabel ? (
                                          <span
                                            className={`rounded-full border px-2 py-0.5 ${
                                              priorityBadgeStyles[priorityLabel] || priorityBadgeStyles.Normal
                                            }`}
                                          >
                                            {priorityLabel}
                                          </span>
                                        ) : null}
                                        {tags.slice(0, 2).map((tag) => (
                                          <span
                                            key={`${message.id}-${tag}`}
                                            className="rounded-full border border-white/10 bg-slate-900/60 px-2 py-0.5 text-[10px] text-slate-300"
                                          >
                                            {tag}
                                          </span>
                                        ))}
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                                <span className="w-full text-right text-xs text-slate-400 sm:ml-auto sm:w-auto sm:shrink-0 sm:text-left">
                                  {formatInboxTimestamp(message)}
                                </span>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="rounded-xl border border-white/10 bg-slate-900/40 px-3 py-2 text-xs text-slate-300">
                          {gmailConnected
                            ? emailMessages.length && emailTagFilter !== "all"
                              ? "No messages match the selected tag."
                              : "No messages found. Try adjusting your search."
                            : "Connect Gmail to view messages."}
                        </div>
                      )}
                      {emailLoading && emailMessages.length ? (
                        <div className="rounded-xl border border-white/10 bg-slate-900/40 px-3 py-2">
                          <InlineLoader label="Loading more..." />
                        </div>
                      ) : null}
                      {emailError && emailMessages.length ? (
                        <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                          {emailError}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-3xl border border-white/10 bg-white/5 p-3 shadow-xl backdrop-blur overflow-hidden flex flex-col sm:min-h-0 sm:h-full sm:p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-xs uppercase tracking-[0.24em] text-indigo-200">Summary preview</p>
                        <h4 className="text-lg font-semibold text-white">Message detail</h4>
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-white/10 text-[10px] font-semibold text-slate-200">
                            {headerSender ? initialsFromName(headerSender.name) : "—"}
                          </span>
                          <span>{headerSenderLabel}</span>
                        </div>
                      </div>
                      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                        <div className="flex flex-wrap items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-slate-200">
                          <button
                            type="button"
                            onClick={() => summarizeEmailMessage(selectedEmailMessage, { force: true })}
                            disabled={!selectedEmailMessage || emailSummaryLoading}
                            className="rounded-lg border border-white/10 bg-white/10 px-2 py-1 text-[10px] text-white disabled:opacity-50"
                          >
                            Re-summarize
                          </button>
                          <button
                            type="button"
                            onClick={() => requestEmailClassification(selectedEmailMessage, { force: true })}
                            disabled={
                              !selectedEmailMessage ||
                              emailClassifyStatus?.[selectedEmailMessage?.id]?.status === "loading"
                            }
                            className="rounded-lg border border-white/10 bg-white/10 px-2 py-1 text-[10px] text-white disabled:opacity-50"
                          >
                            Reclassify
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              openEmailFeedback(
                                selectedEmailMessage,
                                emailClassifications?.[selectedEmailMessage?.id] || {}
                              )
                            }
                            disabled={!selectedEmailMessage}
                            className="rounded-lg border border-white/10 bg-white/10 px-2 py-1 text-[10px] text-white disabled:opacity-50"
                          >
                            Wrong tag?
                          </button>
                          <button
                            type="button"
                            onClick={() => requestEmailActions(selectedEmailMessage, { force: true })}
                            disabled={
                              !selectedEmailMessage ||
                              emailActionsStatus?.[selectedEmailMessage?.id]?.status === "loading"
                            }
                            className="rounded-lg border border-white/10 bg-white/10 px-2 py-1 text-[10px] text-white disabled:opacity-50"
                          >
                            Extract actions
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReplyWithAi(selectedEmailMessage)}
                            disabled={
                              !selectedEmailMessage ||
                              emailReplyVariantsStatus?.[selectedEmailMessage?.id]?.status === "loading"
                            }
                            className="rounded-lg border border-emerald-300/40 bg-emerald-500/20 px-2 py-1 text-[10px] text-emerald-100 disabled:opacity-50"
                          >
                            Reply with AI
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => openComposer("reply", selectedEmailMessage)}
                          disabled={!selectedEmailMessage}
                          className="rounded-lg border border-white/10 bg-white/10 px-2 py-1 text-xs text-white disabled:opacity-50"
                        >
                          <Reply className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openComposer("forward", selectedEmailMessage)}
                          disabled={!selectedEmailMessage}
                          className="rounded-lg border border-white/10 bg-white/10 px-2 py-1 text-xs text-white disabled:opacity-50"
                        >
                          <SendIcon className="h-3.5 w-3.5" />
                        </button>
                        {!emailSummaryVisible ? (
                          <button
                            type="button"
                            onClick={() => setEmailSummaryVisible(true)}
                            disabled={!selectedEmailMessage}
                            className="rounded-xl border border-white/10 bg-white/10 px-3 py-1 text-xs text-white disabled:opacity-60"
                          >
                            Show summary
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-4 relative flex-1 min-h-0 overflow-hidden">
                      {selectedEmailMessage ? (() => {
                        const sender = parseSender(selectedEmailMessage.from);
                        const messageId = selectedEmailMessage.id;
                        const inlineReplyActive =
                          emailInlineReplyOpen && emailInlineReplyMessageId === messageId;
                        const bodyText =
                          emailMessageBodies[messageId] || selectedEmailMessage.snippet || "";
                        const htmlBody = emailMessageHtml[messageId] || "";
                        const attachments = emailMessageAttachments?.[messageId] || [];
                        const displayAttachments = attachments.filter((item) => {
                          const hasRef = item?.filename || item?.id;
                          if (!hasRef) return false;
                          const mime = String(item?.mimeType || "").toLowerCase();
                          if (item?.isInline && mime.startsWith("image/")) return false;
                          return true;
                        });
                        const classification = emailClassifications?.[messageId] || {};
                        const tags = Array.isArray(classification?.tags) ? classification.tags : [];
                        const classifyStatus = emailClassifyStatus?.[messageId] || { status: "idle", message: "" };
                        const actionsStatus = emailActionsStatus?.[messageId] || { status: "idle", message: "" };
                        const actionItems = emailActionsById?.[messageId] || [];
                        const replyVariantsStatus = emailReplyVariantsStatus?.[messageId] || {
                          status: "idle",
                          message: ""
                        };
                        const replyVariants = emailReplyVariantsById?.[messageId]?.variants || [];
                        const priorityLabel = classification?.priorityLabel || "";
                        const priorityScore = Number(classification?.priorityScore) || 0;
                        const sentiment = classification?.sentiment || "Neutral";
                        const confidence = Number(classification?.confidence) || 0;
                        const reasoningShort = classification?.reasoningShort || "";
                        const isEscalation =
                          ["Concerned"].includes(sentiment) &&
                          (priorityLabel === "Urgent" || priorityScore >= 80);
                        const hasReplyDraft = replyVariants.length > 0;
                        const hasInsights =
                          tags.length > 0 ||
                          Boolean(classification?.priorityLabel) ||
                          Boolean(classification?.priorityScore) ||
                          Boolean(classification?.sentiment) ||
                          Boolean(classification?.confidence) ||
                          Boolean(classification?.reasoningShort);
                        const userEmail = user?.email || userForm.email || "";
                        const fromUser = userEmail && sender.email && sender.email.includes(userEmail);
                        const hasSentLabel = (selectedEmailMessage.labelIds || []).includes("SENT");
                        const showFollowUp = !fromUser && !hasSentLabel;
                        return (
                          <>
                            <div
                              className={`h-full overflow-y-auto pr-1 text-sm text-slate-200 ${
                                emailSummaryVisible ? "pb-44" : "pb-4"
                              }`}
                              data-lenis-prevent
                              onWheel={(event) => event.stopPropagation()}
                              onTouchMove={(event) => event.stopPropagation()}
                            >
                              <div className="grid gap-3">
                                <div className="flex flex-wrap items-start gap-3 sm:flex-nowrap sm:items-center">
                                  <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/10 text-xs font-semibold text-slate-100">
                                    {initialsFromName(sender.name)}
                                  </div>
                                  <div>
                                    <p className="text-sm font-semibold text-white">{sender.name}</p>
                                    <p className="text-xs text-slate-400">
                                      {sender.email || "Unknown sender"}
                                    </p>
                                  </div>
                                  <span className="w-full text-right text-xs text-slate-400 sm:ml-auto sm:w-auto sm:text-left">
                                    {formatMessageTimestamp(selectedEmailMessage)}
                                  </span>
                                </div>
                                <div>
                                  <p className="text-lg font-semibold text-white">
                                    {selectedEmailMessage.subject || "No subject"}
                                  </p>
                                  <p className="text-xs text-slate-400">
                                    To: {selectedEmailMessage.to || "You"}
                                  </p>
                                  {selectedEmailMessage.cc ? (
                                    <p className="text-xs text-slate-400">Cc: {selectedEmailMessage.cc}</p>
                                  ) : null}
                                  {priorityLabel || tags.length ? (
                                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-slate-200">
                                      {priorityLabel ? (
                                        <span
                                          className={`rounded-full border px-2 py-0.5 ${
                                            priorityBadgeStyles[priorityLabel] || priorityBadgeStyles.Normal
                                          }`}
                                        >
                                          {priorityLabel} {priorityScore}/100
                                        </span>
                                      ) : null}
                                      {tags.map((tag) => (
                                        <span
                                          key={`${messageId}-tag-${tag}`}
                                          className="rounded-full border border-white/10 bg-slate-900/60 px-2 py-0.5 text-[10px] text-slate-300"
                                        >
                                          {tag}
                                        </span>
                                      ))}
                                      <span className={`text-[10px] ${sentimentStyles[sentiment] || sentimentStyles.Neutral}`}>
                                        {sentiment}
                                      </span>
                                    </div>
                                  ) : null}
                                </div>
                                <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-3 text-sm text-slate-100">
                                  {emailMessageLoading && !emailMessageBodies[messageId] && !emailMessageHtml[messageId]
                                    ? <InlineLoader label="Loading full email..." />
                                    : emailMessageError
                                      ? emailMessageError
                                      : htmlBody
                                        ? (
                                          <div
                                            className="email-html"
                                            dangerouslySetInnerHTML={{ __html: htmlBody }}
                                          />
                                        )
                                        : (
                                          <div className="whitespace-pre-line">
                                            {bodyText || "No email content available."}
                                          </div>
                                        )}
                                </div>
                                {displayAttachments.length ? (
                                  <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-3 text-xs text-slate-200">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-[11px] uppercase tracking-[0.2em] text-indigo-200">
                                        Attachments
                                      </span>
                                      <span className="text-[11px] text-slate-400">
                                        {displayAttachments.length} file
                                        {displayAttachments.length === 1 ? "" : "s"}
                                      </span>
                                    </div>
                                    <div className="mt-2 grid gap-2">
                                      {displayAttachments.map((attachment) => {
                                        const filename = decodeHtmlEntities(attachment.filename || "attachment");
                                        const sizeLabel = formatBytes(attachment.size);
                                        return (
                                          <div
                                            key={`${messageId}-attachment-${attachment.id || filename}`}
                                            className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2"
                                          >
                                            <div className="min-w-0">
                                              <p className="truncate text-xs font-semibold text-white">
                                                {filename}
                                              </p>
                                              <p className="text-[11px] text-slate-400">
                                                {attachment.mimeType || "Attachment"}
                                                {sizeLabel ? ` · ${sizeLabel}` : ""}
                                              </p>
                                            </div>
                                            <button
                                              type="button"
                                              onClick={() => handleDownloadAttachment(messageId, attachment)}
                                              className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-200 hover:border-white/30 hover:text-white"
                                            >
                                              Download
                                            </button>
                                          </div>
                                        );
                                      })}
                                    </div>
                                    {emailAttachmentStatus.status === "error" ? (
                                      <div className="mt-2 text-[11px] text-rose-300">
                                        {emailAttachmentStatus.message}
                                      </div>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                            {emailSummaryVisible ? (
                              <div className="absolute inset-0 z-20 flex items-center justify-center p-4">
                                <div className="pointer-events-none absolute inset-0 rounded-2xl dashboard-modal-backdrop" />
                                <div
                                  className="relative z-10 w-full max-w-xl max-h-[min(80vh,calc(100%-2rem))] overflow-y-auto overscroll-contain rounded-2xl border border-white/10 bg-slate-950/95 p-3 shadow-xl backdrop-blur pointer-events-auto sm:p-4"
                                  data-lenis-prevent
                                  onWheel={(event) => event.stopPropagation()}
                                  onTouchMove={(event) => event.stopPropagation()}
                                >
                                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                      <p className="text-xs uppercase tracking-[0.24em] text-indigo-200">Summary</p>
                                      <p className="text-xs text-slate-400">Quick recap of the selected email.</p>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEmailSummaryVisible(false);
                                        setEmailInlineReplyOpen(false);
                                        setEmailInlineReplyMessageId(null);
                                        setEmailInlineAttachments([]);
                                      }}
                                      className={`rounded-lg border p-2 ${emailActionButtonClass}`}
                                      aria-label="Close summary"
                                    >
                                      <X className="h-4 w-4" />
                                    </button>
                                  </div>
                                  <div className="mt-3 text-sm text-slate-100">
                                    {selectedEmailSummary ? (
                                      <ul className="list-disc space-y-2 pl-5">
                                        {formatSummaryBullets(selectedEmailSummary).map((item, idx) => (
                                          <li key={`${messageId}-${idx}`}>{item}</li>
                                        ))}
                                      </ul>
                                    ) : emailSummaryLoading ? (
                                      <AiLoadingCard
                                        label="Summarizing this email..."
                                        lines={["w-4/5", "w-3/5", "w-5/6"]}
                                      />
                                    ) : (
                                      <p>Generate a summary to see the recap here.</p>
                                    )}
                                  </div>
                                  {emailSummaryError ? (
                                    <div className="mt-2 text-xs text-rose-300">{emailSummaryError}</div>
                                  ) : null}
                                  {isEscalation ? (
                                    <div className="mt-3 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div>
                                          <p className="text-[11px] uppercase tracking-[0.18em] text-rose-200">
                                            Escalation recommended
                                          </p>
                                          <p className="text-[11px] text-rose-100/80">
                                            Concerned sentiment with high priority.
                                          </p>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                          <button
                                            type="button"
                                            onClick={() =>
                                              requestReplyVariants(selectedEmailMessage, {
                                                tone: emailReplyTone,
                                                intent: "follow_up"
                                              })
                                            }
                                            disabled={replyVariantsStatus.status === "loading"}
                                            className="rounded-lg border border-rose-300/40 bg-rose-500/20 px-2 py-1 text-[11px] text-rose-100 disabled:opacity-60"
                                          >
                                            Create follow-up draft
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              runEmailModify({
                                                messageIds: [messageId],
                                                addLabelIds: ["IMPORTANT"],
                                                clearSelection: false,
                                                successMessage: "Marked as important."
                                              })
                                            }
                                            className="rounded-lg border border-white/10 bg-white/10 px-2 py-1 text-[11px] text-white"
                                          >
                                            Mark important
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  ) : null}
                                  <div className="mt-3 flex flex-wrap items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => summarizeEmailMessage(selectedEmailMessage, { force: true })}
                                      disabled={!selectedEmailMessage || emailSummaryLoading}
                                      className="rounded-xl border border-white/10 bg-white/10 px-3 py-1 text-xs text-white disabled:opacity-60"
                                    >
                                      {emailSummaryLoading ? "Summarizing..." : "Refresh summary"}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => openEmailTaskManager(selectedEmailMessage)}
                                      disabled={!selectedEmailMessage}
                                      className="rounded-xl border border-indigo-300/40 bg-indigo-500/20 px-3 py-1 text-xs text-indigo-100 disabled:opacity-60"
                                    >
                                      Add to Task Manager
                                    </button>
                                  </div>
                                  <div className="mt-4 grid gap-3">
                                    <div className="rounded-xl border border-white/10 bg-slate-900/40 p-3">
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div>
                                          <p className="text-xs uppercase tracking-[0.24em] text-indigo-200">Insights</p>
                                          <p className="text-[11px] text-slate-400">Tags, priority, sentiment.</p>
                                        </div>
                                        <div className="flex items-center gap-2 text-[11px] text-slate-400">
                                          <span>{classifyStatus.status === "loading" ? "Classifying..." : ""}</span>
                                          <button
                                            type="button"
                                            onClick={() => openEmailFeedback(selectedEmailMessage, classification)}
                                            disabled={!hasInsights}
                                            className="rounded-lg border border-white/10 bg-white/10 px-2 py-1 text-[11px] text-white disabled:opacity-50"
                                          >
                                            Wrong tag?
                                          </button>
                                        </div>
                                      </div>
                                      {classifyStatus.status === "loading" ? (
                                        <div className="mt-3">
                                          <AiDots label="Classifying message..." />
                                          <div className="mt-2">
                                            <AiSkeleton lines={["w-1/2", "w-1/3", "w-2/3"]} />
                                          </div>
                                        </div>
                                      ) : classifyStatus.status === "error" || classifyStatus.status === "rate_limited" ? (
                                        <div className="mt-2 text-xs text-rose-300">{classifyStatus.message}</div>
                                      ) : hasInsights ? (
                                        <div className="mt-3 space-y-2 text-xs text-slate-200">
                                          <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                                              Priority
                                            </span>
                                            {priorityLabel ? (
                                              <span
                                                className={`rounded-full border px-2 py-0.5 ${
                                                  priorityBadgeStyles[priorityLabel] || priorityBadgeStyles.Normal
                                                }`}
                                              >
                                                {priorityLabel}
                                              </span>
                                            ) : (
                                              <span className="text-slate-400">Not scored</span>
                                            )}
                                            <span className="text-[11px] text-slate-400">{priorityScore}/100</span>
                                          </div>
                                          <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                                              Sentiment
                                            </span>
                                            <span className={sentimentStyles[sentiment] || sentimentStyles.Neutral}>
                                              {sentiment}
                                            </span>
                                          </div>
                                          <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                                              Confidence
                                            </span>
                                            <span className="text-[11px] text-slate-300">
                                              {confidence ? `${Math.round(confidence * 100)}%` : "—"}
                                            </span>
                                          </div>
                                          {reasoningShort ? (
                                            <div className="text-[11px] text-slate-400">
                                              {reasoningShort}
                                            </div>
                                          ) : null}
                                          <div className="flex flex-wrap items-center gap-1">
                                            {tags.length ? (
                                              tags.map((tag) => (
                                                <span
                                                  key={`${messageId}-${tag}-insight`}
                                                  className="rounded-full border border-white/10 bg-slate-900/60 px-2 py-0.5 text-[10px] text-slate-300"
                                                >
                                                  {tag}
                                                </span>
                                              ))
                                            ) : (
                                              <span className="text-slate-400">No tags yet.</span>
                                            )}
                                          </div>
                                        </div>
                                      ) : (
                                        <div className="mt-2 text-xs text-slate-400">
                                          Run classify to see insights.
                                        </div>
                                      )}
                                    </div>
                                    {emailFeedbackOpen ? (
                                      <div className="rounded-xl border border-white/10 bg-slate-900/40 p-3">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                          <div>
                                            <p className="text-xs uppercase tracking-[0.24em] text-indigo-200">Wrong tag?</p>
                                            <p className="text-[11px] text-slate-400">Tell us the correct labels.</p>
                                          </div>
                                          <button
                                            type="button"
                                            onClick={() => setEmailFeedbackOpen(false)}
                                            className="rounded-lg border border-white/10 bg-white/10 px-2 py-1 text-[11px] text-white"
                                          >
                                            Close
                                          </button>
                                        </div>
                                        <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                                          {EMAIL_TAG_OPTIONS.map((tag) => {
                                            const active = emailFeedbackForm.tags.includes(tag);
                                            return (
                                              <button
                                                key={`feedback-tag-${tag}`}
                                                type="button"
                                                onClick={() => toggleEmailFeedbackTag(tag)}
                                                className={`rounded-full border px-2 py-1 ${
                                                  active
                                                    ? "border-indigo-300/60 bg-indigo-500/20 text-indigo-100"
                                                    : "border-white/10 bg-slate-900/60 text-slate-300"
                                                }`}
                                              >
                                                {tag}
                                              </button>
                                            );
                                          })}
                                        </div>
                                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                          <label className="text-[11px] text-slate-400">
                                            Priority
                                            <select
                                              value={emailFeedbackForm.priorityLabel}
                                              onChange={(event) =>
                                                setEmailFeedbackForm((prev) => ({
                                                  ...prev,
                                                  priorityLabel: event.target.value
                                                }))
                                              }
                                              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/60 px-2 py-2 text-xs text-slate-100"
                                            >
                                              {["Urgent", "Normal", "Low"].map((label) => (
                                                <option key={`priority-${label}`} value={label}>
                                                  {label}
                                                </option>
                                              ))}
                                            </select>
                                          </label>
                                          <label className="text-[11px] text-slate-400">
                                            Sentiment
                                            <select
                                              value={emailFeedbackForm.sentiment}
                                              onChange={(event) =>
                                                setEmailFeedbackForm((prev) => ({
                                                  ...prev,
                                                  sentiment: event.target.value
                                                }))
                                              }
                                              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/60 px-2 py-2 text-xs text-slate-100"
                                            >
                                              {["Concerned", "Neutral", "Positive"].map((label) => (
                                                <option key={`sentiment-${label}`} value={label}>
                                                  {label}
                                                </option>
                                              ))}
                                            </select>
                                          </label>
                                        </div>
                                        <label className="mt-3 block text-[11px] text-slate-400">
                                          Notes
                                          <textarea
                                            rows={2}
                                            value={emailFeedbackForm.notes}
                                            onChange={(event) =>
                                              setEmailFeedbackForm((prev) => ({
                                                ...prev,
                                                notes: event.target.value
                                              }))
                                            }
                                            className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/60 px-2 py-2 text-xs text-slate-100"
                                            placeholder="Optional: tell us what we missed."
                                          />
                                        </label>
                                        {emailFeedbackStatus.status === "error" ? (
                                          <div className="mt-2 text-xs text-rose-300">{emailFeedbackStatus.message}</div>
                                        ) : emailFeedbackStatus.status === "success" ? (
                                          <div className="mt-2 text-xs text-emerald-300">{emailFeedbackStatus.message}</div>
                                        ) : null}
                                        <div className="mt-3 flex flex-wrap gap-2">
                                          <button
                                            type="button"
                                            onClick={() => submitEmailFeedback(selectedEmailMessage)}
                                            disabled={emailFeedbackStatus.status === "loading"}
                                            className="rounded-lg border border-emerald-300/40 bg-emerald-500/20 px-3 py-1 text-[11px] text-emerald-100 disabled:opacity-60"
                                          >
                                            {emailFeedbackStatus.status === "loading" ? "Sending..." : "Send feedback"}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setEmailFeedbackOpen(false)}
                                            className="rounded-lg border border-white/10 bg-white/10 px-3 py-1 text-[11px] text-white"
                                          >
                                            Cancel
                                          </button>
                                        </div>
                                      </div>
                                    ) : null}
                                    <div className="rounded-xl border border-white/10 bg-slate-900/40 p-3">
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div>
                                          <p className="text-xs uppercase tracking-[0.24em] text-indigo-200">Action items</p>
                                          <p className="text-[11px] text-slate-400">Checklist from the thread.</p>
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => requestEmailActions(selectedEmailMessage, { force: true })}
                                          disabled={actionsStatus.status === "loading"}
                                          className="rounded-lg border border-white/10 bg-white/10 px-2 py-1 text-[11px] text-white disabled:opacity-60"
                                        >
                                          {actionsStatus.status === "loading" ? "Extracting..." : "Extract"}
                                        </button>
                                      </div>
                                      {actionsStatus.status === "loading" ? (
                                        <div className="mt-3">
                                          <AiDots label="Extracting action items..." />
                                          <div className="mt-2">
                                            <AiSkeleton lines={["w-2/3", "w-1/2", "w-3/5"]} />
                                          </div>
                                        </div>
                                      ) : actionsStatus.status === "error" ? (
                                        <div className="mt-2 text-xs text-rose-300">{actionsStatus.message}</div>
                                      ) : actionItems.length ? (
                                        <div className="mt-3 space-y-2">
                                          {actionItems.map((item, index) => {
                                            const isChecked = emailActionChecks?.[messageId]?.[index];
                                            return (
                                              <label
                                                key={`${messageId}-action-${index}`}
                                                className="flex items-start gap-2 rounded-lg border border-white/10 bg-slate-900/60 px-2 py-2 text-[11px] text-slate-200"
                                              >
                                                <input
                                                  type="checkbox"
                                                  checked={Boolean(isChecked)}
                                                  onChange={() => toggleActionItem(messageId, index)}
                                                  className="mt-0.5 h-3.5 w-3.5 rounded border border-white/20 bg-transparent text-indigo-400"
                                                />
                                                <div className="flex-1">
                                                  <p className={isChecked ? "text-slate-500 line-through" : "text-slate-100"}>
                                                    {item.title}
                                                  </p>
                                                  <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-slate-400">
                                                    {item.dueDate ? <span>Due {item.dueDate}</span> : null}
                                                    {item.owner ? <span>Owner {item.owner}</span> : null}
                                                  </div>
                                                </div>
                                                {item.confidence !== undefined ? (
                                                  <span className="text-[10px] text-slate-400">
                                                    {Math.round(Number(item.confidence || 0) * 100)}%
                                                  </span>
                                                ) : null}
                                              </label>
                                            );
                                          })}
                                        </div>
                                      ) : (
                                        <div className="mt-2 text-xs text-slate-400">
                                          No action items detected yet.
                                        </div>
                                      )}
                                      {showFollowUp ? (
                                        <div className="mt-3">
                                          <button
                                            type="button"
                                            onClick={() =>
                                              requestReplyVariants(selectedEmailMessage, {
                                                tone: emailReplyTone,
                                                intent: "follow_up"
                                              })
                                            }
                                            disabled={replyVariantsStatus.status === "loading"}
                                            className="rounded-lg border border-emerald-300/40 bg-emerald-500/20 px-3 py-1 text-[11px] text-emerald-100 disabled:opacity-60"
                                          >
                                            Create follow-up draft
                                          </button>
                                        </div>
                                      ) : null}
                                    </div>
                                    <div className="rounded-xl border border-white/10 bg-slate-900/40 p-3">
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div>
                                          <p className="text-xs uppercase tracking-[0.24em] text-indigo-200">Reply with AI</p>
                                          <p className="text-[11px] text-slate-400">Pick a tone, get 3 variants.</p>
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => requestReplyVariants(selectedEmailMessage, { tone: emailReplyTone })}
                                          disabled={replyVariantsStatus.status === "loading"}
                                          className="rounded-lg border border-emerald-300/40 bg-emerald-500/20 px-2 py-1 text-[11px] text-emerald-100 disabled:opacity-60"
                                        >
                                          {replyVariantsStatus.status === "loading" ? "Drafting..." : "Generate variants"}
                                        </button>
                                      </div>
                                      <div className="mt-2 flex flex-wrap gap-2">
                                        {REPLY_TONE_PRESETS.map((tone) => (
                                          <button
                                            key={tone}
                                            type="button"
                                            onClick={() => setEmailReplyTone(tone)}
                                            className={`rounded-full border px-2 py-0.5 text-[10px] transition ${
                                              emailReplyTone === tone
                                                ? "border-emerald-300/50 bg-emerald-500/20 text-emerald-100"
                                                : "border-white/10 bg-white/5 text-slate-200 hover:border-white/30"
                                            }`}
                                            aria-pressed={emailReplyTone === tone}
                                          >
                                            {tone}
                                          </button>
                                        ))}
                                      </div>
                                      {replyVariantsStatus.status === "loading" ? (
                                        <div className="mt-3">
                                          <AiDots label="Drafting replies..." />
                                          <div className="mt-2">
                                            <AiSkeleton lines={["w-3/4", "w-2/3", "w-4/5"]} />
                                          </div>
                                        </div>
                                      ) : replyVariantsStatus.status === "error" ? (
                                        <div className="mt-2 text-xs text-rose-300">{replyVariantsStatus.message}</div>
                                      ) : hasReplyDraft ? (
                                        <div className="mt-3 grid gap-2">
                                          {replyVariants.slice(0, 3).map((variant, index) => (
                                            <div
                                              key={`${messageId}-variant-${index}`}
                                              className="rounded-lg border border-white/10 bg-slate-900/60 px-2 py-2 text-[11px] text-slate-100"
                                            >
                                              <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400">
                                                <span>
                                                  {variant.tone || emailReplyTone} variant {index + 1}
                                                </span>
                                                <button
                                                  type="button"
                                                  onClick={() => insertReplyVariant(selectedEmailMessage, variant.text)}
                                                  className="rounded-md border border-white/10 bg-white/10 px-2 py-0.5 text-[10px] text-white"
                                                >
                                                  Insert
                                                </button>
                                              </div>
                                              <p className="mt-2 whitespace-pre-line text-xs text-slate-100">
                                                {variant.text}
                                              </p>
                                            </div>
                                          ))}
                                        </div>
                                      ) : (
                                        <div className="mt-2 text-xs text-slate-400">
                                          Generate variants to see options.
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  {inlineReplyActive ? (
                                    <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3">
                                      <div className="text-[11px] text-slate-400">
                                        Replying to {emailComposerForm.to || "recipient"}
                                      </div>
                                      <input
                                        type="text"
                                        value={emailComposerForm.subject}
                                        onChange={(event) =>
                                          setEmailComposerForm((prev) => ({
                                            ...prev,
                                            subject: event.target.value
                                          }))
                                        }
                                        placeholder="Subject"
                                        className="mt-2 w-full rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-white placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none"
                                      />
                                      <textarea
                                        value={emailComposerForm.body}
                                        onChange={(event) =>
                                          setEmailComposerForm((prev) => ({
                                            ...prev,
                                            body: event.target.value
                                          }))
                                        }
                                        rows={5}
                                        placeholder="Write your reply..."
                                        className="mt-2 w-full rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-white placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none"
                                      />
                                      <div className="mt-2 flex flex-wrap items-center gap-2">
                                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-200">
                                          <Paperclip className="h-3.5 w-3.5" />
                                          Attach files
                                          <input
                                            type="file"
                                            multiple
                                            className="hidden"
                                            onChange={handleInlineAttachmentChange}
                                          />
                                        </label>
                                        {emailInlineAttachments.length ? (
                                          <span className="text-[11px] text-slate-400">
                                            {emailInlineAttachments.length} attachment
                                            {emailInlineAttachments.length === 1 ? "" : "s"}
                                          </span>
                                        ) : null}
                                      </div>
                                      {emailInlineAttachments.length ? (
                                        <div className="mt-2 space-y-1">
                                          {emailInlineAttachments.map((file, idx) => (
                                            <div
                                              key={`${file.name}-${idx}`}
                                              className="flex items-center justify-between rounded-lg border border-white/10 bg-slate-900/50 px-2 py-1 text-[11px] text-slate-200"
                                            >
                                              <span className="truncate">{file.name}</span>
                                              <button
                                                type="button"
                                                onClick={() => removeInlineAttachment(idx)}
                                                className="text-slate-300 hover:text-white"
                                                aria-label={`Remove ${file.name}`}
                                              >
                                                <X className="h-3 w-3" />
                                              </button>
                                            </div>
                                          ))}
                                        </div>
                                      ) : null}
                                      {emailComposerStatus.status === "error" ? (
                                        <div className="mt-2 text-xs text-rose-300">
                                          {emailComposerStatus.message}
                                        </div>
                                      ) : null}
                                      {emailComposerStatus.status === "success" ? (
                                        <div className="mt-2 text-xs text-emerald-200">
                                          {emailComposerStatus.message}
                                        </div>
                                      ) : null}
                                      <div className="mt-3 flex flex-wrap items-center gap-2">
                                        <button
                                          type="button"
                                          onClick={handleInlineReplySend}
                                          disabled={emailComposerStatus.status === "loading"}
                                          className="rounded-xl border border-emerald-300/50 bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-100 disabled:opacity-60"
                                        >
                                          {emailComposerStatus.status === "loading"
                                            ? "Sending..."
                                            : "Send reply"}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            requestReplyVariants(selectedEmailMessage, {
                                              tone: emailReplyTone,
                                              intent: "reply",
                                              currentDraft: emailComposerForm.body
                                            })
                                          }
                                          disabled={!selectedEmailMessage || replyVariantsStatus.status === "loading"}
                                          className="rounded-xl border border-white/10 bg-white/10 px-3 py-1 text-xs text-white disabled:opacity-60"
                                        >
                                          {replyVariantsStatus.status === "loading"
                                            ? "Regenerating..."
                                            : "Regenerate variants"}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setEmailInlineReplyOpen(false);
                                            setEmailInlineReplyMessageId(null);
                                            setEmailComposerStatus({ status: "idle", message: "" });
                                            setEmailInlineAttachments([]);
                                          }}
                                          className="rounded-xl border border-white/10 bg-white/10 px-3 py-1 text-xs text-white"
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            ) : null}
                          </>
                        );
                      })() : (
                        <div className="rounded-xl border border-white/10 bg-slate-900/40 px-3 py-2 text-xs text-slate-300">
                          Select an email from the inbox to view details.
                        </div>
                      )}
                    </div>
                  </div>
                  </div>
                ) : emailSubTab === "settings" ? (
                  <div
                    className="grid gap-4 lg:grid-cols-[200px_minmax(0,1fr)] sm:h-full sm:min-h-0 sm:overflow-y-auto"
                    data-lenis-prevent
                  >
                    <nav className="rounded-3xl border border-white/10 bg-white/5 p-3 shadow-xl backdrop-blur">
                      <p className="text-[11px] uppercase tracking-[0.28em] text-indigo-200">Settings</p>
                      <div className="mt-3 flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-2 lg:overflow-visible">
                        {settingsSections.map((section) => (
                          <button
                            key={section.id}
                            type="button"
                            onClick={() => setSettingsSection(section.id)}
                            className={`rounded-xl px-3 py-2 text-left text-xs font-semibold transition ${
                              settingsSection === section.id
                                ? "bg-white/15 text-white"
                                : "text-slate-200 hover:bg-white/10 hover:text-white"
                            }`}
                          >
                            {section.label}
                          </button>
                        ))}
                      </div>
                    </nav>
                    <div className="grid gap-4">
                      {settingsSection === "automation" && (
                        <>
                          <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-xl backdrop-blur">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <p className="text-xs uppercase tracking-[0.24em] text-indigo-200">Automation</p>
                                <h4 className="text-lg font-semibold text-white">Summary settings</h4>
                              </div>
                              <span className={`text-xs ${gmailConnected ? "text-emerald-200" : "text-slate-400"}`}>
                                {gmailStatusLabel}
                              </span>
                            </div>
                            <div className="mt-4 grid gap-3 text-sm text-slate-200">
                              <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-900/40 p-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                  <p className="text-sm font-semibold text-white">Theme</p>
                                  <p className="text-xs text-slate-400">Switch the email manager appearance.</p>
                                </div>
                                <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 p-1 text-xs">
                                  <button
                                    type="button"
                                    onClick={() => setEmailTheme("dark")}
                                    className={`rounded-full px-3 py-1 font-semibold transition ${
                                      emailTheme === "dark"
                                        ? "bg-indigo-500/30 text-white"
                                        : "text-slate-300 hover:text-white"
                                    }`}
                                    aria-pressed={emailTheme === "dark"}
                                  >
                                    Dark
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEmailTheme("light")}
                                    className={`rounded-full px-3 py-1 font-semibold transition ${
                                      emailTheme === "light"
                                        ? "bg-indigo-500/30 text-white"
                                        : "text-slate-300 hover:text-white"
                                    }`}
                                    aria-pressed={emailTheme === "light"}
                                  >
                                    Light
                                  </button>
                                </div>
                              </div>
                              <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-900/40 p-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                  <p className="text-sm font-semibold text-white">Auto-summarize on open</p>
                                  <p className="text-xs text-slate-400">
                                    Generate a summary whenever you select an email.
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setEmailAutoSummarize((prev) => !prev)}
                                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                                    emailAutoSummarize ? "bg-emerald-400" : "bg-white/10"
                                  }`}
                                >
                                  <span
                                    className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                                      emailAutoSummarize ? "translate-x-5" : "translate-x-1"
                                    }`}
                                  />
                                </button>
                              </div>
                              <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-900/40 p-3">
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                  <div>
                                    <p className="text-sm font-semibold text-white">Auto-tag new emails</p>
                                    <p className="text-xs text-slate-400">
                                      Classify new arrivals in the background and show tags in the inbox.
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const next = !emailAutoTagEnabled;
                                      setEmailAutoTagEnabled(next);
                                      saveEmailSettings({ auto_tag_enabled: next });
                                    }}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                                      emailAutoTagEnabled ? "bg-emerald-400" : "bg-white/10"
                                    }`}
                                  >
                                    <span
                                      className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                                        emailAutoTagEnabled ? "translate-x-5" : "translate-x-1"
                                      }`}
                                    />
                                  </button>
                                </div>
                                <div className="flex flex-col gap-2">
                                  <div className="flex items-center justify-between text-xs text-slate-300">
                                    <span>Urgent confidence threshold</span>
                                    <span>{Math.round(emailUrgentThreshold * 100)}%</span>
                                  </div>
                                  <input
                                    type="range"
                                    min="0.5"
                                    max="0.95"
                                    step="0.05"
                                    value={emailUrgentThreshold}
                                    onChange={(event) => setEmailUrgentThreshold(Number(event.target.value))}
                                    onMouseUp={(event) =>
                                      saveEmailSettings({ urgent_conf_threshold: Number(event.target.value) })
                                    }
                                    onTouchEnd={(event) =>
                                      saveEmailSettings({ urgent_conf_threshold: Number(event.target.value) })
                                    }
                                    className="w-full accent-emerald-400"
                                  />
                                  {emailSettingsStatus.status === "error" ? (
                                    <div className="text-xs text-rose-300">{emailSettingsStatus.message}</div>
                                  ) : emailSettingsStatus.status === "success" ? (
                                    <div className="text-xs text-emerald-300">{emailSettingsStatus.message}</div>
                                  ) : null}
                                </div>
                              </div>
                              <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-3 text-xs text-slate-300">
                                Summaries are generated using OpenAI. We only send the selected email content.
                              </div>
                            </div>
                          </div>
                          <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-xl backdrop-blur">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <p className="text-xs uppercase tracking-[0.24em] text-indigo-200">Connection</p>
                                <h4 className="mt-1 text-lg font-semibold text-white">Gmail access</h4>
                              </div>
                            </div>
                            <p className="mt-2 text-xs text-slate-300">
                              {gmailAccountLabel ? `Connected account: ${gmailAccountLabel}` : "No account connected yet."}
                            </p>
                            <div className="mt-3 grid gap-2 text-xs text-slate-200">
                              <button
                                type="button"
                                onClick={() => beginGoogleLogin?.({ force: true })}
                                disabled={status === "loading"}
                                className="inline-flex items-center justify-center rounded-xl border border-emerald-300/50 bg-emerald-500/20 px-3 py-2 font-semibold text-emerald-50"
                              >
                                Connect Gmail
                              </button>
                              <button
                                type="button"
                                onClick={handleEmailRefresh}
                                className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-white"
                              >
                                Refresh inbox
                              </button>
                              <button
                                type="button"
                                onClick={handleEmailDisconnect}
                                className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-white"
                              >
                                Disconnect
                              </button>
                            </div>
                          </div>
                          <div className="rounded-3xl border border-white/10 bg-white/5 p-4 text-xs text-slate-300 shadow-xl backdrop-blur">
                            <p className="text-sm font-semibold text-white">Data handling</p>
                            <p className="mt-2">
                              Gmail permissions allow reading, labeling, and sending messages so inbox actions can run.
                              You can revoke access at any time by disconnecting the account.
                            </p>
                          </div>
                        </>
                      )}
                      {settingsSection === "business" && (
                        <>
                          <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-xl backdrop-blur">
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="text-xs uppercase tracking-[0.24em] text-indigo-200">Business</p>
                              <h4 className="text-lg font-semibold text-white">Business profile</h4>
                            </div>
                            {!isBusinessProfileEditing ? (
                              <button
                                type="button"
                                onClick={() => setIsBusinessProfileEditing(true)}
                                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/20"
                              >
                                Edit business profile
                              </button>
                            ) : null}
                          </div>
                          <div className="grid gap-3 text-sm text-slate-200">
                            <div className="grid gap-3 md:grid-cols-2">
                              <div className="grid gap-1">
                                <label className="text-xs uppercase tracking-[0.2em] text-slate-400">Business name</label>
                                <input
                                  type="text"
                                  value={businessProfileForm.businessName}
                                  onChange={(e) =>
                                    setBusinessProfileForm((prev) => ({
                                      ...prev,
                                      businessName: e.target.value
                                    }))
                                  }
                                  placeholder="Business name"
                                  readOnly={!isBusinessProfileEditing}
                                  className={businessProfileFieldClass}
                                />
                              </div>
                              <div className="grid gap-1">
                                <label className="text-xs uppercase tracking-[0.2em] text-slate-400">Contact number</label>
                                <input
                                  type="tel"
                                  value={businessProfileForm.contactNumber}
                                  onChange={(e) =>
                                    setBusinessProfileForm((prev) => ({
                                      ...prev,
                                      contactNumber: e.target.value
                                    }))
                                  }
                                  placeholder="Contact number"
                                  readOnly={!isBusinessProfileEditing}
                                  className={businessProfileFieldClass}
                                />
                              </div>
                              <div className="grid gap-1">
                                <label className="text-xs uppercase tracking-[0.2em] text-slate-400">Contact email</label>
                                <input
                                  type="email"
                                  value={businessProfileForm.contactEmail}
                                  onChange={(e) =>
                                    setBusinessProfileForm((prev) => ({
                                      ...prev,
                                      contactEmail: e.target.value
                                    }))
                                  }
                                  placeholder="Contact email"
                                  readOnly={!isBusinessProfileEditing}
                                  className={businessProfileFieldClass}
                                />
                              </div>
                              <div className="grid gap-1">
                                <label className="text-xs uppercase tracking-[0.2em] text-slate-400">Website</label>
                                <input
                                  type="url"
                                  value={businessProfileForm.websiteUrl}
                                  onChange={(e) =>
                                    setBusinessProfileForm((prev) => ({
                                      ...prev,
                                      websiteUrl: e.target.value
                                    }))
                                  }
                                  placeholder="https://example.com"
                                  readOnly={!isBusinessProfileEditing}
                                  className={businessProfileFieldClass}
                                />
                              </div>
                            </div>

                            <div className="grid gap-1">
                              <label className="text-xs uppercase tracking-[0.2em] text-slate-400">What do you do? *</label>
                              <textarea
                                rows={3}
                                maxLength={SUMMARY_LIMIT}
                                value={businessProfileForm.businessSummary}
                                onChange={(e) =>
                                  setBusinessProfileForm((prev) => ({
                                    ...prev,
                                    businessSummary: e.target.value
                                  }))
                                }
                                placeholder="Explain what you sell, who you serve, and the tone you want."
                                readOnly={!isBusinessProfileEditing}
                                className={businessProfileFieldClass}
                                data-lenis-prevent
                              />
                              <div className="text-xs text-slate-400 text-right">
                                {(businessProfileForm.businessSummary || "").length}/{SUMMARY_LIMIT}
                              </div>
                            </div>

                            <div className="grid gap-3 md:grid-cols-2">
                              <div className="grid gap-1">
                                <label className="text-xs uppercase tracking-[0.2em] text-slate-400">
                                  Business openings / hours
                                </label>
                                <textarea
                                  rows={2}
                                  maxLength={FIELD_LIMIT}
                                  value={businessProfileForm.hours}
                                  onChange={(e) =>
                                    setBusinessProfileForm((prev) => ({
                                      ...prev,
                                      hours: e.target.value
                                    }))
                                  }
                                  placeholder="Mon–Fri 9am–6pm; Sat by appointment."
                                  readOnly={!isBusinessProfileEditing}
                                  className={businessProfileFieldClass}
                                  data-lenis-prevent
                                />
                                <div className="text-xs text-slate-400 text-right">
                                  {(businessProfileForm.hours || "").length}/{FIELD_LIMIT}
                                </div>
                              </div>
                              <div className="grid gap-1">
                                <label className="text-xs uppercase tracking-[0.2em] text-slate-400">
                                  Location / service area
                                </label>
                                <textarea
                                  rows={2}
                                  maxLength={FIELD_LIMIT}
                                  value={businessProfileForm.location}
                                  onChange={(e) =>
                                    setBusinessProfileForm((prev) => ({
                                      ...prev,
                                      location: e.target.value
                                    }))
                                  }
                                  placeholder="City, region, or service area."
                                  readOnly={!isBusinessProfileEditing}
                                  className={businessProfileFieldClass}
                                  data-lenis-prevent
                                />
                                <div className="text-xs text-slate-400 text-right">
                                  {(businessProfileForm.location || "").length}/{FIELD_LIMIT}
                                </div>
                              </div>
                            </div>

                            <div className="grid gap-3 md:grid-cols-2">
                              <div className="grid gap-1">
                                <label className="text-xs uppercase tracking-[0.2em] text-slate-400">
                                  Key services or offerings
                                </label>
                                <textarea
                                  rows={2}
                                  maxLength={FIELD_LIMIT}
                                  value={businessProfileForm.services}
                                  onChange={(e) =>
                                    setBusinessProfileForm((prev) => ({
                                      ...prev,
                                      services: e.target.value
                                    }))
                                  }
                                  placeholder="Top services, prices, and qualifications."
                                  readOnly={!isBusinessProfileEditing}
                                  className={businessProfileFieldClass}
                                  data-lenis-prevent
                                />
                                <div className="text-xs text-slate-400 text-right">
                                  {(businessProfileForm.services || "").length}/{FIELD_LIMIT}
                                </div>
                              </div>
                              <div className="grid gap-1">
                                <label className="text-xs uppercase tracking-[0.2em] text-slate-400">
                                  Must-know notes for the AI
                                </label>
                                <textarea
                                  rows={2}
                                  maxLength={FIELD_LIMIT}
                                  value={businessProfileForm.notes}
                                  onChange={(e) =>
                                    setBusinessProfileForm((prev) => ({
                                      ...prev,
                                      notes: e.target.value
                                    }))
                                  }
                                  placeholder="Escalation rules, blocked topics, VIP instructions."
                                  readOnly={!isBusinessProfileEditing}
                                  className={businessProfileFieldClass}
                                  data-lenis-prevent
                                />
                                <div className="text-xs text-slate-400 text-right">
                                  {(businessProfileForm.notes || "").length}/{FIELD_LIMIT}
                                </div>
                              </div>
                            </div>

                            <div className="grid gap-1">
                              <label className="text-xs uppercase tracking-[0.2em] text-slate-400">
                                Additional openings or availability
                              </label>
                              <textarea
                                rows={2}
                                maxLength={FIELD_LIMIT}
                                value={businessProfileForm.openings}
                                onChange={(e) =>
                                  setBusinessProfileForm((prev) => ({
                                    ...prev,
                                    openings: e.target.value
                                  }))
                                }
                                placeholder="Seasonal availability, holiday closures, special notes."
                                readOnly={!isBusinessProfileEditing}
                                className={businessProfileFieldClass}
                                data-lenis-prevent
                              />
                              <div className="text-xs text-slate-400 text-right">
                                {(businessProfileForm.openings || "").length}/{FIELD_LIMIT}
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              {isBusinessProfileEditing ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onBusinessSave?.({
                                        businessName: businessProfileForm.businessName,
                                        businessPhone: businessProfileForm.contactNumber,
                                        websiteUrl: businessProfileForm.websiteUrl,
                                        websiteData: {
                                          businessName: businessProfileForm.businessName,
                                          businessPhone: businessProfileForm.contactNumber,
                                          businessEmail: businessProfileForm.contactEmail,
                                          businessSummary: businessProfileForm.businessSummary,
                                          location: businessProfileForm.location,
                                          hours: businessProfileForm.hours,
                                          openings: businessProfileForm.openings,
                                          services: businessProfileForm.services,
                                          notes: businessProfileForm.notes,
                                          websiteUrl: businessProfileForm.websiteUrl
                                        }
                                      })
                                    }
                                    disabled={businessSaveStatus?.status === "loading"}
                                    className="inline-flex items-center gap-2 rounded-xl border border-emerald-300/60 bg-emerald-500/20 px-3 py-2 text-xs font-semibold text-emerald-50 transition hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    <CheckCircle2 className="h-4 w-4" />
                                    Save business profile
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setBusinessProfileForm({
                                        businessName: derivedBusinessProfile.businessName || "",
                                        contactNumber: derivedBusinessProfile.contactNumber || "",
                                        contactEmail: derivedBusinessProfile.contactEmail || user?.email || "",
                                        websiteUrl: derivedBusinessProfile.websiteUrl || "",
                                        businessSummary: derivedBusinessProfile.businessSummary || "",
                                        hours: derivedBusinessProfile.hours || "",
                                        location: derivedBusinessProfile.location || "",
                                        services: derivedBusinessProfile.services || "",
                                        notes: derivedBusinessProfile.notes || "",
                                        openings: derivedBusinessProfile.openings || ""
                                      });
                                      setIsBusinessProfileEditing(false);
                                    }}
                                    className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/20"
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : null}
                              {businessSaveStatus?.message && (
                                <span
                                  className={`text-xs ${
                                    businessSaveStatus.status === "error"
                                      ? "text-rose-300"
                                      : "text-emerald-200"
                                  }`}
                                >
                                  {businessSaveStatus.message}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-xl backdrop-blur">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <p className="text-xs uppercase tracking-[0.24em] text-indigo-200">AI Agent Prompt</p>
                              <h4 className="text-lg font-semibold text-white">Prompt registry</h4>
                            </div>
                            <span
                              className={`text-xs ${
                                promptStatus.status === "error"
                                  ? "text-rose-300"
                                  : promptStatus.prompt?.status === "needs_regen"
                                    ? "text-amber-200"
                                    : "text-emerald-200"
                              }`}
                            >
                              {promptSubType
                                ? promptStatus.status === "loading"
                                  ? "Checking..."
                                  : promptStatus.prompt?.status === "needs_regen"
                                    ? "Needs regeneration"
                                    : promptStatus.prompt
                                      ? "Up to date"
                                      : "Not generated"
                                : "Missing business type"}
                            </span>
                          </div>
                          <div className="mt-3 grid gap-2 text-xs text-slate-300">
                            <div className="flex items-center justify-between">
                              <span>Active version</span>
                              <span className="text-slate-100">
                                {promptStatus.prompt?.version ? `v${promptStatus.prompt.version}` : "—"}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span>Last generated</span>
                              <span className="text-slate-100">
                                {promptStatus.prompt?.updatedAt
                                  ? formatDate(promptStatus.prompt.updatedAt)
                                  : "—"}
                              </span>
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={handlePromptRegenerate}
                              disabled={!promptSubType || promptActionStatus.status === "loading"}
                              className="inline-flex items-center gap-2 rounded-xl border border-emerald-300/60 bg-emerald-500/20 px-3 py-2 text-xs font-semibold text-emerald-50 transition hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <Sparkles className="h-4 w-4" />
                              Regenerate
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setPromptHistoryOpen(true);
                                loadPromptHistory();
                              }}
                              disabled={!promptSubType || promptHistoryStatus.status === "loading"}
                              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <FileText className="h-4 w-4" />
                              View versions
                            </button>
                          </div>
                          {promptActionStatus.message ? (
                            <div
                              className={`mt-3 text-xs ${
                                promptActionStatus.status === "error"
                                  ? "text-rose-300"
                                  : "text-emerald-200"
                              }`}
                            >
                              {promptActionStatus.message}
                            </div>
                          ) : null}
                          {promptHistoryStatus.status === "error" ? (
                            <div className="mt-2 text-xs text-rose-300">
                              {promptHistoryStatus.message}
                            </div>
                          ) : null}
                        </div>
                        </>
                      )}
                      {settingsSection === "user" && (
                        <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-xl backdrop-blur">
                          <div className="mb-3 flex items-center gap-2">
                            <UserIcon className="h-5 w-5 text-indigo-200" />
                            <div>
                              <p className="text-xs uppercase tracking-[0.24em] text-indigo-200">User</p>
                              <h4 className="text-lg font-semibold text-white">Your profile</h4>
                            </div>
                          </div>
                          <div className="grid gap-3">
                            <input
                              type="email"
                              value={userForm.email}
                              readOnly
                              className="rounded-xl border border-white/10 bg-slate-900/40 px-3 py-2 text-sm text-slate-200"
                            />
                            <input
                              type="text"
                              value={userForm.businessName}
                              onChange={(e) => setUserForm({ ...userForm, businessName: e.target.value })}
                              placeholder="Business name"
                              className="rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
                            />
                            <input
                              type="tel"
                              value={userForm.businessNumber}
                              onChange={(e) => setUserForm({ ...userForm, businessNumber: e.target.value })}
                              placeholder="Business number"
                              className="rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
                            />
                            <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-3 text-xs text-slate-200">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Subscriptions</p>
                                {subscriptionsLoading ? (
                                  <span className="text-[11px] text-slate-400">Checking...</span>
                                ) : null}
                              </div>
                              {subscriptionsLoading ? (
                                <p className="mt-2 text-[11px] text-slate-400">Loading subscription details.</p>
                              ) : subscriptionDetails.length ? (
                                <div className="mt-2 grid gap-2">
                                  {subscriptionDetails.map((sub) => (
                                    <div
                                      key={sub.id}
                                      className="rounded-lg border border-white/10 bg-slate-900/60 px-2 py-2"
                                    >
                                      <div className="flex items-center justify-between gap-2 text-xs">
                                        <span className="font-semibold text-slate-100">{sub.label}</span>
                                        <span
                                          className={`text-[11px] ${
                                            sub.active ? "text-emerald-200" : "text-slate-400"
                                          }`}
                                        >
                                          {formatStatusLabel(sub.status || (sub.active ? "active" : "inactive"))}
                                        </span>
                                      </div>
                                      {(sub.planId || sub.currentPeriodEnd) ? (
                                        <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-400">
                                          {sub.planId ? <span>Plan: {sub.planId}</span> : null}
                                          {sub.currentPeriodEnd ? (
                                            <span>Period ends: {formatDate(sub.currentPeriodEnd)}</span>
                                          ) : null}
                                        </div>
                                      ) : null}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="mt-2 text-[11px] text-slate-400">No subscription details yet.</p>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                onBusinessSave?.({
                                  businessName: userForm.businessName,
                                  businessPhone: userForm.businessNumber,
                                  websiteUrl: businessForm.website
                                })
                              }
                              className="inline-flex items-center gap-2 self-start rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/20"
                            >
                              Update profile
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
                    <div className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-xl backdrop-blur">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-xs uppercase tracking-[0.24em] text-indigo-200">Analytics</p>
                        <h4 className="text-lg font-semibold text-white">Email performance</h4>
                        <p className="text-xs text-slate-400">
                          Snapshot of processed volume and AI triage results.
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <StatCard
                        label="Processed Today"
                        value={emailAnalytics.processedToday}
                        hint="Based on loaded messages"
                        tone="success"
                      />
                      <StatCard
                        label="Processed This Week"
                        value={emailAnalytics.processedWeek}
                        hint="Last 7 days"
                        tone="default"
                      />
                      <StatCard
                        label="Total Loaded"
                        value={emailAnalytics.totalLoaded}
                        hint="Current inbox view"
                        tone="default"
                      />
                      <StatCard
                        label="Avg Response Time"
                        value="—"
                        hint="Coming soon"
                        tone="warning"
                      />
                    </div>
                  </div>
                  <div className="grid gap-4">
                    <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-xl backdrop-blur">
                      <p className="text-sm font-semibold text-white">Tag distribution</p>
                      <div className="mt-3 space-y-2 text-xs text-slate-200">
                        {EMAIL_TAG_OPTIONS.map((tag) => (
                          <div
                            key={`analytics-tag-${tag}`}
                            className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-900/40 px-3 py-2"
                          >
                            <span>{tag}</span>
                            <span className="text-slate-300">{emailAnalytics.tagCounts[tag] || 0}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-xl backdrop-blur">
                      <p className="text-sm font-semibold text-white">Priority breakdown</p>
                      <div className="mt-3 space-y-2 text-xs text-slate-200">
                        {Object.keys(emailAnalytics.priorityCounts).map((label) => (
                          <div
                            key={`analytics-priority-${label}`}
                            className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-900/40 px-3 py-2"
                          >
                            <span>{label}</span>
                            <span className="text-slate-300">
                              {emailAnalytics.priorityCounts[label] || 0}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    </div>
                  </div>
                )}
              </section>
              {emailComposerOpen && (
                <div className="absolute inset-0 z-40 flex items-center justify-center px-4 py-6 dashboard-modal-backdrop">
                  <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-slate-950/90 p-4 shadow-2xl sm:p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs uppercase tracking-[0.24em] text-indigo-200">Compose</p>
                        <h4 className="text-lg font-semibold text-white">{emailComposerTitle}</h4>
                      </div>
                      <button
                        type="button"
                        onClick={closeComposer}
                        className={`rounded-lg border p-2 ${emailActionButtonClass}`}
                        aria-label="Close composer"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-4 grid gap-3 text-xs text-slate-200">
                      <div className="relative">
                        <input
                          type="text"
                          value={emailComposerForm.to}
                          onChange={(event) => handleContactFieldChange("to", event.target.value)}
                          onFocus={() => handleContactFieldFocus("to", emailComposerForm.to)}
                          placeholder="To"
                          className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-white placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none"
                        />
                        {contactSuggestOpen && contactSuggestField === "to" ? (
                          <div
                            className="absolute left-0 right-0 top-full z-30 mt-2 rounded-2xl border border-white/10 bg-slate-950/95 p-2 text-xs text-slate-100 shadow-xl"
                            onMouseDown={(event) => event.preventDefault()}
                          >
                            {contactSuggestLoading ? (
                              <p className="px-2 py-2 text-slate-300">Loading contacts...</p>
                            ) : contactSuggestError ? (
                              <p className="px-2 py-2 text-rose-300">{contactSuggestError}</p>
                            ) : contactSuggestions.length ? (
                              <div className="grid gap-1">
                                {contactSuggestions.map((contact) => (
                                  <button
                                    key={`to-${contact.id}`}
                                    type="button"
                                    onClick={() => handleContactSelect("to", contact)}
                                    className="flex w-full items-center justify-between rounded-xl px-2 py-2 text-left hover:bg-white/10"
                                  >
                                    <span className="font-semibold text-white">
                                      {contact.name || contact.email}
                                    </span>
                                    <span className="text-[10px] text-slate-400">{contact.email}</span>
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <p className="px-2 py-2 text-slate-400">No matches yet.</p>
                            )}
                          </div>
                        ) : null}
                      </div>
                      <div className="grid gap-2 md:grid-cols-2">
                        <div className="relative">
                          <input
                            type="text"
                            value={emailComposerForm.cc}
                            onChange={(event) => handleContactFieldChange("cc", event.target.value)}
                            onFocus={() => handleContactFieldFocus("cc", emailComposerForm.cc)}
                            placeholder="Cc"
                            className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-white placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none"
                          />
                          {contactSuggestOpen && contactSuggestField === "cc" ? (
                            <div
                              className="absolute left-0 right-0 top-full z-30 mt-2 rounded-2xl border border-white/10 bg-slate-950/95 p-2 text-xs text-slate-100 shadow-xl"
                              onMouseDown={(event) => event.preventDefault()}
                            >
                              {contactSuggestLoading ? (
                                <p className="px-2 py-2 text-slate-300">Loading contacts...</p>
                              ) : contactSuggestError ? (
                                <p className="px-2 py-2 text-rose-300">{contactSuggestError}</p>
                              ) : contactSuggestions.length ? (
                                <div className="grid gap-1">
                                  {contactSuggestions.map((contact) => (
                                    <button
                                      key={`cc-${contact.id}`}
                                      type="button"
                                      onClick={() => handleContactSelect("cc", contact)}
                                      className="flex w-full items-center justify-between rounded-xl px-2 py-2 text-left hover:bg-white/10"
                                    >
                                      <span className="font-semibold text-white">
                                        {contact.name || contact.email}
                                      </span>
                                      <span className="text-[10px] text-slate-400">{contact.email}</span>
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                <p className="px-2 py-2 text-slate-400">No matches yet.</p>
                              )}
                            </div>
                          ) : null}
                        </div>
                        <div className="relative">
                          <input
                            type="text"
                            value={emailComposerForm.bcc}
                            onChange={(event) => handleContactFieldChange("bcc", event.target.value)}
                            onFocus={() => handleContactFieldFocus("bcc", emailComposerForm.bcc)}
                            placeholder="Bcc"
                            className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-white placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none"
                          />
                          {contactSuggestOpen && contactSuggestField === "bcc" ? (
                            <div
                              className="absolute left-0 right-0 top-full z-30 mt-2 rounded-2xl border border-white/10 bg-slate-950/95 p-2 text-xs text-slate-100 shadow-xl"
                              onMouseDown={(event) => event.preventDefault()}
                            >
                              {contactSuggestLoading ? (
                                <p className="px-2 py-2 text-slate-300">Loading contacts...</p>
                              ) : contactSuggestError ? (
                                <p className="px-2 py-2 text-rose-300">{contactSuggestError}</p>
                              ) : contactSuggestions.length ? (
                                <div className="grid gap-1">
                                  {contactSuggestions.map((contact) => (
                                    <button
                                      key={`bcc-${contact.id}`}
                                      type="button"
                                      onClick={() => handleContactSelect("bcc", contact)}
                                      className="flex w-full items-center justify-between rounded-xl px-2 py-2 text-left hover:bg-white/10"
                                    >
                                      <span className="font-semibold text-white">
                                        {contact.name || contact.email}
                                      </span>
                                      <span className="text-[10px] text-slate-400">{contact.email}</span>
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                <p className="px-2 py-2 text-slate-400">No matches yet.</p>
                              )}
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <input
                        type="text"
                        value={emailComposerForm.subject}
                        onChange={(event) =>
                          setEmailComposerForm((prev) => ({ ...prev, subject: event.target.value }))
                        }
                        placeholder="Subject"
                        className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-white placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none"
                      />
                      <textarea
                        value={emailComposerForm.body}
                        onChange={(event) =>
                          setEmailComposerForm((prev) => ({ ...prev, body: event.target.value }))
                        }
                        placeholder="Write your message..."
                        rows={8}
                        className="w-full rounded-2xl border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-white placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-200">
                          <Paperclip className="h-3.5 w-3.5" />
                          Attach files
                          <input
                            type="file"
                            multiple
                            className="hidden"
                            onChange={handleComposerAttachmentChange}
                          />
                        </label>
                        {emailComposerAttachments.length ? (
                          <span className="text-[11px] text-slate-400">
                            {emailComposerAttachments.length} attachment
                            {emailComposerAttachments.length === 1 ? "" : "s"}
                          </span>
                        ) : null}
                      </div>
                      {emailComposerAttachments.length ? (
                        <div className="grid gap-1">
                          {emailComposerAttachments.map((file, idx) => (
                            <div
                              key={`${file.name}-${idx}`}
                              className="flex items-center justify-between rounded-lg border border-white/10 bg-slate-900/50 px-2 py-1 text-[11px] text-slate-200"
                            >
                              <span className="truncate">{file.name}</span>
                              <button
                                type="button"
                                onClick={() => removeComposerAttachment(idx)}
                                className="text-slate-300 hover:text-white"
                                aria-label={`Remove ${file.name}`}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {emailComposerAiStatus.status === "error" ? (
                        <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                          {emailComposerAiStatus.message}
                        </div>
                      ) : null}
                      {emailComposerAiStatus.status === "success" ? (
                        <div className="rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-100">
                          {emailComposerAiStatus.message}
                        </div>
                      ) : null}
                      {emailComposerStatus.status === "error" ? (
                        <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                          {emailComposerStatus.message}
                        </div>
                      ) : null}
                      {emailComposerStatus.status === "success" ? (
                        <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                          {emailComposerStatus.message}
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
                      <button
                        type="button"
                        onClick={closeComposer}
                        className="w-full rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-xs text-white sm:w-auto"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleGenerateEmailDraft}
                        disabled={
                          emailComposerAiStatus.status === "loading" ||
                          emailComposerStatus.status === "loading"
                        }
                        className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-indigo-300/50 bg-indigo-500/20 px-4 py-2 text-xs font-semibold text-indigo-100 disabled:opacity-60 sm:w-auto"
                      >
                        {emailComposerAiStatus.status === "loading"
                          ? "Generating..."
                          : "Generate with AI"}
                        <Sparkles className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSendEmail(emailComposerAttachments)}
                        disabled={emailComposerStatus.status === "loading"}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-300/50 bg-emerald-500/20 px-4 py-2 text-xs font-semibold text-emerald-100 disabled:opacity-60 sm:w-auto"
                      >
                        {emailComposerStatus.status === "loading" ? "Sending..." : "Send"}
                        <SendIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            </div>
          </ToolGate>
        )}

        {currentTool === "social_media_manager" && (
          <ToolGate
            locked={activeToolLocked}
            loading={subscriptionsLoading}
            message="Subscribe to the Social Media Manager to plan, approve, and schedule posts."
          >
            <div className="flex flex-col gap-4">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-xl backdrop-blur">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-indigo-200">Social command</p>
                    <h3 className="text-xl font-semibold text-white">Social Media Manager</h3>
                    <p className="text-sm text-slate-300">
                      Connect Meta + WhatsApp, respond from a unified inbox, and schedule posts.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {socialSubTabs.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setSocialTab(tab.id)}
                        className={`rounded-full border px-4 py-1.5 text-xs font-semibold transition ${
                          socialTab === tab.id
                            ? "border-indigo-400/70 bg-indigo-500/20 text-indigo-100"
                            : "border-white/10 bg-white/5 text-slate-200 hover:border-indigo-400/50"
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {socialTab === "connect" && (
                <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
                  <div className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-xl backdrop-blur">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-indigo-200">Meta OAuth</p>
                        <h4 className="text-lg font-semibold text-white">Connect Facebook + Instagram</h4>
                        <p className="text-sm text-slate-300">
                          Grant access to your Facebook Pages and Instagram Business accounts.
                        </p>
                      </div>
                      <div className="rounded-full border border-white/10 bg-white/5 p-2">
                        <Globe2 className="h-5 w-5 text-indigo-200" />
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={beginMetaConnect}
                        disabled={socialConnectStatus.status === "loading"}
                        className="inline-flex items-center gap-2 rounded-xl border border-indigo-300/50 bg-indigo-500/20 px-4 py-2 text-xs font-semibold text-indigo-100 disabled:opacity-60"
                      >
                        <Link2 className="h-4 w-4" />
                        {socialConnectStatus.status === "loading" ? "Connecting..." : "Connect Meta"}
                      </button>
                      {socialConnectStatus.message ? (
                        <span
                          className={`text-xs ${
                            socialConnectStatus.status === "error" ? "text-rose-300" : "text-emerald-200"
                          }`}
                        >
                          {socialConnectStatus.message}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-xl backdrop-blur">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-emerald-200">WhatsApp Cloud API</p>
                        <h4 className="text-lg font-semibold text-white">Connect WhatsApp</h4>
                        <p className="text-sm text-slate-300">
                          Authorize once to connect your WhatsApp Business number and sync messages.
                        </p>
                      </div>
                      <div className="rounded-full border border-white/10 bg-white/5 p-2">
                        <MessageSquare className="h-5 w-5 text-emerald-200" />
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={beginWhatsAppConnect}
                        disabled={whatsappStatus.status === "loading"}
                        className="inline-flex items-center gap-2 rounded-xl border border-emerald-300/50 bg-emerald-500/20 px-4 py-2 text-xs font-semibold text-emerald-100 disabled:opacity-60"
                      >
                        {whatsappStatus.status === "loading" ? "Connecting..." : "Connect WhatsApp"}
                      </button>
                      {whatsappConnected ? (
                        <span className="rounded-full border border-emerald-300/40 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-100">
                          Connected
                        </span>
                      ) : null}
                      {whatsappStatus.message ? (
                        <span
                          className={`text-xs ${
                            whatsappStatus.status === "error" ? "text-rose-300" : "text-emerald-200"
                          }`}
                        >
                          {whatsappStatus.message}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-4">
                      <button
                        type="button"
                        onClick={() => setShowWhatsappManual((prev) => !prev)}
                        className="text-xs text-slate-300 underline-offset-4 hover:underline"
                      >
                        {showWhatsappManual ? "Hide manual setup" : "Use manual token setup"}
                      </button>
                    </div>
                    {showWhatsappManual ? (
                      <div className="mt-4 grid gap-3 text-xs">
                        <input
                          type="text"
                          value={whatsappForm.phoneNumberId}
                          onChange={(event) =>
                            setWhatsappForm((prev) => ({ ...prev, phoneNumberId: event.target.value }))
                          }
                          placeholder="Phone number ID"
                          className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-white placeholder:text-slate-400"
                        />
                        <input
                          type="text"
                          value={whatsappForm.wabaId}
                          onChange={(event) =>
                            setWhatsappForm((prev) => ({ ...prev, wabaId: event.target.value }))
                          }
                          placeholder="WABA ID (optional)"
                          className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-white placeholder:text-slate-400"
                        />
                        <input
                          type="password"
                          value={whatsappForm.token}
                          onChange={(event) =>
                            setWhatsappForm((prev) => ({ ...prev, token: event.target.value }))
                          }
                          placeholder="Permanent access token"
                          className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-white placeholder:text-slate-400"
                        />
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={handleWhatsAppConnect}
                            disabled={whatsappStatus.status === "loading"}
                            className="inline-flex items-center gap-2 rounded-xl border border-emerald-300/50 bg-emerald-500/20 px-4 py-2 text-xs font-semibold text-emerald-100 disabled:opacity-60"
                          >
                            {whatsappStatus.status === "loading" ? "Connecting..." : "Save manual connect"}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="lg:col-span-2 rounded-3xl border border-white/10 bg-white/5 p-5 shadow-xl backdrop-blur">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Connected channels</p>
                        <h4 className="text-lg font-semibold text-white">Active connections</h4>
                      </div>
                      <button
                        type="button"
                        onClick={loadSocialConnections}
                        className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Refresh
                      </button>
                    </div>
                    {socialConnectionsLoading ? (
                      <div className="mt-4">
                        <InlineLoader label="Loading connections..." />
                      </div>
                    ) : socialConnectionsError ? (
                      <div className="mt-4 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                        {socialConnectionsError}
                      </div>
                    ) : socialConnections.length ? (
                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        {socialConnections.map((conn) => (
                          <div
                            key={`connection-${conn.id}`}
                            className="rounded-2xl border border-white/10 bg-slate-900/50 p-4"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-white">
                                  {conn.display_name || conn.external_account_id}
                                </p>
                                <p className="text-xs text-slate-400">{conn.external_account_id}</p>
                                <div className="mt-2 inline-flex items-center gap-2 text-xs text-slate-200">
                                  <span
                                    className={`rounded-full border px-2 py-0.5 ${
                                      socialPlatformStyles[
                                        conn.metadata?.meta_type === "instagram_business"
                                          ? "instagram"
                                          : conn.platform === "meta"
                                            ? "facebook"
                                            : conn.platform
                                      ] || "border-white/10 text-slate-200"
                                    }`}
                                  >
                                    {conn.metadata?.meta_type === "instagram_business"
                                      ? "Instagram"
                                      : conn.platform === "whatsapp_meta"
                                        ? "WhatsApp"
                                        : "Facebook"}
                                  </span>
                                  <span className="text-slate-400">{conn.status}</span>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => disconnectSocialConnection(conn.id)}
                                className="rounded-xl border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-200"
                              >
                                Disconnect
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-4 text-sm text-slate-300">
                        No channels connected yet. Connect Meta or WhatsApp to get started.
                      </p>
                    )}
                  </div>

                  <div className="lg:col-span-2 rounded-3xl border border-dashed border-white/10 bg-slate-900/40 p-5 text-sm text-slate-300">
                    X (Twitter) integration is coming soon. You can already reserve the channel in settings.
                  </div>
                </div>
              )}

              {socialTab === "inbox" && (
                <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
                  <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-xl backdrop-blur">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-sm font-semibold text-white">Conversations</h4>
                      <button
                        type="button"
                        onClick={loadSocialConversations}
                        className="rounded-xl border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-200"
                      >
                        Refresh
                      </button>
                    </div>
                    <div className="mt-3">
                      <input
                        type="search"
                        value={socialSearch}
                        onChange={(event) => setSocialSearch(event.target.value)}
                        placeholder="Search conversations"
                        className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-white placeholder:text-slate-400"
                      />
                    </div>
                    {whatsappConnections.length ? (
                      <div className="mt-4 rounded-2xl border border-white/10 bg-slate-900/50 p-3 text-xs text-slate-200">
                        <p className="text-[11px] uppercase tracking-[0.2em] text-emerald-200">
                          New WhatsApp Message
                        </p>
                        <div className="mt-2 grid gap-2">
                          <select
                            value={whatsappSendForm.connectionId}
                            onChange={(event) =>
                              setWhatsappSendForm((prev) => ({
                                ...prev,
                                connectionId: event.target.value
                              }))
                            }
                            className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-xs text-white"
                          >
                            {whatsappConnections.map((conn) => (
                              <option key={`wa-${conn.id}`} value={conn.id}>
                                {conn.metadata?.display_phone_number || conn.display_name || conn.external_account_id}
                              </option>
                            ))}
                          </select>
                          <input
                            type="text"
                            value={whatsappSendForm.to}
                            onChange={(event) =>
                              setWhatsappSendForm((prev) => ({ ...prev, to: event.target.value }))
                            }
                            placeholder="Recipient phone number (E.164)"
                            className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-xs text-white placeholder:text-slate-400"
                          />
                          <textarea
                            rows={3}
                            value={whatsappSendForm.text}
                            onChange={(event) =>
                              setWhatsappSendForm((prev) => ({ ...prev, text: event.target.value }))
                            }
                            placeholder="Write a message..."
                            className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-xs text-white placeholder:text-slate-400"
                          />
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={sendWhatsAppMessage}
                              disabled={whatsappSendStatus.status === "loading"}
                              className="inline-flex items-center gap-2 rounded-xl border border-emerald-300/50 bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-100 disabled:opacity-60"
                            >
                              {whatsappSendStatus.status === "loading" ? "Sending..." : "Send WhatsApp"}
                            </button>
                            {whatsappSendStatus.message ? (
                              <span
                                className={`text-[11px] ${
                                  whatsappSendStatus.status === "error" ? "text-rose-300" : "text-emerald-200"
                                }`}
                              >
                                {whatsappSendStatus.message}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-4 rounded-2xl border border-white/10 bg-slate-900/50 px-3 py-2 text-xs text-slate-300">
                        Connect WhatsApp to start new messages.
                      </div>
                    )}
                    <div className="mt-4 space-y-2">
                      {socialInboxLoading ? (
                        <InlineLoader label="Loading inbox..." />
                      ) : socialInboxError ? (
                        <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                          {socialInboxError}
                        </div>
                      ) : filteredSocialConversations.length ? (
                        filteredSocialConversations.map((conv) => {
                          const isActive = socialSelectedConversation?.id === conv.id;
                          const platformKey = conv.platform || "facebook";
                          return (
                            <button
                              key={`conv-${conv.id}`}
                              type="button"
                              onClick={() => setSocialSelectedConversation(conv)}
                              className={`w-full rounded-2xl border px-3 py-3 text-left text-xs transition ${
                                isActive
                                  ? "border-indigo-400/50 bg-indigo-500/20 text-indigo-100"
                                  : "border-white/10 bg-slate-900/50 text-slate-200 hover:border-indigo-400/40"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold">
                                  {conv.participant_name || conv.participant_handle || "Unknown"}
                                </span>
                                <span className="text-[11px] text-slate-400">
                                  {formatSocialTimestamp(conv.last_message_at)}
                                </span>
                              </div>
                              <div className="mt-1 line-clamp-2 text-slate-300">
                                {conv.last_message_text || "No message preview"}
                              </div>
                              <div className="mt-2 flex items-center justify-between">
                                <span
                                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] ${
                                    socialPlatformStyles[platformKey] || "border-white/10 text-slate-200"
                                  }`}
                                >
                                  {platformKey === "whatsapp_meta"
                                    ? "WhatsApp"
                                    : platformKey === "instagram"
                                      ? "Instagram"
                                      : "Facebook"}
                                </span>
                                <span className="text-[10px] text-slate-400">
                                  {conv.connection_name || conv.connection_platform || ""}
                                </span>
                              </div>
                            </button>
                          );
                        })
                      ) : (
                        <p className="text-xs text-slate-300">No conversations yet.</p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-xl backdrop-blur">
                    {socialSelectedConversation ? (
                      <div className="flex h-full flex-col gap-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Thread</p>
                            <h4 className="text-lg font-semibold text-white">
                              {socialSelectedConversation.participant_name ||
                                socialSelectedConversation.participant_handle ||
                                "Conversation"}
                            </h4>
                          </div>
                          <span
                            className={`rounded-full border px-3 py-1 text-[11px] ${
                              socialPlatformStyles[socialSelectedConversation.platform] ||
                              "border-white/10 text-slate-200"
                            }`}
                          >
                            {socialSelectedConversation.platform === "whatsapp_meta"
                              ? "WhatsApp"
                              : socialSelectedConversation.platform === "instagram"
                                ? "Instagram"
                                : "Facebook"}
                          </span>
                        </div>

                        <div className="flex-1 space-y-3 overflow-y-auto rounded-2xl border border-white/10 bg-slate-900/40 p-4">
                          {socialMessagesLoading ? (
                            <InlineLoader label="Loading messages..." />
                          ) : socialMessagesError ? (
                            <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                              {socialMessagesError}
                            </div>
                          ) : socialMessages.length ? (
                            socialMessages.map((msg) => (
                              <div
                                key={`msg-${msg.id}`}
                                className={`flex ${msg.direction === "outbound" ? "justify-end" : "justify-start"}`}
                              >
                                <div
                                  className={`max-w-[80%] rounded-2xl border px-3 py-2 text-xs ${
                                    msg.direction === "outbound"
                                      ? "border-indigo-400/40 bg-indigo-500/20 text-indigo-100"
                                      : "border-white/10 bg-slate-800/60 text-slate-100"
                                  }`}
                                >
                                  <p className="whitespace-pre-wrap">{msg.text || "Attachment received."}</p>
                                  <p className="mt-1 text-[10px] text-slate-400">
                                    {formatSocialTimestamp(msg.message_ts)}
                                  </p>
                                </div>
                              </div>
                            ))
                          ) : (
                            <p className="text-xs text-slate-300">No messages yet.</p>
                          )}
                        </div>

                        <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-3">
                          <textarea
                            rows={3}
                            value={socialReplyText}
                            onChange={(event) => setSocialReplyText(event.target.value)}
                            placeholder="Write a reply..."
                            className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-xs text-white placeholder:text-slate-400"
                          />
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={requestSocialSuggestion}
                                disabled={socialSuggestStatus.status === "loading"}
                                className="rounded-xl border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-200"
                              >
                                {socialSuggestStatus.status === "loading" ? "Suggesting..." : "Suggest reply"}
                              </button>
                              {socialSuggestStatus.status === "error" ? (
                                <span className="text-xs text-rose-300">{socialSuggestStatus.message}</span>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              onClick={sendSocialReply}
                              disabled={socialReplyStatus.status === "loading"}
                              className="inline-flex items-center gap-2 rounded-xl border border-indigo-300/50 bg-indigo-500/20 px-4 py-2 text-xs font-semibold text-indigo-100 disabled:opacity-60"
                            >
                              {socialReplyStatus.status === "loading" ? "Sending..." : "Send"}
                              <SendIcon className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          {socialReplyStatus.message ? (
                            <div
                              className={`mt-2 text-xs ${
                                socialReplyStatus.status === "error" ? "text-rose-300" : "text-emerald-200"
                              }`}
                            >
                              {socialReplyStatus.message}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-slate-300">
                        Select a conversation to view messages.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {socialTab === "posts" && (
                <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
                  <div className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-xl backdrop-blur">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-indigo-200">Draft composer</p>
                        <h4 className="text-lg font-semibold text-white">Create a new post</h4>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSocialDraftId(null);
                          setSocialDraftForm({ caption: "", mediaUrls: [""] });
                        }}
                        className="rounded-xl border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-200"
                      >
                        New draft
                      </button>
                    </div>
                    <div className="mt-4 space-y-3">
                      <textarea
                        rows={5}
                        value={socialDraftForm.caption}
                        onChange={(event) =>
                          setSocialDraftForm((prev) => ({ ...prev, caption: event.target.value }))
                        }
                        placeholder="Write your caption..."
                        className="w-full rounded-2xl border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-white placeholder:text-slate-400"
                      />
                      <div className="space-y-2">
                        {socialDraftForm.mediaUrls.map((url, idx) => (
                          <div key={`media-url-${idx}`} className="flex items-center gap-2">
                            <input
                              type="url"
                              value={url}
                              onChange={(event) => {
                                const value = event.target.value;
                                setSocialDraftForm((prev) => ({
                                  ...prev,
                                  mediaUrls: prev.mediaUrls.map((item, itemIdx) =>
                                    itemIdx === idx ? value : item
                                  )
                                }));
                              }}
                              placeholder="Media URL (image)"
                              className="flex-1 rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-white placeholder:text-slate-400"
                            />
                            {socialDraftForm.mediaUrls.length > 1 ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setSocialDraftForm((prev) => ({
                                    ...prev,
                                    mediaUrls: prev.mediaUrls.filter((_, itemIdx) => itemIdx !== idx)
                                  }))
                                }
                                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200"
                              >
                                Remove
                              </button>
                            ) : null}
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() =>
                            setSocialDraftForm((prev) => ({ ...prev, mediaUrls: [...prev.mediaUrls, ""] }))
                          }
                          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200"
                        >
                          Add media URL
                        </button>
                        <div className="flex flex-wrap items-center gap-3">
                          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-emerald-300/50 bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-100">
                            Upload image
                            <input
                              ref={socialUploadInputRef}
                              type="file"
                              accept="image/*"
                              onChange={handleSocialMediaUpload}
                              className="hidden"
                            />
                          </label>
                          <span className="text-[11px] text-slate-400">JPG, PNG, or WebP. Instagram needs an image.</span>
                          {socialUploadStatus.message ? (
                            <span
                              className={`text-[11px] ${
                                socialUploadStatus.status === "error"
                                  ? "text-rose-300"
                                  : socialUploadStatus.status === "success"
                                    ? "text-emerald-200"
                                    : "text-slate-300"
                              }`}
                            >
                              {socialUploadStatus.message}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-3">
                          <p className="text-xs font-semibold text-slate-200">Facebook Page</p>
                          <select
                            value={socialTargets.facebook_page_id}
                            onChange={(event) =>
                              setSocialTargets((prev) => ({ ...prev, facebook_page_id: event.target.value }))
                            }
                            className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-white"
                          >
                            <option value="">Select page</option>
                            {facebookConnections.map((conn) => (
                              <option key={`fb-${conn.id}`} value={conn.external_account_id}>
                                {conn.display_name || conn.external_account_id}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-3">
                          <p className="text-xs font-semibold text-slate-200">Instagram Business</p>
                          <select
                            value={socialTargets.instagram_user_id}
                            onChange={(event) =>
                              setSocialTargets((prev) => ({ ...prev, instagram_user_id: event.target.value }))
                            }
                            className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-white"
                          >
                            <option value="">Select account</option>
                            {instagramConnections.map((conn) => (
                              <option key={`ig-${conn.id}`} value={conn.external_account_id}>
                                {conn.display_name || conn.external_account_id}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={saveSocialDraft}
                          className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs text-slate-200"
                        >
                          Save draft
                        </button>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={publishSocialPost}
                            disabled={socialPublishStatus.status === "loading"}
                            className="inline-flex items-center gap-2 rounded-xl border border-indigo-300/50 bg-indigo-500/20 px-4 py-2 text-xs font-semibold text-indigo-100 disabled:opacity-60"
                          >
                            {socialPublishStatus.status === "loading" ? "Publishing..." : "Publish now"}
                          </button>
                          <div className="flex items-center gap-2">
                            <input
                              type="datetime-local"
                              value={socialScheduleAt}
                              onChange={(event) => setSocialScheduleAt(event.target.value)}
                              className="rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-white"
                            />
                            <button
                              type="button"
                              onClick={scheduleSocialPost}
                              disabled={socialScheduleStatus.status === "loading"}
                              className="rounded-xl border border-emerald-300/50 bg-emerald-500/20 px-4 py-2 text-xs font-semibold text-emerald-100 disabled:opacity-60"
                            >
                              {socialScheduleStatus.status === "loading" ? "Scheduling..." : "Schedule"}
                            </button>
                          </div>
                        </div>
                      </div>
                      {socialPublishStatus.message ? (
                        <div
                          className={`text-xs ${
                            socialPublishStatus.status === "error" ? "text-rose-300" : "text-emerald-200"
                          }`}
                        >
                          {socialPublishStatus.message}
                        </div>
                      ) : null}
                      {socialScheduleStatus.message ? (
                        <div
                          className={`text-xs ${
                            socialScheduleStatus.status === "error" ? "text-rose-300" : "text-emerald-200"
                          }`}
                        >
                          {socialScheduleStatus.message}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid gap-4">
                    <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-xl backdrop-blur">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="text-sm font-semibold text-white">Draft library</h4>
                        <button
                          type="button"
                          onClick={loadSocialDrafts}
                          className="rounded-xl border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-200"
                        >
                          Refresh
                        </button>
                      </div>
                      {socialDraftsLoading ? (
                        <div className="mt-3">
                          <InlineLoader label="Loading drafts..." />
                        </div>
                      ) : socialDraftsError ? (
                        <div className="mt-3 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                          {socialDraftsError}
                        </div>
                      ) : socialDrafts.length ? (
                        <div className="mt-3 space-y-2">
                          {socialDrafts.map((draft) => (
                            <button
                              key={`draft-${draft.id}`}
                              type="button"
                              onClick={() => {
                                setSocialDraftId(draft.id);
                                setSocialDraftForm({
                                  caption: draft.caption || "",
                                  mediaUrls: draft.media_urls?.length ? draft.media_urls : [""]
                                });
                              }}
                              className={`w-full rounded-2xl border px-3 py-3 text-left text-xs ${
                                socialDraftId === draft.id
                                  ? "border-indigo-400/50 bg-indigo-500/20 text-indigo-100"
                                  : "border-white/10 bg-slate-900/50 text-slate-200"
                              }`}
                            >
                              <p className="font-semibold">
                                {draft.caption ? draft.caption.slice(0, 60) : "Untitled draft"}
                              </p>
                              <p className="mt-1 text-[11px] text-slate-400">
                                {draft.media_urls?.length ? `${draft.media_urls.length} media link(s)` : "No media"}
                              </p>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-3 text-xs text-slate-300">No drafts yet.</p>
                      )}
                    </div>

                    <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-xl backdrop-blur">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="text-sm font-semibold text-white">Scheduled posts</h4>
                        <button
                          type="button"
                          onClick={loadSocialScheduled}
                          className="rounded-xl border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-200"
                        >
                          Refresh
                        </button>
                      </div>
                      {socialScheduledLoading ? (
                        <div className="mt-3">
                          <InlineLoader label="Loading schedule..." />
                        </div>
                      ) : socialScheduledError ? (
                        <div className="mt-3 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                          {socialScheduledError}
                        </div>
                      ) : socialScheduledPosts.length ? (
                        <div className="mt-3 space-y-2">
                          {socialScheduledPosts.map((post) => (
                            <div
                              key={`scheduled-${post.id}`}
                              className="rounded-2xl border border-white/10 bg-slate-900/50 px-3 py-3 text-xs text-slate-200"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold">Draft #{post.draft_id}</span>
                                <span className="text-[11px] text-slate-400">
                                  {formatSocialTimestamp(post.scheduled_for)}
                                </span>
                              </div>
                              <div className="mt-1 flex items-center justify-between text-[11px]">
                                <span className="text-slate-400">Status</span>
                                <span
                                  className={`rounded-full border px-2 py-0.5 ${
                                    post.status === "published"
                                      ? "border-emerald-400/40 text-emerald-200"
                                      : post.status === "failed"
                                        ? "border-rose-400/40 text-rose-200"
                                        : "border-white/10 text-slate-200"
                                  }`}
                                >
                                  {post.status}
                                </span>
                              </div>
                              {post.last_error ? (
                                <p className="mt-2 text-[11px] text-rose-300">{post.last_error}</p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-3 text-xs text-slate-300">No scheduled posts yet.</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </ToolGate>
        )}
          </div>
        </div>
      </div>
      {(editingEvent || calendarEditMode === "create") && (
        <div className="calendar-modal">
          <div className="calendar-modal-card">
            <div className="calendar-modal-header">
              <div>
                <p className="calendar-modal-eyebrow">
                  {calendarEditMode === "create" ? "Create event" : "Edit event"}
                </p>
                <h4 className="calendar-modal-title">
                  {calendarEditMode === "create"
                    ? "New calendar event"
                    : editingEvent?.summary || "Untitled event"}
                </h4>
              </div>
              <button
                type="button"
                className="calendar-modal-close"
                onClick={() => {
                  setEditingEvent(null);
                  setCalendarEditMode("edit");
                }}
              >
                Close
              </button>
            </div>
            <div className="calendar-modal-body">
              <label>
                Title
                <input
                  type="text"
                  value={calendarEditForm.title}
                  onChange={(event) =>
                    setCalendarEditForm((prev) => ({ ...prev, title: event.target.value }))
                  }
                  placeholder="Event title"
                />
              </label>
              <label>
                Start time
                <input
                  type="datetime-local"
                  value={calendarEditForm.start}
                  onChange={(event) =>
                    setCalendarEditForm((prev) => ({ ...prev, start: event.target.value }))
                  }
                />
              </label>
              <label>
                End time
                <input
                  type="datetime-local"
                  value={calendarEditForm.end}
                  onChange={(event) =>
                    setCalendarEditForm((prev) => ({ ...prev, end: event.target.value }))
                  }
                />
              </label>
              <label>
                Notes
                <textarea
                  rows={3}
                  value={calendarEditForm.description}
                  onChange={(event) =>
                    setCalendarEditForm((prev) => ({
                      ...prev,
                      description: event.target.value
                    }))
                  }
                  placeholder="Add a note for this event"
                />
              </label>
              {calendarUpdateStatus.message ? (
                <div className={`calendar-modal-message ${calendarUpdateStatus.status}`}>
                  {calendarUpdateStatus.message}
                </div>
              ) : null}
            </div>
            <div className="calendar-modal-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setEditingEvent(null);
                  setCalendarEditMode("edit");
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                onClick={handleCalendarSave}
                disabled={calendarUpdateStatus.status === "loading"}
              >
                {calendarUpdateStatus.status === "loading"
                  ? "Saving..."
                  : calendarEditMode === "create"
                    ? "Create event"
                    : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}
      {taskManagerEmailTarget ? (
        <div className="calendar-modal">
          <div className="calendar-modal-card">
            <div className="calendar-modal-header">
              <div>
                <p className="calendar-modal-eyebrow">Task manager</p>
                <h4 className="calendar-modal-title">Schedule email follow-up</h4>
              </div>
              <button
                type="button"
                className="calendar-modal-close"
                onClick={() => {
                  setTaskManagerEmailTarget(null);
                  setTaskManagerEmailStatus({ status: "idle", message: "" });
                }}
              >
                Close
              </button>
            </div>
            <div className="calendar-modal-body">
              <label>
                Title
                <input
                  type="text"
                  value={taskManagerEmailForm.title}
                  onChange={(event) =>
                    setTaskManagerEmailForm((prev) => ({ ...prev, title: event.target.value }))
                  }
                  placeholder="Task title"
                />
              </label>
              <label>
                Start time
                <input
                  type="datetime-local"
                  value={taskManagerEmailForm.start}
                  onChange={(event) =>
                    setTaskManagerEmailForm((prev) => ({ ...prev, start: event.target.value }))
                  }
                />
              </label>
              <label>
                End time
                <input
                  type="datetime-local"
                  value={taskManagerEmailForm.end}
                  onChange={(event) =>
                    setTaskManagerEmailForm((prev) => ({ ...prev, end: event.target.value }))
                  }
                />
              </label>
              <label>
                Notes
                <textarea
                  rows={3}
                  value={taskManagerEmailForm.description}
                  onChange={(event) =>
                    setTaskManagerEmailForm((prev) => ({
                      ...prev,
                      description: event.target.value
                    }))
                  }
                  placeholder="Add follow-up details"
                />
              </label>
              {taskManagerEmailStatus.message ? (
                <div className={`calendar-modal-message ${taskManagerEmailStatus.status}`}>
                  {taskManagerEmailStatus.message}
                </div>
              ) : null}
            </div>
            <div className="calendar-modal-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setTaskManagerEmailTarget(null);
                  setTaskManagerEmailStatus({ status: "idle", message: "" });
                }}
                disabled={taskManagerEmailStatus.status === "loading"}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                onClick={handleEmailTaskManagerSave}
                disabled={taskManagerEmailStatus.status === "loading"}
              >
                Add to Task Manager
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {promptHistoryOpen && (
        <div className="calendar-modal">
          <div className="calendar-modal-card">
            <div className="calendar-modal-header">
              <div>
                <p className="calendar-modal-eyebrow">AI prompt registry</p>
                <h4 className="calendar-modal-title">Prompt versions</h4>
              </div>
              <button
                type="button"
                className="calendar-modal-close"
                onClick={() => setPromptHistoryOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="calendar-modal-body">
              {promptHistoryStatus.status === "loading" ? (
                <div className="text-xs text-slate-300">Loading prompt history...</div>
              ) : promptHistoryStatus.status === "error" ? (
                <div className="text-xs text-rose-300">{promptHistoryStatus.message}</div>
              ) : promptHistory.length ? (
                <div className="grid gap-2">
                  {promptHistory.map((prompt) => (
                    <div
                      key={prompt.id}
                      className="rounded-2xl border border-white/10 bg-slate-900/50 px-3 py-3 text-xs text-slate-200"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">Version v{prompt.version}</span>
                        <span
                          className={`rounded-full border px-2 py-0.5 ${
                            prompt.isActive
                              ? "border-emerald-300/40 text-emerald-200"
                              : "border-white/10 text-slate-300"
                          }`}
                        >
                          {prompt.isActive ? "Active" : "Inactive"}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                        <span>Updated</span>
                        <span>{prompt.updatedAt ? formatDate(prompt.updatedAt) : "—"}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                        <span>Task</span>
                        <span>{prompt.taskType || "Default"}</span>
                      </div>
                      {!prompt.isActive ? (
                        <div className="mt-3">
                          <button
                            type="button"
                            onClick={() => handlePromptActivate(prompt.version)}
                            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-3 py-1 text-xs font-semibold text-white"
                          >
                            Activate
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-slate-300">No prompt versions yet.</div>
              )}
            </div>
            {promptActionStatus.message ? (
              <div className={`calendar-modal-message ${promptActionStatus.status}`}>
                {promptActionStatus.message}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
