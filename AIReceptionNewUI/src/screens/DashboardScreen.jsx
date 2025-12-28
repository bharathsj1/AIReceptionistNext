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
  Edit3,
  FileText,
  Globe2,
  Inbox,
  Link2,
  Mail,
  MailOpen,
  MailPlus,
  Megaphone,
  MessageSquare,
  Mic,
  Paperclip,
  PhoneCall,
  RefreshCw,
  Reply,
  Shield,
  Star,
  Tag,
  Trash2,
  X,
  User as UserIcon
} from "lucide-react";
import { API_URLS } from "../config/urls";

const formatDuration = (seconds) => {
  if (!seconds && seconds !== 0) return "—";
  const mins = Math.floor(Number(seconds) / 60);
  const secs = Number(seconds) % 60;
  return `${mins}m ${secs.toString().padStart(2, "0")}s`;
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
  "Sales Lead",
  "Support",
  "Invoice",
  "Internal",
  "Updates",
  "Marketing",
  "Spam/Low Priority"
];

const REPLY_TONE_PRESETS = ["Professional", "Friendly", "Short", "Empathetic"];

const priorityBadgeStyles = {
  Urgent: "border-rose-400/60 bg-rose-500/20 text-rose-100",
  Important: "border-amber-400/60 bg-amber-400/20 text-amber-200",
  Normal: "border-indigo-400/60 bg-indigo-500/15 text-indigo-200",
  Low: "border-sky-400/50 bg-sky-500/10 text-sky-100"
};

