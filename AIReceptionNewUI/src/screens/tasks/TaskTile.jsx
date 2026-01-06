import { useMemo } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "../../components/ui/index.jsx";
import {
  CalendarPlus,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Mail,
  Phone,
  Trash2
} from "lucide-react";

const statusStyles = {
  NEW: "border-emerald-300/60 bg-emerald-500/20 text-emerald-100",
  PENDING: "border-amber-300/60 bg-amber-500/20 text-amber-100",
  ACCEPTED: "border-indigo-300/60 bg-indigo-500/20 text-indigo-100",
  REJECTED: "border-rose-300/60 bg-rose-500/20 text-rose-100",
  COMPLETED: "border-slate-300/60 bg-slate-500/20 text-slate-100",
  CANCELLED: "border-slate-300/60 bg-slate-500/20 text-slate-100"
};

const typeStyles = {
  ORDER: "bg-indigo-500/20 text-indigo-100",
  BOOKING: "bg-sky-500/20 text-sky-100",
  QUOTE_REQUEST: "bg-amber-500/20 text-amber-100",
  SUPPORT_TICKET: "bg-rose-500/20 text-rose-100",
  LEAD: "bg-emerald-500/20 text-emerald-100",
  MESSAGE: "bg-slate-500/20 text-slate-100"
};

const formatTime = (value) => {
  if (!value) return "—";
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const datePart = date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    const timePart = date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    });
    return `${datePart}, ${timePart}`;
  } catch {
    return value;
  }
};

const copyToClipboard = async (value) => {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
  } catch (error) {
    console.warn("Clipboard copy failed", error);
  }
};

export default function TaskTile({ task, onOpen, onAccept, onReject, onDelete, onSchedule, busy }) {
  const statusStyle = statusStyles[task?.status] || "border-white/10 bg-white/5 text-slate-200";
  const typeStyle = typeStyles[task?.type] || "bg-white/10 text-slate-200";
  const decisionLocked = useMemo(
    () => ["ACCEPTED", "REJECTED", "COMPLETED", "CANCELLED"].includes(task?.status),
    [task?.status]
  );

  return (
    <Card className="relative overflow-hidden border-white/10 bg-slate-900/60 shadow-2xl backdrop-blur transition hover:-translate-y-1 hover:border-indigo-300/40 hover:bg-slate-900/70">
      <div className="absolute inset-0 opacity-30" aria-hidden="true">
        <div className="absolute -right-16 -top-16 h-40 w-40 rounded-full bg-indigo-500/30 blur-3xl" />
      </div>
      <CardContent className="relative">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={typeStyle}>{task?.type || "Task"}</Badge>
              <Badge className={statusStyle}>{task?.status || "NEW"}</Badge>
            </div>
            <h3 className="text-lg font-semibold text-white">
              {task?.title || "Untitled request"}
            </h3>
            <p className="text-sm text-slate-300 line-clamp-3">
              {task?.summary || "No summary provided."}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2 text-xs text-slate-300">
            <div className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              <span className="whitespace-nowrap">{formatTime(task?.createdAt)}</span>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger>More</DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => copyToClipboard(task?.id)}>
                  Copy task id
                </DropdownMenuItem>
                {task?.customerPhone && (
                  <DropdownMenuItem onClick={() => copyToClipboard(task.customerPhone)}>
                    Copy phone
                  </DropdownMenuItem>
                )}
                {task?.customerEmail && (
                  <DropdownMenuItem onClick={() => copyToClipboard(task.customerEmail)}>
                    Copy email
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="mt-4 grid gap-3 text-xs text-slate-300">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1">
              <ClipboardList className="h-3.5 w-3.5" />
              <span>{task?.customerName || "Unknown customer"}</span>
            </div>
            {task?.customerPhone ? (
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1">
                <Phone className="h-3.5 w-3.5" />
                <span>{task.customerPhone}</span>
              </div>
            ) : null}
            {task?.customerEmail ? (
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1">
                <Mail className="h-3.5 w-3.5" />
                <span>{task.customerEmail}</span>
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="ghost" size="sm" onClick={() => onOpen?.(task)}>
              <ClipboardCheck className="h-4 w-4" />
              View details
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => onSchedule?.(task)}
                disabled={busy}
              >
                <CalendarPlus className="h-4 w-4" />
                Add to Task Manager
              </Button>
              <Button
                variant="success"
                size="sm"
                onClick={() => onAccept?.(task)}
                disabled={decisionLocked || busy}
              >
                Accept
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => onReject?.(task)}
                disabled={decisionLocked || busy}
              >
                Reject
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-10 w-10 px-0 text-rose-200 hover:bg-rose-500/10 hover:text-rose-100"
                onClick={() => onDelete?.(task)}
                disabled={busy}
                aria-label="Delete task"
                title="Delete task"
              >
                <Trash2 className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
