'use client';

import { Suspense } from 'react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import OnboardingProgress from '@/components/OnboardingProgress';

function OnboardingPageContent() {
  return (
    <>
      <Header />
      <main className="py-16">
        <section className="container mx-auto px-4">
          <div className="onboarding-shell space-y-4">
            <h1 className="text-2xl font-bold">Setting up your AI Receptionist</h1>
            <OnboardingProgress />
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={null}>
      <OnboardingPageContent />
    </Suspense>
  );
}
