'use client';

import Header from '@/components/Header';
import Footer from '@/components/Footer';
import React, { useState } from 'react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <>
      <Header />
      <main className="py-16">
        <section className="container mx-auto px-4">
          <div className="mx-auto max-w-lg space-y-4 rounded-2xl border border-white/10 bg-white/5 p-6 shadow-2xl">
            <h1 className="text-2xl font-bold">Sign in to your account</h1>
            <p className="text-white/70">Access your AI receptionist dashboard</p>
            <form className="space-y-4">
              <label className="space-y-1 text-sm font-semibold text-white/90">
                Email address
                <div className="flex items-center rounded-xl border border-white/10 bg-white/5 px-3">
                  <span className="text-white/60">✉</span>
                  <input
                    type="email"
                    className="w-full bg-transparent px-3 py-3 text-white outline-none"
                    placeholder="contact@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              </label>
              <label className="space-y-1 text-sm font-semibold text-white/90">
                Password
                <div className="flex items-center rounded-xl border border-white/10 bg-white/5 px-3">
                  <span className="text-white/60">🔒</span>
                  <input
                    type="password"
                    className="w-full bg-transparent px-3 py-3 text-white outline-none"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
              </label>
              <div className="flex items-center justify-between text-sm text-white/70">
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="h-4 w-4 rounded border-white/20 bg-transparent" />
                  Remember me
                </label>
                <a href="#" className="text-emerald-300">
                  Forgot password?
                </a>
              </div>
              <button
                type="submit"
                className="w-full rounded-xl bg-gradient-to-r from-indigo-400 via-sky-400 to-emerald-300 px-4 py-3 text-center text-sm font-bold text-black shadow-lg"
              >
                Sign In
              </button>
              <p className="text-center text-sm text-white/70">
                Don’t have an account?{' '}
                <a href="/create-account" className="text-emerald-300">
                  Create one
                </a>
              </p>
            </form>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
