import {
  Badge,
  Button,
  Dialog,
  DialogContent
} from "../../components/ui/index.jsx";
import { ClipboardList, Phone, Mail, X } from "lucide-react";

const formatTime = (value) => {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

const renderDetails = (details) => {
  if (!details || typeof details !== "object") {
    return <p className="text-sm text-slate-300">No structured details provided.</p>;
  }
  const entries = Object.entries(details);
  if (!entries.length) {
    return <p className="text-sm text-slate-300">No structured details provided.</p>;
  }
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {entries.map(([key, value]) => {
        let display = value;
        if (Array.isArray(value)) {
          display = value.join(", ");
        } else if (value && typeof value === "object") {
          display = JSON.stringify(value, null, 2);
        }
        return (
          <div
            key={key}
            className="rounded-2xl border border-white/10 bg-white/5 p-3"
          >
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{key}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-white">{String(display)}</p>
          </div>
        );
      })}
    </div>
  );
};

export default function TaskDetailDialog({ open, task, onClose, onAccept, onReject, busy }) {
  if (!task) return null;
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-emerald-200">Task details</p>
            <h3 className="mt-2 text-2xl font-semibold text-white">{task.title}</h3>
            <p className="mt-2 text-sm text-slate-300">{task.summary}</p>
          </div>
          <button
            type="button"
            onClick={() => onClose?.(false)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-200 hover:border-white/30"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge className="border-white/10 bg-white/5 text-slate-100">{task.type}</Badge>
          <Badge className="border-white/10 bg-white/5 text-slate-100">{task.status}</Badge>
          <span className="text-xs text-slate-400">Created {formatTime(task.createdAt)}</span>
        </div>

        <div className="mt-5 rounded-3xl border border-white/10 bg-slate-900/60 p-4">
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1">
              <ClipboardList className="h-3.5 w-3.5" />
              <span>{task.customerName || "Unknown customer"}</span>
            </div>
            {task.customerPhone ? (
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1">
                <Phone className="h-3.5 w-3.5" />
                <span>{task.customerPhone}</span>
              </div>
            ) : null}
            {task.customerEmail ? (
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1">
                <Mail className="h-3.5 w-3.5" />
                <span>{task.customerEmail}</span>
              </div>
            ) : null}
          </div>
          <div className="mt-4 text-xs text-slate-400">
            <p>Call ID: {task.callId || "—"}</p>
            <p>Twilio SID: {task.twilioCallSid || "—"}</p>
          </div>
        </div>

        <div className="mt-5">
          <h4 className="text-sm font-semibold text-white">Structured details</h4>
          <div className="mt-3">{renderDetails(task.detailsJson)}</div>
        </div>

        {task.decisionAt ? (
          <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-slate-300">
            <p>Decision time: {formatTime(task.decisionAt)}</p>
            {task.decisionReason ? <p>Reason: {task.decisionReason}</p> : null}
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => onClose?.(false)}>
            Close
          </Button>
          <Button variant="success" onClick={() => onAccept?.(task)} disabled={busy}>
            Accept
          </Button>
          <Button variant="danger" onClick={() => onReject?.(task)} disabled={busy}>
            Reject
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
