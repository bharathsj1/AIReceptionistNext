'use client';

import { Suspense } from 'react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import SignupForm from '@/components/SignupForm';

function CreateAccountPageContent() {
  return (
    <>
      <Header />
      <main className="py-16">
        <section className="container mx-auto grid gap-8 px-4 md:grid-cols-2">
          <div className="space-y-4">
            <a className="text-2xl font-extrabold" href="/">
              SmartConnect4U
            </a>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-2xl">
              <h1 className="text-2xl font-bold">What&apos;s your website?</h1>
              <p className="text-white/70">We&apos;ll tune your AI receptionist to your services and voice.</p>
              <SignupForm />
            </div>
          </div>
          <div className="space-y-4 rounded-2xl border border-white/10 bg-white/5 p-6 shadow-2xl">
            <h2 className="text-xl font-semibold">Stop losing jobs when you can&apos;t pick up the phone</h2>
            <p className="text-white/70">
              We set up your AI Receptionist so customers are always answered — even when you&apos;re busy on a job.
            </p>
            <div className="space-y-3">
              {[
                { title: 'We Check Your Website', desc: 'We read it to learn what you do and how to talk to your customers.' },
                { title: 'Always Answered 24/7', desc: "We talk to customers when you're busy, take details, and send them straight to you." },
                { title: 'Quick & Free to Try', desc: 'Takes less than a minute. No card needed. 7-day free trial.' },
              ].map((item) => (
                <article key={item.title} className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="text-lg text-emerald-300">✔</div>
                  <h3 className="text-lg font-semibold">{item.title}</h3>
                  <p className="text-white/70">{item.desc}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

export default function CreateAccountPage() {
  return (
    <Suspense fallback={null}>
      <CreateAccountPageContent />
    </Suspense>
  );
}
