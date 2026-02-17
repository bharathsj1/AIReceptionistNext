import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Plus, RefreshCw, Trash2 } from "lucide-react";

import API_URLS from "../config/urls";

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const DAY_LABELS = {
  MON: "Mon",
  TUE: "Tue",
  WED: "Wed",
  THU: "Thu",
  FRI: "Fri",
  SAT: "Sat",
  SUN: "Sun"
};

const COUNTRY_OPTIONS = [
  { code: "GB", label: "United Kingdom" },
  { code: "US", label: "United States" },
  { code: "CA", label: "Canada" },
  { code: "AU", label: "Australia" },
  { code: "NZ", label: "New Zealand" },
  { code: "IE", label: "Ireland" },
  { code: "IN", label: "India" }
];

const TIMEZONE_OPTIONS = [
  "Europe/London",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Pacific/Auckland",
  "Europe/Dublin",
  "Asia/Kolkata",
  "UTC"
];

const COUNTRY_DEFAULT_TZ = {
  GB: "Europe/London",
  US: "America/New_York",
  CA: "America/Toronto",
  AU: "Australia/Sydney",
  NZ: "Pacific/Auckland",
  IE: "Europe/Dublin",
  IN: "Asia/Kolkata"
};

const newDayState = () => ({
  enabled: true,
  start: "09:00",
  end: "17:00",
  hasSecondRange: false,
  start2: "18:00",
  end2: "20:00"
});

const buildInitialDaySchedule = () =>
  DAYS.reduce((acc, day) => {
    acc[day] = newDayState();
    return acc;
  }, {});

const normalizeDay = (value) => String(value || "").trim().toUpperCase();

const parseOpenRulesToSchedule = (openRules) => {
  const initial = buildInitialDaySchedule();
  DAYS.forEach((day) => {
    initial[day].enabled = false;
  });
  const assignedDays = new Set();
  sortRules(openRules).forEach((rule) => {
    const days = Array.isArray(rule?.days) ? rule.days : [];
    const ranges = Array.isArray(rule?.timeRanges) ? rule.timeRanges : [];
    const primary = ranges[0] || {};
    const secondary = ranges[1] || {};
    days.forEach((dayValue) => {
      const day = normalizeDay(dayValue);
      if (!initial[day] || assignedDays.has(day)) return;
      initial[day] = {
        enabled: true,
        start: primary.start || "09:00",
        end: primary.end || "17:00",
        hasSecondRange: Boolean(secondary.start && secondary.end),
        start2: secondary.start || "18:00",
        end2: secondary.end || "20:00"
      };
      assignedDays.add(day);
    });
  });
  return initial;
};

const buildRulesFromSimpleMode = ({
  daySchedule,
  openAction,
  openAgentKey,
  closedAction,
  closedAgentKey
}) => {
  const openRuleAction =
    openAction === "forward"
      ? { type: "FORWARD" }
      : openAction === "ring_then_ai"
        ? { type: "FORWARD", forwardMode: "ring_then_ai", agentKey: openAgentKey || "" }
        : { type: "ULTRAVOX", agentKey: openAgentKey || "" };

  const closedRuleAction =
    closedAction === "forward"
      ? { type: "FORWARD" }
      : closedAction === "after_hours_ai"
        ? { type: "ULTRAVOX", agentKey: closedAgentKey || openAgentKey || "" }
        : { type: "VOICEMAIL" };

  const rules = [];
  DAYS.forEach((day, index) => {
    const dayState = daySchedule[day];
    if (!dayState?.enabled) return;
    const timeRanges = [{ start: dayState.start || "09:00", end: dayState.end || "17:00" }];
    if (dayState.hasSecondRange) {
      timeRanges.push({ start: dayState.start2 || "18:00", end: dayState.end2 || "20:00" });
    }
    rules.push({
      name: `Open hours ${day}`,
      days: [day],
      timeRanges,
      action: openRuleAction,
      priority: 10 + index
    });
  });
  rules.push({
    name: "Outside hours",
    days: DAYS,
    timeRanges: [{ start: "00:00", end: "23:59" }],
    action: closedRuleAction,
    priority: 200
  });
  return rules;
};

const sortRules = (rules) =>
  [...(Array.isArray(rules) ? rules : [])].sort((a, b) => Number(a?.priority || 9999) - Number(b?.priority || 9999));

