import React from 'react';

/**
 * CTASection
 * - Gradient block with heading + CTA.
 * - Adjust gradient colors via Tailwind classes below to match brand accents.
 */
export default function CTASection() {
  return (
    <div className="rounded-3xl bg-gradient-to-r from-purple-600 via-fuchsia-500 to-indigo-500 p-8 text-white shadow-2xl ring-1 ring-white/10">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h3 className="text-2xl font-bold">Ready to automate every call?</h3>
          <p className="text-sm opacity-90">
            Book a demo and see how SmartConnect4U answers, routes, and schedules without missing a beat.
          </p>
        </div>
        <a
          href="#contact"
          className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-900 shadow-lg transition-all duration-200 hover:scale-105 hover:shadow-xl"
        >
          Get Started →
        </a>
      </div>
    </div>
  );
}
