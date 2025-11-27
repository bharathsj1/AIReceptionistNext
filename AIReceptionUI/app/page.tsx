'use client';

import React from 'react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Pricing from '@/components/Pricing';
import ContactForm from '@/components/ContactForm';
import ScreenshotsStrip from '@/components/ScreenshotsStrip';
import FeaturesGrid from '@/components/FeaturesGrid';
import StatsSection from '@/components/StatsSection';
import CTASection from '@/components/CTASection';
import ReceptionistAnimation from '@/components/ReceptionistAnimation';

const processSteps = [
  { title: 'Select what to automate', desc: 'We identify the tasks causing the most friction, costs or delays.' },
  { title: 'Provide your inputs', desc: 'AI learns your pricing, tone and workflow before activating.' },
  { title: 'We configure everything', desc: 'The system runs without heavy setup. You stay focused on customers.' },
  { title: 'Operate with more capacity', desc: 'Admin is handled automatically, with human support on demand.' },
];

const benefits = [
  {
    title: 'Operating costs drop without cutting quality',
    desc:
      "Admin work doesn't need a salary. When AI does it, you reduce payroll and overhead without sacrificing service.",
  },
  {
    title: 'You gain hours that actually grow revenue',
    desc:
      'AI takes those jobs off your team. As the hours you earn back are used on sales, your team sees strategy instead of busywork.',
  },
  {
    title: 'Revenue stops slipping through the cracks',
    desc:
      'AI captures and acts on the first contact with customers instantly, collects information accurately, and keeps leads moving instead of drifting away.',
  },
  {
    title: 'Cash flow becomes more predictable',
    desc:
      "Automated invoicing removes delays caused by forgetfulness, poor handover or human bandwidth. Payments go out on time.",
  },
  {
    title: 'Your business looks more organized, not overstretched',
    desc:
      "When calls are answered cleanly, invoices are correct and social channels stay active, customers experience a business that runs smoothly.",
  },
  {
    title: "Growth doesn't require constant hiring",
    desc:
      "As demand increases, admin doesn't need to scale with it. Automation handles more of the same work with ease.",
  },
];

