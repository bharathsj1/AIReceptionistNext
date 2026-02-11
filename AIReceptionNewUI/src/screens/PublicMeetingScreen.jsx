import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ExternalLink, Loader2, RefreshCw, Shield, Users } from "lucide-react";
import JitsiEmbed from "../components/meetings/JitsiEmbed";
import { getMeeting } from "../lib/api/meetings";
import { formatDateShort } from "../lib/utils/date";

export default function PublicMeetingScreen({ meetingId }) {
  const [meeting, setMeeting] = useState(null);
  const [status, setStatus] = useState({ state: "loading", message: "Loading meeting..." });

  const load = useMemo(
    () => async () => {
      setStatus({ state: "loading", message: "Loading meeting..." });
      try {
        const data = await getMeeting({ meetingId });
        setMeeting(data);
        setStatus({ state: "ready", message: "" });
      } catch (err) {
        setStatus({
          state: "error",
          message: err?.message || "Unable to load meeting. It may be private or missing.",
        });
      }
    },
    [meetingId]
  );

  useEffect(() => {
    if (meetingId) load();
  }, [meetingId, load]);

  if (!meetingId) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-white">
        <p>No meeting id found.</p>
      </div>
    );
  }

  if (status.state === "loading") {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-slate-950 text-white">
        <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
        <p className="text-sm text-slate-200">{status.message}</p>
      </div>
    );
  }

  if (status.state === "error") {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-slate-950 px-6 text-center text-white">
        <AlertTriangle className="h-8 w-8 text-amber-400" />
        <div>
          <p className="text-lg font-semibold">Unable to open meeting</p>
          <p className="text-sm text-slate-300">{status.message}</p>
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          <RefreshCw className="h-4 w-4" /> Retry
        </button>
      </div>
    );
  }

  const metaChips = [
    meeting?.scheduledFor ? `Scheduled: ${formatDateShort(meeting.scheduledFor)}` : null,
    meeting?.publicJoin ? "Public" : null,
  ].filter(Boolean);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 lg:flex-row">
        <div className="lg:w-2/3">
          <div className="rounded-3xl border border-white/10 bg-black/70 p-4 shadow-2xl">
            <div className="flex items-center justify-between gap-3 pb-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.2em] text-indigo-200">Meeting</p>
                <h1 className="text-2xl font-bold">{meeting?.title || "Untitled meeting"}</h1>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-indigo-100">
                  {metaChips.map((chip) => (
                    <span key={chip} className="rounded-full bg-white/10 px-3 py-[4px]">
                      {chip}
                    </span>
                  ))}
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-[4px]">
                    <Shield className="h-3.5 w-3.5" /> Hosted by SmartConnect4u
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-white hover:border-white/30"
                >
                  Refresh
                </button>
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-2">
              <JitsiEmbed
                roomName={meeting?.jitsiRoomName}
                displayName="Guest"
                onJoined={() => setMeeting((prev) => ({ ...prev, status: "live" }))}
                onReadyToClose={() => setMeeting((prev) => ({ ...prev, status: "ended" }))}
              />
            </div>
          </div>
        </div>
        <div className="lg:w-1/3">
          <div className="space-y-4">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-xl">
              <p className="text-sm font-semibold text-white">How to join</p>
              <ul className="mt-2 space-y-2 text-sm text-slate-200">
                <li className="flex items-start gap-2">
                  <ExternalLink className="mt-0.5 h-4 w-4 text-indigo-300" />
                  Share this link with anyone to join directly.
                </li>
                <li className="flex items-start gap-2">
                  <Users className="mt-0.5 h-4 w-4 text-indigo-300" />
                  No login required; ensure the meeting host keeps it public.
                </li>
              </ul>
              <div className="mt-3 rounded-xl bg-black/40 p-3 text-xs text-slate-200 break-all">
                {typeof window !== "undefined" ? window.location.href : ""}
              </div>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-xl">
              <p className="text-sm font-semibold text-white">Status</p>
              <p className="mt-1 text-xs text-slate-300">
                {meeting?.status ? meeting.status : "created"}
              </p>
              {meeting?.scheduledFor && (
                <p className="text-xs text-slate-400">
                  Scheduled for {formatDateShort(meeting.scheduledFor)}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
