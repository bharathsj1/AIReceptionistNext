'use client';

import React from 'react';

const plans = [
  {
    key: 'bronze',
    name: 'Bronze',
    price: '$500',
    per: '/month',
    bullets: ['AI call answering with basic FAQs', 'Standard message taking (call + mail + text)', 'Simple AI training'],
  },
  {
    key: 'silver',
    name: 'Silver',
    price: '$600',
    per: '/month',
    bullets: [
      'AI call answering with FAQs',
      'AI forwarding support (phone + email + text)',
      'AI voice acting & appointment booking / call routing',
      'Invoice reminders & overdue follow-up',
      'Monthly social media',
    ],
  },
  {
    key: 'gold',
    name: 'Gold',
    price: '$700',
    per: '/month',
    highlight: true,
    bullets: [
      'Everything in Silver',
      'AI answering + data capture + complex call routing (multi-level)',
      'Advanced booking workflows',
      'Recurring invoice follow-up',
      'Social media including content and graphics',
    ],
  },
  {
    key: 'platinum',
    name: 'Platinum',
    price: 'Custom',
    per: 'Tailored scope',
    bullets: [
      'Everything in Gold',
      'Industry-specific support (health, trades, legal, retail, etc.)',
      'Custom invoice formats + integrations (QuickBooks, Xero)',
      'Social campaign planning + content strategy (16 posts)',
      'Priority support + urgent updates anytime',
    ],
  },
];

export default function Pricing() {
  return (
    <section id="packages" className="py-12">
      <div className="container mx-auto space-y-8 px-4">
        <div className="text-center">
          <div className="inline-flex items-center rounded-full border border-slate-200/60 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-slate-600">
            Packages
          </div>
          <h2 className="mt-3 text-3xl font-bold text-slate-900">AI business support packages</h2>
          <p className="text-slate-600">Choose a plan that fits your workload today and grows with you tomorrow.</p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          {plans.map((plan) => (
            <article
              key={plan.key}
              className={`relative flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_12px_40px_-22px_rgba(15,23,42,0.45)] ${
                plan.highlight ? 'ring-2 ring-indigo-500' : ''
              }`}
            >
              {plan.highlight ? (
                <span className="absolute right-4 top-4 rounded-md bg-slate-900 px-3 py-1 text-xs font-semibold text-white shadow">
                  Most Popular
                </span>
              ) : null}

              <div className="space-y-2">
                <h3 className="text-xl font-semibold text-slate-900">{plan.name}</h3>
                <p className="text-sm text-slate-600">Designed to match your current inbound volume.</p>
              </div>

              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-extrabold text-slate-900">{plan.price}</span>
                <span className="text-slate-500">{plan.per}</span>
              </div>

              <div className="rounded-md border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-800">
                Flexible capacity
              </div>

              <ul className="space-y-2 text-sm text-slate-700">
                {plan.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2">
                    <span className="mt-0.5 text-sky-600">✓</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>

              <a
                href={`/payment?plan=${plan.key}`}
                className={`mt-auto block w-full rounded-lg px-4 py-3 text-center text-sm font-semibold shadow-sm transition ${
                  plan.highlight
                    ? 'bg-sky-600 text-white hover:bg-sky-700'
                    : 'bg-slate-900 text-white hover:bg-slate-800'
                }`}
              >
                {plan.key === 'platinum' ? 'Talk with us' : 'Start free today'}
              </a>
            </article>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_12px_40px_-22px_rgba(15,23,42,0.35)]">
          <div>
            <h3 className="text-xl font-semibold text-slate-900">Need something more specific?</h3>
            <p className="text-slate-600">
              If your business has unique workflows or industry requirements, we can build a bespoke package.
            </p>
          </div>
          <a
            className="rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
            href="#contact"
          >
            Tell us what you need
          </a>
        </div>
      </div>
    </section>
  );
}