const sentimentStyles = {
  Angry: "text-rose-200",
  Concerned: "text-amber-200",
  Happy: "text-emerald-200",
  Neutral: "text-slate-200"
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

const StatCard = ({ label, value, hint, icon: Icon, tone = "default" }) => {
  const tones = {
    default: "bg-slate-900/60 border-slate-800 text-slate-200",
    success: "bg-emerald-900/50 border-emerald-800 text-emerald-100",
    warning: "bg-amber-900/40 border-amber-800 text-amber-100"
  };
  return (
    <div className={`rounded-2xl border p-4 shadow-lg backdrop-blur ${tones[tone] || tones.default}`}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{label}</p>
          <div className="mt-1 text-2xl font-semibold leading-tight">{value}</div>
          {hint && <p className="text-xs text-slate-400">{hint}</p>}
        </div>
        {Icon ? <Icon className="h-5 w-5 text-slate-400" /> : null}
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
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-3xl bg-slate-950/30 backdrop-blur-sm">
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
  const [businessForm, setBusinessForm] = useState({
    name: clientData?.business_name || clientData?.name || "",
    phone: clientData?.business_phone || "",
    website: clientData?.website_url || ""
  });
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
  const [emailSubTab, setEmailSubTab] = useState("email");
  const [emailMailbox, setEmailMailbox] = useState("INBOX");
  const [emailUnreadOnly, setEmailUnreadOnly] = useState(false);
  const [emailAutoSummarize, setEmailAutoSummarize] = useState(true);
  const [emailPanelOpen, setEmailPanelOpen] = useState(false);
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
  const [emailSummaryVisible, setEmailSummaryVisible] = useState(true);
  const [emailInlineReplyOpen, setEmailInlineReplyOpen] = useState(false);
  const [emailInlineReplyMessageId, setEmailInlineReplyMessageId] = useState(null);
  const [emailInlineAttachments, setEmailInlineAttachments] = useState([]);
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
  const [sideNavHidden, setSideNavHidden] = useState(false);
  const [showHolidayCalendars, setShowHolidayCalendars] = useState(true);
  const [showBirthdayEvents, setShowBirthdayEvents] = useState(true);
  const calendarRef = useRef(null);
  const calendarRangeCacheRef = useRef(new Set());
  const calendarFetchTimerRef = useRef(null);
  const emailLoadedRef = useRef(false);
  const emailLabelsLoadedRef = useRef(false);
  const emailClassifyTimerRef = useRef(null);
  const emailActionsTimerRef = useRef(null);
  const socialConnectionsLoadedRef = useRef(false);
  const socialDraftsLoadedRef = useRef(false);
  const socialScheduledLoadedRef = useRef(false);
  const sideNavHideTimerRef = useRef(null);

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
    if (sideNavHidden) {
      if (sideNavHideTimerRef.current) {
        clearTimeout(sideNavHideTimerRef.current);
      }
      return;
    }

    const resetTimer = () => {
      if (sideNavHideTimerRef.current) {
        clearTimeout(sideNavHideTimerRef.current);
      }
      sideNavHideTimerRef.current = setTimeout(() => {
        setSideNavHidden(true);
      }, 5000);
    };

    const activityEvents = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];
    resetTimer();
    activityEvents.forEach((eventName) => window.addEventListener(eventName, resetTimer));

    return () => {
      if (sideNavHideTimerRef.current) {
        clearTimeout(sideNavHideTimerRef.current);
      }
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, resetTimer));
    };
  }, [sideNavHidden]);

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
          backgroundColor: allDay ? "rgba(59, 130, 246, 0.55)" : "rgba(59, 130, 246, 0.85)",
          borderColor: allDay ? "rgba(59, 130, 246, 0.8)" : "rgba(59, 130, 246, 1)",
          textColor: "#f8fafc",
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
      const res = await fetch(`${API_URLS.emailMessages}?${params.toString()}`);
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
      setEmailMessages((prev) => (append ? [...prev, ...incoming] : incoming));
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

  const openComposer = (mode = "new", message = null) => {
    setEmailComposerMode(mode);
    setEmailComposerStatus({ status: "idle", message: "" });
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
    } else {
      const sender = parseSender(message.from);
      const subject =
        mode === "reply"
          ? message.subject?.startsWith("Re:")
            ? message.subject
            : `Re: ${message.subject || ""}`.trim()
          : message.subject?.startsWith("Fwd:")
            ? message.subject
            : `Fwd: ${message.subject || ""}`.trim();
      const replyBody = `\n\n---\n${message.snippet || ""}`.trim();
      setEmailComposerForm({
        to: mode === "reply" ? sender.email : "",
        cc: "",
        bcc: "",
        subject,
        body: replyBody,
        threadId: message.threadId || "",
        inReplyTo: message.messageIdHeader || message.inReplyTo || "",
        references: message.references || message.messageIdHeader || ""
      });
    }
    setEmailComposerOpen(true);
  };

  const handleSendEmail = async (attachments = []) => {
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
      const attachmentPayload = (attachments || [])
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
      if (emailMailbox === "SENT" || emailMailbox === "ALL_MAIL") {
        handleEmailRefresh();
      }
      return true;
    } catch (err) {
      setEmailComposerStatus({ status: "error", message: err?.message || "Unable to send email." });
      return false;
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
      const bodyText = data?.body || data?.snippet || "";
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
    return {
      to: mode === "reply" ? sender.email : "",
      cc: "",
      bcc: "",
      subject,
      body: draftText || "",
      threadId: message.threadId || "",
      inReplyTo: message.messageIdHeader || message.inReplyTo || "",
      references: message.references || message.messageIdHeader || ""
    };
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

  const handleInlineAttachmentChange = async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    const items = await Promise.all(
      files.map(async (file) => ({
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        data: await readFileAsBase64(file)
      }))
    );
    setEmailInlineAttachments((prev) => [...prev, ...items]);
    event.target.value = "";
  };

  const removeInlineAttachment = (index) => {
    setEmailInlineAttachments((prev) => prev.filter((_, idx) => idx !== index));
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
      const payload = buildEmailAiPayload(message);
      const res = await fetch(API_URLS.emailClassify, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Unable to classify email"));
      }
      const data = await res.json().catch(() => ({}));
      const next = {
        tags: Array.isArray(data?.tags) ? data.tags : [],
        priorityScore: Number(data?.priorityScore) || 0,
        priorityLabel: data?.priorityLabel || "Normal",
        sentiment: data?.sentiment || "Neutral"
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

  const toolTabs = [
    {
      id: "ai_receptionist",
      label: "AI Receptionist",
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
      label: "Social Media Manager",
      eyebrow: "Content ops",
      icon: Megaphone,
      copy: "Plan content, enforce brand safety, and schedule multi-channel posts."
    }
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
  const emailSubTabItems = [
    { id: "email", label: "Email", icon: Mail },
    { id: "settings", label: "Settings", icon: Edit3 },
    { id: "analytics", label: "Analytics", icon: Activity }
  ];
  const socialSubTabs = [
    { id: "connect", label: "Connect" },
    { id: "inbox", label: "Inbox" },
    { id: "posts", label: "Posts" }
  ];

  const isToolLocked = (toolId) => {
    const entry = toolSubscriptions?.[toolId];
    if (entry && typeof entry.active === "boolean") return !entry.active;
    if (subscriptionsLoading) return false;
    return true;
  };

  const currentTool = activeTool || "ai_receptionist";
  const isEmailManager = currentTool === "email_manager";
  const activeToolLocked = isToolLocked(currentTool);
  const activeToolMeta = toolTabs.find((tool) => tool.id === currentTool);
  const activeToolLabel = activeToolMeta?.label || "AI tool";
  const activeToolCopy =
    activeToolMeta?.copy || "Full control over your AI agents, analytics, and automations.";
  const ActiveIcon = activeToolMeta?.icon || Shield;
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
  const gmailStatusLabel = gmailConnected
    ? "Gmail connected"
    : googleConnected
      ? "Google connected (calendar only)"
      : "Not connected";
  const emailHasNext = Boolean(emailPageTokens[emailCurrentPage]);
  const selectedEmailIds = Array.from(emailSelectedIds);
  const emailSelectionCount = selectedEmailIds.length;
  const emailAllSelected = Boolean(emailMessages.length && emailSelectionCount === emailMessages.length);
  const emailActionLoading = emailActionStatus.status === "loading";
  const emailActionError = emailActionStatus.status === "error" ? emailActionStatus.message : "";
  const emailActionSuccess = emailActionStatus.status === "success" ? emailActionStatus.message : "";
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

  useEffect(() => {
    setBusinessForm({
      name: clientData?.business_name || clientData?.name || "",
      phone: clientData?.business_phone || "",
      website: clientData?.website_url || ""
    });
  }, [clientData?.business_name, clientData?.business_phone, clientData?.name, clientData?.website_url]);

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
    if (currentTool !== "email_manager" || emailSubTab !== "email") return;
    if (!selectedEmailMessage?.id) return;
    const status = emailClassifyStatus?.[selectedEmailMessage.id]?.status;
    if (emailClassifications?.[selectedEmailMessage.id]) return;
    if (status === "loading") return;
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
    setSelectedEmailMessage(null);
    setEmailError("");
    setEmailSummaryStatus({ status: "idle", message: "" });
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

    const tagCounts = EMAIL_TAG_OPTIONS.reduce((acc, tag) => {
      acc[tag] = 0;
      return acc;
    }, {});
    const priorityCounts = {
      Urgent: 0,
      Important: 0,
      Normal: 0,
      Low: 0
    };

    Object.values(emailClassifications || {}).forEach((classification) => {
      const tags = classification?.tags || [];
      tags.forEach((tag) => {
        if (tagCounts[tag] !== undefined) {
          tagCounts[tag] += 1;
        }
      });
      const label = classification?.priorityLabel;
      if (label && priorityCounts[label] !== undefined) {
        priorityCounts[label] += 1;
      }
    });

    return {
      processedToday,
      processedWeek,
      totalLoaded: emailMessages.length,
      tagCounts,
      priorityCounts
    };
  }, [emailClassifications, emailMessages]);

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

  const integrationStatus = calendarStatus || (calendarEvents?.length ? "Google" : null);
  const selectedProviderLabel = selectedCalendarProvider === "google" ? "Google" : "Outlook";
  const selectedProviderConnected =
    selectedCalendarProvider === "google" ? Boolean(integrationStatus) : false;
  const sideNavWidthClass = sideNavHidden
    ? "w-0 min-w-0 max-w-0"
    : sideNavOpen
      ? "w-full max-w-[22%] min-w-[220px]"
      : "w-20";

  return (
    <section
      className={`relative bg-slate-950 px-0 sm:px-2 lg:px-4 pt-2 pb-4 text-slate-100 ${
        isEmailManager ? "min-h-screen sm:h-screen sm:overflow-hidden" : "min-h-screen"
      }`}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(99,102,241,0.08),transparent_32%),radial-gradient(circle_at_80%_0%,rgba(16,185,129,0.08),transparent_32%)]" />
      <div className="absolute -left-6 -right-6 -top-6 bottom-0 bg-slate-950/60 backdrop-blur-3xl" />
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
              className="mt-3 -translate-x-1/2 rounded-full border border-white/5 bg-white/5 px-2 py-1 text-[11px] text-slate-400 opacity-40"
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
        <div className={`flex ${sideNavHidden ? "gap-0" : "gap-3"} ${isEmailManager ? "h-full min-h-0" : ""}`}>
          <aside
            aria-hidden={sideNavHidden}
            inert={sideNavHidden ? "" : undefined}
            className={`sticky top-0 flex h-fit flex-col gap-3 rounded-3xl border border-white/10 bg-white/5 p-4 shadow-2xl backdrop-blur transition-all ${sideNavWidthClass} ${
              sideNavHidden
                ? "pointer-events-none overflow-hidden border-transparent bg-transparent p-0 opacity-0 shadow-none"
                : ""
            }`}
          >
            <div className={`flex items-center ${sideNavOpen ? "justify-between" : "justify-center"} gap-2`}>
              {sideNavOpen && (
                <button
                  type="button"
                  onClick={handleGoHome}
                  className="flex items-center gap-2 text-[11px] tracking-[0.2em] text-indigo-200 transition hover:text-indigo-100"
                  aria-label="Go to home"
                >
                  <img src="/media/logo.png" alt="SmartConnect4u" className="h-5 w-5" />
                  <span>SmartConnect4u</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setSideNavOpen((prev) => !prev)}
                className={`rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-200 transition hover:border-white/30 ${
                  sideNavOpen ? "" : "mx-auto"
                }`}
                aria-label={sideNavOpen ? "Collapse menu" : "Expand menu"}
              >
                {sideNavOpen ? "⟨" : "⟩"}
              </button>
            </div>
            <div className="mt-2 grid gap-2">
              {toolTabs.map((tool) => {
                const Icon = tool.icon;
                const locked = isToolLocked(tool.id);
                return (
                  <button
                    key={tool.id}
                    onClick={() => {
                      setActiveTool?.(tool.id);
                      if (tool.id === "ai_receptionist") setActiveTab?.("dashboard");
                    }}
                    className={`flex items-center ${
                      sideNavOpen ? "justify-start gap-3 px-3" : "justify-center"
                    } rounded-2xl border py-2 text-left transition ${
                      currentTool === tool.id
                        ? "border-indigo-400/70 bg-indigo-500/10 text-white"
                        : "border-white/10 bg-white/5 text-slate-200 hover:border-white/25 hover:bg-white/10"
                    }`}
                  >
                    <Icon className="h-5 w-5 text-indigo-200" />
                    {sideNavOpen && (
                      <div className="flex-1">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-indigo-200">{tool.eyebrow}</p>
                        <p className="text-sm font-semibold text-white">{tool.label}</p>
                      </div>
                    )}
                    {sideNavOpen && (
                      <span
                        className={`ml-auto rounded-full border px-2 py-1 text-[10px] font-semibold ${
                          locked
                            ? "border-white/15 bg-white/5 text-slate-200"
                            : "border-emerald-200/60 bg-emerald-500/20 text-emerald-50"
                        }`}
                      >
                        {subscriptionsLoading && !toolSubscriptions?.[tool.id]
                          ? "Checking..."
                          : locked
                            ? "Locked"
                            : "Active"}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {showResumeBusinessAction && (
              <button
                type="button"
                onClick={onResumeBusinessDetails}
                className={`mt-2 inline-flex items-center justify-center rounded-2xl border border-indigo-400/60 bg-indigo-500/15 px-3 py-2 text-xs font-semibold text-indigo-100 transition hover:-translate-y-0.5 hover:border-indigo-300 hover:bg-indigo-500/25 ${
                  sideNavOpen ? "" : "px-0"
                }`}
              >
                {sideNavOpen ? "Enter business details" : "Go"}
              </button>
            )}
          </aside>

          <div className={`flex flex-1 flex-col gap-5 ${isEmailManager ? "min-h-0" : ""}`}>
            {currentTool !== "email_manager" && (
            <header className="flex flex-col gap-3 rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <ActiveIcon className="h-10 w-10 text-indigo-300" />
                  <div>
                    <p className="text-xs uppercase tracking-[0.28em] text-indigo-200">
                      Dashboard · {activeToolLabel}
                    </p>
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
                  {onLogout && (
                    <button
                      className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:border-white/40 hover:bg-white/20"
                      type="button"
                      onClick={onLogout}
                    >
                      Logout
                    </button>
                  )}
                </div>
              </div>
              {currentTool === "ai_receptionist" && (
                <div className="flex flex-wrap items-center gap-2">
                  {["dashboard", "agents", "calls", "business", "integrations"].map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab?.(tab)}
                      className={`rounded-full border px-3 py-1 text-sm capitalize transition ${
                        activeTab === tab
                          ? "border-indigo-400 bg-indigo-500/20 text-indigo-100"
                          : "border-white/10 bg-white/5 text-slate-200 hover:border-white/30"
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
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

        {currentTool === "ai_receptionist" && (
          <ToolGate
            locked={activeToolLocked}
            loading={subscriptionsLoading}
            message="Purchase the AI Receptionist to unlock live calls, agents, and integrations."
          >
            <div className="relative">
              <div className={showNumberGate ? "pointer-events-none blur-[2px] opacity-60 transition" : "transition"}>
                {activeTab === "dashboard" && (
                  <>
                <section className="grid gap-4 md:grid-cols-4">
                  <StatCard label="Total Calls" value={analytics.totalCalls} hint="All time" icon={PhoneCall} />
                  <StatCard
                    label="Answered"
                    value={`${analytics.answeredRate}%`}
                    hint="Completed calls"
                    icon={CheckCircle2}
                    tone="success"
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
                              className="flex-1 rounded-full bg-gradient-to-t from-indigo-500/30 via-indigo-400/60 to-emerald-300/80"
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
            )}

        {activeTab === "agents" && (
          <section className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-xl backdrop-blur">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-indigo-200">Agent control</p>
                <h3 className="text-xl font-semibold text-white">
                  {agentDetails.agentName || "Ultravox Agent"}
                </h3>
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
                      {lang}
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
                    ? "Loading Ultravox voices..."
                    : `${filteredVoiceOptions.length} voices available`}
                </span>
              </div>
              {selectedVoice?.sampleUrl ? (
                <div className="mt-2">
                  <audio controls className="w-full" src={selectedVoice.sampleUrl}>
                    Your browser does not support audio playback.
                  </audio>
                </div>
              ) : null}

              <label className="mt-2 text-sm text-slate-200">System prompt</label>
              <textarea
                rows={6}
                value={agentDetails.systemPrompt || ""}
                onChange={(e) => setAgentDetails({ ...agentDetails, systemPrompt: e.target.value })}
                className="w-full max-h-64 min-h-[160px] overflow-y-auto rounded-2xl border border-white/10 bg-slate-900/60 p-3 text-sm text-slate-100 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
                placeholder="Guide your agent's behavior and personality."
              />

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
                <input
                  type="text"
                  value={businessForm.name}
                  onChange={(e) => setBusinessForm({ ...businessForm, name: e.target.value })}
                  placeholder="Business name"
                  className="rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
                />
                <input
                  type="tel"
                  value={businessForm.phone}
                  onChange={(e) => setBusinessForm({ ...businessForm, phone: e.target.value })}
                  placeholder="Business phone"
                  className="rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
                />
                <input
                  type="url"
                  value={businessForm.website}
                  onChange={(e) => setBusinessForm({ ...businessForm, website: e.target.value })}
                  placeholder="Website URL"
                  className="rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
                />
                <div className="flex items-center gap-2">
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
          </section>
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
                Streaming transcripts from Twilio + Ultravox (polling on select)
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
                          <div className="flex items-center justify-between text-sm font-semibold">
                            <span>{fromLabel}</span>
                            <span className="text-xs text-slate-300">{formatDate(startLabel)}</span>
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
                  {callTranscript?.recordings?.length ? (
                    <div className="mt-2 text-xs text-slate-400">
                      Recordings:{" "}
                      {callTranscript.recordings.map((r) => r.sid).join(", ")}
                    </div>
                  ) : null}
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
                    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-slate-950/60 backdrop-blur">
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
              className={`email-manager-shell min-h-screen sm:h-full sm:min-h-0 ${emailTheme === "light" ? "email-theme-light" : ""}`}
            >
              <div className="relative grid gap-4 sm:h-full sm:min-h-0 sm:grid-rows-[auto,1fr] sm:overflow-hidden">
              <section
                className={`grid gap-4 sm:h-full sm:min-h-0 sm:overflow-hidden ${
                  emailSubTab === "email"
                    ? emailPanelOpen
                      ? "lg:grid-cols-[180px_1.25fr_1.6fr]"
                      : "lg:grid-cols-[64px_1.41fr_1.6fr]"
                    : emailPanelOpen
                      ? "lg:grid-cols-[180px_1.55fr]"
                      : "lg:grid-cols-[64px_1.84fr]"
                }`}
              >
                <aside
                  className={`rounded-3xl border border-white/10 bg-white/5 shadow-xl backdrop-blur overflow-hidden flex flex-col sm:min-h-0 sm:h-full ${
                    emailPanelOpen ? "p-3 sm:p-4" : "p-2"
                  }`}
                >
                  <div className={`flex items-center ${emailPanelOpen ? "justify-between" : "justify-center"}`}>
                    {emailPanelOpen && (
                      <p className="text-[11px] uppercase tracking-[0.28em] text-indigo-200">Gmail inbox</p>
                    )}
                    <button
                      type="button"
                      onClick={() => setEmailPanelOpen((prev) => !prev)}
                      className={`rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-200 transition hover:border-white/30 ${
                        emailPanelOpen ? "" : "mx-auto"
                      }`}
                      aria-label={emailPanelOpen ? "Collapse inbox panel" : "Expand inbox panel"}
                    >
                      {emailPanelOpen ? "⟨" : "⟩"}
                    </button>
                  </div>

                  <div className={`mt-4 ${emailPanelOpen ? "" : "flex justify-center"}`}>
                    <button
                      type="button"
                      onClick={() => openComposer("new")}
                      className={`inline-flex items-center justify-center rounded-xl border border-emerald-300/50 bg-emerald-500/20 text-xs font-semibold text-emerald-50 transition hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-emerald-500/30 ${
                        emailPanelOpen ? "w-full gap-2 px-3 py-2" : "h-10 w-10"
                      }`}
                      aria-label="Compose email"
                    >
                      <MailPlus className="h-4 w-4" />
                      {emailPanelOpen ? "New mail" : null}
                    </button>
                  </div>

                  {emailPanelOpen ? (
                    <>
                      {emailSubTab === "email" ? (
                        <div className="mt-4 border-t border-white/10 pt-4">
                          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Mailboxes</p>
                          <div className="mt-2 grid gap-1">
                            {mailboxItems.map((item) => {
                              const Icon = item.icon;
                              const isActive = emailMailbox === item.id;
                              return (
                                <button
                                  key={item.id}
                                  type="button"
                                  onClick={() => handleMailboxSelect(item.id)}
                                  className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs transition ${
                                    isActive
                                      ? "border-indigo-400/50 bg-indigo-500/15 text-indigo-100"
                                      : "border-white/10 bg-slate-900/40 text-slate-200 hover:border-white/30"
                                  }`}
                                >
                                  <span className="flex items-center gap-2">
                                    <Icon className="h-4 w-4" />
                                    {item.label}
                                  </span>
                                  {isActive ? null : null}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                      <div className="mt-auto border-t border-white/10 pt-4">
                        <div className="grid gap-2">
                          {emailSubTabItems.map((item) => {
                            const Icon = item.icon;
                            const isActive = emailSubTab === item.id;
                            return (
                              <button
                                key={`email-nav-${item.id}`}
                                type="button"
                                onClick={() => setEmailSubTab(item.id)}
                                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                                  isActive
                                    ? "border-indigo-400 bg-indigo-500/20 text-indigo-100"
                                    : "border-white/10 bg-white/5 text-slate-200 hover:border-white/30"
                                }`}
                              >
                                <Icon className="h-4 w-4" />
                                {item.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="mt-4 flex w-full flex-1 flex-col items-center">
                      {emailSubTab === "email" ? (
                        <div className="flex w-full flex-row flex-wrap items-center justify-center gap-3 sm:flex-col">
                          {mailboxItems.map((item) => {
                            const Icon = item.icon;
                            const isActive = emailMailbox === item.id;
                            return (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => handleMailboxSelect(item.id)}
                                className={`flex h-9 w-9 items-center justify-center rounded-lg border transition ${
                                  isActive
                                    ? "border-indigo-400/60 bg-indigo-500/15 text-indigo-100"
                                    : "border-white/10 bg-slate-900/40 text-slate-200 hover:border-white/30"
                                }`}
                                aria-label={item.label}
                                title={item.label}
                              >
                                <Icon className="h-5 w-5" />
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                      <div className="mt-auto flex flex-col items-center gap-2 border-t border-white/10 pt-3">
                        {emailSubTabItems.map((item) => {
                          const Icon = item.icon;
                          const isActive = emailSubTab === item.id;
                          return (
                            <button
                              key={`email-nav-collapsed-${item.id}`}
                              type="button"
                              onClick={() => setEmailSubTab(item.id)}
                              className={`flex h-9 w-9 items-center justify-center rounded-lg border transition ${
                                isActive
                                  ? "border-indigo-400/60 bg-indigo-500/15 text-indigo-100"
                                  : "border-white/10 bg-slate-900/40 text-slate-200 hover:border-white/30"
                              }`}
                              aria-label={item.label}
                              title={item.label}
                            >
                              <Icon className="h-4 w-4" />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </aside>

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
                          className="rounded-lg border border-white/10 bg-white/10 p-2 text-white"
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
                      <span className="shrink-0 text-[11px] text-slate-400">
                        {emailSelectionCount ? `${emailSelectionCount} selected` : ""}
                      </span>
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
                        className="shrink-0 rounded-lg border border-white/10 bg-white/10 p-2 text-white disabled:cursor-not-allowed disabled:opacity-50"
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
                        className="shrink-0 rounded-lg border border-white/10 bg-white/10 p-2 text-white disabled:cursor-not-allowed disabled:opacity-50"
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
                        className="shrink-0 rounded-lg border border-white/10 bg-white/10 p-2 text-white disabled:cursor-not-allowed disabled:opacity-50"
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
                        className="shrink-0 rounded-lg border border-white/10 bg-white/10 p-2 text-white disabled:cursor-not-allowed disabled:opacity-50"
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
                        className="shrink-0 rounded-lg border border-white/10 bg-white/10 p-2 text-white disabled:cursor-not-allowed disabled:opacity-50"
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
                          <span className="text-[10px] uppercase tracking-[0.2em] text-slate-400">AI</span>
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
                            Classify
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
                        const isEscalation =
                          ["Angry", "Concerned"].includes(sentiment) &&
                          (priorityLabel === "Urgent" || priorityScore >= 80);
                        const hasReplyDraft = replyVariants.length > 0;
                        const hasInsights =
                          tags.length > 0 ||
                          Boolean(classification?.priorityLabel) ||
                          Boolean(classification?.priorityScore) ||
                          Boolean(classification?.sentiment);
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
                              </div>
                            </div>
                            {emailSummaryVisible ? (
                              <div className="absolute inset-0 flex items-center justify-center p-4">
                                <div className="pointer-events-none absolute inset-0 rounded-2xl bg-slate-950/70 backdrop-blur-xl" />
                                <div
                                  className="relative z-10 w-full max-w-xl max-h-[80vh] overflow-y-auto overscroll-contain rounded-2xl border border-white/10 bg-slate-950/95 p-3 shadow-xl backdrop-blur pointer-events-auto sm:p-4"
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
                                      className="rounded-lg border border-white/10 bg-white/10 p-2 text-white"
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
                                            Angry or concerned sentiment with high priority.
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
                                  </div>
                                  <div className="mt-4 grid gap-3">
                                    <div className="rounded-xl border border-white/10 bg-slate-900/40 p-3">
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div>
                                          <p className="text-xs uppercase tracking-[0.24em] text-indigo-200">Insights</p>
                                          <p className="text-[11px] text-slate-400">Tags, priority, sentiment.</p>
                                        </div>
                                        <span className="text-[11px] text-slate-400">
                                          {classifyStatus.status === "loading" ? "Classifying..." : ""}
                                        </span>
                                      </div>
                                      {classifyStatus.status === "loading" ? (
                                        <div className="mt-3">
                                          <AiDots label="Classifying message..." />
                                          <div className="mt-2">
                                            <AiSkeleton lines={["w-1/2", "w-1/3", "w-2/3"]} />
                                          </div>
                                        </div>
                                      ) : classifyStatus.status === "error" ? (
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
                  <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
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
                      <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-3 text-xs text-slate-300">
                        Summaries are generated using OpenAI. We only send the selected email content.
                      </div>
                    </div>
                  </div>
                  <div className="grid gap-4">
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
                <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/70 px-4 py-6 backdrop-blur">
                  <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-slate-950/90 p-4 shadow-2xl sm:p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs uppercase tracking-[0.24em] text-indigo-200">Compose</p>
                        <h4 className="text-lg font-semibold text-white">{emailComposerTitle}</h4>
                      </div>
                      <button
                        type="button"
                        onClick={() => setEmailComposerOpen(false)}
                        className="rounded-lg border border-white/10 bg-white/10 p-2 text-white"
                        aria-label="Close composer"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-4 grid gap-3 text-xs text-slate-200">
                      <input
                        type="text"
                        value={emailComposerForm.to}
                        onChange={(event) =>
                          setEmailComposerForm((prev) => ({ ...prev, to: event.target.value }))
                        }
                        placeholder="To"
                        className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-white placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none"
                      />
                      <div className="grid gap-2 md:grid-cols-2">
                        <input
                          type="text"
                          value={emailComposerForm.cc}
                          onChange={(event) =>
                            setEmailComposerForm((prev) => ({ ...prev, cc: event.target.value }))
                          }
                          placeholder="Cc"
                          className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-white placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none"
                        />
                        <input
                          type="text"
                          value={emailComposerForm.bcc}
                          onChange={(event) =>
                            setEmailComposerForm((prev) => ({ ...prev, bcc: event.target.value }))
                          }
                          placeholder="Bcc"
                          className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-white placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none"
                        />
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
                        onClick={() => setEmailComposerOpen(false)}
                        className="w-full rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-xs text-white sm:w-auto"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleSendEmail}
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
                        <p className="text-xs uppercase tracking-[0.2em] text-emerald-200">WhatsApp</p>
                        <h4 className="text-lg font-semibold text-white">Manual Cloud API connect</h4>
                        <p className="text-sm text-slate-300">
                          Paste your phone number ID and permanent token to start receiving messages.
                        </p>
                      </div>
                      <div className="rounded-full border border-white/10 bg-white/5 p-2">
                        <MessageSquare className="h-5 w-5 text-emerald-200" />
                      </div>
                    </div>
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
                          {whatsappStatus.status === "loading" ? "Connecting..." : "Connect WhatsApp"}
                        </button>
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
                    </div>
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
    </section>
  );
}
