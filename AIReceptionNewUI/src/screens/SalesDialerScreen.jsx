import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Search,
  Volume2,
  VolumeX
} from "lucide-react";
import { API_URLS } from "../config/urls";

const E164_REGEX = /^\+[1-9]\d{7,14}$/;
const DIAL_PAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "+", "0", "⌫"];
const TWILIO_SDK_URL =
  import.meta.env.VITE_TWILIO_VOICE_SDK_URL ||
  "https://sdk.twilio.com/js/voice/releases/2.12.3/twilio.min.js";

const normalizeDialInput = (value) => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  const keepLeadingPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";
  return keepLeadingPlus ? `+${digits}` : digits;
};

const toE164WithHelpers = (value) => {
  const raw = normalizeDialInput(value);
  if (!raw) return "";
  if (raw.startsWith("+")) return raw;
  if (raw.startsWith("00")) return `+${raw.slice(2)}`;
  if (raw.startsWith("0")) return `+44${raw.slice(1)}`;
  if (raw.length === 10) return `+1${raw}`;
  if (raw.length === 11 && raw.startsWith("1")) return `+${raw}`;
  return `+${raw}`;
};

const formatDuration = (seconds) => {
  const total = Number(seconds || 0);
  const mins = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const secs = Math.floor(total % 60)
    .toString()
    .padStart(2, "0");
  return `${mins}:${secs}`;
};

const statusTone = (value) => {
  const normalized = String(value || "").toLowerCase();
  if (["connected", "in-progress", "in_progress", "answered"].includes(normalized)) return "text-emerald-300";
  if (["ringing", "initiated", "queued"].includes(normalized)) return "text-amber-300";
  if (["failed", "error", "busy", "no-answer", "canceled", "cancelled"].includes(normalized)) return "text-rose-300";
  return "text-slate-300";
};

const prettyStatus = (value) =>
  String(value || "idle")
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

const loadTwilioVoiceSdk = () =>
  new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Browser runtime not available."));
      return;
    }
    if (window.Twilio?.Device) {
      resolve(window.Twilio.Device);
      return;
    }
    const existing = document.querySelector(`script[data-twilio-voice-sdk="1"]`);
    if (existing) {
      existing.addEventListener("load", () => {
        if (window.Twilio?.Device) {
          resolve(window.Twilio.Device);
        } else {
          reject(new Error("Twilio SDK loaded without Device constructor."));
        }
      });
      existing.addEventListener("error", () => reject(new Error("Failed to load Twilio Voice SDK.")));
      return;
    }
    const script = document.createElement("script");
    script.src = TWILIO_SDK_URL;
    script.async = true;
    script.dataset.twilioVoiceSdk = "1";
    script.onload = () => {
      if (window.Twilio?.Device) {
        resolve(window.Twilio.Device);
      } else {
        reject(new Error("Twilio SDK loaded without Device constructor."));
      }
    };
    script.onerror = () => reject(new Error("Failed to load Twilio Voice SDK."));
    document.head.appendChild(script);
  });

