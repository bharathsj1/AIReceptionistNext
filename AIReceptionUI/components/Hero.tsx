import React from 'react';

export default function Hero() {
  return (
    <section className="relative overflow-hidden py-20" id="home">
      <div className="container mx-auto grid items-center gap-10 px-4 md:grid-cols-2">
        <div className="space-y-4">
          <div className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-white/70">
            AI business support
          </div>
          <p className="text-sm text-white/60">
            Keywords: AI business support, AI tools for business automation, AI for small businesses, AI voice agent
            services, AI bookkeeping
          </p>
          <h1 className="text-4xl font-extrabold leading-tight">
            AI tools for business automation that work like part of your team.
          </h1>
          <p className="text-lg text-white/70">
            Turn your missed calls, messages and social posts into automated tasks that run in the background — so you
            can focus on running the business.
          </p>
          <div className="flex flex-wrap gap-3">
            <a
              className="rounded-xl bg-gradient-to-r from-indigo-400 via-sky-400 to-emerald-300 px-4 py-3 text-sm font-bold text-black shadow-lg"
              href="#services"
            >
              See how it works
            </a>
            <a className="rounded-xl border border-white/10 px-4 py-3 text-sm font-bold text-white" href="#packages">
              Discover packages
            </a>
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-2xl">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.08em] text-white/60">Always-on support</p>
              <h3 className="text-xl font-semibold">Work runs while you focus</h3>
            </div>
            <span className="rounded-full bg-emerald-400/20 px-3 py-1 text-xs font-semibold text-emerald-200">Live</span>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {[
              { label: 'No fixed contracts', desc: 'Predictable monthly fees. Scale up or down.' },
              { label: 'Big savings', desc: 'Skip extra recruitment, training and payroll.' },
              { label: 'Hands-free', desc: 'AI handles the admin, messages and follow ups.' },
              { label: 'Works 24/7', desc: 'Always on, no breaks, no missed opportunities.' },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-base font-bold">{item.label}</p>
                <p className="text-sm text-white/70">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
