import { useEffect, useMemo, useRef, useState } from "react";
import { Circle, Copy, ExternalLink, Loader2, Mic, Pause, RefreshCw, Upload } from "lucide-react";
import JitsiEmbed from "../../components/meetings/JitsiEmbed";
import {
  createMeeting,
  getArtifacts,
  getMeeting,
  listMeetings,
  saveMeetingTasks,
  summarizeMeeting,
  uploadMeetingAudio,
} from "../../lib/api/meetings";
import { formatDateShort } from "../../lib/utils/date";

const statusColor = (status) => {
  const map = {
    created: "bg-slate-500/60 text-slate-100",
    live: "bg-emerald-600/70 text-emerald-50",
    processing: "bg-amber-500/80 text-white",
    ready: "bg-indigo-500/80 text-white",
    failed: "bg-rose-600/80 text-white",
  };
  return map[status] || "bg-slate-600/70 text-white";
};

const emptyArtifact = { transcript: null, summary: null, tasks: null, status: "created" };

export default function MeetingsScreen({ tenantId, userId, userEmail }) {
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [createModal, setCreateModal] = useState({ open: false, title: "", scheduledFor: "", publicJoin: true, status: "idle", error: "" });
  const [selected, setSelected] = useState(null);
  const [meetingMeta, setMeetingMeta] = useState(null);
  const [artifacts, setArtifacts] = useState(emptyArtifact);
  const [polling, setPolling] = useState(false);
  const [recording, setRecording] = useState(false);
  const [uploadStatus, setUploadStatus] = useState({ status: "idle", message: "" });
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  const headers = useMemo(() => ({ tenantId, userId, email: userEmail }), [tenantId, userId, userEmail]);

  const loadMeetings = async () => {
    setLoading(true);
    try {
      const data = await listMeetings(headers);
      setMeetings(data);
      if (!selected && data.length) setSelected(data[0]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMeetings();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selected) return;
    const fetchDetail = async () => {
      try {
        const meta = await getMeeting({ ...headers, meetingId: selected.meetingId || selected.RowKey || selected.id });
        setMeetingMeta(meta);
      } catch (err) {
        console.error(err);
      }
    };
    fetchDetail();
  }, [selected, headers]);

  const pollArtifacts = async (meetingId, attempts = 0) => {
    if (!meetingId) return;
    setPolling(true);
    try {
      const payload = await getArtifacts({ ...headers, meetingId });
      if (payload.status && payload.status !== "ready" && attempts < 24) {
        setTimeout(() => pollArtifacts(meetingId, attempts + 1), 5000);
      }
      setArtifacts(payload);
    } catch (err) {
      console.error(err);
    } finally {
      setPolling(false);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data?.size) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        await uploadBlob(blob);
        stream.getTracks().forEach((t) => t.stop());
      };
      mediaRecorderRef.current = recorder;
      recorder.start(1000);
      setRecording(true);
    } catch (err) {
      setUploadStatus({ status: "error", message: err?.message || "Mic permission denied" });
    }
  };

  const stopRecording = () => {
    try {
      mediaRecorderRef.current?.stop();
    } catch (err) {
      console.error(err);
    }
    setRecording(false);
  };

  const uploadBlob = async (blob) => {
    if (!selected) return;
    setUploadStatus({ status: "uploading", message: "Uploading audio..." });
    try {
      await uploadMeetingAudio({ ...headers, meetingId: selected.meetingId || selected.RowKey, blob });
      setUploadStatus({ status: "processing", message: "Processing with AI..." });
      pollArtifacts(selected.meetingId || selected.RowKey);
    } catch (err) {
      setUploadStatus({ status: "error", message: err?.message || "Upload failed" });
    }
  };

  const handleCreate = async () => {
    setCreateModal((prev) => ({ ...prev, status: "loading", error: "" }));
    try {
      const payload = await createMeeting({ ...headers, title: createModal.title, scheduledFor: createModal.scheduledFor, publicJoin: createModal.publicJoin });
      setCreateModal({ open: false, title: "", scheduledFor: "", publicJoin: true, status: "idle", error: "" });
      await loadMeetings();
      setSelected({ meetingId: payload.meetingId });
    } catch (err) {
      setCreateModal((prev) => ({ ...prev, status: "error", error: err?.message || "Failed" }));
    }
  };

  const handleInstantMeeting = async () => {
    setUploadStatus({ status: "loading", message: "Starting meeting..." });
    try {
      const title = `Instant meeting ${new Date().toLocaleString()}`;
      const payload = await createMeeting({ ...headers, title, publicJoin: true });
      await loadMeetings();
      setSelected({ meetingId: payload.meetingId, jitsiRoomName: payload.jitsiRoomName, joinUrl: payload.joinUrl, title });
      setUploadStatus({ status: "idle", message: "" });
    } catch (err) {
      setUploadStatus({ status: "error", message: err?.message || "Failed to start meeting" });
    }
  };

  const shareUrl = (meeting) => {
    if (!meeting) return "";
    const id = meeting.meetingId || meeting.RowKey || meeting.id;
    const base = typeof window !== "undefined" ? window.location.origin : "";
    if (meeting.joinUrl) return `${base}${meeting.joinUrl.startsWith("/") ? "" : "/"}${meeting.joinUrl}`;
    return `${base}/meet/${id}`;
  };

  const copyLink = (meeting) => {
    const url = shareUrl(meeting);
    if (!url) return;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(url);
      setUploadStatus({ status: "info", message: "Meeting link copied" });
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = url;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setUploadStatus({ status: "info", message: "Meeting link copied" });
    }
  };

  const handleSummarize = async () => {
    if (!selected) return;
    setUploadStatus({ status: "processing", message: "Re-summarizing..." });
    try {
      const res = await summarizeMeeting({ ...headers, meetingId: selected.meetingId || selected.RowKey });
      setArtifacts((prev) => ({ ...prev, summary: res.summary, tasks: res.tasks, status: "ready" }));
    } catch (err) {
      setUploadStatus({ status: "error", message: err?.message || "Summarize failed" });
    }
  };

  const handleTaskToggle = async (task) => {
    if (!selected) return;
    const updated = (artifacts.tasks || []).map((t) =>
      t.task === task.task ? { ...t, done: !t.done } : t
    );
    setArtifacts((prev) => ({ ...prev, tasks: updated }));
    try {
      await saveMeetingTasks({ ...headers, meetingId: selected.meetingId || selected.RowKey, tasks: updated });
    } catch (err) {
      console.error(err);
    }
  };

  const activeStatus = artifacts.status || meetingMeta?.status || selected?.status || "created";

  return (
    <div className="grid gap-6 lg:grid-cols-[360px,1fr]">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Meetings</h3>
          <button
            type="button"
            onClick={() => setCreateModal((prev) => ({ ...prev, open: true }))}
            className="rounded-lg bg-indigo-600 px-3 py-1 text-sm font-semibold text-white shadow hover:bg-indigo-500"
          >
            + Create
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleInstantMeeting}
            className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:border-white/30"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Start now & copy link
          </button>
          {selected && (
            <button
              type="button"
              onClick={() => copyLink(selected)}
              className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-white hover:border-white/30"
            >
              <Copy className="h-3.5 w-3.5" />
              Copy meeting link
            </button>
          )}
        </div>
        <div className="mt-4 space-y-2 max-h-[520px] overflow-y-auto pr-1">
          {loading && <p className="text-xs text-slate-300">Loading meetings…</p>}
          {!loading && meetings.length === 0 && <p className="text-xs text-slate-400">No meetings yet.</p>}
          {meetings.map((m) => (
            <button
              key={m.meetingId || m.RowKey}
              type="button"
              onClick={() => setSelected(m)}
              className={`w-full rounded-2xl border border-white/10 px-3 py-2 text-left transition hover:border-white/30 ${
                (selected?.meetingId || selected?.RowKey) === (m.meetingId || m.RowKey) ? "bg-white/10" : "bg-white/5"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-white">{m.title || "Untitled meeting"}</p>
                  <p className="text-[11px] text-slate-300">{formatDateShort(m.scheduledFor || m.createdAt)}</p>
                </div>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[11px] font-semibold ${statusColor(m.status)}`}>
                  <Circle className="h-3 w-3" />
                  {m.status || "created"}
                </span>
              </div>
              <p className="mt-1 text-[12px] text-slate-300">Room: {m.jitsiRoomName}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-xl">
        {!selected && <p className="text-sm text-slate-200">Select or create a meeting.</p>}
        {selected && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-indigo-200">Meeting</p>
                <h3 className="text-2xl font-semibold text-white">{meetingMeta?.title || selected.title || "Untitled"}</h3>
                <p className="text-sm text-slate-300">Room: {meetingMeta?.jitsiRoomName || selected.jitsiRoomName}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[11px] font-semibold ${statusColor(activeStatus)}`}>
                  <Circle className="h-3 w-3" /> {activeStatus}
                </span>
                <button
                  type="button"
                  onClick={() => loadMeetings()}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1 text-xs font-semibold text-white hover:border-white/30"
                >
                  <RefreshCw className="h-3 w-3" /> Refresh
                </button>
                <button
                  type="button"
                  onClick={() => copyLink(selected)}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1 text-xs font-semibold text-white hover:border-white/30"
                >
                  <Copy className="h-3 w-3" /> Copy link
                </button>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.2fr,0.8fr]">
              <div className="rounded-2xl border border-white/10 bg-black/60 p-3">
                <JitsiEmbed
                  roomName={meetingMeta?.jitsiRoomName || selected.jitsiRoomName}
                  displayName={userEmail || "SmartConnect4u User"}
                  onJoined={() => setMeetingMeta((prev) => ({ ...prev, status: "live" }))}
                  onReadyToClose={() => setMeetingMeta((prev) => ({ ...prev, status: "ended" }))}
                />
              </div>

              <div className="space-y-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-white">AI Recording (MVP)</p>
                    <span className="text-[11px] text-slate-300">Mic-only capture</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {!recording ? (
                      <button
                        type="button"
                        onClick={startRecording}
                        className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                      >
                        <Mic className="h-4 w-4" /> Start Recording
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={stopRecording}
                        className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-500"
                      >
                        <Pause className="h-4 w-4" /> Stop & Upload
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => pollArtifacts(selected.meetingId || selected.RowKey)}
                      className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-white hover:border-white/30"
                    >
                      <Upload className="h-4 w-4" /> Check status
                    </button>
                  </div>
                  {uploadStatus.status !== "idle" && (
                    <p className="mt-2 text-[12px] text-slate-200 flex items-center gap-2">
                      {uploadStatus.status === "uploading" || uploadStatus.status === "processing" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      {uploadStatus.message}
                    </p>
                  )}
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-white">Summary</p>
                    <button
                      type="button"
                      onClick={handleSummarize}
                      className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1 text-xs font-semibold text-white hover:border-white/30"
                    >
                      <RefreshCw className="h-3 w-3" /> Re-summarize
                    </button>
                  </div>
                  {polling && <p className="text-[12px] text-slate-300">Processing...</p>}
                  {!artifacts.summary && !polling && <p className="text-[12px] text-slate-400">No summary yet.</p>}
                  {artifacts.summary && (
                    <div className="mt-2 space-y-1">
                      <p className="text-sm font-semibold text-white">{artifacts.summary.title}</p>
                      <pre className="whitespace-pre-wrap text-xs text-slate-200">{artifacts.summary.summary}</pre>
                      <p className="text-[11px] text-slate-300">Decisions: {(artifacts.summary.decisions || []).join(", ")}</p>
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-white">Tasks</p>
                  </div>
                  {(artifacts.tasks || []).length === 0 && <p className="text-[12px] text-slate-400">No tasks yet.</p>}
                  <div className="mt-2 space-y-2">
                    {(artifacts.tasks || []).map((task) => (
                      <label key={task.task} className="flex items-start gap-2 text-sm text-white">
                        <input
                          type="checkbox"
                          checked={!!task.done}
                          onChange={() => handleTaskToggle(task)}
                          className="mt-1"
                        />
                        <span>
                          <span className="font-semibold">{task.task}</span>
                          {task.owner && <span className="ml-2 text-xs text-indigo-200">Owner: {task.owner}</span>}
                          {task.dueDate && <span className="ml-2 text-xs text-slate-200">Due: {task.dueDate}</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-white">Transcript</p>
                {artifacts.language && (
                  <span className="text-[11px] text-slate-300">Lang: {artifacts.language}</span>
                )}
              </div>
              {artifacts.transcript ? (
                <pre className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg bg-black/40 p-3 text-xs text-slate-100">
                  {artifacts.transcript}
                </pre>
              ) : (
                <p className="text-[12px] text-slate-400">No transcript yet.</p>
              )}
            </div>
          </div>
        )}
      </div>

      {createModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-white">Create meeting</h3>
            <label className="mt-3 block text-sm text-slate-200">
              Title
              <input
                className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
                value={createModal.title}
                onChange={(e) => setCreateModal((prev) => ({ ...prev, title: e.target.value }))}
                placeholder="Project sync"
              />
            </label>
            <label className="mt-3 block text-sm text-slate-200">
              Scheduled for (optional)
              <input
                type="datetime-local"
                className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
                value={createModal.scheduledFor}
                onChange={(e) => setCreateModal((prev) => ({ ...prev, scheduledFor: e.target.value }))}
              />
            </label>
            <label className="mt-3 inline-flex items-center gap-2 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={createModal.publicJoin}
                onChange={(e) => setCreateModal((prev) => ({ ...prev, publicJoin: e.target.checked }))}
              />
              Allow public join (Jitsi only)
            </label>
            {createModal.error && <p className="mt-2 text-xs text-rose-300">{createModal.error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreateModal({ open: false, title: "", scheduledFor: "", publicJoin: true, status: "idle", error: "" })}
                className="rounded-lg border border-white/10 px-3 py-2 text-sm font-semibold text-white hover:border-white/30"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreate}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
                disabled={createModal.status === "loading"}
              >
                {createModal.status === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
