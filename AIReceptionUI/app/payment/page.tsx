'use client';

import Header from '@/components/Header';
import Footer from '@/components/Footer';
import React, { Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';

const plans = {
  bronze: { name: 'Bronze', price: '$500/month' },
  silver: { name: 'Silver', price: '$600/month' },
  gold: { name: 'Gold', price: '$700/month' },
  platinum: { name: 'Platinum', price: 'Custom' },
};

export default function PaymentPage() {
  return (
    <Suspense fallback={null}>
      <PaymentContent />
    </Suspense>
  );
}

function PaymentContent() {
  const params = useSearchParams();
  const planKey = (params.get('plan') || 'gold').toLowerCase();
  const plan = useMemo(() => plans[planKey as keyof typeof plans] || plans.gold, [planKey]);

  return (
    <>
      <Header />
      <main className="py-12">
        <section className="container mx-auto px-4">
          <div className="payment-shell space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h1 className="text-2xl font-bold">Checkout</h1>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-white/80">
                {plan.name} plan
              </span>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <form className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4 md:col-span-2">
                <h2 className="text-xl font-semibold">Billing details</h2>
                <input className="input" placeholder="Full name" required />
                <input className="input" placeholder="Email" type="email" required />
                <input className="input" placeholder="Company" />
                <div className="grid gap-3 md:grid-cols-2">
                  <input className="input" placeholder="Card number" required />
                  <input className="input" placeholder="MM/YY" required />
                </div>
                <button className="w-full rounded-xl bg-gradient-to-r from-indigo-400 via-sky-400 to-emerald-300 px-4 py-3 text-sm font-bold text-black shadow-lg">
                  Pay now
                </button>
              </form>
              <aside className="order-summary space-y-3">
                <h2 className="text-lg font-semibold">Order summary</h2>
                <div className="text-3xl font-extrabold">{plan.price}</div>
                <p className="text-white/70">Predictable monthly fees. Scale up or down.</p>
              </aside>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
