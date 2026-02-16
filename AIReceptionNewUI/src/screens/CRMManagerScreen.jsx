import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, BellRing } from "lucide-react";
import {
  createCrmContact,
  createCrmDeal,
  createCrmDealComment,
  createCrmEmailLink,
  createCrmTask,
  fetchCrmDashboard,
  exportCrmDealsReport,
  exportCrmTasksReport,
  getCrmDeal,
  getCrmTask,
  listCrmContacts,
  listCrmDeals,
  listCrmNotifications,
  listCrmTasks,
  listCrmUsers,
  markCrmNotificationRead,
  updateCrmContact,
  updateCrmDeal,
  updateCrmTask,
  createCrmTaskComment,
} from "../lib/api/crm";
import FilterBar from "../components/crm/FilterBar";
import EntityTable from "../components/crm/EntityTable";
import KanbanColumn from "../components/crm/KanbanColumn";
import DetailDrawer from "../components/crm/DetailDrawer";
import Timeline from "../components/crm/Timeline";
import CommentBox from "../components/crm/CommentBox";
import { Dialog, DialogContent } from "../components/ui/index.jsx";

const TASK_STATUS_OPTIONS = [
  { id: "new", label: "New" },
  { id: "in_progress", label: "In Progress" },
  { id: "blocked", label: "Blocked" },
  { id: "waiting", label: "Waiting" },
  { id: "completed", label: "Completed" },
  { id: "archived", label: "Archived" },
];

const DEAL_STAGES = [
  { id: "lead", label: "Lead" },
  { id: "qualified", label: "Qualified" },
  { id: "proposal", label: "Proposal" },
  { id: "negotiation", label: "Negotiation" },
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" },
];

const TASK_STATUS_THEME = {
  new: {
    chip: "bg-sky-500/15 text-sky-200 border-sky-400/40",
    tile: "border-sky-400/30 bg-sky-500/10",
  },
  in_progress: {
    chip: "bg-indigo-500/15 text-indigo-200 border-indigo-400/40",
    tile: "border-indigo-400/30 bg-indigo-500/10",
  },
  blocked: {
    chip: "bg-rose-500/15 text-rose-200 border-rose-400/40",
    tile: "border-rose-400/30 bg-rose-500/10",
  },
  waiting: {
    chip: "bg-amber-500/15 text-amber-200 border-amber-400/40",
    tile: "border-amber-400/30 bg-amber-500/10",
  },
  completed: {
    chip: "bg-emerald-500/15 text-emerald-200 border-emerald-400/40",
    tile: "border-emerald-400/30 bg-emerald-500/10",
  },
  archived: {
    chip: "bg-slate-500/20 text-slate-300 border-slate-400/40",
    tile: "border-slate-400/30 bg-slate-500/10",
  },
};

const DEAL_STAGE_THEME = {
  lead: {
    chip: "bg-cyan-500/15 text-cyan-200 border-cyan-400/40",
    tile: "border-cyan-400/30 bg-cyan-500/10",
  },
  qualified: {
    chip: "bg-violet-500/15 text-violet-200 border-violet-400/40",
    tile: "border-violet-400/30 bg-violet-500/10",
  },
  proposal: {
    chip: "bg-blue-500/15 text-blue-200 border-blue-400/40",
    tile: "border-blue-400/30 bg-blue-500/10",
  },
  negotiation: {
    chip: "bg-amber-500/15 text-amber-200 border-amber-400/40",
    tile: "border-amber-400/30 bg-amber-500/10",
  },
  won: {
    chip: "bg-emerald-500/15 text-emerald-200 border-emerald-400/40",
    tile: "border-emerald-400/30 bg-emerald-500/10",
  },
  lost: {
    chip: "bg-rose-500/15 text-rose-200 border-rose-400/40",
    tile: "border-rose-400/30 bg-rose-500/10",
  },
};

const currencyForCountry = (code) => {
  if (!code) return "USD";
  const upper = String(code).toUpperCase();
  if (upper === "CA") return "CAD";
  if (upper === "GB" || upper === "UK") return "GBP";
  if (["DE", "FR", "ES", "IT", "NL", "IE", "PT", "BE", "AT", "FI", "LU", "GR"].includes(upper)) return "EUR";
  if (upper === "AU") return "AUD";
  if (upper === "NZ") return "NZD";
  if (upper === "IN") return "INR";
  if (upper === "SG") return "SGD";
  if (upper === "AE") return "AED";
  if (upper === "JP") return "JPY";
  return "USD";
};

const formatMoney = (value, currency = "USD") => {
  const numeric = Number(value || 0);
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 0,
  }).format(numeric);
};

const formatStatus = (value) =>
  String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

const formatDateTime = (value) => {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString();
};

const toIsoDateTime = (value) => {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString();
};

