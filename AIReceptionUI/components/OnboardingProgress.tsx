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
  const [crawlMessage, setCrawlMessage] = useState<string | null>(null);
  const [crawlState, setCrawlState] = useState<'idle' | 'running' | 'success' | 'error'>('idle');

  // Use the new proxy API route
  const crawlKbEndpoint = '/api/crawl-kb';

  useEffect(() => {
    if (!website || crawlState !== 'idle') return;
    const controller = new AbortController();
    const runCrawl = async () => {
      setCrawlState('running');
      setCrawlMessage('Reading your website…');
      try {
        const res = await fetch(crawlKbEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: website }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error('Unable to analyze site');
        const data = await res.json();
        const pages = typeof data?.pages === 'number' ? data.pages : undefined;
        const summary = { website, pages };
        setCrawlSummary(summary);
        setCrawlMessage(`Website analyzed${pages ? ` (${pages} pages)` : ''}.`);
        setCrawlState('success');
        try {
          sessionStorage.setItem('crawlResult', JSON.stringify({ website, data }));
        } catch (storageErr) {
          console.warn('Could not cache crawl result in session storage', storageErr);
        }
      } catch (err: any) {
        if (controller.signal.aborted) return;
        setCrawlState('error');
        setCrawlMessage(err?.message || 'Something went wrong while analyzing your site.');
      }
    };
    runCrawl();
    return () => controller.abort();
  }, [website, crawlState]);

  useEffect(() => {
    const lastStepIndex = ONBOARDING_STEPS.length - 1;
    if (active >= lastStepIndex) {
      if (crawlState === 'running') return;
      const timer = setTimeout(() => router.push(`/ready${website ? `?website=${encodeURIComponent(website)}` : ''}`), 700);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(
      () => setActive((i) => Math.min(i + 1, lastStepIndex)),
      900,
    );
    return () => clearTimeout(timer);
  }, [active, router, website, crawlState]);

  return (
    <div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-indigo-400 via-sky-400 to-emerald-300 transition-all"
          style={{ width: `${Math.min(100, ((active + 1) / ONBOARDING_STEPS.length) * 100)}%` }}
        />
      </div>
      {(crawlMessage || crawlSummary) && (
        <p className="mt-2 text-xs text-white/60">
          {crawlMessage ||
            `Using crawl for ${crawlSummary?.website || 'your site'}${
              typeof crawlSummary?.pages === 'number' ? ` (${crawlSummary.pages} pages)` : ''
            }.`}
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
