'use client';

import React, { useState } from 'react';
import { API_ENDPOINTS } from '@/lib/constants';

export default function ContactForm() {
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', team_size: '', goals: '' });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setStatus(null);
    try {
      const res = await fetch(API_ENDPOINTS.demoRequest, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error('Submission failed');
      setStatus('Thanks! We received your request and will reply within one business day.');
      setForm({ name: '', email: '', team_size: '', goals: '' });
    } catch (err: any) {
      setStatus(err.message || 'Something went wrong. Please try again later.');
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-5 shadow-xl" onSubmit={handleSubmit}>
      <label className="space-y-1 text-sm font-semibold">
        Name*
        <input
          className="input"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          required
          placeholder="Alex Smith"
        />
      </label>
      <label className="space-y-1 text-sm font-semibold">
        Work email*
        <input
          className="input"
          type="email"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          required
          placeholder="you@company.com"
        />
      </label>
      <label className="space-y-1 text-sm font-semibold">
        Team size*
        <select
          className="input bg-[#0d0a1d]"
          value={form.team_size}
          onChange={(e) => setForm((f) => ({ ...f, team_size: e.target.value }))}
          required
        >
          <option value="" disabled>
            Select team size
          </option>
          <option>1-5</option>
          <option>6-20</option>
          <option>21-50</option>
          <option>51-200</option>
          <option>200+</option>
        </select>
      </label>
      <label className="space-y-1 text-sm font-semibold">
        What do you want to automate?*
        <textarea
          className="input min-h-[120px]"
          value={form.goals}
          onChange={(e) => setForm((f) => ({ ...f, goals: e.target.value }))}
          required
          placeholder="e.g., Multilingual support, proactive outreach, service routing"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-gradient-to-r from-indigo-400 via-sky-400 to-emerald-300 px-4 py-3 text-sm font-bold text-black shadow-lg disabled:opacity-60"
      >
        {pending ? 'Submitting…' : 'Request demo'}
      </button>
      {status && <p className="text-sm text-emerald-300">{status}</p>}
    </form>
  );
}
