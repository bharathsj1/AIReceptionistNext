'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SignupForm() {
  const router = useRouter();
  const [website, setWebsite] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!website.trim()) {
      setStatus('Please enter a website URL to continue.');
      return;
    }
    setPending(true);
    setStatus('Analyzing your website…');
    try {
      const res = await fetch('http://localhost:5001/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: website }),
      });
      if (!res.ok) throw new Error('Unable to analyze site');
      const data = await res.json();
      setStatus(`Website analyzed! ${data.pages || 0} pages added.`);
      setTimeout(() => router.push(`/onboarding?website=${encodeURIComponent(website)}`), 600);
    } catch (err: any) {
      setStatus(err.message || 'Something went wrong. Please try again.');
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      <label className="space-y-2 text-sm font-semibold">
        <div className="flex items-center rounded-xl border border-white/10 bg-white/5 px-3">
          <span className="text-lg text-white/60">🌐</span>
          <input
            className="w-full bg-transparent px-3 py-3 text-white outline-none"
            placeholder="https://yourwebsite.com"
            type="url"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            required
          />
        </div>
      </label>
      {status && <p className="text-sm text-emerald-300">{status}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-gradient-to-r from-indigo-400 via-sky-400 to-emerald-300 px-4 py-3 text-sm font-bold text-black shadow-lg disabled:opacity-60"
      >
        {pending ? 'Analyzing…' : 'Continue →'}
      </button>
    </form>
  );
}
