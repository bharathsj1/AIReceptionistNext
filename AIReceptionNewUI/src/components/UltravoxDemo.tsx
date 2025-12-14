"use client";

import { useEffect, useRef, useState } from "react";
import { UltravoxSession } from "ultravox-client";
import API_URLS from "../config/urls.js";

type CallStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "disconnecting"
  | "disconnected"
  | "error";

type TranscriptItem = {
  id: string;
  text: string;
  speaker: "user" | "agent";
  isFinal: boolean;
};

type AgentOption = {
  id: string;
  name: string;
};

const statusCopy: Record<CallStatus, string> = {
  idle: "Ready to start",
  connecting: "Connecting…",
  listening: "Listening to you…",
  thinking: "Thinking…",
  speaking: "Speaking…",
  disconnecting: "Ending call…",
  disconnected: "Call ended",
  error: "Could not start"
};

const statusTone: Record<CallStatus, string> = {
  idle: "bg-slate-100 text-slate-700",
  connecting: "bg-indigo-50 text-indigo-700",
  listening: "bg-emerald-50 text-emerald-700",
  thinking: "bg-amber-50 text-amber-700",
  speaking: "bg-indigo-50 text-indigo-700",
  disconnecting: "bg-slate-100 text-slate-700",
  disconnected: "bg-slate-100 text-slate-700",
  error: "bg-red-50 text-red-700"
};

