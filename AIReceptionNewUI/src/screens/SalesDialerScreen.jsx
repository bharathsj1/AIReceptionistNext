import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_URLS } from "../config/urls";

const NOTES_KEY = "appointment_dialer_notes_v1";
const DIAL_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "+", "0", "#"];
const E164_REGEX = /^\+[1-9]\d{7,14}$/;
const DESTINATION_CALLER_PREFIX_RULES = [
  { destination: ["+1"], caller: ["+1"] },
  { destination: ["+44"], caller: ["+44"] },
  { destination: ["+61"], caller: ["+61"] },
  { destination: ["+64"], caller: ["+64"] },
  { destination: ["+353"], caller: ["+353"] },
  { destination: ["+91"], caller: ["+91"] },
  { destination: ["+33"], caller: ["+33"] },
  { destination: ["+49"], caller: ["+49"] },
  { destination: ["+34"], caller: ["+34"] },
  { destination: ["+39"], caller: ["+39"] }
];

const TWILIO_SDK_URL = "https://unpkg.com/@twilio/voice-sdk@2.18.0/dist/twilio.min.js";

const styles = `
.sales-dialer-page {
  margin: 0;
  min-height: 100vh;
  width: 100%;
  max-width: 100%;
  overflow-x: hidden;
  background: radial-gradient(circle at 85% 0%, #dce9ff 0%, rgba(220, 233, 255, 0) 30%), #f4f6fb;
  color: #0f1d3a;
  font-family: "Product Sans", "SF Pro Display", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  padding: 24px;
}
.sales-dialer-page * {
  box-sizing: border-box;
}
.sales-dialer-page .app {
  width: 100%;
  min-width: 0;
  max-width: 1300px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: minmax(360px, 420px) minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}
.sales-dialer-page .app > * {
  min-width: 0;
}
.sales-dialer-page .panel {
  min-width: 0;
  background: #ffffff;
  border: 1px solid #d7dfef;
  border-radius: 16px;
  box-shadow: 0 18px 42px rgba(14, 24, 46, 0.11);
  padding: 16px;
}
.sales-dialer-page h1,
.sales-dialer-page h2,
.sales-dialer-page h3 {
  margin: 0;
  letter-spacing: -0.02em;
}
.sales-dialer-page h1 {
  font-size: 30px;
}
.sales-dialer-page h2 {
  font-size: 20px;
  margin-bottom: 10px;
}
.sales-dialer-page h3 {
  font-size: 16px;
}
.sales-dialer-page p {
  margin: 8px 0 0;
  color: #4f5b78;
}
.sales-dialer-page .stack {
  display: grid;
  gap: 14px;
  align-content: start;
}
.sales-dialer-page .field-label {
  display: block;
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 6px;
}
.sales-dialer-page .field-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
}
.sales-dialer-page .field-meta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.sales-dialer-page .input,
.sales-dialer-page select,
.sales-dialer-page textarea,
.sales-dialer-page .btn {
  min-width: 0;
  width: 100%;
  border: 1px solid #d7dfef;
  border-radius: 10px;
  font-family: inherit;
  font-size: 15px;
  padding: 10px 12px;
  background: #fff;
  color: #0f1d3a;
}
.sales-dialer-page textarea {
  resize: vertical;
  min-height: 78px;
}
.sales-dialer-page .input:focus,
.sales-dialer-page select:focus,
.sales-dialer-page textarea:focus {
  outline: none;
  border-color: #91b6ff;
  box-shadow: 0 0 0 3px rgba(12, 109, 253, 0.16);
}
.sales-dialer-page .btn {
  border: none;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.12s ease, transform 0.12s ease;
}
.sales-dialer-page .btn:hover {
  transform: translateY(-1px);
}
.sales-dialer-page .btn:disabled {
  cursor: not-allowed;
  transform: none;
  opacity: 0.55;
}
.sales-dialer-page .btn-primary {
  background: #0c6dfd;
  color: #fff;
}
.sales-dialer-page .btn-primary:hover {
  background: #0958cc;
}
.sales-dialer-page .btn-danger {
  background: #ca2a2a;
  color: #fff;
}
.sales-dialer-page .btn-subtle {
  background: #1f2937;
  color: #fff;
}
.sales-dialer-page .status-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  background: #eaf2ff;
  border: 1px solid #bad3ff;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 700;
  padding: 7px 11px;
  color: #1c4ea3;
}
.sales-dialer-page .dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #2ea043;
}
.sales-dialer-page .timer {
  font-family: "Product Sans", "SF Pro Display", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 28px;
  font-weight: 700;
  margin-top: 8px;
  color: #1f2937;
}
.sales-dialer-page .timer-inline {
  font-family: "Product Sans", "SF Pro Display", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 18px;
  font-weight: 700;
  color: #1f2937;
  white-space: nowrap;
}
.sales-dialer-page .dialpad {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-top: 10px;
}
.sales-dialer-page .dial-btn {
  border: 1px solid #d7dfef;
  border-radius: 10px;
  background: #fff;
  color: #0f1d3a;
  font-family: "Product Sans", "SF Pro Display", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 19px;
  padding: 14px 8px;
  cursor: pointer;
  font-weight: 700;
  min-height: 68px;
}
.sales-dialer-page .dial-btn:hover {
  background: #f2f7ff;
}
.sales-dialer-page .dial-actions,
.sales-dialer-page .call-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 10px;
}
.sales-dialer-page .cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
.sales-dialer-page .card {
  border: 1px solid #d7dfef;
  border-radius: 12px;
  padding: 12px;
  background: #f8fbff;
}
.sales-dialer-page .card .label {
  font-size: 12px;
  color: #4f5b78;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.sales-dialer-page .card .value {
  font-size: 26px;
  font-weight: 700;
  margin-top: 4px;
}
.sales-dialer-page .toolbar {
  display: grid;
  grid-template-columns: 170px minmax(220px, 1fr) 120px;
  gap: 8px;
  margin: 12px 0;
}
.sales-dialer-page .metric-toolbar {
  display: grid;
  grid-template-columns: 170px 150px 150px 120px;
  gap: 8px;
  margin: 10px 0 12px;
}
.sales-dialer-page table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.sales-dialer-page th,
.sales-dialer-page td {
  border-bottom: 1px solid #d7dfef;
  padding: 9px 8px;
  text-align: left;
  vertical-align: top;
}
.sales-dialer-page th {
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #4f5b78;
}
.sales-dialer-page .row-btn {
  border: 1px solid #b8cbef;
  background: #eef4ff;
  color: #123f85;
  border-radius: 8px;
  padding: 5px 7px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
}
.sales-dialer-page .badge {
  display: inline-block;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  padding: 4px 8px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.sales-dialer-page .badge-completed {
  background: #e6f9ef;
  color: #15633c;
}
.sales-dialer-page .badge-missed {
  background: #fff1e7;
  color: #9f4500;
}
.sales-dialer-page .badge-other {
  background: #eef2f7;
  color: #2a3a55;
}
.sales-dialer-page .missed-list {
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 8px;
  max-height: 220px;
  overflow-y: auto;
}
.sales-dialer-page .missed-item {
  border: 1px solid #ffd8c1;
  background: #fff9f5;
  border-radius: 10px;
  padding: 10px;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  align-items: center;
}
.sales-dialer-page .mono {
  font-family: "Product Sans", "SF Pro Display", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}
.sales-dialer-page .selected-call {
  border: 1px solid #d7dfef;
  border-radius: 10px;
  background: #f8fbff;
  padding: 10px;
  font-size: 13px;
  min-height: 54px;
}
.sales-dialer-page .response {
  margin-top: 10px;
  border: 1px solid #d0ddf7;
  border-radius: 10px;
  background: #0d1a35;
  color: #dce9ff;
  min-height: 120px;
  padding: 11px;
  font-family: "Product Sans", "SF Pro Display", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 12px;
  white-space: pre-wrap;
  overflow-x: auto;
}
@media (max-width: 1120px) {
  .sales-dialer-page .app {
    grid-template-columns: 1fr;
    gap: 14px;
  }
  .sales-dialer-page .cards {
    grid-template-columns: repeat(2, 1fr);
  }
  .sales-dialer-page .toolbar {
    grid-template-columns: 1fr;
  }
  .sales-dialer-page .metric-toolbar {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .sales-dialer-page {
    padding: 12px;
  }

  .sales-dialer-page .panel {
    padding: 12px;
    border-radius: 12px;
  }

  .sales-dialer-page h1 {
    font-size: 22px;
  }

  .sales-dialer-page .field-head {
    flex-direction: column;
    align-items: flex-start;
  }

  .sales-dialer-page .field-meta {
    width: 100%;
    justify-content: space-between;
  }

  .sales-dialer-page h2 {
    font-size: 18px;
  }

  .sales-dialer-page .call-actions,
  .sales-dialer-page .dial-actions,
  .sales-dialer-page .toolbar,
  .sales-dialer-page .metric-toolbar {
    grid-template-columns: 1fr;
  }

  .sales-dialer-page .cards {
    grid-template-columns: 1fr;
  }

  .sales-dialer-page .card .value {
    font-size: 22px;
  }

  .sales-dialer-page .dialpad {
    gap: 6px;
  }

  .sales-dialer-page .dial-btn {
    min-height: 58px;
    padding: 10px 6px;
    font-size: 26px;
  }

  .sales-dialer-page .timer {
    font-size: 24px;
  }

  .sales-dialer-page table {
    min-width: 100%;
    table-layout: fixed;
  }

  .sales-dialer-page th,
  .sales-dialer-page td {
    font-size: 12px;
    padding: 8px 6px;
    word-break: break-word;
  }

  .sales-dialer-page th:nth-child(2),
  .sales-dialer-page td:nth-child(2),
  .sales-dialer-page th:nth-child(5),
  .sales-dialer-page td:nth-child(5) {
    display: none;
  }

  .sales-dialer-page .row-btn {
    padding: 4px 6px;
    font-size: 11px;
  }
}

@media (max-width: 480px) {
  .sales-dialer-page {
    padding: 8px;
  }

  .sales-dialer-page .panel {
    padding: 10px;
  }

  .sales-dialer-page .cards {
    grid-template-columns: 1fr;
  }

  .sales-dialer-page .field-label {
    font-size: 12px;
  }

  .sales-dialer-page .input,
  .sales-dialer-page select,
  .sales-dialer-page textarea,
  .sales-dialer-page .btn {
    font-size: 14px;
    padding: 9px 10px;
  }

  .sales-dialer-page .dial-btn {
    min-height: 54px;
    font-size: 24px;
  }

  .sales-dialer-page th:nth-child(1),
  .sales-dialer-page td:nth-child(1) {
    display: none;
  }
}
`;

