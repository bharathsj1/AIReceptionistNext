"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
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
  connecting: "bg-amber-100 text-amber-800",
  listening: "bg-emerald-100 text-emerald-800",
  thinking: "bg-amber-100 text-amber-800",
  speaking: "bg-slate-900 text-white",
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
  const surfaceStyle: CSSProperties = {
    "--dot-color": "rgba(15, 23, 42, 0.12)",
    "--warm-bg": "#f5f2ea",
    "--warm-glow": "rgba(255, 255, 255, 0.85)",
    backgroundColor: "var(--warm-bg)",
    backgroundImage:
      "radial-gradient(circle at 1px 1px, var(--dot-color) 1px, transparent 0), linear-gradient(180deg, var(--warm-glow), rgba(245, 242, 234, 0.98))",
    backgroundSize: "24px 24px, 100% 100%"
  };

  useEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;
    // Scroll to the latest message smoothly when new transcripts arrive.
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [transcripts]);

  return (
    <section
      className="relative overflow-hidden rounded-[32px] border border-slate-200/80 px-6 py-10 shadow-[0_30px_80px_rgba(30,41,59,0.12)] md:px-10 md:py-12"
      style={surfaceStyle}
    >
      <div className="pointer-events-none absolute -top-28 left-1/2 h-56 w-56 -translate-x-1/2 rounded-full bg-white/70 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 right-[-40px] h-52 w-52 rounded-full bg-amber-200/50 blur-3xl" />

      <div className="relative z-10">
        <div className="flex flex-col items-center text-center">
          <p className="mt-2 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
            Test my AI Receptionist
          </p>
          <p className="mt-2 max-w-2xl text-sm text-slate-600 md:text-base">
            Speak to our advanced agents right here and watch the transcript stream in real time.
          </p>
          <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm ring-1 ring-slate-200">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            Voice ready
          </div>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <div className="order-2 flex flex-col rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-lg backdrop-blur md:order-1 md:p-6">
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
              className="mt-4 h-[320px] overflow-y-auto rounded-xl border border-slate-100 bg-white/90 p-3 md:h-[380px]"
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
                                : "bg-slate-900 text-white"
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

          <div className="order-1 flex flex-col gap-6 md:order-2">
            <div className="relative mx-auto w-full max-w-sm">
              <div className="rounded-[36px] border border-slate-900/80 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-800 p-5 shadow-[0_30px_70px_rgba(15,23,42,0.45)]">
                <div className="flex items-center justify-between rounded-full bg-slate-950/70 px-4 py-2 text-[11px] font-semibold text-slate-200">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        className="h-4 w-4 text-white"
                        aria-hidden="true"
                      >
                        <path
                          fill="currentColor"
                          d="M12 3a9 9 0 1 0 9 9a9 9 0 0 0-9-9Zm4.24 12.06-1.42 1.42L12 13.66l-2.82 2.82-1.42-1.42L10.59 12 7.76 9.18l1.42-1.42L12 10.34l2.82-2.82 1.42 1.42L13.41 12Z"
                        />
                      </svg>
                    </span>
                    <span>SmartConnect4u Voice Support</span>
                  </div>
                  <span className={isInCall ? "text-emerald-400" : "text-slate-400"}>
                    {isInCall ? "Live" : "0:00"}
                  </span>
                </div>

                <div className="mt-6 flex flex-col items-center gap-4 rounded-[28px] bg-gradient-to-b from-slate-700/70 via-slate-600/60 to-slate-500/40 px-6 py-8">
                  <button
                    type="button"
                    aria-pressed={isInCall}
                    onClick={startCall}
                    disabled={isInCall}
                    className={`flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-white shadow-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${
                      isInCall ? "opacity-60" : "hover:bg-white/20"
                    } disabled:cursor-not-allowed`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      className="h-4 w-4"
                      aria-hidden="true"
                    >
                      <path
                        fill="currentColor"
                        d="M12 14a4 4 0 0 0 4-4V5a4 4 0 1 0-8 0v5a4 4 0 0 0 4 4Zm-7-4a7 7 0 0 0 14 0h-2a5 5 0 1 1-10 0H5Zm6 7.93V22h2v-4.07a8.03 8.03 0 0 1-2 0Z"
                      />
                    </svg>
                    {isInCall ? "Live" : "Unmute"}
                  </button>

                  <button
                    type="button"
                    onClick={endCall}
                    disabled={!isInCall}
                    className={`flex items-center gap-2 rounded-full px-5 py-2 text-xs font-semibold shadow-md transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200 ${
                      isInCall
                        ? "bg-rose-500 text-white hover:bg-rose-600"
                        : "bg-slate-400/50 text-slate-200"
                    } disabled:cursor-not-allowed`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      className="h-4 w-4"
                      aria-hidden="true"
                    >
                      <path fill="currentColor" d="M7 6h2v12H7zm8 0h2v12h-2z" />
                    </svg>
                    End call
                  </button>

                  <button
                    type="button"
                    aria-pressed={isInCall}
                    onClick={handleToggleCall}
                    className="sr-only"
                  >
                    Toggle call
                  </button>

                  <div className="text-center">
                    <p className="text-sm font-semibold text-white">
                      {isInCall ? "End call" : "Start test call"}
                    </p>
                    <p className="mt-1 text-xs text-slate-300">
                      {statusLabel}
                    </p>
                  </div>

                  <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold ${statusTone[status]}`}>
                    <span className="h-2 w-2 rounded-full bg-current opacity-70" />
                    {statusLabel}
                  </div>
                </div>
              </div>
              <div className="pointer-events-none absolute -bottom-5 left-1/2 h-10 w-40 -translate-x-1/2 rounded-full bg-slate-900/30 blur-2xl" />
            </div>

            <div className="flex flex-col rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-lg backdrop-blur">
              <p className="text-sm font-semibold text-slate-700">Talk to our AI Receptionist</p>
              <p className="mt-1 text-sm text-slate-600">
                Click the button and speak, our advanced agent will respond in real time.
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
                        className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1 ${
                          isActive
                            ? "border-slate-300 bg-slate-900 text-white shadow-sm"
                            : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:text-slate-900"
                        } ${isInCall && !isActive ? "opacity-60" : ""}`}
                      >
                        <span className={`h-2 w-2 rounded-full ${isActive ? "bg-emerald-400" : "bg-slate-400"}`} />
                        {agent.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <p className="mt-4 text-xs text-slate-500">
                We will ask for microphone access so you can talk to the agent.
              </p>
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>
    </section>
  );
}