export default function UltravoxDemo() {
  const agentOptions: AgentOption[] = [
    {
      id: import.meta.env.VITE_ULTRAVOX_AGENT_DEMO1_ID ?? "0a6ea934-ddea-4819-a3a4-ab7475b1366e",
      name: "Demo 1"
    },
    {
      id: import.meta.env.VITE_ULTRAVOX_AGENT_DEMO2_ID ?? "",
      name: "Demo 2"
    },
    {
      id: import.meta.env.VITE_ULTRAVOX_AGENT_DEMO3_ID ?? "",
      name: "Demo 3"
    }
  ];

  const [status, setStatus] = useState<CallStatus>("idle");
  const [isInCall, setIsInCall] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<AgentOption>(agentOptions[0]);
  const sessionRef = useRef<UltravoxSession | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!sessionRef.current) {
      sessionRef.current = new UltravoxSession();
    }

    const session = sessionRef.current;

    const handleStatus = () => {
      const next = (session.status as CallStatus) || "idle";
      setStatus(next);
      const active = next !== "disconnected" && next !== "idle";
      setIsInCall(active);
    };

    const handleTranscripts = () => {
      const items = session.transcripts || [];
      setTranscripts(
        items.map((t, idx) => ({
          id: `${idx}-${t.speaker}-${t.medium ?? "voice"}`,
          text: t.text ?? "",
          speaker: t.speaker === "user" ? "user" : "agent",
          isFinal: Boolean(t.isFinal)
        }))
      );
    };

    session.addEventListener("status", handleStatus);
    session.addEventListener("transcripts", handleTranscripts);

    return () => {
      session.removeEventListener("status", handleStatus);
      session.removeEventListener("transcripts", handleTranscripts);
      session.leaveCall().catch(() => {});
    };
  }, []);

  const handleToggleCall = async () => {
    if (!isInCall) {
      await startCall();
    } else {
      await endCall();
    }
  };

  const startCall = async () => {
    const session = sessionRef.current;
    if (!session) {
      setError("Voice session is not ready yet. Please refresh and try again.");
      return;
    }

    if (!selectedAgent?.id) {
      setError("Agent is not configured. Please set an Ultravox agent ID for this demo.");
      return;
    }

    setError(null);
    setStatus("connecting");
    setIsInCall(true);
    try {
      const res = await fetch(API_URLS.ultravoxDemoCall, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          agentId: selectedAgent.id
        })
      });
      if (!res.ok) {
        throw new Error("Failed to start Ultravox call");
      }
      const data = await res.json();
      const joinUrl = data?.joinUrl;

      if (!joinUrl || typeof joinUrl !== "string") {
        throw new Error("Join URL missing from Ultravox response");
      }

      await session.joinCall(joinUrl, "demo-homepage");
      setIsInCall(true);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not start Ultravox call.";
      const friendly =
        message.toLowerCase().includes("permission") || message.toLowerCase().includes("microphone")
          ? "Microphone permission was denied. Please allow mic access in your browser and try again."
          : "Could not start Ultravox call. Please check your API key and agent configuration.";
      setError(friendly);
      setStatus("error");
      setIsInCall(false);
    }
  };

  const endCall = async () => {
    const session = sessionRef.current;
    if (!session) {
      return;
    }
    setStatus("disconnecting");
    try {
      await session.leaveCall();
    } catch {
      // Ignore disconnect errors; UI will reset below.
    } finally {
      setIsInCall(false);
      setStatus("disconnected");
    }
  };

  const statusLabel = statusCopy[status] || "Ready to start";

  useEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;
    // Scroll to the latest message smoothly when new transcripts arrive.
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [transcripts]);

  return (
    <section className="relative overflow-hidden rounded-3xl border border-white/60 bg-gradient-to-br from-white via-slate-50 to-indigo-50/70 p-6 shadow-[0_20px_90px_rgba(15,23,42,0.25)] backdrop-blur md:p-10">
      <div className="pointer-events-none absolute -left-10 -top-16 h-40 w-40 rounded-full bg-indigo-200/60 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-16 h-48 w-48 rounded-full bg-sky-200/60 blur-3xl" />

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600">
            Live voice demo
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-slate-900 md:text-3xl">
            Test my AI Receptionist
          </h2>
          <p className="mt-2 text-sm text-slate-600 md:text-base">
            Speak to our advanced agents right here and watch the transcript stream in real-time.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm ring-1 ring-slate-200">
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          Voice ready
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] md:gap-8">
        <div className="flex flex-col rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-lg backdrop-blur md:p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Live conversation
              </p>
              <h3 className="text-lg font-semibold text-slate-900">Transcript</h3>
            </div>
            <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${statusTone[status]}`}>
              <span className="h-2 w-2 rounded-full bg-current opacity-70" />
              {statusLabel}
            </span>
          </div>

          <div
            className="mt-4 h-[320px] overflow-y-auto rounded-xl border border-slate-100 bg-white/80 p-3 md:h-[380px]"
            aria-live="polite"
            ref={transcriptRef}
          >
            {transcripts.length === 0 ? (
              <div className="flex h-full items-center justify-center text-center text-sm text-slate-500">
                Transcript will appear here once you start talking to the agent.
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {transcripts.map((item) => {
                  const isUser = item.speaker === "user";
                  return (
                    <div
                      key={item.id}
                      className={`flex ${isUser ? "justify-start" : "justify-end"}`}
                    >
                      <div className={`flex max-w-[85%] flex-col gap-1 ${isUser ? "items-start" : "items-end"}`}>
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                          {isUser ? "You" : "AI Receptionist"}
                        </span>
                        <div
                          className={`rounded-2xl px-4 py-3 shadow-sm ${
                            isUser
                              ? "bg-slate-100 text-slate-900"
                              : "bg-indigo-600 text-white"
                          }`}
                        >
                          <p
                            className={`text-sm leading-relaxed ${
                              item.isFinal ? "" : "opacity-80"
                            } ${!item.isFinal ? "animate-pulse" : ""}`}
                          >
                            {item.text}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-lg backdrop-blur md:p-6">
          <p className="text-sm font-semibold text-slate-700">Talk to our AI Receptionist</p>
          <p className="mt-1 text-sm text-slate-600">
            Click the button and speak — our advanced agent will respond in real-time.
          </p>

          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              Choose a demo agent
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {agentOptions.map((agent) => {
                const isActive = selectedAgent.id === agent.id && selectedAgent.name === agent.name;
                return (
                  <button
                    key={agent.name}
                    type="button"
                onClick={() => setSelectedAgent(agent)}
                    disabled={isInCall && !isActive}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 ${
                      isActive
                        ? "border-indigo-200 bg-indigo-50 text-indigo-700 shadow-sm"
                        : "border-slate-200 bg-white text-slate-700 hover:border-indigo-200 hover:text-indigo-700"
                    } ${isInCall && !isActive ? "opacity-60" : ""}`}
                  >
                    <span className="h-2 w-2 rounded-full bg-indigo-500" />
                    {agent.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-6 flex flex-col items-center gap-4">
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                aria-pressed={isInCall}
                onClick={startCall}
                disabled={isInCall}
                className={`relative flex h-24 w-24 items-center justify-center rounded-full text-white shadow-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
                  isInCall
                    ? "bg-gradient-to-br from-slate-200 to-slate-300 opacity-60"
                    : "bg-gradient-to-br from-indigo-600 to-violet-500 hover:scale-[1.05]"
                } disabled:cursor-not-allowed`}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  className="h-9 w-9"
                  aria-hidden="true"
                >
                  <path
                    fill="currentColor"
                    d="M12 14a4 4 0 0 0 4-4V5a4 4 0 1 0-8 0v5a4 4 0 0 0 4 4Zm-7-4a7 7 0 0 0 14 0h-2a5 5 0 1 1-10 0H5Zm6 7.93V22h2v-4.07a8.03 8.03 0 0 1-2 0Z"
                  />
                </svg>
                <span className="sr-only">Start test call</span>
              </button>

              <button
                type="button"
                onClick={endCall}
                disabled={!isInCall}
                className={`flex h-12 items-center gap-2 rounded-full px-5 text-sm font-semibold text-white shadow-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 ${
                  isInCall
                    ? "bg-gradient-to-br from-rose-500 to-red-500 hover:scale-[1.03]"
                    : "bg-slate-300 text-slate-600 opacity-70"
                } disabled:cursor-not-allowed`}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  <path fill="currentColor" d="M7 6h2v12H7zm8 0h2v12h-2z" />
                </svg>
                End call
              </button>
            </div>

            <button
              type="button"
              aria-pressed={isInCall}
              onClick={handleToggleCall}
              className="sr-only"
            >
              {/* Hidden toggle preserved for accessibility */}
              Toggle call
            </button>

            <div className="text-center">
              <p className="text-sm font-semibold text-slate-800">
                {isInCall ? "End call" : "Start test call"}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {statusLabel}
              </p>
            </div>

            <div className="mt-2 inline-flex items-center rounded-full px-3 py-1 text-xs font-medium text-slate-600">
              <span className="mr-2 h-2 w-2 rounded-full bg-indigo-500" />
              {statusLabel}
            </div>

            <p className="mt-1 text-center text-xs text-slate-500">
              We’ll ask for microphone access so you can talk to the agent.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
    </section>
  );
}
