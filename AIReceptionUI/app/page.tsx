'use client';

import React from 'react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Hero from '@/components/Hero';
import SectionShell from '@/components/SectionShell';
import Pricing from '@/components/Pricing';
import ContactForm from '@/components/ContactForm';

const services = [
  {
    title: 'AI Call Answering',
    desc:
      'Our AI receptionist picks up every call and follows your script exactly. It books appointments, answers questions, collects details and routes enquiries to the right place — even when your team is busy or offline.',
    img: 'https://images.unsplash.com/photo-1525182008055-f88b95ff7980?auto=format&fit=crop&w=800&q=80',
  },
  {
    title: 'AI Invoice Creation',
    desc:
      'Invoices write themselves. AI pulls client details, calculates totals, applies taxes and sends fully-formatted invoices automatically. No missed payments, no manual errors, no late nights fixing numbers.',
    img: 'https://images.unsplash.com/photo-1454165205744-3b78555e5572?auto=format&fit=crop&w=900&q=80',
  },
  {
    title: 'AI Social Media Management',
    desc:
      'Stay active online without logging in. AI writes posts that match your tone, schedules them, and adjusts based on engagement data — so your brand keeps growing while you focus on core operations.',
    img: 'https://images.unsplash.com/photo-1521791136064-7986c2920216?auto=format&fit=crop&w=800&q=80',
  },
];

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
      <Hero />
      <main className="space-y-16">
        <SectionShell id="services" title="AI business support that handles the admin you shouldn’t have to">
          <div className="grid gap-6 md:grid-cols-3">
            {services.map((svc) => (
              <article key={svc.title} className="rounded-2xl border border-white/10 bg-white/5 shadow-xl">
                <img src={svc.img} alt={svc.title} className="h-44 w-full rounded-2xl object-cover" />
                <div className="p-5 space-y-3">
                  <div className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-white/70">
                    {svc.title}
                  </div>
                  <h3 className="text-xl font-semibold">{svc.title}</h3>
                  <p className="text-white/70">{svc.desc}</p>
                  <a className="font-semibold text-emerald-300" href="#contact">
                    Learn more
                  </a>
                </div>
              </article>
            ))}
          </div>
        </SectionShell>

        <SectionShell id="process" pill="Process" title="How SmartConnect4U works">
          <div className="grid gap-4 md:grid-cols-4">
            {processSteps.map((step, idx) => (
              <div key={step.title} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-lg font-extrabold text-indigo-300">0{idx + 1}</div>
                <h3 className="text-lg font-semibold">{step.title}</h3>
                <p className="text-white/70">{step.desc}</p>
              </div>
            ))}
          </div>
        </SectionShell>

        <Pricing />

        <SectionShell id="benefits" title="AI tools for business automation — how you benefit">
          <div className="grid gap-4 md:grid-cols-3">
            {benefits.map((b) => (
              <div key={b.title} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <h3 className="text-lg font-semibold">{b.title}</h3>
                <p className="text-white/70">{b.desc}</p>
              </div>
            ))}
          </div>
        </SectionShell>

        <SectionShell id="contact" pill="Let’s talk" title="Speak with an automation specialist">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-3">
              <p className="text-emerald-300">Priority onboarding · Human-in-the-loop · 24/7 monitoring</p>
              <p className="text-white/70">
                Share your goals and we’ll design a tailored rollout plan. One AI receptionist orchestrates calls,
                invoices, and social replies while you stay focused on clients.
              </p>
            </div>
            <ContactForm />
          </div>
        </SectionShell>
      </main>
      <Footer />
    </>
  );
}
