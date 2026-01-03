import { BusinessTypeForm } from "./_components/BusinessTypeForm";

export default function BusinessOnboardingPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.16),_transparent_45%),radial-gradient(circle_at_20%_60%,_rgba(129,140,248,0.14),_transparent_50%)]"
        />
        <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-12">
          <div className="max-w-2xl space-y-3">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
              Onboarding
            </p>
            <h1 className="text-3xl font-semibold text-white sm:text-4xl">
              Tell us about your business
            </h1>
            <p className="text-base text-slate-300">
              We'll tailor your AI receptionist scripts, voice, and booking flow.
            </p>
          </div>

          <div className="mt-10 flex-1">
            <BusinessTypeForm />
          </div>
        </div>
      </div>
    </div>
  );
}
