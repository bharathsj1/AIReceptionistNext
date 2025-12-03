'use client';

import React, { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { ONBOARDING_STEPS } from '@/lib/constants';

export default function OnboardingProgress() {
  const params = useSearchParams();
  const router = useRouter();
  const website = params.get('website') || undefined;
  const [active, setActive] = useState(0);
  const [crawlSummary, setCrawlSummary] = useState<{ website?: string; pages?: number } | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('crawlResult');
      if (raw) {
        const parsed = JSON.parse(raw);
        setCrawlSummary({ website: parsed?.website || website, pages: parsed?.data?.pages });
      }
    } catch (err) {
      console.warn('Unable to load crawl result', err);
    }
  }, [website]);

  useEffect(() => {
    if (active >= ONBOARDING_STEPS.length) {
      setTimeout(() => router.push(`/ready${website ? `?website=${encodeURIComponent(website)}` : ''}`), 700);
      return;
    }
    const timer = setTimeout(() => setActive((i) => i + 1), 900);
    return () => clearTimeout(timer);
  }, [active, router, website]);

  return (
    <div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-indigo-400 via-sky-400 to-emerald-300 transition-all"
          style={{ width: `${Math.min(100, ((active + 1) / ONBOARDING_STEPS.length) * 100)}%` }}
        />
      </div>
      {crawlSummary && (
        <p className="mt-2 text-xs text-white/60">
          Using crawl for {crawlSummary.website || 'your site'}
          {typeof crawlSummary.pages === 'number' ? ` (${crawlSummary.pages} pages)` : ''}.
        </p>
      )}
      <ul className="mt-4 space-y-3">
        {ONBOARDING_STEPS.map((step, idx) => {
          const state = idx < active ? 'done' : idx === active ? 'active' : 'pending';
          return (
            <li
              key={step}
              className={`flex items-center gap-3 rounded-xl border border-white/10 p-3 ${
                state === 'active' ? 'border-indigo-300/60 shadow-indigo-500/20' : ''
              }`}
            >
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-white/5">
                {state === 'done' ? '✓' : state === 'active' ? '↻' : ''}
              </span>
              <div>
                <p className="text-sm font-semibold">{step}</p>
                <p className="text-xs text-white/60">
                  {state === 'active' ? 'In progress…' : state === 'done' ? 'Done' : 'Pending'}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