const toDateTimeLocal = (value) => {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const hours = String(parsed.getHours()).padStart(2, "0");
  const minutes = String(parsed.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const toDateKey = (value) => {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const addDays = (value, days) => {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date();
  parsed.setDate(parsed.getDate() + days);
  return parsed;
};

const statusLabelToId = (label) => {
  const normalized = String(label || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  const match = TASK_STATUS_OPTIONS.find((entry) => entry.id === normalized);
  return match?.id || normalized;
};

export default function CRMManagerScreen({ user, businessName, geoCountryCode }) {
  const email = user?.email || "";
  const scope = String(user?.scope || "").toLowerCase();
  const role = scope === "primary_user" ? "admin" : "member";
  const canManage = role === "admin";
  const canCreateWorkItems = Boolean(email);
  const isPrimaryAdmin = role === "admin" && scope === "primary_user";

  const [activeTab, setActiveTab] = useState("dashboard");
  const [taskView, setTaskView] = useState("list");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dashboard, setDashboard] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [deals, setDeals] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [users, setUsers] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [taskFilters, setTaskFilters] = useState({
    assignee: "",
    status: "",
    priority: "",
    search: "",
  });
  const [selectedDay, setSelectedDay] = useState(() => toDateKey(new Date()));
  const [selectedTask, setSelectedTask] = useState(null);
  const [taskDetail, setTaskDetail] = useState(null);
  const [taskCommentBusy, setTaskCommentBusy] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState(null);
  const [dealDetail, setDealDetail] = useState(null);
  const [dealCommentBusy, setDealCommentBusy] = useState(false);
  const [taskCreateOpen, setTaskCreateOpen] = useState(false);
  const [dealCreateOpen, setDealCreateOpen] = useState(false);
  const [creatingTask, setCreatingTask] = useState({
    title: "",
    description: "",
    priority: "med",
    startDateTime: "",
    endDateTime: "",
    assignedToEmail: "",
  });
  const [creatingDeal, setCreatingDeal] = useState({
    name: "",
    description: "",
    stage: "lead",
    value: "",
    expectedCloseDate: "",
    ownerEmail: "",
  });
  const [creatingContact, setCreatingContact] = useState({
    name: "",
    email: "",
    phone: "",
    company: "",
    leadSource: "manual",
    lifecycleStage: "lead",
  });
  const [emailLinkForm, setEmailLinkForm] = useState({
    provider: "gmail",
    threadId: "",
    messageId: "",
    subject: "",
    snippet: "",
  });
  const [savingBusy, setSavingBusy] = useState(false);
  const dashboardCurrency = String(
    dashboard?.currency || currencyForCountry(geoCountryCode || "US")
  ).toUpperCase();
  const minSelectableDay = useMemo(() => toDateKey(addDays(new Date(), -30)), []);
  const maxSelectableDay = useMemo(() => toDateKey(addDays(new Date(), 30)), []);
  const todayDay = useMemo(() => toDateKey(new Date()), []);

  const clampSelectedDay = useCallback(
    (value) => {
      const next = String(value || "").trim();
      if (!next) return todayDay;
      if (next < minSelectableDay) return minSelectableDay;
      if (next > maxSelectableDay) return maxSelectableDay;
      return next;
    },
    [maxSelectableDay, minSelectableDay, todayDay]
  );

  const moveSelectedDay = useCallback(
    (deltaDays) => {
      const base = new Date(`${selectedDay}T00:00:00`);
      const next = toDateKey(addDays(base, deltaDays));
      setSelectedDay(clampSelectedDay(next));
    },
    [clampSelectedDay, selectedDay]
  );

  const loadDashboard = useCallback(async () => {
    if (!email) return;
    const data = await fetchCrmDashboard({
      email,
      query: geoCountryCode ? { countryCode: String(geoCountryCode).toUpperCase() } : {},
    });
    setDashboard(data);
  }, [email, geoCountryCode]);

  const loadTasks = useCallback(async () => {
    if (!email) return;
    const query = { limit: 100 };
    const dayStart = new Date(`${selectedDay}T00:00:00`);
    const dayEnd = new Date(`${selectedDay}T23:59:59.999`);
    query.dueAfter = dayStart.toISOString();
    query.dueBefore = dayEnd.toISOString();
    if (taskFilters.assignee) query.assignee = taskFilters.assignee;
    if (taskFilters.status) query.status = taskFilters.status;
    if (taskFilters.priority) query.priority = taskFilters.priority;
    if (taskFilters.search) query.search = taskFilters.search;
    const data = await listCrmTasks({ email, query });
    setTasks(Array.isArray(data?.items) ? data.items : []);
  }, [email, selectedDay, taskFilters.assignee, taskFilters.priority, taskFilters.search, taskFilters.status]);

  const loadDeals = useCallback(async () => {
    if (!email) return;
    const query = { limit: 100 };
    const dayStart = new Date(`${selectedDay}T00:00:00`);
    const dayEnd = new Date(`${selectedDay}T23:59:59.999`);
    query.expectedCloseAfter = dayStart.toISOString();
    query.expectedCloseBefore = dayEnd.toISOString();
    const data = await listCrmDeals({ email, query });
    setDeals(Array.isArray(data?.items) ? data.items : []);
  }, [email, selectedDay]);

  const loadContacts = useCallback(async () => {
    if (!email) return;
    const data = await listCrmContacts({ email });
    setContacts(Array.isArray(data?.items) ? data.items : []);
  }, [email]);

  const loadUsers = useCallback(async () => {
    if (!email) return;
    const data = await listCrmUsers({ email });
    setUsers(Array.isArray(data?.items) ? data.items : []);
  }, [email]);

  const loadNotifications = useCallback(async () => {
    if (!email) return;
    const data = await listCrmNotifications({ email });
    setNotifications(Array.isArray(data?.items) ? data.items : []);
  }, [email]);

  const refreshAll = useCallback(async () => {
    if (!email) return;
    setLoading(true);
    setError("");
    try {
      await Promise.all([
        loadDashboard(),
        loadTasks(),
        loadDeals(),
        loadContacts(),
        loadUsers(),
        loadNotifications(),
      ]);
    } catch (err) {
      setError(err?.message || "Unable to load CRM data.");
    } finally {
      setLoading(false);
    }
  }, [email, loadContacts, loadDashboard, loadDeals, loadNotifications, loadTasks, loadUsers]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const assigneeOptions = useMemo(() => {
    return users.map((entry) => ({
      value: entry.email,
      label: `${entry.email}${entry.workload ? ` (${entry.workload.openTasks} open)` : ""}`,
    }));
  }, [users]);

  const unreadNotificationsCount = useMemo(
    () => notifications.filter((item) => !item.read).length,
    [notifications]
  );
  const canMovePrevDay = selectedDay > minSelectableDay;
  const canMoveNextDay = selectedDay < maxSelectableDay;

  const taskColumns = useMemo(
    () => [
      { id: "title", label: "Task" },
      { id: "status", label: "Status", render: (row) => formatStatus(row.status) },
      { id: "priority", label: "Priority", render: (row) => String(row.priority || "").toUpperCase() || "—" },
      { id: "assignedToEmail", label: "Assignee" },
      {
        id: "startDateTime",
        label: "Start",
        render: (row) => formatDateTime(row.startDateTime),
      },
      {
        id: "endDateTime",
        label: "End",
        render: (row) => formatDateTime(row.endDateTime || row.dueDate),
      },
      {
        id: "progressPercent",
        label: "Progress",
        render: (row) => `${Math.max(0, Math.min(100, Number(row.progressPercent || 0)))}%`,
      },
    ],
    []
  );

  const taskByStatus = useMemo(() => {
    const bucket = {};
    TASK_STATUS_OPTIONS.forEach((entry) => {
      bucket[entry.id] = [];
    });
    tasks.forEach((task) => {
      const key = statusLabelToId(task.status);
      if (!bucket[key]) bucket[key] = [];
      bucket[key].push(task);
    });
    return bucket;
  }, [tasks]);

  const dealsByStage = useMemo(() => {
    const bucket = {};
    DEAL_STAGES.forEach((stage) => {
      bucket[stage.id] = [];
    });
    deals.forEach((deal) => {
      const key = String(deal.stage || "lead").toLowerCase();
      if (!bucket[key]) bucket[key] = [];
      bucket[key].push(deal);
    });
    return bucket;
  }, [deals]);

  const openTaskDetail = async (task) => {
    if (!task?.id) return;
    setSelectedTask(task);
    setTaskDetail(null);
    try {
      const data = await getCrmTask({ email, taskId: task.id });
      setTaskDetail(data);
    } catch (err) {
      setError(err?.message || "Unable to load task detail.");
    }
  };

  const openDealDetail = async (deal) => {
    if (!deal?.id) return;
    setSelectedDeal(deal);
    setDealDetail(null);
    try {
      const data = await getCrmDeal({ email, dealId: deal.id });
      setDealDetail(data);
    } catch (err) {
      setError(err?.message || "Unable to load deal detail.");
    }
  };

  const handleTaskMove = async (taskId, statusLabel) => {
    const nextStatus = statusLabelToId(statusLabel);
    const previous = [...tasks];
    const updatedLocal = previous.map((item) =>
      item.id === taskId ? { ...item, status: nextStatus, updatedAt: new Date().toISOString() } : item
    );
    setTasks(updatedLocal);
    try {
      const res = await updateCrmTask({ email, taskId, data: { status: nextStatus } });
      setTasks((current) => current.map((item) => (item.id === taskId ? res.item : item)));
      if (selectedTask?.id === taskId) {
        setSelectedTask(res.item);
        setTaskDetail((prev) => ({ ...(prev || {}), item: res.item }));
      }
      loadDashboard();
    } catch (err) {
      setTasks(previous);
      setError(err?.message || "Unable to update task status.");
    }
  };

  const handleDealMove = async (dealId, stageLabel) => {
    const nextStage = statusLabelToId(stageLabel);
    const previous = [...deals];
    setDeals((current) => current.map((deal) => (deal.id === dealId ? { ...deal, stage: nextStage } : deal)));
    try {
      const res = await updateCrmDeal({ email, dealId, data: { stage: nextStage } });
      setDeals((current) => current.map((deal) => (deal.id === dealId ? res.item : deal)));
      if (selectedDeal?.id === dealId) {
        setSelectedDeal(res.item);
        setDealDetail((prev) => ({ ...(prev || {}), item: res.item }));
      }
      loadDashboard();
    } catch (err) {
      setDeals(previous);
      setError(err?.message || "Unable to update deal stage.");
    }
  };

  const handleCreateTask = async () => {
    if (!canCreateWorkItems) return;
    if (!creatingTask.title.trim()) {
      setError("Task title is required.");
      return;
    }
    const startIso = toIsoDateTime(creatingTask.startDateTime);
    const endIso = toIsoDateTime(creatingTask.endDateTime);
    if (startIso && endIso && new Date(endIso) <= new Date(startIso)) {
      setError("End date/time must be after start date/time.");
      return;
    }
    setSavingBusy(true);
    try {
      await createCrmTask({
        email,
        data: {
          ...creatingTask,
          title: creatingTask.title.trim(),
          startDateTime: startIso,
          endDateTime: endIso,
          dueDate: endIso,
          assignedToEmail: creatingTask.assignedToEmail,
        },
      });
      setCreatingTask({
        title: "",
        description: "",
        priority: "med",
        startDateTime: "",
        endDateTime: "",
        assignedToEmail: "",
      });
      setTaskCreateOpen(false);
      await Promise.all([loadTasks(), loadDashboard(), loadNotifications()]);
    } catch (err) {
      setError(err?.message || "Unable to create task.");
    } finally {
      setSavingBusy(false);
    }
  };

  const handleCreateDeal = async () => {
    if (!canCreateWorkItems) return;
    if (!creatingDeal.name.trim()) {
      setError("Deal name is required.");
      return;
    }
    setSavingBusy(true);
    try {
      await createCrmDeal({
        email,
        data: {
          ...creatingDeal,
          name: creatingDeal.name.trim(),
          description: (creatingDeal.description || "").trim(),
          value: Number(creatingDeal.value || 0),
          expectedCloseDate: toIsoDateTime(creatingDeal.expectedCloseDate),
          countryCode: (geoCountryCode || "").toUpperCase() || undefined,
          currency: dashboardCurrency,
        },
      });
      setCreatingDeal({ name: "", description: "", stage: "lead", value: "", expectedCloseDate: "", ownerEmail: "" });
      setDealCreateOpen(false);
      await Promise.all([loadDeals(), loadDashboard()]);
    } catch (err) {
      setError(err?.message || "Unable to create deal.");
    } finally {
      setSavingBusy(false);
    }
  };

  const handleCreateContact = async () => {
    if (!canCreateWorkItems) return;
    if (!creatingContact.name.trim()) {
      setError("Contact name is required.");
      return;
    }
    setSavingBusy(true);
    try {
      await createCrmContact({ email, data: creatingContact });
      setCreatingContact({
        name: "",
        email: "",
        phone: "",
        company: "",
        leadSource: "manual",
        lifecycleStage: "lead",
      });
      await loadContacts();
    } catch (err) {
      setError(err?.message || "Unable to create contact.");
    } finally {
      setSavingBusy(false);
    }
  };

  const handleAddComment = async (text) => {
    if (!selectedTask?.id) return;
    setTaskCommentBusy(true);
    try {
      await createCrmTaskComment({ email, taskId: selectedTask.id, text });
      const detail = await getCrmTask({ email, taskId: selectedTask.id });
      setTaskDetail(detail);
      await Promise.all([loadTasks(), loadNotifications()]);
    } catch (err) {
      setError(err?.message || "Unable to add comment.");
    } finally {
      setTaskCommentBusy(false);
    }
  };

  const handleAddDealComment = async (text) => {
    if (!selectedDeal?.id) return;
    setDealCommentBusy(true);
    try {
      await createCrmDealComment({ email, dealId: selectedDeal.id, text });
      const detail = await getCrmDeal({ email, dealId: selectedDeal.id });
      setDealDetail(detail);
      await Promise.all([loadDeals(), loadDashboard(), loadNotifications()]);
    } catch (err) {
      setError(err?.message || "Unable to add deal comment.");
    } finally {
      setDealCommentBusy(false);
    }
  };

  const handleSaveTaskDetail = async () => {
    if (!selectedTask?.id || !taskDetail?.item) return;
    const current = taskDetail.item;
    const title = String(current.title || "").trim();
    if (!title) {
      setError("Task title is required.");
      return;
    }
    const startIso = toIsoDateTime(current.startDateTime);
    const endIso = toIsoDateTime(current.endDateTime || current.dueDate);
    if (startIso && endIso && new Date(endIso) <= new Date(startIso)) {
      setError("End date/time must be after start date/time.");
      return;
    }
    setSavingBusy(true);
    try {
      const res = await updateCrmTask({
        email,
        taskId: selectedTask.id,
        data: {
          title,
          description: String(current.description || ""),
          priority: String(current.priority || "med").toLowerCase(),
          assignedToEmail: String(current.assignedToEmail || "").trim().toLowerCase(),
          startDateTime: startIso || undefined,
          endDateTime: endIso || undefined,
          dueDate: endIso || undefined,
        },
      });
      setTaskDetail((prev) => ({ ...(prev || {}), item: res.item }));
      setTasks((rows) => rows.map((item) => (item.id === selectedTask.id ? res.item : item)));
      setSelectedTask(res.item);
      await loadDashboard();
    } catch (err) {
      setError(err?.message || "Unable to update task.");
    } finally {
      setSavingBusy(false);
    }
  };

  const handleSaveDealDetail = async () => {
    if (!selectedDeal?.id || !dealDetail?.item) return;
    const current = dealDetail.item;
    const name = String(current.name || "").trim();
    if (!name) {
      setError("Deal name is required.");
      return;
    }
    setSavingBusy(true);
    try {
      const res = await updateCrmDeal({
        email,
        dealId: selectedDeal.id,
        data: {
          name,
          description: String(current.description || ""),
          stage: String(current.stage || "lead").toLowerCase(),
          value: Number(current.value || 0),
          expectedCloseDate: toIsoDateTime(current.expectedCloseDate),
          ownerEmail: String(current.ownerEmail || "").trim().toLowerCase(),
          nextAction: String(current.nextAction || ""),
        },
      });
      setDealDetail((prev) => ({ ...(prev || {}), item: res.item }));
      setDeals((rows) => rows.map((item) => (item.id === selectedDeal.id ? res.item : item)));
      setSelectedDeal(res.item);
      await loadDashboard();
    } catch (err) {
      setError(err?.message || "Unable to update deal.");
    } finally {
      setSavingBusy(false);
    }
  };

  const handleLinkEmail = async () => {
    if (!selectedTask?.id) return;
    if (!emailLinkForm.threadId && !emailLinkForm.messageId) {
      setError("Provide thread ID or message ID.");
      return;
    }
    setSavingBusy(true);
    try {
      await createCrmEmailLink({
        email,
        data: {
          entityType: "task",
          entityId: selectedTask.id,
          ...emailLinkForm,
        },
      });
      const detail = await getCrmTask({ email, taskId: selectedTask.id });
      setTaskDetail(detail);
      setEmailLinkForm({ provider: "gmail", threadId: "", messageId: "", subject: "", snippet: "" });
    } catch (err) {
      setError(err?.message || "Unable to link email.");
    } finally {
      setSavingBusy(false);
    }
  };

  const markNotificationRead = async (notifId) => {
    try {
      await markCrmNotificationRead({ email, notifId });
      setNotifications((current) =>
        current.map((item) => (item.id === notifId ? { ...item, read: true, readAt: new Date().toISOString() } : item))
      );
    } catch (err) {
      setError(err?.message || "Unable to mark notification as read.");
    }
  };

  const downloadCsv = (filename, csvText) => {
    const blob = new Blob([csvText || ""], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExport = async (type) => {
    if (!isPrimaryAdmin) return;
    try {
      setSavingBusy(true);
      if (type === "tasks") {
        const csv = await exportCrmTasksReport({ email });
        downloadCsv("crm_tasks_report.csv", csv);
      } else {
        const csv = await exportCrmDealsReport({ email });
        downloadCsv("crm_deals_report.csv", csv);
      }
    } catch (err) {
      setError(err?.message || "Unable to export report.");
    } finally {
      setSavingBusy(false);
    }
  };

  return (
    <section className="crm-shell space-y-4">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-xl backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-indigo-200">CRM Manager</p>
            <h2 className="text-2xl font-semibold text-white">{businessName || "Customer pipeline"}</h2>
            <p className="text-sm text-slate-300">
              Single source of truth for contacts, deals, tasks, comments, and linked email activity.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {["dashboard", "tasks", "deals", "contacts", "notifications"].map((tab) => {
              const isNotificationsTab = tab === "notifications";
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`rounded-xl px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] ${
                    activeTab === tab ? "bg-indigo-500/30 text-white" : "bg-white/5 text-slate-300"
                  }`}
                >
                  {isNotificationsTab ? (
                    <span className="flex items-center gap-1.5">
                      <Bell className="h-3.5 w-3.5" />
                      <span>Notifications</span>
                      {unreadNotificationsCount > 0 ? (
                        <span className="rounded-full border border-rose-300/50 bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-bold text-rose-100">
                          {unreadNotificationsCount > 99 ? "99+" : unreadNotificationsCount}
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    tab
                  )}
                </button>
              );
            })}
            <button
              type="button"
              onClick={refreshAll}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200"
            >
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>
        {error ? <div className="mt-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</div> : null}
      </div>

      {activeTab === "dashboard" && (
        <div className="space-y-3">
          {isPrimaryAdmin ? (
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={savingBusy}
                onClick={() => handleExport("tasks")}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 disabled:opacity-60"
              >
                Export tasks CSV
              </button>
              <button
                type="button"
                disabled={savingBusy}
                onClick={() => handleExport("deals")}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 disabled:opacity-60"
              >
                Export deals CSV
              </button>
            </div>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Open tasks", value: dashboard?.kpis?.openTasks ?? 0, tone: "border-sky-400/30 bg-sky-500/10 text-sky-100" },
            { label: "Overdue", value: dashboard?.kpis?.overdueTasks ?? 0, tone: "border-rose-400/30 bg-rose-500/10 text-rose-100" },
            { label: "Completed (7d)", value: dashboard?.kpis?.completedThisWeek ?? 0, tone: "border-emerald-400/30 bg-emerald-500/10 text-emerald-100" },
            { label: "Active deal value", value: formatMoney(dashboard?.kpis?.activeDealsValue ?? 0, dashboardCurrency), tone: "border-amber-400/30 bg-amber-500/10 text-amber-100" },
          ].map((card) => (
            <div key={card.label} className={`rounded-2xl border p-4 ${card.tone}`}>
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">{card.label}</p>
              <p className="mt-2 text-2xl font-semibold">{card.value}</p>
            </div>
          ))}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 md:col-span-2">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Task status breakdown</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {TASK_STATUS_OPTIONS.map((status) => (
                <div
                  key={status.id}
                  className={`rounded-xl border px-3 py-2 text-xs ${
                    TASK_STATUS_THEME[status.id]?.tile || "border-white/10 bg-slate-900/50 text-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p>{status.label}</p>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] ${
                        TASK_STATUS_THEME[status.id]?.chip || "border-white/20 text-slate-200"
                      }`}
                    >
                      Task
                    </span>
                  </div>
                  <p className="mt-1 text-lg font-semibold text-white">
                    {dashboard?.taskStatusBreakdown?.[status.id] ?? 0}
                  </p>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 md:col-span-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Deal stage breakdown</p>
              <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-300">
                {dashboardCurrency}
              </span>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {DEAL_STAGES.map((stage) => {
                const stageData = dashboard?.dealStageBreakdown?.[stage.id] || {};
                const count = Number(stageData?.count || 0);
                const value = Number(stageData?.value || 0);
                return (
                  <div
                    key={stage.id}
                    className={`rounded-xl border px-3 py-2 text-xs ${
                      DEAL_STAGE_THEME[stage.id]?.tile || "border-white/10 bg-slate-900/50 text-slate-300"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p>{stage.label}</p>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] ${
                          DEAL_STAGE_THEME[stage.id]?.chip || "border-white/20 text-slate-200"
                        }`}
                      >
                        Deal
                      </span>
                    </div>
                    <p className="mt-1 text-lg font-semibold text-white">{count}</p>
                    <p className="text-[11px] text-slate-200">{formatMoney(value, dashboardCurrency)}</p>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 md:col-span-2">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Recent activity</p>
            <div className="mt-3 max-h-[420px] overflow-y-auto pr-1">
              <Timeline items={dashboard?.recentActivity || []} emptyText="No activity yet." />
            </div>
          </div>
        </div>
        </div>
      )}

      {activeTab === "tasks" && (
        <div className="space-y-3">
          <FilterBar
            filters={[
              {
                id: "assignee",
                label: "Assignee",
                type: "select",
                options: assigneeOptions,
              },
              {
                id: "status",
                label: "Status",
                type: "select",
                options: TASK_STATUS_OPTIONS.map((entry) => ({ value: entry.id, label: entry.label })),
              },
              {
                id: "priority",
                label: "Priority",
                type: "select",
                options: [
                  { value: "low", label: "Low" },
                  { value: "med", label: "Medium" },
                  { value: "high", label: "High" },
                  { value: "urgent", label: "Urgent" },
                ],
              },
              { id: "search", label: "Search", placeholder: "Title, description, contact..." },
            ]}
            values={taskFilters}
            onChange={(id, value) => setTaskFilters((prev) => ({ ...prev, [id]: value }))}
            actions={
              <>
                <button
                  type="button"
                  onClick={() => setTaskView((prev) => (prev === "list" ? "kanban" : "list"))}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200"
                >
                  {taskView === "list" ? "Kanban view" : "List view"}
                </button>
                <button
                  type="button"
                  onClick={loadTasks}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200"
                >
                  Apply filters
                </button>
              </>
            }
          />

          {canCreateWorkItems ? (
            <div className="flex items-center justify-end rounded-2xl border border-white/10 bg-white/5 p-3">
              <button
                type="button"
                disabled={savingBusy}
                onClick={() => setTaskCreateOpen(true)}
                className="min-w-[120px] rounded-lg border border-indigo-300/50 bg-indigo-500/20 px-3 py-2 text-sm font-semibold text-indigo-50 disabled:opacity-60"
              >
                Add task
              </button>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
            <div className="flex items-center gap-2">
              <label className="text-xs uppercase tracking-[0.12em] text-slate-400">Date</label>
              <button
                type="button"
                onClick={() => moveSelectedDay(-1)}
                disabled={!canMovePrevDay}
                className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-200 disabled:opacity-50"
              >
                &lt;
              </button>
              <button
                type="button"
                onClick={() => setSelectedDay(todayDay)}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => moveSelectedDay(1)}
                disabled={!canMoveNextDay}
                className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-200 disabled:opacity-50"
              >
                &gt;
              </button>
            </div>
            <input
              type="date"
              value={selectedDay}
              min={minSelectableDay}
              max={maxSelectableDay}
              onChange={(event) => setSelectedDay(clampSelectedDay(event.target.value))}
              className="rounded-lg border border-white/10 bg-slate-900/70 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-indigo-400"
            />
          </div>

          {taskView === "list" ? (
            <EntityTable columns={taskColumns} rows={tasks} emptyText="No tasks found." onRowClick={openTaskDetail} />
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {TASK_STATUS_OPTIONS.map((status) => (
                <KanbanColumn
                  key={status.id}
                  title={status.label}
                  items={taskByStatus[status.id] || []}
                  onMove={handleTaskMove}
                  onItemClick={openTaskDetail}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "deals" && (
        <div className="space-y-3">
          {canCreateWorkItems ? (
            <div className="flex items-center justify-end rounded-2xl border border-white/10 bg-white/5 p-3">
              <button
                type="button"
                disabled={savingBusy}
                onClick={() => setDealCreateOpen(true)}
                className="min-w-[120px] rounded-lg border border-indigo-300/50 bg-indigo-500/20 px-3 py-2 text-sm font-semibold text-indigo-50 disabled:opacity-60"
              >
                Add deal
              </button>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
            <div className="flex items-center gap-2">
              <label className="text-xs uppercase tracking-[0.12em] text-slate-400">Date</label>
              <button
                type="button"
                onClick={() => moveSelectedDay(-1)}
                disabled={!canMovePrevDay}
                className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-200 disabled:opacity-50"
              >
                &lt;
              </button>
              <button
                type="button"
                onClick={() => setSelectedDay(todayDay)}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => moveSelectedDay(1)}
                disabled={!canMoveNextDay}
                className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-200 disabled:opacity-50"
              >
                &gt;
              </button>
            </div>
            <input
              type="date"
              value={selectedDay}
              min={minSelectableDay}
              max={maxSelectableDay}
              onChange={(event) => setSelectedDay(clampSelectedDay(event.target.value))}
              className="rounded-lg border border-white/10 bg-slate-900/70 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-indigo-400"
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {DEAL_STAGES.map((stage) => (
              <KanbanColumn
                key={stage.id}
                title={stage.label}
                items={dealsByStage[stage.id] || []}
                onMove={handleDealMove}
                onItemClick={openDealDetail}
                emptyText="No deals"
              />
            ))}
          </div>
        </div>
      )}

      {activeTab === "contacts" && (
        <div className="space-y-3">
          {canCreateWorkItems ? (
            <div className="grid gap-2 rounded-2xl border border-white/10 bg-white/5 p-3 md:grid-cols-6">
              <input
                value={creatingContact.name}
                onChange={(event) => setCreatingContact((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Name"
                className="rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400"
              />
              <input
                value={creatingContact.email}
                onChange={(event) => setCreatingContact((prev) => ({ ...prev, email: event.target.value }))}
                placeholder="Email"
                className="rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400"
              />
              <input
                value={creatingContact.phone}
                onChange={(event) => setCreatingContact((prev) => ({ ...prev, phone: event.target.value }))}
                placeholder="Phone"
                className="rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400"
              />
              <input
                value={creatingContact.company}
                onChange={(event) => setCreatingContact((prev) => ({ ...prev, company: event.target.value }))}
                placeholder="Company"
                className="rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400"
              />
              <select
                value={creatingContact.lifecycleStage}
                onChange={(event) => setCreatingContact((prev) => ({ ...prev, lifecycleStage: event.target.value }))}
                className="rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400"
              >
                {["lead", "qualified", "customer", "churned"].map((stage) => (
                  <option key={stage} value={stage}>
                    {formatStatus(stage)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={savingBusy}
                onClick={handleCreateContact}
                className="rounded-lg border border-indigo-300/50 bg-indigo-500/20 px-3 py-2 text-sm font-semibold text-indigo-50 disabled:opacity-60"
              >
                Add contact
              </button>
            </div>
          ) : null}
          <EntityTable
            columns={[
              { id: "name", label: "Name" },
              { id: "email", label: "Email" },
              { id: "phone", label: "Phone" },
              { id: "company", label: "Company" },
              { id: "leadSource", label: "Lead source" },
              { id: "lifecycleStage", label: "Lifecycle", render: (row) => formatStatus(row.lifecycleStage) },
            ]}
            rows={contacts}
            emptyText="No contacts yet."
            onRowClick={(contact) =>
              canManage
                ? updateCrmContact({
                    email,
                    contactId: contact.id,
                    data: {
                      lifecycleStage: contact.lifecycleStage === "lead" ? "qualified" : "lead",
                    },
                  }).then(loadContacts).catch((err) => setError(err?.message || "Unable to update contact."))
                : null
            }
          />
        </div>
      )}

      {activeTab === "notifications" && (
        <div className="space-y-2 rounded-2xl border border-white/10 bg-white/5 p-3">
          {!notifications.length ? (
            <p className="text-sm text-slate-400">No notifications.</p>
          ) : (
            notifications.map((item) => (
              <div key={item.id} className="rounded-xl border border-white/10 bg-slate-900/50 px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-white">{item.title || "Notification"}</p>
                    <p className="text-xs text-slate-300">{item.message}</p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {item.createdAt ? new Date(item.createdAt).toLocaleString() : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {item.read ? (
                      <span className="rounded-full border border-emerald-300/40 bg-emerald-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-emerald-100">
                        Read
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border border-rose-300/50 bg-rose-500/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-rose-100">
                        <BellRing className="h-3 w-3" />
                        Unread
                      </span>
                    )}
                    {!item.read ? (
                      <button
                        type="button"
                        onClick={() => markNotificationRead(item.id)}
                        className="rounded-lg border border-white/10 px-2 py-1 text-[11px] text-slate-200"
                      >
                        Mark read
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      <Dialog open={taskCreateOpen} onOpenChange={setTaskCreateOpen}>
        <DialogContent className="max-w-3xl">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-indigo-200">Task</p>
                <h3 className="text-lg font-semibold text-white">Add task</h3>
              </div>
              <button
                type="button"
                onClick={() => setTaskCreateOpen(false)}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-200"
              >
                Close
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="text-xs uppercase tracking-[0.12em] text-slate-400">Title</label>
                <input
                  value={creatingTask.title}
                  onChange={(event) => setCreatingTask((prev) => ({ ...prev, title: event.target.value }))}
                  placeholder="Task title"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs uppercase tracking-[0.12em] text-slate-400">Details</label>
                <textarea
                  rows={3}
                  value={creatingTask.description}
                  onChange={(event) => setCreatingTask((prev) => ({ ...prev, description: event.target.value }))}
                  placeholder="Description, context, and notes"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400"
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-[0.12em] text-slate-400">Priority</label>
                <select
                  value={creatingTask.priority}
                  onChange={(event) => setCreatingTask((prev) => ({ ...prev, priority: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400"
                >
                  <option value="low">Low</option>
                  <option value="med">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              <div>
                <label className="text-xs uppercase tracking-[0.12em] text-slate-400">Assignee</label>
                <select
                  value={creatingTask.assignedToEmail}
                  onChange={(event) => setCreatingTask((prev) => ({ ...prev, assignedToEmail: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400"
                >
                  <option value="">Unassigned</option>
                  {assigneeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs uppercase tracking-[0.12em] text-slate-400">Start date & time</label>
                <input
                  type="datetime-local"
                  value={creatingTask.startDateTime}
                  onChange={(event) => setCreatingTask((prev) => ({ ...prev, startDateTime: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400"
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-[0.12em] text-slate-400">End date & time</label>
                <input
                  type="datetime-local"
                  value={creatingTask.endDateTime}
                  onChange={(event) => setCreatingTask((prev) => ({ ...prev, endDateTime: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setTaskCreateOpen(false)}
                className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingBusy}
                onClick={handleCreateTask}
                className="rounded-lg border border-indigo-300/50 bg-indigo-500/20 px-3 py-2 text-sm font-semibold text-indigo-50 disabled:opacity-60"
              >
                {savingBusy ? "Saving..." : "Create task"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={dealCreateOpen} onOpenChange={setDealCreateOpen}>
        <DialogContent className="max-w-3xl">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-indigo-200">Deal</p>
                <h3 className="text-lg font-semibold text-white">Add deal</h3>
              </div>
              <button
                type="button"
                onClick={() => setDealCreateOpen(false)}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-200"
              >
                Close
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="text-xs uppercase tracking-[0.12em] text-slate-400">Name</label>
                <input
                  value={creatingDeal.name}
                  onChange={(event) => setCreatingDeal((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="Deal name"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs uppercase tracking-[0.12em] text-slate-400">Description</label>
                <textarea
                  rows={3}
                  value={creatingDeal.description}
                  onChange={(event) => setCreatingDeal((prev) => ({ ...prev, description: event.target.value }))}
                  placeholder="Deal details"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400"
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-[0.12em] text-slate-400">Stage</label>
                <select
                  value={creatingDeal.stage}
                  onChange={(event) => setCreatingDeal((prev) => ({ ...prev, stage: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400"
                >
                  {DEAL_STAGES.map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {stage.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs uppercase tracking-[0.12em] text-slate-400">Value ({dashboardCurrency})</label>
                <input
                  value={creatingDeal.value}
                  onChange={(event) => setCreatingDeal((prev) => ({ ...prev, value: event.target.value }))}
                  placeholder="0"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400"
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-[0.12em] text-slate-400">Expected close</label>
                <input
                  type="datetime-local"
                  value={creatingDeal.expectedCloseDate}
                  onChange={(event) => setCreatingDeal((prev) => ({ ...prev, expectedCloseDate: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400"
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-[0.12em] text-slate-400">Owner email</label>
                <input
                  type="email"
                  value={creatingDeal.ownerEmail}
                  onChange={(event) => setCreatingDeal((prev) => ({ ...prev, ownerEmail: event.target.value }))}
                  placeholder="owner@company.com"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDealCreateOpen(false)}
                className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingBusy}
                onClick={handleCreateDeal}
                className="rounded-lg border border-indigo-300/50 bg-indigo-500/20 px-3 py-2 text-sm font-semibold text-indigo-50 disabled:opacity-60"
              >
                {savingBusy ? "Saving..." : "Create deal"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <DetailDrawer
        open={Boolean(selectedDeal)}
        onClose={() => {
          setSelectedDeal(null);
          setDealDetail(null);
        }}
        title={selectedDeal?.name || "Deal detail"}
        subtitle={selectedDeal?.id}
      >
        {!dealDetail ? (
          <p className="text-sm text-slate-400">Loading details...</p>
        ) : (
          <div className="space-y-3">
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Deal overview</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-400">Name</p>
                  <input
                    value={dealDetail?.item?.name || ""}
                    onChange={(event) =>
                      setDealDetail((prev) => ({
                        ...(prev || {}),
                        item: { ...(prev?.item || {}), name: event.target.value },
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/70 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-indigo-400"
                  />
                </div>
                <div className="rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-400">Stage</p>
                  <select
                    value={dealDetail?.item?.stage || "lead"}
                    onChange={(event) =>
                      setDealDetail((prev) => ({
                        ...(prev || {}),
                        item: { ...(prev?.item || {}), stage: event.target.value },
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/70 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-indigo-400"
                  >
                    {DEAL_STAGES.map((stage) => (
                      <option key={stage.id} value={stage.id}>
                        {stage.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-400">Value</p>
                  <input
                    type="number"
                    min="0"
                    value={dealDetail?.item?.value ?? 0}
                    onChange={(event) =>
                      setDealDetail((prev) => ({
                        ...(prev || {}),
                        item: { ...(prev?.item || {}), value: Number(event.target.value || 0) },
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/70 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-indigo-400"
                  />
                </div>
                <div className="rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-400">Owner</p>
                  <input
                    type="email"
                    value={dealDetail?.item?.ownerEmail || ""}
                    onChange={(event) =>
                      setDealDetail((prev) => ({
                        ...(prev || {}),
                        item: { ...(prev?.item || {}), ownerEmail: event.target.value },
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/70 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-indigo-400"
                  />
                </div>
                <div className="rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-400">Expected close</p>
                  <input
                    type="datetime-local"
                    value={toDateTimeLocal(dealDetail?.item?.expectedCloseDate)}
                    onChange={(event) =>
                      setDealDetail((prev) => ({
                        ...(prev || {}),
                        item: { ...(prev?.item || {}), expectedCloseDate: event.target.value },
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/70 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-indigo-400"
                  />
                </div>
              </div>
              <div className="mt-2 grid gap-2">
                <div className="rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-400">Description</p>
                  <textarea
                    rows={3}
                    value={dealDetail?.item?.description || ""}
                    onChange={(event) =>
                      setDealDetail((prev) => ({
                        ...(prev || {}),
                        item: { ...(prev?.item || {}), description: event.target.value },
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/70 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-indigo-400"
                  />
                </div>
                <div className="rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-400">Next action</p>
                  <input
                    value={dealDetail?.item?.nextAction || ""}
                    onChange={(event) =>
                      setDealDetail((prev) => ({
                        ...(prev || {}),
                        item: { ...(prev?.item || {}), nextAction: event.target.value },
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/70 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-indigo-400"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={savingBusy}
                    onClick={handleSaveDealDetail}
                    className="rounded-lg border border-indigo-300/50 bg-indigo-500/20 px-3 py-2 text-sm font-semibold text-indigo-50 disabled:opacity-60"
                  >
                    Save deal changes
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Timeline</p>
              <div className="mt-2">
                <Timeline items={dealDetail?.timeline || []} />
              </div>
            </div>

            <CommentBox
              onSubmit={handleAddDealComment}
              busy={dealCommentBusy}
              placeholder="Add comment on this deal..."
            />
          </div>
        )}
      </DetailDrawer>

      <DetailDrawer
        open={Boolean(selectedTask)}
        onClose={() => {
          setSelectedTask(null);
          setTaskDetail(null);
        }}
        title={selectedTask?.title || "Task detail"}
        subtitle={selectedTask?.id}
      >
        {!taskDetail ? (
          <p className="text-sm text-slate-400">Loading details...</p>
        ) : (
          <div className="space-y-3">
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Task overview</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 sm:col-span-2">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-400">Title</p>
                  <input
                    value={taskDetail?.item?.title || ""}
                    onChange={(event) =>
                      setTaskDetail((prev) => ({
                        ...(prev || {}),
                        item: { ...(prev?.item || {}), title: event.target.value },
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/70 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-indigo-400"
                  />
                </div>
                <div className="rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 sm:col-span-2">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-400">Description</p>
                  <textarea
                    rows={3}
                    value={taskDetail?.item?.description || ""}
                    onChange={(event) =>
                      setTaskDetail((prev) => ({
                        ...(prev || {}),
                        item: { ...(prev?.item || {}), description: event.target.value },
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/70 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-indigo-400"
                  />
                </div>
                <div className="rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-400">Priority</p>
                  <select
                    value={String(taskDetail?.item?.priority || "med").toLowerCase()}
                    onChange={(event) =>
                      setTaskDetail((prev) => ({
                        ...(prev || {}),
                        item: { ...(prev?.item || {}), priority: event.target.value },
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/70 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-indigo-400"
                  >
                    <option value="low">Low</option>
                    <option value="med">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
                <div className="rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-400">Assignee</p>
                  <select
                    value={taskDetail?.item?.assignedToEmail || ""}
                    onChange={(event) =>
                      setTaskDetail((prev) => ({
                        ...(prev || {}),
                        item: { ...(prev?.item || {}), assignedToEmail: event.target.value },
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/70 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-indigo-400"
                  >
                    <option value="">Unassigned</option>
                    {assigneeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-400">Start</p>
                  <input
                    type="datetime-local"
                    value={toDateTimeLocal(taskDetail?.item?.startDateTime)}
                    onChange={(event) =>
                      setTaskDetail((prev) => ({
                        ...(prev || {}),
                        item: { ...(prev?.item || {}), startDateTime: event.target.value },
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/70 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-indigo-400"
                  />
                </div>
                <div className="rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-400">End</p>
                  <input
                    type="datetime-local"
                    value={toDateTimeLocal(taskDetail?.item?.endDateTime || taskDetail?.item?.dueDate)}
                    onChange={(event) =>
                      setTaskDetail((prev) => ({
                        ...(prev || {}),
                        item: { ...(prev?.item || {}), endDateTime: event.target.value, dueDate: event.target.value },
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/70 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-indigo-400"
                  />
                </div>
              </div>
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  disabled={savingBusy}
                  onClick={handleSaveTaskDetail}
                  className="rounded-lg border border-indigo-300/50 bg-indigo-500/20 px-3 py-2 text-sm font-semibold text-indigo-50 disabled:opacity-60"
                >
                  Save task changes
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Status</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-400">Start</p>
                  <p className="mt-1 text-sm text-slate-200">{formatDateTime(taskDetail?.item?.startDateTime)}</p>
                </div>
                <div className="rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-400">End</p>
                  <p className="mt-1 text-sm text-slate-200">
                    {formatDateTime(taskDetail?.item?.endDateTime || taskDetail?.item?.dueDate)}
                  </p>
                </div>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <select
                  value={taskDetail?.item?.status || "new"}
                  onChange={(event) =>
                    updateCrmTask({
                      email,
                      taskId: selectedTask.id,
                      data: { status: event.target.value },
                    })
                      .then((res) => {
                        setTaskDetail((prev) => ({ ...(prev || {}), item: res.item }));
                        setTasks((current) =>
                          current.map((item) => (item.id === selectedTask.id ? res.item : item))
                        );
                        loadDashboard();
                      })
                      .catch((err) => setError(err?.message || "Unable to update status."))
                  }
                  className="rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400"
                >
                  {TASK_STATUS_OPTIONS.map((status) => (
                    <option key={status.id} value={status.id}>
                      {status.label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={taskDetail?.item?.progressPercent ?? 0}
                  onChange={(event) => {
                    const value = Math.max(0, Math.min(100, Number(event.target.value || 0)));
                    setTaskDetail((prev) => ({
                      ...(prev || {}),
                      item: { ...(prev?.item || {}), progressPercent: value },
                    }));
                  }}
                  onBlur={() =>
                    updateCrmTask({
                      email,
                      taskId: selectedTask.id,
                      data: { progressPercent: taskDetail?.item?.progressPercent ?? 0 },
                    })
                      .then((res) => {
                        setTaskDetail((prev) => ({ ...(prev || {}), item: res.item }));
                        setTasks((current) =>
                          current.map((item) => (item.id === selectedTask.id ? res.item : item))
                        );
                      })
                      .catch((err) => setError(err?.message || "Unable to update progress."))
                  }
                  className="rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400"
                />
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Timeline</p>
              <div className="mt-2">
                <Timeline items={taskDetail?.timeline || []} />
              </div>
            </div>

            <CommentBox onSubmit={handleAddComment} busy={taskCommentBusy} />

            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Link email thread/message</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <select
                  value={emailLinkForm.provider}
                  onChange={(event) => setEmailLinkForm((prev) => ({ ...prev, provider: event.target.value }))}
                  className="rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400"
                >
                  <option value="gmail">Gmail</option>
                  <option value="outlook">Outlook</option>
                </select>
                <input
                  value={emailLinkForm.threadId}
                  onChange={(event) => setEmailLinkForm((prev) => ({ ...prev, threadId: event.target.value }))}
                  placeholder="Thread ID"
                  className="rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400"
                />
                <input
                  value={emailLinkForm.messageId}
                  onChange={(event) => setEmailLinkForm((prev) => ({ ...prev, messageId: event.target.value }))}
                  placeholder="Message ID"
                  className="rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400"
                />
                <input
                  value={emailLinkForm.subject}
                  onChange={(event) => setEmailLinkForm((prev) => ({ ...prev, subject: event.target.value }))}
                  placeholder="Subject"
                  className="rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400"
                />
              </div>
              <textarea
                rows={2}
                value={emailLinkForm.snippet}
                onChange={(event) => setEmailLinkForm((prev) => ({ ...prev, snippet: event.target.value }))}
                placeholder="Snippet (optional)"
                className="mt-2 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400"
              />
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  disabled={savingBusy}
                  onClick={handleLinkEmail}
                  className="rounded-lg border border-indigo-300/50 bg-indigo-500/20 px-3 py-1.5 text-xs font-semibold text-indigo-100 disabled:opacity-60"
                >
                  Link email
                </button>
              </div>
            </div>
          </div>
        )}
      </DetailDrawer>
    </section>
  );
}
