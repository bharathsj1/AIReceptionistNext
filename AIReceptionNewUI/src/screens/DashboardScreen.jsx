import { useEffect, useMemo, useState } from "react";
import "@fullcalendar/react/dist/vdom";
import FullCalendar from "@fullcalendar/react";
import interactionPlugin from "@fullcalendar/interaction";
import timeGridPlugin from "@fullcalendar/timegrid";
import "@fullcalendar/common/main.css";
import "@fullcalendar/timegrid/main.css";
import {
  Activity,
  CalendarClock,
  CheckCircle2,
  Edit3,
  Globe2,
  Mail,
  Megaphone,
  Mic,
  PhoneCall,
  RefreshCw,
  Shield,
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

const ToolGate = ({ locked, loading, message, children }) => (
  <div className="relative">
    <div className={locked ? "pointer-events-none blur-[2px] opacity-60 transition" : "transition"}>
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
  onLogout
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

  const calendarItems = useMemo(
    () =>
      (calendarEvents || []).map((event) => {
        const start = event.start?.dateTime || event.start?.date || null;
        const end = event.end?.dateTime || event.end?.date || null;
        const allDay = Boolean(event.start?.date && !event.start?.dateTime);
        return {
          id: event.id,
          title: event.summary || "No title",
          start,
          end,
          allDay,
          extendedProps: { raw: event, provider: "google" }
        };
      }),
    [calendarEvents]
  );

  const visibleCalendarItems = useMemo(() => {
    if (selectedCalendarProvider === "google") return calendarItems;
    return [];
  }, [calendarItems, selectedCalendarProvider]);

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
      eyebrow: "Inbox command",
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

  const isToolLocked = (toolId) => {
    const entry = toolSubscriptions?.[toolId];
    if (entry && typeof entry.active === "boolean") return !entry.active;
    if (subscriptionsLoading) return false;
    return true;
  };

  const currentTool = activeTool || "ai_receptionist";
  const activeToolLocked = isToolLocked(currentTool);
  const activeToolMeta = toolTabs.find((tool) => tool.id === currentTool);
  const activeToolLabel = activeToolMeta?.label || "AI tool";
  const activeToolCopy =
    activeToolMeta?.copy || "Full control over your AI agents, analytics, and automations.";
  const ActiveIcon = activeToolMeta?.icon || Shield;

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

  const primaryVoice = agentDetails.voice;
  const voiceOptions = useMemo(
    () =>
      (ultravoxVoices || []).map((v) => ({
        id: v.id || v.voiceId || v.voice_id,
        name: v.name || v.label || v.voice || v.id,
        locale: v.locale || v.language || "",
        gender: v.gender || v.style || ""
      })),
    [ultravoxVoices]
  );

  const integrationStatus = calendarStatus || (calendarEvents?.length ? "Google" : null);
  const selectedProviderLabel = selectedCalendarProvider === "google" ? "Google" : "Outlook";
  const selectedProviderConnected =
    selectedCalendarProvider === "google" ? Boolean(integrationStatus) : false;

  return (
    <section className="relative min-h-screen bg-slate-950 px-6 py-6 text-slate-100">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(99,102,241,0.08),transparent_32%),radial-gradient(circle_at_80%_0%,rgba(16,185,129,0.08),transparent_32%)]" />
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-3xl" />
      <div className="relative mx-auto flex w-full max-w-screen-2xl flex-col gap-5">
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
                <div className="rounded-2xl border border-emerald-400/40 bg-emerald-900/40 px-4 py-3 text-sm font-semibold text-emerald-100 shadow">
                  <p className="text-xs uppercase tracking-[0.2em] text-emerald-200">AI Number</p>
                  <div className="flex items-center gap-2 text-lg">
                    <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
                    {aiNumber || "Pending assignment"}
                  </div>
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
          <div className="grid gap-3 md:grid-cols-3">
            {toolTabs.map((tool) => {
              const Icon = tool.icon;
              const locked = isToolLocked(tool.id);
              const statusLabel =
                subscriptionsLoading && !toolSubscriptions?.[tool.id]
                  ? "Checking..."
                  : locked
                    ? "Locked"
                    : "Active";
              return (
                <button
                  key={tool.id}
                  onClick={() => {
                    setActiveTool?.(tool.id);
                    if (tool.id === "ai_receptionist") setActiveTab?.("dashboard");
                  }}
                  className={`group flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                    currentTool === tool.id
                      ? "border-indigo-400/70 bg-indigo-500/10 shadow-lg shadow-indigo-900/40"
                      : "border-white/10 bg-white/5 hover:border-white/25 hover:bg-white/10"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon className="h-5 w-5 text-indigo-200" />
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.18em] text-indigo-200">
                        {tool.eyebrow}
                      </p>
                      <p className="text-base font-semibold text-white">{tool.label}</p>
                    </div>
                  </div>
                  <span
                    className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                      locked
                        ? "border-white/15 bg-white/5 text-slate-200"
                        : "border-emerald-200/60 bg-emerald-500/20 text-emerald-50"
                    }`}
                  >
                    {statusLabel}
                  </span>
                </button>
              );
            })}
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

        {currentTool === "ai_receptionist" && (
          <ToolGate
            locked={activeToolLocked}
            loading={subscriptionsLoading}
            message="Purchase the AI Receptionist to unlock live calls, agents, and integrations."
          >
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

                <section className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
                  <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-2xl backdrop-blur">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="text-sm font-semibold text-white">Overview</div>
                      <span className="text-xs text-slate-400">Latest activity</span>
                    </div>
                    <div className="text-sm text-slate-300">
                      Use the tabs above to manage agents, inspect calls, edit business info, or manage integrations.
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
                  value={primaryVoice || ""}
                  onChange={(e) => setAgentDetails({ ...agentDetails, voice: e.target.value })}
                  className="w-full min-w-[220px] rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40 sm:w-auto"
                  disabled={ultravoxVoicesLoading}
                >
                  <option value="">Select a voice</option>
                  {voiceOptions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} {v.locale ? `• ${v.locale}` : ""} {v.gender ? `(${v.gender})` : ""}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-slate-400">
                  {ultravoxVoicesLoading
                    ? "Loading Ultravox voices..."
                    : `${voiceOptions.length} voices available`}
                </span>
              </div>

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
                            <span>{call.from || call.from_display || call.from_raw || "Unknown"}</span>
                            <span className="text-xs text-slate-300">{formatDate(call.start_time)}</span>
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
                    <span className="text-xs text-slate-400">
                      {callTranscript?.recordings?.length || 0} recording(s)
                    </span>
                  </div>
                  <div className="h-64 overflow-y-auto rounded-xl border border-white/5 bg-slate-950/60 p-3 text-sm text-slate-200">
                    {callTranscript?.loading ? (
                      <p className="text-slate-400">Loading transcript...</p>
                    ) : callTranscript?.error ? (
                      <p className="text-rose-300">{callTranscript.error}</p>
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
                <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-2">
                  <div className="calendar-shell" data-lenis-prevent>
                    <FullCalendar
                      plugins={[timeGridPlugin, interactionPlugin]}
                      initialView="timeGridWeek"
                      headerToolbar={{
                        left: "prev,next today",
                        center: "title",
                        right: "timeGridWeek,timeGridDay"
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
      </ToolGate>
    )}

        {currentTool === "email_manager" && (
          <ToolGate
            locked={activeToolLocked}
            loading={subscriptionsLoading}
            message="Subscribe to the Email Manager to unlock inbox automation."
          >
            <section className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-xl backdrop-blur">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-indigo-200">Inbox playbook</p>
                    <h3 className="text-xl font-semibold text-white">Automation blueprint</h3>
                    <p className="text-sm text-slate-300">
                      Route, summarize, and draft replies automatically with role-based approvals.
                    </p>
                  </div>
                  <div className="rounded-full border border-white/10 bg-white/5 p-2">
                    <Mail className="h-5 w-5 text-indigo-200" />
                  </div>
                </div>
                <div className="mt-4 grid gap-2 rounded-2xl border border-white/10 bg-slate-900/40 p-4 text-sm text-slate-100">
                  <div className="flex items-center justify-between">
                    <span>Auto-triage rules</span>
                    <span className="rounded-full border border-indigo-300/60 bg-indigo-500/20 px-3 py-1 text-xs font-semibold text-indigo-50">
                      Lead, Support, Billing
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Response styles</span>
                    <span className="text-xs text-slate-300">Friendly | Formal | Escalate</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>QA sampling</span>
                    <span className="text-xs text-slate-300">10% flagged for human review</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Signature + sender</span>
                    <span className="text-xs text-slate-300">Use shared inbox or agent persona</span>
                  </div>
                </div>
              </div>
              <div className="grid gap-3">
                <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-xl backdrop-blur">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-white">SLA guardrails</p>
                    <span className="text-xs text-slate-300">Live preview</span>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-slate-200">
                    <div className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-900/40 px-3 py-2">
                      <span>First response</span>
                      <span className="font-semibold">under 4 min</span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-900/40 px-3 py-2">
                      <span>Resolution</span>
                      <span className="font-semibold">within 1 hour</span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-900/40 px-3 py-2">
                      <span>Escalation</span>
                      <span className="font-semibold">Auto-route to team lead</span>
                    </div>
                  </div>
                </div>
                <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-xl backdrop-blur">
                  <p className="text-xs uppercase tracking-[0.24em] text-indigo-200">Coming soon</p>
                  <h4 className="mt-1 text-lg font-semibold text-white">CRM + ticket sync</h4>
                  <p className="text-sm text-slate-300">
                    Pipe summaries into your CRM, log dispositions, and sync assignments for clean reporting.
                  </p>
                </div>
              </div>
            </section>
          </ToolGate>
        )}

        {currentTool === "social_media_manager" && (
          <ToolGate
            locked={activeToolLocked}
            loading={subscriptionsLoading}
            message="Subscribe to the Social Media Manager to plan, approve, and schedule posts."
          >
            <section className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-xl backdrop-blur">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-indigo-200">Content engine</p>
                    <h3 className="text-xl font-semibold text-white">Publishing control room</h3>
                    <p className="text-sm text-slate-300">
                      Generate drafts, enforce tone, and stage posts for approval before they go live.
                    </p>
                  </div>
                  <div className="rounded-full border border-white/10 bg-white/5 p-2">
                    <Megaphone className="h-5 w-5 text-indigo-200" />
                  </div>
                </div>
                <div className="mt-4 grid gap-2 text-sm text-slate-200">
                  <div className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-900/40 px-3 py-2">
                    <span>Channels</span>
                    <span className="text-xs text-slate-300">Instagram · LinkedIn · X · Facebook</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-900/40 px-3 py-2">
                    <span>Brand safety</span>
                    <span className="text-xs text-slate-300">Forbidden phrases + compliance tags</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-900/40 px-3 py-2">
                    <span>Approval flow</span>
                    <span className="text-xs text-slate-300">Draft → Review → Schedule</span>
                  </div>
                </div>
              </div>
              <div className="grid gap-3">
                <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-xl backdrop-blur">
                  <p className="text-sm font-semibold text-white">Weekly calendar preview</p>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-200">
                    {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                      <div
                        key={day}
                        className="rounded-xl border border-white/10 bg-slate-900/50 p-3"
                      >
                        <p className="text-[11px] uppercase tracking-[0.12em] text-indigo-200">{day}</p>
                        <p className="mt-1 font-semibold text-white">2 posts scheduled</p>
                        <p className="text-slate-300">Captions + assets ready</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-3xl border border-dashed border-white/10 bg-slate-900/50 p-4 text-sm text-slate-200">
                  Listening + sentiment coming soon - aggregate comments and DMs to train the AI on what resonates.
                </div>
              </div>
            </section>
          </ToolGate>
        )}
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
