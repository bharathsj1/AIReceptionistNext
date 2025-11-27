import React from 'react';

const stats = [
  { label: 'ROI on Boost', value: '250%+', detail: 'When calls are answered instantly' },
  { label: 'After-hours bookings', value: '45%', detail: 'Appointments captured outside 9–5' },
  { label: 'More bookings per customer', value: '18%', detail: 'By routing every lead' },
  { label: 'Active customers', value: '27,000+', detail: 'Teams relying on AI reception' },
];

/**
 * StatsSection
 * - Calina-style stat layout with bold numbers and small labels.
 * - Edit the `stats` array to adjust metrics; values and descriptions are easy to update.
 */
export default function StatsSection() {
  return (
    <div className="grid gap-4 rounded-3xl bg-[#111524] p-6 shadow-2xl ring-1 ring-white/10 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <div key={stat.label} className="space-y-1">
          <div className="text-2xl font-extrabold text-white">{stat.value}</div>
          <div className="text-sm font-semibold text-slate-200">{stat.label}</div>
          <p className="text-xs text-slate-400">{stat.detail}</p>
        </div>
      ))}
    </div>
  );
}