export default function SalesDialerScreen({ user, userProfile, sessionEmail = "" }) {
  const userEmail = useMemo(
    () =>
      String(
        sessionEmail ||
          user?.email ||
          userProfile?.contact_email ||
          userProfile?.email ||
          ""
      )
        .trim()
        .toLowerCase(),
    [sessionEmail, user?.email, userProfile?.contact_email, userProfile?.email]
  );
  const [mode, setMode] = useState("browser");
  const [inputNumber, setInputNumber] = useState("");
  const [repPhone, setRepPhone] = useState("");
  const [callerId, setCallerId] = useState("+1 431 340 0857");
  const [deviceState, setDeviceState] = useState("idle");
  const [callState, setCallState] = useState("idle");
  const [callSeconds, setCallSeconds] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [micPermission, setMicPermission] = useState("prompt");
  const [tokenError, setTokenError] = useState("");
  const [actionError, setActionError] = useState("");
  const [recentCalls, setRecentCalls] = useState([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactSearch, setContactSearch] = useState("");

  const deviceRef = useRef(null);
  const activeCallRef = useRef(null);
  const callStartRef = useRef(null);
  const twilioDeviceCtorRef = useRef(null);

  const normalizedTarget = useMemo(() => toE164WithHelpers(inputNumber), [inputNumber]);
  const canDial = E164_REGEX.test(normalizedTarget);

  const authHeaders = useMemo(
    () => ({
      "Content-Type": "application/json",
      "x-user-email": userEmail
    }),
    [userEmail]
  );

  const attachConnectionListeners = useCallback((connection) => {
    if (!connection) return;
    connection.on("ringing", () => setCallState("ringing"));
    connection.on("accept", () => {
      callStartRef.current = Date.now();
      setCallSeconds(0);
      setCallState("connected");
    });
    connection.on("disconnect", () => {
      activeCallRef.current = null;
      setCallState("ended");
      setIsMuted(false);
    });
    connection.on("cancel", () => setCallState("ended"));
    connection.on("reject", () => setCallState("ended"));
    connection.on("error", (err) => {
      setCallState("error");
      setActionError(err?.message || "Call failed.");
    });
  }, []);

  const loadRecentCalls = useCallback(async () => {
    if (!userEmail) return;
    setRecentLoading(true);
    try {
      const res = await fetch(
        `${API_URLS.voiceLogs}?email=${encodeURIComponent(userEmail)}&limit=25`,
        { headers: { "x-user-email": userEmail } }
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || "Unable to load recent calls");
      }
      setRecentCalls(Array.isArray(payload?.items) ? payload.items : []);
    } catch (err) {
      setActionError(err?.message || "Unable to load recent calls.");
    } finally {
      setRecentLoading(false);
    }
  }, [userEmail]);

  const loadContacts = useCallback(async () => {
    if (!userEmail) return;
    setContactsLoading(true);
    try {
      const params = new URLSearchParams({ email: userEmail, limit: "20" });
      if (contactSearch.trim()) params.set("search", contactSearch.trim());
      const res = await fetch(`${API_URLS.contacts}?${params.toString()}`);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || "Unable to load contacts");
      }
      setContacts(Array.isArray(payload?.contacts) ? payload.contacts : []);
    } catch (err) {
      setActionError(err?.message || "Unable to load contacts.");
    } finally {
      setContactsLoading(false);
    }
  }, [contactSearch, userEmail]);

  const requestMicPermission = useCallback(async () => {
    if (!navigator?.mediaDevices?.getUserMedia) {
      setMicPermission("unsupported");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setMicPermission("granted");
    } catch {
      setMicPermission("denied");
    }
  }, []);

  const bootstrapDevice = useCallback(async () => {
    if (!userEmail) {
      setDeviceState("error");
      setTokenError("No signed-in email found. Please log in again.");
      return null;
    }
    setDeviceState("initializing");
    setTokenError("");
    setActionError("");
    try {
      if (!twilioDeviceCtorRef.current) {
        twilioDeviceCtorRef.current = await loadTwilioVoiceSdk();
      }
      const tokenRes = await fetch(
        `${API_URLS.voiceToken}?email=${encodeURIComponent(userEmail)}`,
        { headers: { "x-user-email": userEmail } }
      );
      const tokenPayload = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok) {
        throw new Error(tokenPayload?.error || "Unable to load Twilio token.");
      }
      setCallerId(tokenPayload?.callerId || "+14313400857");
      const DeviceCtor = twilioDeviceCtorRef.current;
      if (!DeviceCtor) {
        throw new Error("Twilio Voice SDK not available.");
      }
      if (deviceRef.current) {
        try {
          deviceRef.current.destroy();
        } catch {
          // no-op
        }
      }
      const device = new DeviceCtor(tokenPayload.token, {
        closeProtection: true,
        codecPreferences: ["opus", "pcmu"],
      });
      deviceRef.current = device;
      device.on("registering", () => setDeviceState("registering"));
      device.on("registered", () => setDeviceState("ready"));
      device.on("error", (err) => {
        setDeviceState("error");
        setTokenError(err?.message || "Twilio device error.");
      });
      device.on("connect", (connection) => {
        activeCallRef.current = connection;
        attachConnectionListeners(connection);
      });
      device.on("disconnect", () => {
        activeCallRef.current = null;
        setCallState("ended");
        setIsMuted(false);
        loadRecentCalls();
      });
      device.on("tokenWillExpire", async () => {
        try {
          const refreshed = await fetch(
            `${API_URLS.voiceToken}?email=${encodeURIComponent(userEmail)}`,
            { headers: { "x-user-email": userEmail } }
          );
          const refreshedPayload = await refreshed.json().catch(() => ({}));
          if (refreshed.ok && refreshedPayload?.token) {
            device.updateToken(refreshedPayload.token);
          }
        } catch {
          // no-op best effort
        }
      });
      await device.register();
      return device;
    } catch (err) {
      setDeviceState("error");
      setTokenError(err?.message || "Unable to initialize browser dialer.");
      return null;
    }
  }, [attachConnectionListeners, loadRecentCalls, userEmail]);

  const startBrowserCall = useCallback(async () => {
    setActionError("");
    if (!userEmail) {
      setActionError("No signed-in email found. Please log in again.");
      return;
    }
    if (!canDial) {
      setActionError("Enter a valid E.164 number.");
      return;
    }
    let device = deviceRef.current;
    if (!device) {
      device = await bootstrapDevice();
      if (!device) return;
    }
    try {
      setCallState("ringing");
      const connection = await device.connect({ params: { To: normalizedTarget } });
      activeCallRef.current = connection;
      attachConnectionListeners(connection);
    } catch (err) {
      setCallState("error");
      setActionError(err?.message || "Unable to place browser call.");
    }
  }, [attachConnectionListeners, bootstrapDevice, canDial, normalizedTarget, userEmail]);

  const startDialoutFallback = useCallback(async () => {
    setActionError("");
    if (!canDial) {
      setActionError("Enter a valid E.164 number.");
      return;
    }
    const rep = toE164WithHelpers(repPhone || userProfile?.business_number || "");
    if (!E164_REGEX.test(rep)) {
      setActionError("Add a valid rep phone number for fallback.");
      return;
    }
    try {
      setCallState("ringing");
      const res = await fetch(API_URLS.voiceDialout, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          email: userEmail,
          to: normalizedTarget,
          repPhone: rep
        })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || "Dial-out failed.");
      }
      loadRecentCalls();
    } catch (err) {
      setCallState("error");
      setActionError(err?.message || "Dial-out failed.");
    }
  }, [authHeaders, canDial, loadRecentCalls, normalizedTarget, repPhone, userEmail, userProfile?.business_number]);

  const hangup = useCallback(() => {
    try {
      if (activeCallRef.current) {
        activeCallRef.current.disconnect();
      } else if (deviceRef.current) {
        deviceRef.current.disconnectAll();
      }
      setCallState("ended");
      setIsMuted(false);
    } catch {
      setActionError("Unable to hang up call.");
    }
  }, []);

  const toggleMute = useCallback(() => {
    const connection = activeCallRef.current;
    if (!connection) return;
    const next = !isMuted;
    try {
      connection.mute(next);
      setIsMuted(next);
    } catch {
      setActionError("Mute is not available for this call.");
    }
  }, [isMuted]);

  const toggleSpeaker = useCallback(() => {
    const device = deviceRef.current;
    const next = !speakerOn;
    try {
      const speakerDevices = device?.audio?.speakerDevices;
      if (speakerDevices?.set) {
        speakerDevices.set(next ? "default" : []);
      }
      setSpeakerOn(next);
    } catch {
      setActionError("Speaker routing is browser-managed on this device.");
    }
  }, [speakerOn]);

  useEffect(() => {
    requestMicPermission();
    loadRecentCalls();
  }, [loadRecentCalls, requestMicPermission]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadContacts();
    }, 200);
    return () => clearTimeout(timer);
  }, [loadContacts]);

  useEffect(() => {
    if (mode !== "browser") return;
    if (!userEmail) {
      setDeviceState("error");
      setTokenError("No signed-in email found. Please log in again.");
      return undefined;
    }
    bootstrapDevice();
    return () => {
      if (deviceRef.current) {
        try {
          deviceRef.current.destroy();
        } catch {
          // no-op
        }
        deviceRef.current = null;
      }
      activeCallRef.current = null;
    };
  }, [bootstrapDevice, mode, userEmail]);

  useEffect(() => {
    if (callState !== "connected") return undefined;
    const id = setInterval(() => {
      const started = callStartRef.current || Date.now();
      setCallSeconds(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    }, 1000);
    return () => clearInterval(id);
  }, [callState]);

  const handleDialPad = (value) => {
    if (value === "⌫") {
      setInputNumber((prev) => prev.slice(0, -1));
      return;
    }
    setInputNumber((prev) => `${prev}${value}`);
  };

  const placeCall = () => {
    if (mode === "browser") {
      startBrowserCall();
      return;
    }
    startDialoutFallback();
  };

  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-xl backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-indigo-200">Sales tools</p>
          <h3 className="text-xl font-semibold text-white">Sales Dialer</h3>
          <p className="text-sm text-slate-300">UK reps calling Canada using your Twilio caller ID.</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-900/50 px-3 py-2 text-sm text-slate-200">
          From: <span className="font-semibold text-white">{callerId || "+14313400857"}</span>
        </div>
      </div>

      <div className="mt-4 inline-flex rounded-2xl border border-white/10 bg-slate-900/40 p-1">
        <button
          type="button"
          onClick={() => setMode("browser")}
          className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
            mode === "browser" ? "bg-indigo-500/70 text-white" : "text-slate-300 hover:bg-white/10"
          }`}
        >
          Browser Dialer (Recommended)
        </button>
        <button
          type="button"
          onClick={() => setMode("dialout")}
          className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
            mode === "dialout" ? "bg-indigo-500/70 text-white" : "text-slate-300 hover:bg-white/10"
          }`}
        >
          Phone Dial-Out (Fallback)
        </button>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.2fr_1fr]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
            <label className="mb-2 block text-sm font-semibold text-slate-200">Dial number (E.164)</label>
            <input
              type="tel"
              value={inputNumber}
              onChange={(event) => setInputNumber(event.target.value)}
              placeholder="+14165551234"
              className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setInputNumber((prev) => toE164WithHelpers(prev))}
                className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:bg-white/10"
              >
                Auto format (UK/CA)
              </button>
              <span className={`text-xs ${canDial ? "text-emerald-300" : "text-amber-300"}`}>
                {canDial ? `Ready: ${normalizedTarget}` : "Use +countrycode format"}
              </span>
            </div>
            {mode === "dialout" && (
              <div className="mt-3">
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">
                  Rep phone (verified)
                </label>
                <input
                  type="tel"
                  value={repPhone}
                  onChange={(event) => setRepPhone(event.target.value)}
                  placeholder={userProfile?.business_number || "+447700900123"}
                  className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2 rounded-2xl border border-white/10 bg-slate-900/40 p-4">
            {DIAL_PAD.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => handleDialPad(key)}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-base font-semibold text-white transition hover:bg-white/15"
              >
                {key}
              </button>
            ))}
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <button
                type="button"
                onClick={placeCall}
                disabled={!canDial || (mode === "browser" && deviceState === "registering")}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500/80 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Phone className="h-4 w-4" />
                Call
              </button>
              <button
                type="button"
                onClick={hangup}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-500/80 px-3 py-2 text-sm font-semibold text-white transition hover:bg-rose-500"
              >
                <PhoneOff className="h-4 w-4" />
                Hang up
              </button>
              <button
                type="button"
                onClick={toggleMute}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                {isMuted ? "Unmute" : "Mute"}
              </button>
              <button
                type="button"
                onClick={toggleSpeaker}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                {speakerOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                {speakerOn ? "Speaker On" : "Speaker Off"}
              </button>
            </div>

            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-slate-300">
                Browser device: <span className={statusTone(deviceState)}>{prettyStatus(deviceState)}</span>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-slate-300">
                Call status: <span className={statusTone(callState)}>{prettyStatus(callState)}</span>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-slate-300">
                Microphone: <span className={statusTone(micPermission)}>{prettyStatus(micPermission)}</span>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-slate-300">
                Timer: <span className="text-white">{formatDuration(callSeconds)}</span>
              </div>
            </div>

            {(tokenError || actionError) && (
              <p className="mt-3 text-sm text-rose-300">{tokenError || actionError}</p>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-white">Recent calls</p>
              <button
                type="button"
                onClick={loadRecentCalls}
                className="rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-xs text-slate-200 hover:bg-white/10"
              >
                Refresh
              </button>
            </div>
            <div className="max-h-64 space-y-2 overflow-auto pr-1">
              {recentLoading && <p className="text-xs text-slate-300">Loading recent calls...</p>}
              {!recentLoading && recentCalls.length === 0 && (
                <p className="text-xs text-slate-400">No calls logged yet.</p>
              )}
              {recentCalls.map((item) => (
                <button
                  key={`${item.callSid}-${item.updatedAt || ""}`}
                  type="button"
                  onClick={() => setInputNumber(item.to || "")}
                  className="w-full rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-left hover:bg-slate-800/70"
                >
                  <p className="text-sm font-semibold text-white">{item.to || "Unknown target"}</p>
                  <p className="text-xs text-slate-300">
                    {prettyStatus(item.status)} • {item.duration ? `${item.duration}s` : "—"}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-white">Click-to-call contacts</p>
              <div className="relative w-40">
                <Search className="pointer-events-none absolute left-2 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  value={contactSearch}
                  onChange={(event) => setContactSearch(event.target.value)}
                  placeholder="Search"
                  className="w-full rounded-lg border border-white/10 bg-slate-950/60 py-2 pl-7 pr-2 text-xs text-white outline-none focus:border-indigo-400"
                />
              </div>
            </div>
            <div className="max-h-72 space-y-2 overflow-auto pr-1">
              {contactsLoading && <p className="text-xs text-slate-300">Loading contacts...</p>}
              {!contactsLoading && contacts.length === 0 && (
                <p className="text-xs text-slate-400">No contacts with phone numbers found.</p>
              )}
              {contacts
                .filter((entry) => String(entry?.phone || "").trim())
                .map((entry) => (
                  <div
                    key={`${entry.id}-${entry.phone}`}
                    className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">{entry.name || "Unnamed"}</p>
                      <p className="truncate text-xs text-slate-300">{entry.phone}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setInputNumber(entry.phone || "")}
                      className="ml-3 rounded-lg border border-emerald-400/40 bg-emerald-500/20 px-2 py-1 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/30"
                    >
                      Use
                    </button>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
