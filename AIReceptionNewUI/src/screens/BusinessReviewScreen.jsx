import { useMemo, useState } from "react";

const clampText = (value, limit) => (value || "").slice(0, limit);
const SUMMARY_LIMIT = 5000;
const FIELD_LIMIT = 1000;

export default function BusinessReviewScreen({ initialData = {}, onSubmit, onBack }) {
  const defaults = useMemo(
    () => ({
      businessName: initialData.businessName || "",
      businessPhone: initialData.businessPhone || "",
      businessEmail: initialData.businessEmail || "",
      websiteUrl: initialData.websiteUrl || "",
      businessSummary: initialData.businessSummary || "",
      location: initialData.location || "",
      hours: initialData.hours || "",
      openings: initialData.openings || "",
      services: initialData.services || "",
      notes: initialData.notes || ""
    }),
    [initialData]
  );

  const [businessName, setBusinessName] = useState(defaults.businessName);
  const [businessPhone, setBusinessPhone] = useState(defaults.businessPhone);
  const [businessEmail, setBusinessEmail] = useState(defaults.businessEmail);
  const [websiteUrl, setWebsiteUrl] = useState(defaults.websiteUrl);
  const [businessSummary, setBusinessSummary] = useState(
    clampText(defaults.businessSummary, SUMMARY_LIMIT)
  );
  const [location, setLocation] = useState(clampText(defaults.location, FIELD_LIMIT));
  const [hours, setHours] = useState(clampText(defaults.hours, FIELD_LIMIT));
  const [openings, setOpenings] = useState(clampText(defaults.openings, FIELD_LIMIT));
  const [services, setServices] = useState(clampText(defaults.services, FIELD_LIMIT));
  const [notes, setNotes] = useState(clampText(defaults.notes, FIELD_LIMIT));

  const handleSubmit = (event) => {
    event.preventDefault();
    onSubmit?.({
      businessName: businessName.trim(),
      businessPhone: businessPhone.trim(),
      businessEmail: businessEmail.trim(),
      websiteUrl: websiteUrl.trim(),
      businessSummary: businessSummary.trim(),
      location: location.trim(),
      hours: hours.trim(),
      openings: openings.trim(),
      services: services.trim(),
      notes: notes.trim()
    });
  };

  return (
    <section className="screen-panel">
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-8 shadow-[0_20px_90px_rgba(15,23,42,0.35)] backdrop-blur">
        <div className="pointer-events-none absolute -left-10 -top-16 h-64 w-64 rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -right-10 bottom-0 h-64 w-64 rounded-full bg-amber-400/10 blur-3xl" />
        <div className="relative grid gap-8 lg:grid-cols-[1fr_1.4fr]">
          <div className="flex flex-col gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-200">
              Confirm your details
            </p>
            <h2 className="text-3xl font-semibold text-white">Review your business profile</h2>
            <p className="text-sm text-slate-200/85 leading-relaxed">
              We pulled these details from your website crawl. Please confirm or update anything
              before continuing to packages.
            </p>
            <div className="mt-4 grid gap-3 rounded-2xl border border-white/10 bg-slate-900/40 p-4 text-sm text-slate-100">
              <div className="flex items-center justify-between">
                <span className="text-slate-300">What happens next</span>
                <span className="rounded-full border border-indigo-300/50 bg-indigo-500/20 px-3 py-1 text-[11px] font-semibold text-indigo-50">
                  AI-ready brief
                </span>
              </div>
              <ul className="list-disc space-y-1 pl-5 text-slate-200/90">
                <li>We confirm your business summary and service focus.</li>
                <li>We tailor the AI receptionist to your brand voice.</li>
                <li>You proceed to packages and provisioning.</li>
              </ul>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="relative grid gap-5 rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-inner">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Business name">
                <input
                  name="businessName"
                  type="text"
                  value={businessName}
                  onChange={(event) => setBusinessName(event.target.value)}
                  required
                  className="w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
                  placeholder="Synergy Dental"
                />
              </Field>
              <Field label="Contact number">
                <input
                  name="businessPhone"
                  type="tel"
                  value={businessPhone}
                  onChange={(event) => setBusinessPhone(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
                  placeholder="+1 555-123-4567"
                />
              </Field>
              <Field label="Contact email">
                <input
                  name="businessEmail"
                  type="email"
                  value={businessEmail}
                  onChange={(event) => setBusinessEmail(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
                  placeholder="hello@yourbrand.com"
                />
              </Field>
              <Field label="Website">
                <input
                  name="websiteUrl"
                  type="url"
                  value={websiteUrl}
                  onChange={(event) => setWebsiteUrl(event.target.value)}
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
                maxLength={SUMMARY_LIMIT}
                value={businessSummary}
                onChange={(event) => setBusinessSummary(clampText(event.target.value, SUMMARY_LIMIT))}
                className="w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
                placeholder="Explain what you sell, who you serve, and the tone you want your receptionist to use."
              />
              <div className="text-xs text-slate-300 text-right">{businessSummary.length}/5000</div>
            </Field>

            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Business openings / hours">
                <textarea
                  name="hours"
                  rows={2}
                  maxLength={FIELD_LIMIT}
                  value={hours}
                  onChange={(event) => setHours(clampText(event.target.value, FIELD_LIMIT))}
                  className="w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
                  placeholder="Mon–Fri 9am–6pm; Sat by appointment."
                />
                <div className="text-xs text-slate-300 text-right">{hours.length}/1000</div>
              </Field>
              <Field label="Location / service area">
                <textarea
                  name="location"
                  rows={2}
                  maxLength={FIELD_LIMIT}
                  value={location}
                  onChange={(event) => setLocation(clampText(event.target.value, FIELD_LIMIT))}
                  className="w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
                  placeholder="123 Main St, Springfield OR. Servicing nationwide via phone."
                />
                <div className="text-xs text-slate-300 text-right">{location.length}/1000</div>
              </Field>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Key services or offerings">
                <textarea
                  name="services"
                  rows={2}
                  maxLength={FIELD_LIMIT}
                  value={services}
                  onChange={(event) => setServices(clampText(event.target.value, FIELD_LIMIT))}
                  className="w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
                  placeholder="Top services, prices, and any qualifications customers should know."
                />
                <div className="text-xs text-slate-300 text-right">{services.length}/1000</div>
              </Field>
              <Field label="Must-know notes for the AI">
                <textarea
                  name="notes"
                  rows={2}
                  maxLength={FIELD_LIMIT}
                  value={notes}
                  onChange={(event) => setNotes(clampText(event.target.value, FIELD_LIMIT))}
                  className="w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
                  placeholder="Escalation rules, blocked topics, VIP instructions, or FAQs."
                />
                <div className="text-xs text-slate-300 text-right">{notes.length}/1000</div>
              </Field>
            </div>

            <Field label="Additional openings or availability">
              <textarea
                name="openings"
                rows={2}
                maxLength={FIELD_LIMIT}
                value={openings}
                onChange={(event) => setOpenings(clampText(event.target.value, FIELD_LIMIT))}
                className="w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
                placeholder="Seasonal availability, holiday closures, or special opening notes."
              />
              <div className="text-xs text-slate-300 text-right">{openings.length}/1000</div>
            </Field>

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
