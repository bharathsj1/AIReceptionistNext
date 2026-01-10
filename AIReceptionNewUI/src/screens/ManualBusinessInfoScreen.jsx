import { useState } from "react";

const DEFAULT_DAY_STATE = {
  open: true,
  start: "09:00",
  end: "18:00"
};
const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABELS = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun"
};

export default function ManualBusinessInfoScreen({
  name = "",
  phone = "",
  email = "",
  onSubmit,
  onBack
}) {
  const [daySchedule, setDaySchedule] = useState(() =>
    DAY_ORDER.reduce((acc, day) => {
      const isWeekend = day === "sat" || day === "sun";
      acc[day] = { ...DEFAULT_DAY_STATE, open: !isWeekend };
      return acc;
    }, {})
  );

  const handleSubmit = (e) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const hoursLines = DAY_ORDER.map((day) => {
      const entry = daySchedule[day];
      if (!entry?.open) return `${DAY_LABELS[day]}: Closed`;
      const startVal = entry.start || "09:00";
      const endVal = entry.end || "18:00";
      return `${DAY_LABELS[day]}: ${startVal}-${endVal}`;
    }).join(" | ");
    const hoursStr = hoursLines || form.get("hours") || "";
    const payload = {
      businessName: form.get("businessName") || "",
      businessPhone: form.get("businessPhone") || "",
      businessEmail: form.get("businessEmail") || "",
      businessSummary: form.get("businessSummary") || "",
      hours: hoursStr,
      location: form.get("location") || "",
      services: form.get("services") || "",
      notes: form.get("notes") || "",
      websiteUrl: form.get("websiteUrl") || ""
    };
    onSubmit?.(payload);
  };

  return (
    <section className="screen-panel">
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-8 shadow-[0_20px_90px_rgba(15,23,42,0.35)] backdrop-blur">
        <div className="pointer-events-none absolute -left-10 -top-16 h-64 w-64 rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -right-10 bottom-0 h-64 w-64 rounded-full bg-amber-400/10 blur-3xl" />
        <div className="relative grid gap-8 lg:grid-cols-[1fr_1.4fr]">
          <div className="flex flex-col gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-200">
              Describe your business
            </p>
            <h2 className="text-3xl font-semibold text-white">No website? No problem.</h2>
            <p className="text-sm text-slate-200/85 leading-relaxed">
              Tell us about your brand, hours, and services. We’ll craft the AI receptionist prompt,
              voice, and booking rules without a site crawl.
            </p>
            <div className="mt-4 grid gap-3 rounded-2xl border border-white/10 bg-slate-900/40 p-4 text-sm text-slate-100">
              <div className="flex items-center justify-between">
                <span className="text-slate-300">What you’ll get</span>
                <span className="rounded-full border border-indigo-300/50 bg-indigo-500/20 px-3 py-1 text-[11px] font-semibold text-indigo-50">
                  AI-ready brief
                </span>
              </div>
              <ul className="list-disc space-y-1 pl-5 text-slate-200/90">
                <li>Tailored S4U-v3 prompt for your receptionist</li>
                <li>Hours, services, and escalation rules baked in</li>
                <li>Ready for booking and call routing after checkout</li>
              </ul>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="relative grid gap-5 rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-inner">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Business name">
                <input
                  name="businessName"
                  type="text"
                  defaultValue={name}
                  required
                  className="w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
                  placeholder="Synergy Dental"
                />
              </Field>
              <Field label="Contact number">
                <input
                  name="businessPhone"
                  type="tel"
                  defaultValue={phone}
                  className="w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
                  placeholder="+1 555-123-4567"
                />
              </Field>
              <Field label="Contact email">
                <input
                  name="businessEmail"
                  type="email"
                  defaultValue={email}
                  className="w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
                  placeholder="hello@yourbrand.com"
                />
              </Field>
              <Field label="Optional website (if any)">
                <input
                  name="websiteUrl"
                  type="url"
                  className="w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
                  placeholder="https://example.com"
                />
              </Field>
            </div>

            <Field label="What do you do? *">
              <textarea
                name="businessSummary"
                rows={3}
                required
                className="w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
                placeholder="Explain what you sell, who you serve, and the tone you want your receptionist to use."
              />
            </Field>

            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Hours + days">
                <div className="grid gap-2 rounded-2xl border border-white/10 bg-white/5 p-3">
                  {DAY_ORDER.map((day) => (
                    <div key={day} className="grid items-center gap-2 sm:grid-cols-[1fr_auto_auto]">
                      <button
                        type="button"
                        className={`w-full rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide sm:w-auto ${
                          daySchedule[day]?.open
                            ? "border border-emerald-300/60 bg-emerald-500/20 text-emerald-50"
                            : "border border-white/10 bg-white/5 text-slate-200"
                        }`}
                        onClick={() =>
                          setDaySchedule((prev) => ({
                            ...prev,
                            [day]: { ...prev[day], open: !prev[day]?.open }
                          }))
                        }
                      >
                        {DAY_LABELS[day]}
                      </button>
                      <input
                        type="time"
                        value={daySchedule[day]?.start || "09:00"}
                        onChange={(e) =>
                          setDaySchedule((prev) => ({
                            ...prev,
                            [day]: { ...prev[day], start: e.target.value }
                          }))
                        }
                        className="w-full rounded-lg border border-white/10 bg-white/10 px-2 py-1 text-sm text-white outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-40"
                        disabled={!daySchedule[day]?.open}
                      />
                      <input
                        type="time"
                        value={daySchedule[day]?.end || "18:00"}
                        onChange={(e) =>
                          setDaySchedule((prev) => ({
                            ...prev,
                            [day]: { ...prev[day], end: e.target.value }
                          }))
                        }
                        className="w-full rounded-lg border border-white/10 bg-white/10 px-2 py-1 text-sm text-white outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-40"
                        disabled={!daySchedule[day]?.open}
                      />
                    </div>
                  ))}
                </div>
              </Field>
              <Field label="Location / service area">
                <textarea
                  name="location"
                  rows={2}
                  className="w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
                  placeholder="123 Main St, Springfield OR. Servicing nationwide via phone."
                />
              </Field>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Key services or offerings">
                <textarea
                  name="services"
                  rows={2}
                  className="w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
                  placeholder="Top services, prices, and any qualifications customers should know."
                />
              </Field>
              <Field label="Must-know notes for the AI">
                <textarea
                  name="notes"
                  rows={2}
                  className="w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
                  placeholder="Escalation rules, blocked topics, VIP instructions, or FAQs."
                />
              </Field>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="ghost" onClick={onBack}>
                ← Back
              </button>
              <button type="submit" className="primary">
                Continue to packages
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}

const Field = ({ label, children }) => (
  <label className="flex flex-col gap-1 text-sm font-semibold text-slate-100">
    <span className="text-xs uppercase tracking-[0.14em] text-slate-300">{label}</span>
    {children}
  </label>
);
