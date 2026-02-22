"use client";

import { useMemo, useState } from "react";

const normalizeBase = (value: string | undefined) =>
  String(value || "").trim().replace(/\/$/, "");

const resolveApiBase = () => {
  const explicitApiBase = normalizeBase(process.env.NEXT_PUBLIC_API_BASE);
  if (explicitApiBase) {
    return explicitApiBase.endsWith("/api") ? explicitApiBase : `${explicitApiBase}/api`;
  }

  const explicitHost = normalizeBase(process.env.NEXT_PUBLIC_FUNCTION_HOST);
  if (explicitHost) return `${explicitHost}/api`;

  return "/api";
};

const API_BASE = resolveApiBase();

type RoutingPayload = {
  selectedTwilioNumber?: string;
  phoneNumbers?: string[];
  routingConfig?: {
    country?: string;
    timezone?: string;
    enabled?: boolean;
    rules?: Array<Record<string, unknown>>;
  };
  forwardTargets?: {
    targets?: Array<{ to?: string; label?: string; priority?: number }>;
    ringStrategy?: string;
    timeoutSeconds?: number;
    fallback?: string;
  };
};

const dayLabels = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;

export default function PhoneRoutingSettingsPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [payload, setPayload] = useState<RoutingPayload>({});
  const [rulesDraft, setRulesDraft] = useState("[]");
  const [targetsDraft, setTargetsDraft] = useState("[]");

  const rulesJson = useMemo(() => JSON.stringify(payload.routingConfig?.rules || [], null, 2), [payload.routingConfig?.rules]);
  const targetsJson = useMemo(
    () => JSON.stringify(payload.forwardTargets?.targets || [], null, 2),
    [payload.forwardTargets?.targets]
  );

  const load = async () => {
    if (!email.trim()) return;
    setLoading(true);
    setStatus("");
    try {
      const query = new URLSearchParams({ email: email.trim() });
      const res = await fetch(`${API_BASE}/phone/routing?${query.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load routing settings");
      setPayload(data || {});
      setRulesDraft(JSON.stringify(data?.routingConfig?.rules || [], null, 2));
      setTargetsDraft(JSON.stringify(data?.forwardTargets?.targets || [], null, 2));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load routing settings");
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    if (!email.trim() || !payload.selectedTwilioNumber) return;
    setSaving(true);
    setStatus("");
    try {
      const res = await fetch(`${API_BASE}/phone/routing`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          twilioNumber: payload.selectedTwilioNumber,
          routingConfig: {
            ...(payload.routingConfig || {}),
            rules: JSON.parse(rulesDraft || "[]")
          },
          forwardTargets: payload.forwardTargets || {}
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to save routing settings");
      setPayload(data || {});
      setRulesDraft(JSON.stringify(data?.routingConfig?.rules || [], null, 2));
      setTargetsDraft(JSON.stringify(data?.forwardTargets?.targets || [], null, 2));
      setStatus("Saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to save routing settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="space-y-2">
          <p className="text-xs uppercase tracking-[0.28em] text-indigo-200">Settings / Phone / Routing</p>
          <h1 className="text-3xl font-semibold text-white">Call Routing Scheduler + Warm Transfer</h1>
          <p className="text-sm text-slate-300">
            Country-aware routing with AI hours, forwarding, and whisper-accept warm transfer.
          </p>
        </header>

        <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-4">
          <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Tenant user email"
              className="rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-slate-100"
            />
            <button
              onClick={load}
              disabled={loading}
              className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {loading ? "Loading..." : "Load"}
            </button>
            <button
              onClick={save}
              disabled={saving || !payload.selectedTwilioNumber}
              className="rounded-xl border border-emerald-300/60 bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-100 disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
          {status ? <p className="mt-2 text-xs text-slate-300">{status}</p> : null}
        </div>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-4">
            <h2 className="text-sm font-semibold text-white">Business Country + Timezone</h2>
            <div className="mt-3 grid gap-3">
              <input
                value={payload.routingConfig?.country || ""}
                onChange={(event) =>
                  setPayload((prev) => ({
                    ...prev,
                    routingConfig: { ...(prev.routingConfig || {}), country: event.target.value.toUpperCase() }
                  }))
                }
                placeholder="Country (GB/US/CA/AU)"
                className="rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-slate-100"
              />
              <input
                value={payload.routingConfig?.timezone || ""}
                onChange={(event) =>
                  setPayload((prev) => ({
                    ...prev,
                    routingConfig: { ...(prev.routingConfig || {}), timezone: event.target.value }
                  }))
                }
                placeholder="Timezone (IANA, e.g. Europe/London)"
                className="rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-slate-100"
              />
              <label className="flex items-center gap-2 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={payload.routingConfig?.enabled !== false}
                  onChange={(event) =>
                    setPayload((prev) => ({
                      ...prev,
                      routingConfig: { ...(prev.routingConfig || {}), enabled: event.target.checked }
                    }))
                  }
                />
                Routing enabled
              </label>
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-4">
            <h2 className="text-sm font-semibold text-white">Forwarding Settings</h2>
            <div className="mt-3 grid gap-3">
              <input
                value={payload.forwardTargets?.ringStrategy || ""}
                onChange={(event) =>
                  setPayload((prev) => ({
                    ...prev,
                    forwardTargets: { ...(prev.forwardTargets || {}), ringStrategy: event.target.value }
                  }))
                }
                placeholder="ringStrategy: sequential | simultaneous"
                className="rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-slate-100"
              />
              <input
                value={String(payload.forwardTargets?.timeoutSeconds || "")}
                onChange={(event) =>
                  setPayload((prev) => ({
                    ...prev,
                    forwardTargets: {
                      ...(prev.forwardTargets || {}),
                      timeoutSeconds: Number(event.target.value || 20)
                    }
                  }))
                }
                placeholder="timeoutSeconds"
                className="rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-slate-100"
              />
              <input
                value={payload.forwardTargets?.fallback || ""}
                onChange={(event) =>
                  setPayload((prev) => ({
                    ...prev,
                    forwardTargets: { ...(prev.forwardTargets || {}), fallback: event.target.value }
                  }))
                }
                placeholder="fallback: voicemail | ai_callback | hangup"
                className="rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-slate-100"
              />
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-4">
            <h2 className="text-sm font-semibold text-white">Rules JSON</h2>
            <textarea
              value={rulesDraft || rulesJson}
              onChange={(event) => setRulesDraft(event.target.value)}
              rows={16}
              className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-xs text-slate-100"
            />
            <p className="mt-2 text-xs text-slate-400">
              Rules are evaluated by priority (lowest number first), then day/time match.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-4">
            <h2 className="text-sm font-semibold text-white">Forward Targets JSON</h2>
            <textarea
              value={targetsDraft || targetsJson}
              onChange={(event) => {
                const next = event.target.value;
                setTargetsDraft(next);
                try {
                  const parsed = JSON.parse(next || "[]");
                  setPayload((prev) => ({
                    ...prev,
                    forwardTargets: { ...(prev.forwardTargets || {}), targets: parsed }
                  }));
                } catch {
                  // Keep editing draft until valid JSON.
                }
              }}
              rows={16}
              className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-xs text-slate-100"
            />
            <p className="mt-2 text-xs text-slate-400">
              Example local formats: GB 07700 900123, US (202) 555-0148. Saved values are normalized to E.164.
            </p>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-slate-900/50 p-4 text-xs text-slate-300">
          <p className="font-semibold text-slate-100">Simple Mode Checklist</p>
          <ul className="mt-2 grid gap-1">
            {dayLabels.map((day) => (
              <li key={day}>- {day}: set open/closed ranges in rules JSON (Simple mode in dashboard offers toggles).</li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
