import React, { useEffect, useMemo, useState } from 'react';

type CallPhase = 'incoming' | 'oncall' | 'next';

const notesText =
  'Caller asked for availability tomorrow at 3PM. Wants a quote emailed. Prefers SMS confirmation.';

/**
 * ReceptionDashboard
 * - Loops through call phases (incoming -> on call -> next actions) every 5s to mimic live activity.
 * - Edit text labels (titles, notes, routes, actions) in the constants below.
 * - Change timing by adjusting `PHASE_DURATION_MS`.
 */
export default function ReceptionDashboard() {
  const PHASE_DURATION_MS = 5000;
  const [phase, setPhase] = useState<CallPhase>('incoming');

  useEffect(() => {
    const order: CallPhase[] = ['incoming', 'oncall', 'next'];
    let idx = 0;
    const id = setInterval(() => {
      idx = (idx + 1) % order.length;
      setPhase(order[idx]);
    }, PHASE_DURATION_MS);
    return () => clearInterval(id);
  }, []);

  const isIncoming = phase === 'incoming';
  const isOnCall = phase === 'oncall';
  const isNext = phase === 'next';

  const bannerTitle = useMemo(() => (isOnCall ? 'On call' : 'Incoming call'), [isOnCall]);
  const bannerSubtitle = 'Booking request · Plumbing';

  return (
    <div className="w-full max-w-xl rounded-3xl bg-[#0b0f1c] p-6 shadow-[0_25px_70px_rgba(0,0,0,0.45)] ring-1 ring-white/5">
      {/* Top row: avatar + title + status */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-purple-500 to-indigo-500 text-xl text-white animate-pulse">
            🤖
          </div>
          <div className="space-y-1">
            <p className="text-base font-semibold text-white">Reception Dashboard</p>
            <p className="flex items-center gap-2 text-xs text-slate-300">
              <span className="relative inline-flex h-2 w-2 items-center justify-center">
                <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-300" />
              </span>
              Live • Auto-routing
            </p>
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <span className="h-2 w-2 rounded-full bg-slate-500" />
          <span className="h-2 w-2 rounded-full bg-slate-500" />
          <span className="h-2 w-2 rounded-full bg-slate-500" />
        </div>
      </div>

      {/* Incoming banner */}
      <div
        className={`mt-5 flex items-center justify-between rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 p-4 text-white transition-all duration-500 ${
          isIncoming ? 'shadow-[0_0_30px_rgba(129,140,248,0.45)]' : ''
        }`}
      >
        <div>
          <p className="text-sm font-semibold">{bannerTitle}</p>
          <p className="text-xs text-slate-100">{bannerSubtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className={`grid h-10 w-10 place-items-center rounded-full bg-emerald-500 text-white transition-all duration-200 hover:scale-105 hover:shadow-lg ${
              isIncoming ? 'animate-pulse' : ''
            }`}
            aria-label="Accept call"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" className="h-5 w-5">
              <path
                d="M6.75 3.75h3l1.5 4.5-2.25 1.5a12 12 0 0 0 4.5 4.5l1.5-2.25 4.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5 15 15 0 0 1-13.5-13.5 1.5 1.5 0 0 1 1.5-1.5Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="grid h-10 w-10 place-items-center rounded-full bg-rose-500 text-white transition-all duration-200 hover:scale-105 hover:shadow-lg"
            aria-label="Drop call"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" className="h-5 w-5">
              <path
                d="M3.75 4.5 19.5 20.25M9.75 4.5h4.5l1.5 4.5-1.068.712M9.257 10.328 7.5 9.75l1.5-4.5H9.75m0 0h-.75"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M9.52 13.5c1.33 1.29 2.96 2.32 4.78 3.01l1.5-2.25 4.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5 15 15 0 0 1-10.37-3.88"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Notes */}
      <div className="mt-4 rounded-2xl bg-[#0c111f] p-4 ring-1 ring-white/5">
        <p className="text-xs uppercase tracking-[0.12em] text-slate-400">Assistant Notes</p>
        <p
          className={`mt-2 text-sm text-slate-100 transition-opacity duration-500 ${
            isOnCall ? 'opacity-100' : 'opacity-70'
          }`}
        >
          {notesText}
        </p>
      </div>

      {/* Bottom cards */}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl bg-gradient-to-r from-purple-500 to-indigo-500 p-4 text-white shadow-lg">
          <p className="text-xs uppercase tracking-[0.12em] opacity-80">Routes</p>
          <p className="text-lg font-semibold">Sales • Billing • Emergencies</p>
        </div>
        <div
          className={`rounded-2xl bg-[#0c111f] p-4 text-white ring-1 transition-all duration-500 ${
            isNext ? 'ring-purple-400 shadow-[0_0_25px_rgba(129,140,248,0.35)]' : 'ring-white/5'
          }`}
        >
          <p className="text-xs uppercase tracking-[0.12em] text-slate-400">Next actions</p>
          <p className="text-sm text-slate-100">Send quote · Confirm slot · Sync calendar</p>
        </div>
      </div>
    </div>
  );
}
