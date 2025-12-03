'use client';

import React, { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { API_ENDPOINTS } from '@/lib/constants';

export default function ReadyForm() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();
  const params = useSearchParams();
  const website = params.get('website');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setStatus('Please enter your email to continue.');
      return;
    }
    setPending(true);
    setStatus('Creating your trial account…');
    try {
      const res = await fetch(API_ENDPOINTS.trial, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error('Account creation failed');
      setStatus('Account created! Redirecting…');
      setTimeout(() => router.push(`/test-call?email=${encodeURIComponent(email)}${website ? `&website=${encodeURIComponent(website)}` : ''}`), 400);
    } catch (err: any) {
      setStatus(err.message || 'Something went wrong. Please try again.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="ready-shell space-y-4">
      <h1 className="text-2xl font-bold">You&apos;re ready to try your AI Receptionist</h1>
      <form className="ready-form" onSubmit={handleSubmit}>
        <label className="space-y-2 text-sm font-semibold">
          Work email
          <input
            className="input"
            type="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        {status && <p className="text-sm text-emerald-300">{status}</p>}
        <div className="ready-actions">
          <button
            type="submit"
            disabled={pending}
            className="rounded-xl bg-gradient-to-r from-indigo-400 via-sky-400 to-emerald-300 px-4 py-3 text-sm font-bold text-black shadow-lg disabled:opacity-60"
          >
            {pending ? 'Creating account…' : 'Try Your AI Receptionist Now →'}
          </button>
        </div>
      </form>
    </div>
  );
}
