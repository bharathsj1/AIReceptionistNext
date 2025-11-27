import React from 'react';

const features = [
  {
    title: 'AI Call Answering',
    desc:
      'Our AI receptionist picks up every call, follows your script, books appointments, answers questions, and routes enquiries on-brand.',
    icon: '☎️',
  },
  {
    title: 'AI Invoice Creation',
    desc:
      'Invoices write themselves with accurate client details, totals, and taxes—no missed payments or late-night fixes.',
    icon: '🧾',
  },
  {
    title: 'AI Social Media Management',
    desc:
      'Stay active online without logging in. Posts match your tone, schedule automatically, and react to engagement data.',
    icon: '📣',
  },
  {
    title: 'Advanced Routing',
    desc: 'Multi-level call routing, data capture, and booking flows that adjust to your playbook.',
    icon: '🧭',
  },
];

/**
 * FeaturesGrid
 * - Displays product benefits in Calina-style minimal cards.
 * - Update `features` to change titles/descriptions; emoji icons are easy to swap.
 */
export default function FeaturesGrid() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {features.map((feature) => (
        <div
          key={feature.title}
          className="group rounded-2xl bg-[#121622] p-4 shadow-lg ring-1 ring-white/10 transition-transform duration-200 hover:-translate-y-1 hover:shadow-2xl"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-500/20 text-lg text-purple-200">
            {feature.icon}
          </div>
          <h3 className="mt-3 text-lg font-semibold text-white group-hover:text-purple-100">{feature.title}</h3>
          <p className="mt-2 text-sm text-slate-300 group-hover:text-slate-200">{feature.desc}</p>
        </div>
      ))}
    </div>
  );
}
