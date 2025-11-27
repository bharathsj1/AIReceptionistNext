import React from 'react';

const cards = [
  { title: 'Analytics Pulse', desc: 'Live view of calls answered, routed, and converted.', accent: 'from-purple-500 to-indigo-500' },
  { title: 'Call Summary', desc: 'Highlights, action items, and follow-ups from every call.', accent: 'from-fuchsia-500 to-purple-700' },
  { title: 'Appointments', desc: 'Calendar slots auto-filled with confirmed bookings.', accent: 'from-emerald-400 to-teal-500' },
];

/**
 * ScreenshotsStrip
 * - Lightweight faux UI cards that mimic “app screenshots”.
 * - To add or edit cards, update the `cards` array above. Tailwind gradients set per-card accents.
 */
export default function ScreenshotsStrip() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => (
        <div
          key={card.title}
          className="rounded-2xl bg-[#131722] p-4 shadow-xl ring-1 ring-white/10 backdrop-blur"
        >
          <div className={`flex h-32 flex-col justify-between rounded-xl bg-gradient-to-br ${card.accent} p-4 text-white`}>
            <div className="flex items-center justify-between">
              <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-semibold">Live</span>
              <span className="flex gap-1">
                <span className="h-2 w-2 rounded-full bg-white/60" />
                <span className="h-2 w-2 rounded-full bg-white/60" />
                <span className="h-2 w-2 rounded-full bg-white/60" />
              </span>
            </div>
            <div>
              <p className="text-sm opacity-80">{card.desc}</p>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            <p className="text-sm font-semibold text-white">{card.title}</p>
            <div className="h-2 w-full rounded-full bg-slate-800">
              <div className="h-full w-2/3 rounded-full bg-gradient-to-r from-purple-400 to-indigo-500" />
            </div>
            <div className="h-2 w-11/12 rounded-full bg-slate-800">
              <div className="h-full w-3/4 rounded-full bg-gradient-to-r from-purple-400 to-indigo-500" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