const isClosedRule = (rule) => {
  const name = String(rule?.name || "").toLowerCase();
  if (name.includes("outside") || name.includes("after") || name.includes("closed")) return true;
  const days = Array.isArray(rule?.days) ? rule.days.map(normalizeDay) : [];
  const ranges = Array.isArray(rule?.timeRanges) ? rule.timeRanges : [];
  const allDays = days.length === DAYS.length && DAYS.every((day) => days.includes(day));
  const fullDay = ranges.some((range) => range?.start === "00:00" && range?.end === "23:59");
  return allDays && fullDay;
};

const parseActionMode = (openRule, closedRule) => {
  const openAction = openRule?.action || {};
  const closedAction = closedRule?.action || {};
  let openMode = "ai";
  if (String(openAction.type || "").toUpperCase() === "FORWARD") {
    openMode = String(openAction.forwardMode || "").toLowerCase() === "ring_then_ai" ? "ring_then_ai" : "forward";
  }
  let closedMode = "voicemail";
  if (String(closedAction.type || "").toUpperCase() === "FORWARD") closedMode = "forward";
  if (String(closedAction.type || "").toUpperCase() === "ULTRAVOX") closedMode = "after_hours_ai";
  return {
    openMode,
    closedMode,
    openAgentKey: openAction.agentKey || "",
    closedAgentKey: closedAction.agentKey || ""
  };
};