export default function HomePage() {
  return (
    <>
      <Header />
      <main className="mx-auto max-w-6xl space-y-12 px-4 pt-24 pb-10">
        {/* Hero area with dark/purple inspired aesthetic */}
        <section className="grid items-center gap-10 rounded-3xl bg-gradient-to-br from-[#161a2a] via-[#111524] to-[#0d101c] p-8 shadow-[0_25px_70px_rgba(0,0,0,0.45)] ring-1 ring-white/10 backdrop-blur lg:grid-cols-2">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full bg-purple-500/20 px-3 py-1 text-xs font-semibold text-purple-200">
              <span>Powered by AI</span>
              <span>•</span>
              <span>24/7</span>
            </div>
            <h1 className="text-4xl font-extrabold leading-tight text-white">
              AI tools for business automation that work like part of your team.
            </h1>
            <p className="text-lg text-slate-200">
              Turn your missed calls, messages, and social posts into automated tasks that run in the background — so you
              can focus on running the business.
            </p>
            <div className="flex flex-wrap gap-3">
              <a
                className="rounded-full bg-gradient-to-r from-purple-500 to-indigo-500 px-5 py-3 text-sm font-semibold text-white shadow-lg transition-all duration-200 hover:scale-105 hover:shadow-xl"
                href="#contact"
              >
                See how it works
              </a>
              <a
                className="rounded-full border border-white/10 px-5 py-3 text-sm font-semibold text-white transition-all duration-200 hover:scale-105 hover:border-white/40"
                href="#packages"
              >
                Discover packages
              </a>
            </div>
          </div>
          {/* Faux app card */}
          <div className="relative">
            <div className="absolute -left-6 -top-6 h-12 w-12 rounded-full bg-purple-500 blur-2xl opacity-60" />
            <div className="absolute -right-8 -bottom-8 h-16 w-16 rounded-full bg-indigo-400 blur-3xl opacity-50" />
            <div className="relative rounded-2xl bg-[#0f1220] p-6 shadow-2xl ring-1 ring-white/10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-purple-500 to-indigo-500 text-lg text-white">
                    🤖
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">Reception Dashboard</p>
                    <p className="text-xs text-slate-300 flex items-center gap-2">
                      <span className="relative inline-flex h-2 w-2 items-center justify-center">
                        <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-300" />
                      </span>
                      Live • Auto-routing
                    </p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <span className="h-2 w-2 rounded-full bg-white/40" />
                  <span className="h-2 w-2 rounded-full bg-white/40" />
                  <span className="h-2 w-2 rounded-full bg-white/40" />
                </div>
              </div>
              <div className="mt-6 space-y-3">
                <div className="flex items-center justify-between rounded-xl bg-gradient-to-r from-purple-500/20 to-indigo-400/20 p-3 ring-1 ring-white/10">
                  <div>
                    <p className="text-sm font-semibold text-white">Incoming call</p>
                    <p className="text-xs text-slate-200">Booking request · Plumbing</p>
                  </div>
                  <div className="flex gap-2">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-emerald-500 text-white shadow transition-transform duration-150 hover:scale-105">
                      📞
                    </span>
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-rose-500 text-white shadow transition-transform duration-150 hover:scale-105">
                      📵
                    </span>
                  </div>
                </div>
                <div className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
                  <p className="text-xs uppercase tracking-[0.1em] text-slate-300">Assistant Notes</p>
                  <p className="mt-1 text-sm text-slate-100">
                    Caller asked for availability tomorrow at 3PM. Wants a quote emailed. Prefers SMS confirmation.
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-xl bg-gradient-to-r from-purple-500 to-indigo-500 p-3 text-white shadow">
                    <p className="text-xs uppercase tracking-[0.1em]">Routes</p>
                    <p className="text-sm font-semibold">Sales • Billing • Emergencies</p>
                  </div>
                  <div className="rounded-xl bg-white/5 p-3 shadow-inner ring-1 ring-white/10">
                    <p className="text-xs uppercase tracking-[0.1em] text-slate-300">Next actions</p>
                    <p className="text-sm text-slate-100">Send quote · Confirm slot · Sync calendar</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Screenshot strip */}
        <section className="rounded-3xl bg-[#111524] p-6 shadow-2xl ring-1 ring-white/10">
          <div className="mb-4 flex items-center justify-between text-white">
            <h2 className="text-2xl font-bold">Product views</h2>
            <span className="text-sm text-slate-300">Preview of your AI receptionist in action</span>
          </div>
          <ScreenshotsStrip />
        </section>

        {/* Stats */}
        <StatsSection />

        {/* Features */}
        <section className="rounded-3xl bg-[#111524] p-6 shadow-2xl ring-1 ring-white/10">
          <div className="mb-4 flex items-center justify-between text-white">
            <h2 className="text-2xl font-bold">What you get</h2>
            <span className="text-sm text-slate-300">Built from your existing workflows</span>
          </div>
          <FeaturesGrid />
        </section>

        {/* Process */}
        <section className="rounded-3xl bg-[#111524] p-6 shadow-2xl ring-1 ring-white/10">
          <h3 className="text-2xl font-bold text-white">How SmartConnect4U works</h3>
          <div className="mt-4 grid gap-4 md:grid-cols-4">
            {processSteps.map((step, idx) => (
              <div key={step.title} className="rounded-2xl bg-slate-50 p-4 shadow-inner ring-1 ring-slate-100">
                <div className="text-lg font-extrabold text-purple-500">0{idx + 1}</div>
                <h4 className="text-lg font-semibold text-slate-900">{step.title}</h4>
                <p className="text-sm text-slate-600">{step.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Animation section retained */}
        <section className="rounded-3xl bg-[#111524] p-6 shadow-2xl ring-1 ring-white/10">
          <div className="grid items-center gap-10 md:grid-cols-2">
            <div className="flex justify-center">
              <ReceptionistAnimation />
            </div>
            <div className="space-y-4">
              <h2 className="text-3xl font-bold text-white">A live, always-on receptionist</h2>
              <p className="text-slate-300">
                See how your AI receptionist greets callers, confirms details, and books appointments without missing a beat.
                The animation shows the breathing idle state, gentle phone motion, and live speech bubble updates that cycle
                through real responses.
              </p>
              <ul className="space-y-2 text-slate-200">
                <li>• Friendly, on-brand tone for every call</li>
                <li>• Subtle screen glow and handset motion to show active engagement</li>
                <li>• Smooth looping animation that stays lightweight and performant</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Benefits */}
        <section className="rounded-3xl bg-[#111524] p-6 shadow-2xl ring-1 ring-white/10">
          <h3 className="text-2xl font-bold text-white">AI tools for business automation — how you benefit</h3>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {benefits.map((b) => (
              <div key={b.title} className="rounded-2xl bg-white/5 p-4 shadow-inner ring-1 ring-white/10">
                <h4 className="text-lg font-semibold text-white">{b.title}</h4>
                <p className="text-sm text-slate-300">{b.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing (kept from existing content) */}
        <section id="packages" className="rounded-3xl bg-[#111524] p-6 shadow-2xl ring-1 ring-white/10">
          <Pricing />
        </section>

        {/* Contact */}
        <section id="contact" className="rounded-3xl bg-[#111524] p-6 shadow-2xl ring-1 ring-white/10">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-3">
              <p className="text-purple-300">Let’s talk</p>
              <h3 className="text-2xl font-bold text-white">Speak with an automation specialist</h3>
              <p className="text-slate-300">
                Share your goals and we’ll design a tailored rollout plan. One AI receptionist orchestrates calls,
                invoices, and social replies while you stay focused on clients.
              </p>
            </div>
            <ContactForm />
          </div>
        </section>

        <CTASection />
      </main>
      <Footer />
    </>
  );
}