const formatSeconds = (totalSeconds) => {
  const safe = Math.max(0, Number(totalSeconds) || 0);
  const mm = String(Math.floor(safe / 60)).padStart(2, "0");
  const ss = String(Math.floor(safe % 60)).padStart(2, "0");
  return `${mm}:${ss}`;
};

const toLocale = (iso) => {
  if (!iso) return "-";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "-";
  return dt.toLocaleString();
};

const statusBadgeClass = (status, missed) => {
  if (missed) return "badge badge-missed";
  if (status === "completed") return "badge badge-completed";
  return "badge badge-other";
};

const normalizePhone = (raw) => {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  return trimmed.replace(/[^\d+#*+]/g, "");
};

const chooseCallerNumberForDestination = (destination, selectedFrom, activeCallerNumbers) => {
  const to = String(destination || "").trim();
  const current = String(selectedFrom || "").trim();
  const candidates = Array.isArray(activeCallerNumbers)
    ? activeCallerNumbers
        .map((item) => String(item?.phone_number || "").trim())
        .filter((num) => E164_REGEX.test(num))
    : [];

  if (!candidates.length) return current;

  const rule = DESTINATION_CALLER_PREFIX_RULES.find((entry) =>
    entry.destination.some((prefix) => to.startsWith(prefix))
  );
  if (!rule) return current || candidates[0];

  if (current && rule.caller.some((prefix) => current.startsWith(prefix))) {
    return current;
  }

  const matched = candidates.find((num) => rule.caller.some((prefix) => num.startsWith(prefix)));
  return matched || current || candidates[0];
};

const inferCountryFromDestination = (destination, fallback = "") => {
  const to = String(destination || "").trim();
  if (to.startsWith("+1")) return "CA";
  if (to.startsWith("+44")) return "GB";
  if (to.startsWith("+61")) return "AU";
  if (to.startsWith("+64")) return "NZ";
  if (to.startsWith("+353")) return "IE";
  if (to.startsWith("+91")) return "IN";
  if (to.startsWith("+33")) return "FR";
  if (to.startsWith("+49")) return "DE";
  if (to.startsWith("+34")) return "ES";
  if (to.startsWith("+39")) return "IT";
  const fb = String(fallback || "").trim().toUpperCase();
  return fb.length === 2 ? fb : "";
};

const loadTwilioSdk = () =>
  new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Browser runtime unavailable"));
      return;
    }
    if (window.Twilio?.Device) {
      resolve(window.Twilio.Device);
      return;
    }

    const existing = document.querySelector("script[data-twilio-voice-sdk='1']");
    if (existing) {
      existing.addEventListener("load", () => resolve(window.Twilio?.Device), { once: true });
      existing.addEventListener("error", () => reject(new Error("Twilio Voice SDK failed to load.")), {
        once: true
      });
      return;
    }

    const script = document.createElement("script");
    script.src = TWILIO_SDK_URL;
    script.async = true;
    script.dataset.twilioVoiceSdk = "1";
    script.addEventListener("load", () => {
      if (window.Twilio?.Device) {
        resolve(window.Twilio.Device);
      } else {
        reject(new Error("Twilio Voice SDK loaded without Device constructor."));
      }
    });
    script.addEventListener("error", () => reject(new Error("Twilio Voice SDK failed to load.")));
    document.head.appendChild(script);
  });

