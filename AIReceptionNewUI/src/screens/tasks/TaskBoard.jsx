import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Dialog,
  DialogContent,
  Input,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger
} from "../../components/ui/index.jsx";
import {
  ClipboardList,
  RefreshCw,
  Search,
  Sparkles,
  Wifi,
  WifiOff
} from "lucide-react";
import TaskTile from "./TaskTile";
import TaskDetailDialog from "./TaskDetailDialog";
import { useTaskStream } from "./useTaskStream";
import { acceptTask, deleteTask, fetchTasks, rejectTask } from "../../lib/api/tasks";

const statusTabs = [
  { id: "ALL", label: "All" },
  { id: "NEW", label: "New" },
  { id: "ACCEPTED", label: "Accepted" },
  { id: "REJECTED", label: "Rejected" }
];

const statusTone = {
  NEW: "border-emerald-300/60 bg-emerald-500/20 text-emerald-100",
  ACCEPTED: "border-indigo-300/60 bg-indigo-500/20 text-indigo-100",
  REJECTED: "border-rose-300/60 bg-rose-500/20 text-rose-100",
  ALL: "border-white/10 bg-white/5 text-slate-200"
};

const normalizeTask = (task) => {
  if (!task || typeof task !== "object") return task;
  let details = task.detailsJson;
  if (typeof details === "string") {
    try {
      details = JSON.parse(details);
    } catch {
      details = {};
    }
  }
  return {
    ...task,
    detailsJson: details || {}
  };
};

const filterTasks = (tasks, status, search) => {
  let filtered = tasks;
  if (status && status !== "ALL") {
    filtered = filtered.filter((task) => task.status === status);
  }
  if (search) {
    const lowered = search.toLowerCase();
    filtered = filtered.filter((task) =>
      [task.title, task.summary, task.customerName, task.customerPhone, task.customerEmail]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(lowered))
    );
  }
  return filtered;
};

