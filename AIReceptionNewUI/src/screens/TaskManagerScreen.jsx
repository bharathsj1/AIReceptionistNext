import { useCallback, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import interactionPlugin from "@fullcalendar/interaction";
import timeGridPlugin from "@fullcalendar/timegrid";
import dayGridPlugin from "@fullcalendar/daygrid";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  Dialog,
  DialogContent,
  Input
} from "../components/ui/index.jsx";
import { CalendarClock, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import {
  createTaskManagerItem,
  deleteTaskManagerItem,
  fetchTaskManagerItems,
  updateTaskManagerItem
} from "../lib/api/taskManager";

const SOURCE_COLORS = {
  ai_task: {
    backgroundColor: "rgba(167, 139, 250, 0.24)",
    borderColor: "rgba(167, 139, 250, 0.8)",
    textColor: "#f8fafc"
  },
  email_summary: {
    backgroundColor: "rgba(16, 185, 129, 0.22)",
    borderColor: "rgba(16, 185, 129, 0.7)",
    textColor: "#f8fafc"
  },
  manual: {
    backgroundColor: "rgba(59, 130, 246, 0.22)",
    borderColor: "rgba(59, 130, 246, 0.7)",
    textColor: "#f8fafc"
  }
};

const pad = (value) => String(value).padStart(2, "0");

const toLocalIso = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}:00`;
};

const toInputValue = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
};

const buildDefaultTimes = () => {
  const now = new Date();
  now.setSeconds(0, 0);
  const roundedMinutes = Math.ceil(now.getMinutes() / 15) * 15;
  now.setMinutes(roundedMinutes % 60);
  if (roundedMinutes >= 60) {
    now.setHours(now.getHours() + 1);
  }
  const end = new Date(now.getTime() + 60 * 60 * 1000);
  return { start: toInputValue(now), end: toInputValue(end) };
};

const normalizeItems = (items) =>
  (items || []).map((item) => ({
    ...item,
    start: item.start || item.start_time || item.startTime,
    end: item.end || item.end_time || item.endTime
  }));

export default function TaskManagerScreen({ email, businessName }) {
  const calendarRef = useRef(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [calendarRange, setCalendarRange] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState("create");
  const [activeItem, setActiveItem] = useState(null);
  const [allowOverlaps, setAllowOverlaps] = useState(true);
  const [form, setForm] = useState({
    title: "",
    description: "",
    start: "",
    end: ""
  });
  const [actionBusy, setActionBusy] = useState(false);

  const loadItems = useCallback(
    async (range = calendarRange) => {
      if (!email) return;
      setLoading(true);
      setError("");
      try {
        const data = await fetchTaskManagerItems({
          email,
          start: range?.start || undefined,
          end: range?.end || undefined
        });
        setItems(normalizeItems(data));
      } catch (err) {
        setError(err?.message || "Failed to load task manager items.");
      } finally {
        setLoading(false);
      }
    },
    [calendarRange, email]
  );

  const events = useMemo(() => {
    const filtered = items.filter((item) => {
      if (!search) return true;
      const lowered = search.toLowerCase();
      return (
        String(item.title || "").toLowerCase().includes(lowered) ||
        String(item.description || "").toLowerCase().includes(lowered)
      );
    });
    return filtered.map((item) => {
      const palette = SOURCE_COLORS[item.sourceType] || SOURCE_COLORS.manual;
      return {
        id: String(item.id),
        title: item.title,
        start: item.start,
        end: item.end,
        backgroundColor: palette.backgroundColor,
        borderColor: palette.borderColor,
        textColor: palette.textColor,
        extendedProps: item
      };
    });
  }, [items, search]);

  const openCreateModal = () => {
    const { start, end } = buildDefaultTimes();
    setForm({
      title: "",
      description: "",
      start,
      end
    });
    setActiveItem(null);
    setModalMode("create");
    setModalOpen(true);
  };

  const openEditModal = (item) => {
    setForm({
      title: item?.title || "",
      description: item?.description || "",
      start: toInputValue(item?.start || item?.start_time),
      end: toInputValue(item?.end || item?.end_time)
    });
    setActiveItem(item);
    setModalMode("edit");
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!email || !form.title || !form.start) {
      setError("Title and start time are required.");
      return;
    }
    if (!allowOverlaps) {
      const effectiveEnd = form.end || toInputValue(new Date(new Date(form.start).getTime() + 60 * 60 * 1000));
      const overlapFound = items.some((item) => {
        if (activeItem?.id && String(item.id) === String(activeItem.id)) return false;
        const start = new Date(item.start);
        const end = new Date(item.end || item.start);
        const nextStart = new Date(form.start);
        const nextEnd = new Date(effectiveEnd);
        if (Number.isNaN(start.getTime()) || Number.isNaN(nextStart.getTime())) return false;
        return nextStart < end && nextEnd > start;
      });
      if (overlapFound) {
        setError("Another task already exists in this time range.");
        return;
      }
    }
    setActionBusy(true);
    try {
      if (modalMode === "create") {
        const created = await createTaskManagerItem({
          email,
          title: form.title,
          description: form.description,
          start: form.start,
          end: form.end,
          sourceType: "manual"
        });
        setItems((prev) => normalizeItems([created, ...prev]));
      } else if (activeItem?.id) {
        const updated = await updateTaskManagerItem({
          email,
          id: activeItem.id,
          title: form.title,
          description: form.description,
          start: form.start,
          end: form.end
        });
        setItems((prev) =>
          normalizeItems(prev.map((item) => (item.id === updated.id ? updated : item)))
        );
      }
      setModalOpen(false);
      setError("");
    } catch (err) {
      setError(err?.message || "Failed to save task.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!activeItem?.id || !email) return;
    setActionBusy(true);
    try {
      await deleteTaskManagerItem({ email, id: activeItem.id });
      setItems((prev) => prev.filter((item) => item.id !== activeItem.id));
      setModalOpen(false);
    } catch (err) {
      setError(err?.message || "Failed to delete task.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleDragUpdate = async (event, revert) => {
    if (!email) return;
    if (!allowOverlaps) {
      const start = event.start ? new Date(event.start) : null;
      const end = event.end ? new Date(event.end) : new Date(event.start.getTime() + 60 * 60 * 1000);
      const overlapFound = items.some((item) => {
        if (String(item.id) === String(event.id)) return false;
        const itemStart = new Date(item.start);
        const itemEnd = new Date(item.end || item.start);
        if (Number.isNaN(itemStart.getTime()) || !start) return false;
        return start < itemEnd && end > itemStart;
      });
      if (overlapFound) {
        if (revert) revert();
        setError("Multiple tasks at the same time are disabled.");
        return;
      }
    }
    try {
      const updated = await updateTaskManagerItem({
        email,
        id: event.id,
        start: toLocalIso(event.start),
        end: event.end ? toLocalIso(event.end) : ""
      });
      setItems((prev) =>
        normalizeItems(prev.map((item) => (item.id === updated.id ? updated : item)))
      );
    } catch (err) {
      if (revert) revert();
      setError(err?.message || "Failed to update time.");
    }
  };

  return (
    <section className="grid gap-4">
      <Card className="border-white/10 bg-slate-900/70">
        <CardHeader className="border-b border-white/10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-indigo-300/40 bg-indigo-500/10">
                <CalendarClock className="h-5 w-5 text-indigo-200" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-indigo-200">Task manager</p>
                <h2 className="text-2xl font-semibold text-white">
                  {businessName || "Schedule"}
                </h2>
                <p className="text-sm text-slate-300">
                  Plan work, set timelines, and keep tasks on track.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="sm" onClick={loadItems}>
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>
              <Button variant="primary" size="sm" onClick={openCreateModal}>
                <Plus className="h-4 w-4" />
                Add task
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search tasks, titles, notes"
                className="pl-10"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => calendarRef.current?.getApi().today()}
              >
                Today
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => calendarRef.current?.getApi().changeView("timeGridDay")}
              >
                Day
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => calendarRef.current?.getApi().changeView("timeGridWeek")}
              >
                Week
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => calendarRef.current?.getApi().changeView("dayGridMonth")}
              >
                Month
              </Button>
              <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-200">
                <span className="uppercase tracking-[0.2em] text-slate-400">Multi</span>
                <button
                  type="button"
                  onClick={() => setAllowOverlaps((prev) => !prev)}
                  className={`relative h-5 w-9 rounded-full border transition ${
                    allowOverlaps
                      ? "border-indigo-300/50 bg-indigo-500/30"
                      : "border-white/10 bg-white/5"
                  }`}
                  aria-pressed={allowOverlaps}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${
                      allowOverlaps ? "left-4" : "left-0.5"
                    }`}
                  />
                </button>
                <span className="text-slate-300">{allowOverlaps ? "On" : "Off"}</span>
              </div>
            </div>
          </div>

          {error ? (
            <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </div>
          ) : null}

          <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-2">
            {loading ? (
              <div className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-6 text-sm text-slate-300">
                Loading schedule...
              </div>
            ) : null}
            <div
              className={`calendar-shell task-manager-calendar ${
                allowOverlaps ? "task-manager-multi" : ""
              }`}
              data-lenis-prevent
            >
              <FullCalendar
                ref={calendarRef}
                plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
                initialView="timeGridWeek"
                headerToolbar={false}
                height={620}
                editable
                selectable
                selectMirror
                nowIndicator
                events={events}
                eventOverlap={allowOverlaps}
                selectOverlap={allowOverlaps}
                datesSet={(range) => {
                  const nextRange = {
                    start: toLocalIso(range.start),
                    end: toLocalIso(range.end)
                  };
                  setCalendarRange(nextRange);
                  loadItems(nextRange);
                }}
                eventClick={(info) => {
                  const details = info.event.extendedProps || {};
                  openEditModal(details);
                }}
                select={(selection) => {
                  if (!allowOverlaps) {
                    const overlapFound = items.some((item) => {
                      const itemStart = new Date(item.start);
                      const itemEnd = new Date(item.end || item.start);
                      return selection.start < itemEnd && selection.end > itemStart;
                    });
                    if (overlapFound) {
                      calendarRef.current?.getApi().unselect();
                      setError("Multiple tasks at the same time are disabled.");
                      return;
                    }
                  }
                  setForm({
                    title: "",
                    description: "",
                    start: toInputValue(selection.start),
                    end: toInputValue(selection.end)
                  });
                  setActiveItem(null);
                  setModalMode("create");
                  setModalOpen(true);
                }}
                eventDrop={(info) => handleDragUpdate(info.event, info.revert)}
                eventResize={(info) => handleDragUpdate(info.event, info.revert)}
                slotMinTime="06:00:00"
                slotMaxTime="22:00:00"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-indigo-200">
                {modalMode === "create" ? "Add task" : "Edit task"}
              </p>
              <h4 className="text-lg font-semibold text-white">
                {modalMode === "create" ? "Schedule task" : "Update schedule"}
              </h4>
            </div>
            {modalMode === "edit" ? (
              <Button variant="danger" size="sm" onClick={handleDelete} disabled={actionBusy}>
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            ) : null}
          </div>
          <div className="mt-4 grid gap-3">
            <div>
              <label className="text-xs text-slate-300">Title</label>
              <Input
                value={form.title}
                onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                placeholder="Task title"
              />
            </div>
            <div>
              <label className="text-xs text-slate-300">Description</label>
              <textarea
                rows={3}
                value={form.description}
                onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                className="w-full rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-2 text-sm text-white outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/40"
                placeholder="Notes, context, or next steps"
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="text-xs text-slate-300">Start</label>
                <Input
                  type="datetime-local"
                  value={form.start}
                  onChange={(event) => setForm((prev) => ({ ...prev, start: event.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-slate-300">End</label>
                <Input
                  type="datetime-local"
                  value={form.end}
                  onChange={(event) => setForm((prev) => ({ ...prev, end: event.target.value }))}
                />
              </div>
            </div>
            {error ? (
              <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                {error}
              </div>
            ) : null}
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => setModalOpen(false)} disabled={actionBusy}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleSave} disabled={actionBusy}>
                {modalMode === "create" ? "Add task" : "Save changes"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
