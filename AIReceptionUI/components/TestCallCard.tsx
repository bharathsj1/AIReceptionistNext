'use client';

import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function TestCallCard() {
  const router = useRouter();
  const params = useSearchParams();
  const email = params.get('email') || '';

  return (
    <div className="test-call-shell space-y-3">
      <h1 className="text-2xl font-bold">Test Call</h1>
      <p className="text-white/70">
        Thanks for trying SmartConnect4U. Start a test call and then view your dashboard insights.
      </p>
      <button
        className="rounded-xl bg-gradient-to-r from-indigo-400 via-sky-400 to-emerald-300 px-4 py-3 text-sm font-bold text-black shadow-lg"
        onClick={() => router.push(`/dashboard${email ? `?email=${encodeURIComponent(email)}` : ''}`)}
      >
        Go to dashboard →
      </button>
    </div>
  );
}
