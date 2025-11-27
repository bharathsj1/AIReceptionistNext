'use client';

import React from 'react';

const plans = [
  { key: 'bronze', name: 'Bronze', price: '$500', per: '/month', bullets: ['AI call answering with basic FAQs', 'Standard message taking (call + mail + text)', 'Simple AI training'] },
  { key: 'silver', name: 'Silver', price: '$600', per: '/month', bullets: ['AI call answering with FAQs', 'AI forwarding support (phone + email + text)', 'AI voice acting & appointment booking / call routing', 'Invoice reminders & overdue follow-up', 'Monthly social media'] },
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
      <div className="container mx-auto space-y-6 px-4">
        <div className="text-center">
          <div className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-white/70">
            Packages
          </div>
          <h2 className="text-3xl font-bold">AI business support packages</h2>
          <p className="text-white/70">Choose a plan that fits your workload today and grows with you tomorrow.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          {plans.map((plan) => (
            <article
              key={plan.key}
              className={`rounded-2xl border border-white/10 bg-white/5 p-5 shadow-xl ${plan.highlight ? 'border-indigo-300/60 shadow-indigo-500/20' : ''}`}
            >
              <div className="flex items-center justify-between">
                <div className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] ${plan.highlight ? 'bg-white/10 text-white' : 'bg-white/5 text-white/70'}`}>
                  {plan.name}
                </div>
                <p className="text-sm text-white/70">Plan</p>
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-3xl font-extrabold">{plan.price}</span>
                <span className="text-white/60">{plan.per}</span>
              </div>
              <ul className="mt-4 space-y-2 text-white/70">
                {plan.bullets.map((b) => (
                  <li key={b} className="flex gap-2">
                    <span className="text-emerald-300">✓</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              <a
                href={`/payment?plan=${plan.key}`}
                className="mt-4 block w-full rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-center text-sm font-bold text-white hover:bg-white/20"
              >
                {plan.key === 'platinum' ? 'Talk with us' : `Start ${plan.name}`}
              </a>
            </article>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div>
            <h3 className="text-xl font-semibold">Need something more specific?</h3>
            <p className="text-white/70">
              If your business has unique workflows or industry requirements, we can build a bespoke package.
            </p>
          </div>
          <a
            className="rounded-xl bg-gradient-to-r from-indigo-400 via-sky-400 to-emerald-300 px-4 py-3 text-sm font-bold text-black shadow-lg"
            href="#contact"
          >
            Tell us what you need
          </a>
        </div>
      </div>
    </section>
  );
}