export default function TaskBoard({ email, businessName, liveEnabled }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [selectedTask, setSelectedTask] = useState(null);
  const [rejectTaskTarget, setRejectTaskTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionBusy, setActionBusy] = useState(false);

  const loadTasks = useCallback(async () => {
    if (!email) return;
    setLoading(true);
    setError("");
    try {
      const data = await fetchTasks({ email, status: "ALL" });
      setTasks((data || []).map(normalizeTask));
    } catch (err) {
      setError(err?.message || "Failed to load tasks.");
    } finally {
      setLoading(false);
    }
  }, [email]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const upsertTask = useCallback((task) => {
    if (!task?.id) return;
    setTasks((prev) => {
      const next = [...prev];
      const idx = next.findIndex((item) => item.id === task.id);
      if (idx >= 0) {
        next[idx] = { ...next[idx], ...normalizeTask(task) };
      } else {
        next.unshift(normalizeTask(task));
      }
      return next.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    });
  }, []);

  const removeTaskById = useCallback((taskId) => {
    if (!taskId) return;
    setTasks((prev) => prev.filter((item) => item.id !== taskId));
    setSelectedTask((current) => (current?.id === taskId ? null : current));
  }, []);

  const { connectionStatus } = useTaskStream({
    enabled: liveEnabled,
    email,
    onEvent: (evt) => {
      if (evt?.type === "task.deleted") {
        removeTaskById(evt.taskId || evt.task?.id);
        return;
      }
      if (evt?.task) {
        upsertTask(evt.task);
      }
    }
  });

  const statusCounts = useMemo(() => {
    return tasks.reduce(
      (acc, task) => {
        acc.ALL += 1;
        if (task.status === "NEW") acc.NEW += 1;
        if (task.status === "ACCEPTED") acc.ACCEPTED += 1;
        if (task.status === "REJECTED") acc.REJECTED += 1;
        return acc;
      },
      { ALL: 0, NEW: 0, ACCEPTED: 0, REJECTED: 0 }
    );
  }, [tasks]);

  const filteredTasks = useMemo(
    () => filterTasks(tasks, status, search),
    [tasks, status, search]
  );

  const liveStatusLabel = useMemo(() => {
    if (!liveEnabled) return "Live updates disabled";
    if (connectionStatus === "connected") return "Live";
    if (connectionStatus === "polling") return "Live (polling)";
    if (connectionStatus === "fallback") return "Live (fallback)";
    if (connectionStatus === "connecting") return "Connecting";
    return "Offline";
  }, [connectionStatus, liveEnabled]);

  const handleAccept = async (task) => {
    if (!task?.id) return;
    setActionBusy(true);
    try {
      await acceptTask({ email, id: task.id });
      upsertTask({ ...task, status: "ACCEPTED", decisionAt: new Date().toISOString() });
    } catch (err) {
      setError(err?.message || "Failed to accept task.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleReject = async () => {
    if (!rejectTaskTarget?.id) return;
    setActionBusy(true);
    try {
      await rejectTask({ email, id: rejectTaskTarget.id, reason: rejectReason });
      upsertTask({
        ...rejectTaskTarget,
        status: "REJECTED",
        decisionAt: new Date().toISOString(),
        decisionReason: rejectReason || null
      });
      setRejectTaskTarget(null);
      setRejectReason("");
    } catch (err) {
      setError(err?.message || "Failed to reject task.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleDelete = async (task) => {
    if (!task?.id) return;
    const confirmed = window.confirm("Delete this task? This cannot be undone.");
    if (!confirmed) return;
    setActionBusy(true);
    try {
      await deleteTask({ email, id: task.id });
      removeTaskById(task.id);
    } catch (err) {
      setError(err?.message || "Failed to delete task.");
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <section className="grid gap-6">
      <Card className="overflow-hidden border-white/10 bg-slate-900/70">
        <div className="relative">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.2),_transparent_60%),radial-gradient(circle_at_bottom,_rgba(99,102,241,0.2),_transparent_55%)]" />
          <CardHeader className="relative border-b border-white/10">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Tasks</p>
                <h2 className="mt-2 text-2xl font-semibold text-white">
                  {businessName || "Task command center"}
                </h2>
                <p className="mt-2 text-sm text-slate-300">
                  Review, accept, and respond to requests captured during calls.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Badge
                  className={`gap-1 ${
                    connectionStatus === "connected"
                      ? "border-emerald-300/60 bg-emerald-500/20 text-emerald-100"
                      : connectionStatus === "polling" || connectionStatus === "fallback"
                        ? "border-amber-300/60 bg-amber-500/20 text-amber-100"
                        : "border-rose-300/60 bg-rose-500/20 text-rose-100"
                  }`}
                >
                  {connectionStatus === "connected" ? (
                    <Wifi className="h-3.5 w-3.5" />
                  ) : (
                    <WifiOff className="h-3.5 w-3.5" />
                  )}
                  {liveStatusLabel}
                </Badge>
                <Button variant="ghost" size="sm" onClick={loadTasks}>
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </Button>
              </div>
            </div>
          </CardHeader>
        </div>
        <CardContent className="relative grid gap-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <Tabs value={status} onValueChange={setStatus}>
              <TabsList>
                {statusTabs.map((tab) => (
                  <TabsTrigger
                    key={tab.id}
                    value={tab.id}
                    variant={tab.id.toLowerCase()}
                  >
                    {tab.label} {statusCounts[tab.id] ?? 0}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search tasks, customers, phone, email"
                className="pl-10"
              />
            </div>
          </div>

          {error ? (
            <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Card key={index} className="border-white/10 bg-slate-900/60">
              <CardContent>
                <Skeleton className="h-5 w-24" />
                <Skeleton className="mt-3 h-6 w-3/4" />
                <Skeleton className="mt-2 h-4 w-full" />
                <div className="mt-4 flex gap-2">
                  <Skeleton className="h-8 w-24" />
                  <Skeleton className="h-8 w-24" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredTasks.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredTasks.map((task) => (
            <TaskTile
              key={task.id}
              task={task}
              onOpen={setSelectedTask}
              onAccept={handleAccept}
              onReject={(target) => {
                setRejectTaskTarget(target);
                setRejectReason("");
              }}
              onDelete={handleDelete}
              busy={actionBusy}
            />
          ))}
        </div>
      ) : (
        <Card className="border-dashed border-white/20 bg-slate-900/40">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/5">
              <Sparkles className="h-6 w-6 text-slate-300" />
            </div>
            <h3 className="mt-4 text-lg font-semibold text-white">No tasks yet</h3>
            <p className="mt-2 max-w-md text-sm text-slate-300">
              When callers place orders or requests, they will appear here as actionable tasks.
            </p>
          </CardContent>
        </Card>
      )}

      <TaskDetailDialog
        open={Boolean(selectedTask)}
        task={selectedTask}
        onClose={() => setSelectedTask(null)}
        onAccept={handleAccept}
        onReject={(target) => {
          setRejectTaskTarget(target);
          setRejectReason("");
        }}
        busy={actionBusy}
      />

      <Dialog open={Boolean(rejectTaskTarget)} onOpenChange={() => setRejectTaskTarget(null)}>
        <DialogContent className="max-w-lg">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-500/20">
              <ClipboardList className="h-5 w-5 text-rose-200" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-rose-200">Reject task</p>
              <h4 className="mt-1 text-lg font-semibold text-white">
                {rejectTaskTarget?.title || "Task"}
              </h4>
            </div>
          </div>
          <p className="mt-3 text-sm text-slate-300">
            Share a short reason so the caller understands what happened.
          </p>
          <textarea
            rows={4}
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
            placeholder="Reason (optional)"
            className="mt-4 w-full rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-white outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-500/40"
          />
          <div className="mt-4 flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setRejectTaskTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleReject} disabled={actionBusy}>
              Reject task
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