const loadNotes = () => {
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

export default function SalesDialerScreen({ geoCountryCode = "" }) {
  const tokenEndpoint = API_URLS.voiceTokenDialer || "http://localhost:7071/api/voice-token";
  const historyEndpoint = API_URLS.callHistory || "http://localhost:7071/api/call-history";
  const activePhoneNumbersEndpoint =
    API_URLS.activePhoneNumbers || "http://localhost:7071/api/active-phone-numbers";

  const deviceRef = useRef(null);
  const activeCallRef = useRef(null);
  const callTimerRef = useRef(null);
  const callStartAtRef = useRef(null);

  const [phoneInput, setPhoneInput] = useState("+447495957010");
  const [statusText, setStatusText] = useState("Ready");
  const [timerText, setTimerText] = useState("00:00");
  const [responseText, setResponseText] = useState("Awaiting action...");

  const [summary, setSummary] = useState({
    total_calls: 0,
    completed_calls: 0,
    missed_calls: 0,
    total_minutes: 0
  });
  const [callHistory, setCallHistory] = useState([]);
  const [activeCallerNumbers, setActiveCallerNumbers] = useState([]);
  const [selectedFromNumber, setSelectedFromNumber] = useState("");
  const [loadingCallerNumbers, setLoadingCallerNumbers] = useState(false);

  const [metricPeriodFilter, setMetricPeriodFilter] = useState("today");
  const [metricStartDateInput, setMetricStartDateInput] = useState("");
  const [metricEndDateInput, setMetricEndDateInput] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchInput, setSearchInput] = useState("");

  const [selectedCallSid, setSelectedCallSid] = useState("");
  const [dispositionInput, setDispositionInput] = useState("");
  const [followUpInput, setFollowUpInput] = useState("");
  const [notesInput, setNotesInput] = useState("");
  const [notesBySid, setNotesBySid] = useState(() => loadNotes());

  const [connecting, setConnecting] = useState(false);
  const [deviceReady, setDeviceReady] = useState(false);
  const [placingCall, setPlacingCall] = useState(false);
  const [callActive, setCallActive] = useState(false);
  const autoConnectTriedRef = useRef(false);

  const selectedCall = useMemo(
    () => callHistory.find((item) => item.sid === selectedCallSid) || null,
    [callHistory, selectedCallSid]
  );

  const missedCalls = useMemo(
    () => callHistory.filter((call) => call.is_missed).slice(0, 12),
    [callHistory]
  );

  const setOutput = useCallback((payload) => {
    try {
      setResponseText(JSON.stringify(payload, null, 2));
    } catch {
      setResponseText(String(payload));
    }
  }, []);

  const stopCallTimer = useCallback(() => {
    if (callTimerRef.current) {
      window.clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }
  }, []);

  const startCallTimer = useCallback(() => {
    stopCallTimer();
    callStartAtRef.current = Date.now();
    setTimerText("00:00");
    callTimerRef.current = window.setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - (callStartAtRef.current || Date.now())) / 1000);
      setTimerText(formatSeconds(elapsedSec));
    }, 1000);
  }, [stopCallTimer]);

  const fetchActiveCallerNumbers = useCallback(async () => {
    setLoadingCallerNumbers(true);
    try {
      const params = new URLSearchParams();
      const country = String(geoCountryCode || "").trim().toUpperCase();
      if (country.length === 2) {
        params.set("country", country);
      }
      const url = params.toString()
        ? `${activePhoneNumbersEndpoint}?${params.toString()}`
        : activePhoneNumbersEndpoint;
      const res = await fetch(url);
      const payload = await res.json();
      if (!res.ok) {
        setOutput(payload);
        return;
      }

      const items = Array.isArray(payload.items) ? payload.items : [];
      setActiveCallerNumbers(items);
      setSelectedFromNumber((prev) => {
        if (prev && items.some((item) => item.phone_number === prev)) return prev;
        if (payload.selected && items.some((item) => item.phone_number === payload.selected)) {
          return payload.selected;
        }
        return items[0]?.phone_number || "";
      });
    } catch (error) {
      setOutput({ error: String(error) });
    } finally {
      setLoadingCallerNumbers(false);
    }
  }, [activePhoneNumbersEndpoint, geoCountryCode, setOutput]);

  const fetchHistory = useCallback(async () => {
    const period = metricPeriodFilter || "all";
    const params = new URLSearchParams({
      limit: "250",
      status: statusFilter,
      period
    });

    if (searchInput.trim()) {
      params.set("q", searchInput.trim());
    }
    if (period === "custom") {
      if (metricStartDateInput) params.set("start_date", metricStartDateInput);
      if (metricEndDateInput) params.set("end_date", metricEndDateInput);
    }

    setStatusText("Loading history...");
    try {
      const res = await fetch(`${historyEndpoint}?${params.toString()}`);
      const payload = await res.json();
      if (!res.ok) {
        setOutput(payload);
        setStatusText("History failed");
        return;
      }

      setCallHistory(Array.isArray(payload.calls) ? payload.calls : []);
      setSummary(payload.summary || {});
      setStatusText("Ready");
    } catch (error) {
      setStatusText("History failed");
      setOutput({ error: String(error) });
    }
  }, [historyEndpoint, metricEndDateInput, metricPeriodFilter, metricStartDateInput, searchInput, setOutput, statusFilter]);

  const connectMic = useCallback(async ({ auto = false } = {}) => {
    if (connecting || deviceReady) return;

    const identity = "agent_01";
    setConnecting(true);
    setStatusText("Connecting microphone...");

    try {
      if (!navigator?.mediaDevices?.getUserMedia) {
        setStatusText("Mic unsupported");
        if (!auto) {
          setOutput({ error: "This browser does not support microphone access." });
        }
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
      } catch (error) {
        setDeviceReady(false);
        setStatusText("Mic blocked");
        if (!auto) {
          setOutput({ error: "Microphone permission denied.", details: String(error) });
        }
        return;
      }

      const tokenRes = await fetch(`${tokenEndpoint}?identity=${encodeURIComponent(identity)}`);
      const tokenPayload = await tokenRes.json();

      if (!tokenRes.ok) {
        setOutput(tokenPayload);
        setStatusText("Token error");
        return;
      }

      await loadTwilioSdk();
      if (!window.Twilio?.Device) {
        setOutput({ error: "Twilio Voice SDK failed to load." });
        setStatusText("SDK unavailable");
        return;
      }

      if (deviceRef.current) {
        try {
          deviceRef.current.destroy();
        } catch {
          // no-op
        }
      }

      const device = new window.Twilio.Device(tokenPayload.token, {
        logLevel: 1,
        codecPreferences: ["opus", "pcmu"]
      });

      deviceRef.current = device;

      device.on("registered", () => {
        setDeviceReady(true);
        setStatusText("Mic connected");
        setOutput({ ok: true, identity: tokenPayload.identity });
        fetchActiveCallerNumbers();
      });

      device.on("error", (error) => {
        setDeviceReady(false);
        setCallActive(false);
        setStatusText("Device error");
        setOutput({ error: error.message, code: error.code });
      });

      await device.register();
    } catch (error) {
      setStatusText("Connect failed");
      setOutput({ error: String(error) });
    } finally {
      setConnecting(false);
    }
  }, [connecting, deviceReady, fetchActiveCallerNumbers, setOutput, tokenEndpoint]);

  const placeCall = useCallback(async () => {
    const device = deviceRef.current;
    if (!device) {
      setOutput({ error: "Connect microphone first." });
      setStatusText("No device");
      return;
    }

    const to = normalizePhone(phoneInput);
    if (!to || !E164_REGEX.test(to)) {
      setOutput({ error: "Enter a valid E.164 destination number." });
      return;
    }
    let effectiveFromNumber = selectedFromNumber;
    const recommendedFrom = chooseCallerNumberForDestination(to, selectedFromNumber, activeCallerNumbers);
    if (recommendedFrom && recommendedFrom !== selectedFromNumber) {
      effectiveFromNumber = recommendedFrom;
      setSelectedFromNumber(recommendedFrom);
    }

    if (!effectiveFromNumber || !E164_REGEX.test(effectiveFromNumber)) {
      setOutput({ error: "Select a valid active caller number before dialing." });
      return;
    }

    setPlacingCall(true);
    setCallActive(true);
    setStatusText("Dialing...");

    try {
      const callParams = { To: to, FromNumber: effectiveFromNumber };
      const country = inferCountryFromDestination(to, geoCountryCode);
      if (country.length === 2) {
        callParams.Country = country;
      }
      const activeCall = await device.connect({ params: callParams });
      activeCallRef.current = activeCall;

      activeCall.on("accept", () => {
        startCallTimer();
        setStatusText("Call connected");
      });

      const finishCall = (text) => {
        stopCallTimer();
        setCallActive(false);
        setPlacingCall(false);
        setStatusText(text);
        activeCallRef.current = null;
        fetchHistory();
      };

      activeCall.on("disconnect", () => finishCall("Call ended"));
      activeCall.on("reject", () => finishCall("Call rejected"));
      activeCall.on("cancel", () => finishCall("Call canceled"));
      activeCall.on("error", (error) => {
        const hint =
          Number(error?.code) === 31005
            ? "Twilio rejected this call. Ensure the selected caller number is voice-capable and outbound dialing permissions for Canada are enabled in Twilio."
            : "";
        setOutput({ error: error.message, code: error.code, hint, from: effectiveFromNumber, to });
        finishCall("Call error");
      });
    } catch (error) {
      stopCallTimer();
      setCallActive(false);
      setPlacingCall(false);
      setStatusText("Dial failed");
      setOutput({ error: String(error) });
    }
  }, [activeCallerNumbers, fetchHistory, geoCountryCode, phoneInput, selectedFromNumber, setOutput, startCallTimer, stopCallTimer]);

  const hangUp = useCallback(() => {
    if (activeCallRef.current) {
      activeCallRef.current.disconnect();
      return;
    }
    if (deviceRef.current) {
      deviceRef.current.disconnectAll();
    }
  }, []);

  const selectCall = useCallback(
    (callSid) => {
      setSelectedCallSid(callSid);
      const note = notesBySid[callSid] || {};
      setDispositionInput(note.disposition || "");
      setFollowUpInput(note.followUp || "");
      setNotesInput(note.notes || "");
    },
    [notesBySid]
  );

  const saveNote = useCallback(() => {
    if (!selectedCallSid) {
      setOutput({ error: "Select a call from history before saving a note." });
      return;
    }

    const next = {
      ...notesBySid,
      [selectedCallSid]: {
        disposition: dispositionInput,
        followUp: followUpInput,
        notes: notesInput.trim(),
        updatedAt: new Date().toISOString()
      }
    };

    setNotesBySid(next);
    localStorage.setItem(NOTES_KEY, JSON.stringify(next));
    setOutput({ ok: true, call_sid: selectedCallSid, note: next[selectedCallSid] });
  }, [dispositionInput, followUpInput, notesBySid, notesInput, selectedCallSid, setOutput]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    fetchActiveCallerNumbers();
  }, [fetchActiveCallerNumbers]);

  useEffect(() => {
    if (autoConnectTriedRef.current) return;
    autoConnectTriedRef.current = true;
    connectMic({ auto: true });
  }, [connectMic]);

  useEffect(() => {
    return () => {
      stopCallTimer();
      if (activeCallRef.current) {
        try {
          activeCallRef.current.disconnect();
        } catch {
          // no-op
        }
      }
      if (deviceRef.current) {
        try {
          deviceRef.current.destroy();
        } catch {
          // no-op
        }
      }
    };
  }, [stopCallTimer]);

  const customPeriod = metricPeriodFilter === "custom";
  const callButtonDisabled = !deviceReady || callActive || placingCall || !selectedFromNumber;
  const hangupDisabled = !callActive;

  return (
    <>
      <style>{styles}</style>
      <div className="sales-dialer-page">
        <div className="app">
          <section className="panel stack">
            <div>
              <h1>Dialer Workspace</h1>
            </div>

            <div className="call-actions">
              <button className="btn btn-subtle" id="connectBtn" type="button" onClick={connectMic} disabled={connecting}>
                {deviceReady ? "Mic Connected" : connecting ? "Connecting..." : "Connect Mic"}
              </button>
              <button className="btn btn-primary" id="refreshBtn" type="button" onClick={fetchHistory}>
                Refresh History
              </button>
            </div>

            <div>
              <label className="field-label" htmlFor="fromNumberSelect">
                Caller Number (Active Twilio)
              </label>
              <select
                id="fromNumberSelect"
                value={selectedFromNumber}
                onChange={(event) => setSelectedFromNumber(event.target.value)}
                disabled={loadingCallerNumbers || !activeCallerNumbers.length}
              >
                {!activeCallerNumbers.length && (
                  <option value="">
                    {loadingCallerNumbers ? "Loading active numbers..." : "No active numbers found"}
                  </option>
                )}
                {activeCallerNumbers.map((item) => (
                  <option key={item.phone_number} value={item.phone_number}>
                    {item.phone_number}
                    {item.friendly_name && item.friendly_name !== item.phone_number ? ` - ${item.friendly_name}` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="field-head">
                <label className="field-label" htmlFor="phoneInput" style={{ marginBottom: 0 }}>
                  Destination Number (E.164)
                </label>
                <div className="field-meta">
                  <span className="status-chip">
                    <span className="dot" />
                    <span id="statusText">{statusText}</span>
                  </span>
                  <span className="timer-inline" id="timer">
                    {timerText}
                  </span>
                </div>
              </div>
              <input
                className="input"
                id="phoneInput"
                value={phoneInput}
                onChange={(event) => setPhoneInput(event.target.value)}
              />
              <div className="dialpad" id="dialpad">
                {DIAL_KEYS.map((key) => (
                  <button
                    key={key}
                    className="dial-btn"
                    type="button"
                    onClick={() => {
                      if (key === "+") {
                        if (phoneInput.includes("+")) return;
                        setPhoneInput(`${phoneInput}+`);
                        return;
                      }
                      setPhoneInput(`${phoneInput}${key}`);
                    }}
                  >
                    {key}
                  </button>
                ))}
              </div>
              <div className="dial-actions">
                <button className="btn btn-primary" id="callBtn" type="button" disabled={callButtonDisabled} onClick={placeCall}>
                  Call
                </button>
                <button className="btn btn-danger" id="hangupBtn" type="button" disabled={hangupDisabled} onClick={hangUp}>
                  End
                </button>
              </div>
            </div>

            <div>
              <h2>After-Call Notes</h2>
              <div className="selected-call" id="selectedCall">
                {selectedCall ? (
                  <>
                    <div>
                      <strong>Call SID:</strong> <span className="mono">{selectedCall.sid}</span>
                    </div>
                    <div>
                      <strong>From:</strong> <span className="mono">{selectedCall.from || "-"}</span> | <strong>To:</strong>{" "}
                      <span className="mono">{selectedCall.to || "-"}</span>
                    </div>
                    <div>
                      <strong>Status:</strong> {selectedCall.status || "-"} | <strong>Duration:</strong>{" "}
                      {formatSeconds(selectedCall.duration_seconds || 0)}
                    </div>
                  </>
                ) : (
                  "Select a call from history to add notes."
                )}
              </div>
              <label className="field-label" htmlFor="dispositionInput" style={{ marginTop: "10px" }}>
                Disposition
              </label>
              <select id="dispositionInput" value={dispositionInput} onChange={(event) => setDispositionInput(event.target.value)}>
                <option value="">Select outcome</option>
                <option value="connected">Connected</option>
                <option value="voicemail">Left voicemail</option>
                <option value="no_answer">No answer</option>
                <option value="not_interested">Not interested</option>
                <option value="follow_up">Follow up scheduled</option>
              </select>
              <label className="field-label" htmlFor="followUpInput" style={{ marginTop: "10px" }}>
                Follow-up Time
              </label>
              <input
                className="input"
                id="followUpInput"
                type="datetime-local"
                value={followUpInput}
                onChange={(event) => setFollowUpInput(event.target.value)}
              />
              <label className="field-label" htmlFor="notesInput" style={{ marginTop: "10px" }}>
                Notes
              </label>
              <textarea
                id="notesInput"
                placeholder="Add details for this call..."
                value={notesInput}
                onChange={(event) => setNotesInput(event.target.value)}
              />
              <button className="btn btn-primary" id="saveNoteBtn" style={{ marginTop: "10px" }} type="button" onClick={saveNote}>
                Save Note
              </button>
            </div>

            <div className="response" id="responseBox">
              {responseText}
            </div>
          </section>

          <section className="panel stack">
            <div>
              <h2>Call Performance</h2>
              <div className="metric-toolbar">
                <select value={metricPeriodFilter} onChange={(event) => setMetricPeriodFilter(event.target.value)}>
                  <option value="all">All time</option>
                  <option value="today">Today</option>
                  <option value="this_week">This week</option>
                  <option value="this_month">This month</option>
                  <option value="custom">Custom range</option>
                </select>
                <input
                  className="input"
                  type="date"
                  disabled={!customPeriod}
                  value={metricStartDateInput}
                  onChange={(event) => setMetricStartDateInput(event.target.value)}
                />
                <input
                  className="input"
                  type="date"
                  disabled={!customPeriod}
                  value={metricEndDateInput}
                  onChange={(event) => setMetricEndDateInput(event.target.value)}
                />
                <button className="btn btn-primary" type="button" onClick={fetchHistory}>
                  Apply
                </button>
              </div>
              <div className="cards">
                <div className="card">
                  <div className="label">Total Calls</div>
                  <div className="value">{String(summary.total_calls ?? 0)}</div>
                </div>
                <div className="card">
                  <div className="label">Completed</div>
                  <div className="value">{String(summary.completed_calls ?? 0)}</div>
                </div>
                <div className="card">
                  <div className="label">Missed</div>
                  <div className="value">{String(summary.missed_calls ?? 0)}</div>
                </div>
                <div className="card">
                  <div className="label">Minutes</div>
                  <div className="value">{String(summary.total_minutes ?? 0)}</div>
                </div>
              </div>
            </div>

            <div>
              <h2>Call History</h2>
              <div className="toolbar">
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  <option value="all">All statuses</option>
                  <option value="completed">Completed</option>
                  <option value="missed">Missed</option>
                  <option value="busy">Busy</option>
                  <option value="no-answer">No answer</option>
                  <option value="failed">Failed</option>
                  <option value="canceled">Canceled</option>
                </select>
                <input
                  className="input"
                  placeholder="Search number or status"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                />
                <button className="btn btn-primary" type="button" onClick={fetchHistory}>
                  Apply
                </button>
              </div>
              <div
                style={{
                  maxHeight: "350px",
                  overflow: "auto",
                  WebkitOverflowScrolling: "touch",
                  border: "1px solid #d7dfef",
                  borderRadius: "10px"
                }}
              >
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>From</th>
                      <th>To</th>
                      <th>Status</th>
                      <th>Duration</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!callHistory.length && (
                      <tr>
                        <td colSpan={6}>No calls found.</td>
                      </tr>
                    )}
                    {callHistory.map((call) => {
                      const note = notesBySid[call.sid];
                      return (
                        <tr key={call.sid} onClick={() => selectCall(call.sid)}>
                          <td>{toLocale(call.start_time || call.date_created)}</td>
                          <td className="mono">{call.from || "-"}</td>
                          <td className="mono">{call.to || "-"}</td>
                          <td>
                            <span className={statusBadgeClass(call.status, call.is_missed)}>{call.status || "unknown"}</span>
                            {note?.disposition && (
                              <div style={{ marginTop: "4px", fontSize: "11px", color: "#4f5b78" }}>Note: {note.disposition}</div>
                            )}
                          </td>
                          <td className="mono">{formatSeconds(call.duration_seconds || 0)}</td>
                          <td>
                            <button
                              className="row-btn"
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                if (call.to) setPhoneInput(call.to);
                              }}
                            >
                              Call
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h2>Missed Calls</h2>
              <ul className="missed-list">
                {!missedCalls.length && <li className="missed-item">No missed calls found.</li>}
                {missedCalls.map((call) => (
                  <li className="missed-item" key={call.sid}>
                    <div>
                      <div className="mono" style={{ fontWeight: 700 }}>
                        {call.to || call.from || "-"}
                      </div>
                      <div style={{ fontSize: "12px", color: "#5c6481" }}>
                        {toLocale(call.start_time || call.date_created)} | {call.status}
                      </div>
                    </div>
                    <button
                      className="row-btn"
                      type="button"
                      onClick={() => {
                        setPhoneInput(call.to || call.from || "");
                      }}
                    >
                      Redial
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