const defaultPreviewDateTime = () => {
  const now = new Date();
  const pad2 = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}T${pad2(
    now.getHours()
  )}:${pad2(now.getMinutes())}`;
};

const getZonedDayAndTime = (dateValue, timeZone) => {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return { day: "MON", hhmm: "00:00", label: "Invalid date" };
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timeZone || "UTC",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(date);
  const weekday = (parts.find((p) => p.type === "weekday")?.value || "Mon").slice(0, 3).toUpperCase();
  const hour = parts.find((p) => p.type === "hour")?.value || "00";
  const minute = parts.find((p) => p.type === "minute")?.value || "00";
  return {
    day: weekday,
    hhmm: `${hour}:${minute}`,
    label: formatter.format(date)
  };
};

const timeInRange = (value, start, end) => {
  if (!value || !start || !end) return false;
  if (start < end) return value >= start && value < end;
  return value >= start || value < end;
};

const matchesRule = (rule, zoneDay, zoneTime) => {
  const days = Array.isArray(rule?.days) ? rule.days.map(normalizeDay) : [];
  if (days.length && !days.includes(zoneDay)) return false;
  const ranges = Array.isArray(rule?.timeRanges) ? rule.timeRanges : [];
  return ranges.some((range) => timeInRange(zoneTime, range?.start, range?.end));
};

const parseRulesForPreview = (rules, zoneDay, zoneTime) =>
  sortRules(rules).find((rule) => matchesRule(rule, zoneDay, zoneTime));

const normalizeTargetPayload = (targets) =>
  (Array.isArray(targets) ? targets : []).map((item, idx) => ({
    to: String(item?.to || "").trim(),
    label: String(item?.label || `Target ${idx + 1}`).trim(),
    priority: Number(item?.priority || idx + 1) || idx + 1
  }));

const fallbackNormalizeE164 = (value, country) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return `+${digits.replace(/[^\d]/g, "")}`;
  const noLeading = digits.replace(/[^\d]/g, "");
  const countryCode = country === "GB" ? "44" : country === "US" ? "1" : country === "CA" ? "1" : country === "AU" ? "61" : "";
  return countryCode ? `+${countryCode}${noLeading}` : `+${noLeading}`;
};

const toE164 = async (value, country) => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  try {
    const moduleName = "libphonenumber-js/min";
    const phoneLib = await import(/* @vite-ignore */ moduleName);
    const parsed = phoneLib?.parsePhoneNumberFromString?.(trimmed, country);
    if (parsed && parsed.isValid()) return parsed.number;
  } catch {
    // Optional dependency in current workspace; fallback to basic normalization.
  }
  return fallbackNormalizeE164(trimmed, country);
};

export default function RoutingSettingsPanel({ email, disabled = false }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState({ type: "idle", message: "" });
  const [canEdit, setCanEdit] = useState(true);
  const [phoneNumbers, setPhoneNumbers] = useState([]);
  const [selectedTwilioNumber, setSelectedTwilioNumber] = useState("");
  const [availableAgents, setAvailableAgents] = useState([]);
  const [country, setCountry] = useState("GB");
  const [timezone, setTimezone] = useState("Europe/London");
  const [enabled, setEnabled] = useState(true);
  const [daySchedule, setDaySchedule] = useState(buildInitialDaySchedule());
  const [openAction, setOpenAction] = useState("ai");
  const [openAgentKey, setOpenAgentKey] = useState("");
  const [closedAction, setClosedAction] = useState("forward");
  const [closedAgentKey, setClosedAgentKey] = useState("");
  const [ringStrategy, setRingStrategy] = useState("sequential");
  const [timeoutSeconds, setTimeoutSeconds] = useState(20);
  const [fallback, setFallback] = useState("voicemail");
  const [targets, setTargets] = useState([]);
  const [previewAt, setPreviewAt] = useState(defaultPreviewDateTime());

  const uiReadOnly = disabled || !canEdit || saving;

  const hydrate = (payload) => {
    const routingConfig = payload?.routingConfig || {};
    const forwardTargets = payload?.forwardTargets || {};
    const rules = sortRules(routingConfig?.rules || []);
    const openRules = rules.filter((rule) => !isClosedRule(rule));
    const openRule = openRules[0] || null;
    const closedRule = rules.find((rule) => isClosedRule(rule)) || null;
    const actionMode = parseActionMode(openRule, closedRule);

    setCanEdit(Boolean(payload?.canEdit ?? true));
    setPhoneNumbers(Array.isArray(payload?.phoneNumbers) ? payload.phoneNumbers : []);
    setSelectedTwilioNumber(payload?.selectedTwilioNumber || "");
    setAvailableAgents(Array.isArray(payload?.availableAgents) ? payload.availableAgents : []);
    setCountry(String(routingConfig?.country || "GB").toUpperCase());
    setTimezone(routingConfig?.timezone || COUNTRY_DEFAULT_TZ[String(routingConfig?.country || "GB").toUpperCase()] || "UTC");
    setEnabled(routingConfig?.enabled !== false);
    setDaySchedule(parseOpenRulesToSchedule(openRules));
    setOpenAction(actionMode.openMode);
    setClosedAction(actionMode.closedMode);
    setOpenAgentKey(actionMode.openAgentKey || payload?.availableAgents?.[0]?.key || "");
    setClosedAgentKey(actionMode.closedAgentKey || actionMode.openAgentKey || payload?.availableAgents?.[0]?.key || "");
    setRingStrategy(String(forwardTargets?.ringStrategy || "sequential"));
    setTimeoutSeconds(Number(forwardTargets?.timeoutSeconds || 20));
    setFallback(String(forwardTargets?.fallback || "voicemail"));
    setTargets(normalizeTargetPayload(forwardTargets?.targets || []));
  };

  const loadData = async (numberOverride = "") => {
    if (!email) return;
    setLoading(true);
    setStatus({ type: "idle", message: "" });
    try {
      const query = new URLSearchParams({ email });
      if (numberOverride) query.set("twilioNumber", numberOverride);
      const res = await fetch(`${API_URLS.dashboardRoutingSettings}?${query.toString()}`);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || "Unable to load routing settings");
      }
      hydrate(payload);
    } catch (err) {
      setStatus({
        type: "error",
        message: err?.message || "Unable to load routing settings"
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [email]);

  const onCopyToAllDays = () => {
    const source = daySchedule.MON || newDayState();
    const copied = {};
    DAYS.forEach((day) => {
      copied[day] = { ...source, enabled: daySchedule[day]?.enabled ?? true };
    });
    setDaySchedule(copied);
  };

  const preview = useMemo(() => {
    const rules = buildRulesFromSimpleMode({
      daySchedule,
      openAction,
      openAgentKey,
      closedAction,
      closedAgentKey
    });
    const zone = getZonedDayAndTime(previewAt, timezone);
    const matchedRule = parseRulesForPreview(rules, zone.day, zone.hhmm);
    const action = matchedRule?.action || {};
    const actionType = String(action.type || "VOICEMAIL").toUpperCase();
    let result = "Voicemail";
    if (actionType === "ULTRAVOX") {
      result = `AI agent ${action.agentKey || "(default)"}`;
    } else if (actionType === "FORWARD") {
      const topTarget = [...targets].sort((a, b) => Number(a.priority || 9999) - Number(b.priority || 9999))[0];
      result = topTarget?.label
        ? `Forward to ${topTarget.label} (${topTarget.to || "pending"})`
        : "Forward to configured targets";
      if (String(action.forwardMode || "").toLowerCase() === "ring_then_ai") {
        result += `, then AI fallback ${action.agentKey || "(default)"}`;
      } else {
        result += `, fallback ${fallback}`;
      }
    }
    return {
      zoneLabel: zone.label,
      matchedRule: matchedRule?.name || "No matching rule",
      result
    };
  }, [closedAction, closedAgentKey, daySchedule, fallback, openAction, openAgentKey, previewAt, targets, timezone]);

  const handleSave = async () => {
    if (!email || !selectedTwilioNumber) return;
    setSaving(true);
    setStatus({ type: "idle", message: "" });
    try {
      const normalizedTargets = [];
      for (const item of targets) {
        const e164 = await toE164(item?.to, country);
        if (!e164) continue;
        normalizedTargets.push({
          to: e164,
          label: item?.label || "Forward target",
          priority: Number(item?.priority || normalizedTargets.length + 1)
        });
      }

      const rules = buildRulesFromSimpleMode({
        daySchedule,
        openAction,
        openAgentKey,
        closedAction,
        closedAgentKey
      });
      const payload = {
        email,
        twilioNumber: selectedTwilioNumber,
        routingConfig: {
          country,
          timezone,
          enabled,
          rules
        },
        forwardTargets: {
          targets: normalizedTargets,
          ringStrategy,
          timeoutSeconds: Number(timeoutSeconds || 20),
          fallback
        }
      };
      const res = await fetch(API_URLS.dashboardRoutingSettings, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error || "Unable to save routing settings");
      }
      setStatus({ type: "success", message: "Routing settings saved." });
      hydrate(json);
    } catch (err) {
      setStatus({
        type: "error",
        message: err?.message || "Unable to save routing settings"
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-xl backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-indigo-200">Phone routing</p>
          <h4 className="text-lg font-semibold text-white">Call routing scheduler + warm transfer</h4>
          <p className="mt-1 text-xs text-slate-300">
            Configure AI hours, forwarding hours, and warm-transfer acceptance flow.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => loadData(selectedTwilioNumber)}
            disabled={loading || saving}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/20 disabled:opacity-60"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={uiReadOnly || loading}
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-300/60 bg-emerald-500/20 px-3 py-2 text-xs font-semibold text-emerald-50 transition hover:bg-emerald-500/30 disabled:opacity-60"
          >
            <CheckCircle2 className="h-4 w-4" />
            {saving ? "Saving..." : "Save routing"}
          </button>
        </div>
      </div>

      {status.message ? (
        <div className={`mt-3 text-xs ${status.type === "error" ? "text-rose-300" : "text-emerald-200"}`}>
          {status.message}
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-xs text-slate-300">
              Smartconnect AI number
              <select
                value={selectedTwilioNumber}
                onChange={(event) => {
                  const next = event.target.value;
                  setSelectedTwilioNumber(next);
                  loadData(next);
                }}
                disabled={loading || saving}
                className="rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-100"
              >
                {(phoneNumbers.length ? phoneNumbers : [""]).map((number) => (
                  <option key={number || "none"} value={number}>
                    {number || "No number configured"}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs text-slate-300">
              Country
              <select
                value={country}
                onChange={(event) => {
                  const next = event.target.value;
                  setCountry(next);
                  setTimezone(COUNTRY_DEFAULT_TZ[next] || timezone);
                }}
                disabled={uiReadOnly}
                className="rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-100"
              >
                {COUNTRY_OPTIONS.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label} ({option.code})
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs text-slate-300">
              Timezone
              <select
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                disabled={uiReadOnly}
                className="rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-100"
              >
                {TIMEZONE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900/40 px-3 py-2 text-sm text-slate-100">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
                disabled={uiReadOnly}
                className="accent-emerald-400"
              />
              Routing enabled
            </label>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Weekly schedule (AI/open hours)</p>
              <button
                type="button"
                onClick={onCopyToAllDays}
                disabled={uiReadOnly}
                className="rounded-lg border border-white/10 bg-white/10 px-2 py-1 text-[11px] text-white"
              >
                Copy Mon to all
              </button>
            </div>
            <div className="grid gap-2">
              {DAYS.map((day) => {
                const row = daySchedule[day] || newDayState();
                return (
                  <div key={day} className="rounded-xl border border-white/10 bg-slate-900/60 p-2">
                    <div className="grid items-center gap-2 md:grid-cols-[80px_70px_1fr_1fr_auto]">
                      <span className="text-xs font-semibold text-slate-200">{DAY_LABELS[day]}</span>
                      <label className="flex items-center gap-1 text-xs text-slate-300">
                        <input
                          type="checkbox"
                          checked={row.enabled}
                          onChange={(event) =>
                            setDaySchedule((prev) => ({
                              ...prev,
                              [day]: { ...prev[day], enabled: event.target.checked }
                            }))
                          }
                          disabled={uiReadOnly}
                          className="accent-indigo-400"
                        />
                        Open
                      </label>
                      <input
                        type="time"
                        value={row.start}
                        onChange={(event) =>
                          setDaySchedule((prev) => ({ ...prev, [day]: { ...prev[day], start: event.target.value } }))
                        }
                        disabled={uiReadOnly || !row.enabled}
                        className="rounded-lg border border-white/10 bg-slate-900/80 px-2 py-1 text-xs text-slate-100"
                      />
                      <input
                        type="time"
                        value={row.end}
                        onChange={(event) =>
                          setDaySchedule((prev) => ({ ...prev, [day]: { ...prev[day], end: event.target.value } }))
                        }
                        disabled={uiReadOnly || !row.enabled}
                        className="rounded-lg border border-white/10 bg-slate-900/80 px-2 py-1 text-xs text-slate-100"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setDaySchedule((prev) => ({
                            ...prev,
                            [day]: { ...prev[day], hasSecondRange: !prev[day]?.hasSecondRange }
                          }))
                        }
                        disabled={uiReadOnly || !row.enabled}
                        className="rounded-lg border border-white/10 bg-white/10 px-2 py-1 text-[11px] text-slate-200"
                      >
                        {row.hasSecondRange ? "Range 2: On" : "Range 2: Off"}
                      </button>
                    </div>
                    {row.hasSecondRange && row.enabled ? (
                      <div className="mt-2 grid gap-2 md:grid-cols-[150px_1fr_1fr]">
                        <span className="text-[11px] text-slate-400">Second range</span>
                        <input
                          type="time"
                          value={row.start2}
                          onChange={(event) =>
                            setDaySchedule((prev) => ({ ...prev, [day]: { ...prev[day], start2: event.target.value } }))
                          }
                          disabled={uiReadOnly}
                          className="rounded-lg border border-white/10 bg-slate-900/80 px-2 py-1 text-xs text-slate-100"
                        />
                        <input
                          type="time"
                          value={row.end2}
                          onChange={(event) =>
                            setDaySchedule((prev) => ({ ...prev, [day]: { ...prev[day], end2: event.target.value } }))
                          }
                          disabled={uiReadOnly}
                          className="rounded-lg border border-white/10 bg-slate-900/80 px-2 py-1 text-xs text-slate-100"
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-300">During open hours</p>
              <select
                value={openAction}
                onChange={(event) => setOpenAction(event.target.value)}
                disabled={uiReadOnly}
                className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-slate-100"
              >
                <option value="ai">AI answers</option>
                <option value="forward">Forward</option>
                <option value="ring_then_ai">Ring then AI fallback</option>
              </select>
              {(openAction === "ai" || openAction === "ring_then_ai") ? (
                <select
                  value={openAgentKey}
                  onChange={(event) => setOpenAgentKey(event.target.value)}
                  disabled={uiReadOnly}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-slate-100"
                >
                  <option value="">Default agent</option>
                  {availableAgents.map((agent) => (
                    <option key={agent.key} value={agent.key}>
                      {agent.label} ({agent.key})
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Outside hours</p>
              <select
                value={closedAction}
                onChange={(event) => setClosedAction(event.target.value)}
                disabled={uiReadOnly}
                className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-slate-100"
              >
                <option value="forward">Forward</option>
                <option value="voicemail">Voicemail</option>
                <option value="after_hours_ai">After-hours AI agent</option>
              </select>
              {closedAction === "after_hours_ai" ? (
                <select
                  value={closedAgentKey}
                  onChange={(event) => setClosedAgentKey(event.target.value)}
                  disabled={uiReadOnly}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-slate-100"
                >
                  <option value="">Default agent</option>
                  {availableAgents.map((agent) => (
                    <option key={agent.key} value={agent.key}>
                      {agent.label} ({agent.key})
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Forwarding settings</p>
              <button
                type="button"
                onClick={() =>
                  setTargets((prev) => [...prev, { to: "", label: `Target ${prev.length + 1}`, priority: prev.length + 1 }])
                }
                disabled={uiReadOnly}
                className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/10 px-2 py-1 text-[11px] text-white"
              >
                <Plus className="h-3 w-3" />
                Add target
              </button>
            </div>
            <div className="mt-2 grid gap-2">
              {targets.map((target, idx) => (
                <div key={`${idx}-${target.label}`} className="grid gap-2 rounded-xl border border-white/10 bg-slate-900/60 p-2 md:grid-cols-[2fr_2fr_80px_auto]">
                  <input
                    type="text"
                    value={target.label}
                    onChange={(event) =>
                      setTargets((prev) => prev.map((row, rIdx) => (rIdx === idx ? { ...row, label: event.target.value } : row)))
                    }
                    disabled={uiReadOnly}
                    placeholder="Label"
                    className="rounded-lg border border-white/10 bg-slate-900/80 px-2 py-1 text-xs text-slate-100"
                  />
                  <input
                    type="tel"
                    value={target.to}
                    onChange={(event) =>
                      setTargets((prev) => prev.map((row, rIdx) => (rIdx === idx ? { ...row, to: event.target.value } : row)))
                    }
                    disabled={uiReadOnly}
                    placeholder="Forward number"
                    className="rounded-lg border border-white/10 bg-slate-900/80 px-2 py-1 text-xs text-slate-100"
                  />
                  <input
                    type="number"
                    min="1"
                    value={target.priority}
                    onChange={(event) =>
                      setTargets((prev) =>
                        prev.map((row, rIdx) => (rIdx === idx ? { ...row, priority: Number(event.target.value || 1) } : row))
                      )
                    }
                    disabled={uiReadOnly}
                    className="rounded-lg border border-white/10 bg-slate-900/80 px-2 py-1 text-xs text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={() => setTargets((prev) => prev.filter((_, rIdx) => rIdx !== idx))}
                    disabled={uiReadOnly}
                    className="inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/10 px-2 py-1 text-slate-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              <label className="grid gap-1 text-xs text-slate-300">
                Ring strategy
                <select
                  value={ringStrategy}
                  onChange={(event) => setRingStrategy(event.target.value)}
                  disabled={uiReadOnly}
                  className="rounded-lg border border-white/10 bg-slate-900/80 px-2 py-1 text-xs text-slate-100"
                >
                  <option value="sequential">Sequential</option>
                  <option value="simultaneous">Simultaneous</option>
                </select>
              </label>
              <label className="grid gap-1 text-xs text-slate-300">
                Timeout seconds
                <input
                  type="number"
                  min="5"
                  max="60"
                  value={timeoutSeconds}
                  onChange={(event) => setTimeoutSeconds(Number(event.target.value || 20))}
                  disabled={uiReadOnly}
                  className="rounded-lg border border-white/10 bg-slate-900/80 px-2 py-1 text-xs text-slate-100"
                />
              </label>
              <label className="grid gap-1 text-xs text-slate-300">
                Fallback
                <select
                  value={fallback}
                  onChange={(event) => setFallback(event.target.value)}
                  disabled={uiReadOnly}
                  className="rounded-lg border border-white/10 bg-slate-900/80 px-2 py-1 text-xs text-slate-100"
                >
                  <option value="voicemail">Voicemail</option>
                  <option value="ai_callback">AI callback capture</option>
                  <option value="hangup">Hang up</option>
                </select>
              </label>
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              Local input is converted to E.164 on save. Examples: GB `07700 900123` → `+447700900123`,
              US `(202) 555-0148` → `+12025550148`.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-3">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Preview</p>
          <label className="mt-2 grid gap-1 text-xs text-slate-300">
            Test date/time
            <input
              type="datetime-local"
              value={previewAt}
              onChange={(event) => setPreviewAt(event.target.value)}
              className="rounded-lg border border-white/10 bg-slate-900/80 px-2 py-1 text-xs text-slate-100"
            />
          </label>
          <div className="mt-3 space-y-2 rounded-xl border border-white/10 bg-slate-900/60 p-3 text-xs text-slate-200">
            <p>
              <span className="text-slate-400">Timezone:</span> {timezone}
            </p>
            <p>
              <span className="text-slate-400">At:</span> {preview.zoneLabel}
            </p>
            <p>
              <span className="text-slate-400">Rule:</span> {preview.matchedRule}
            </p>
            <p>
              <span className="text-slate-400">Route:</span> {preview.result}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
