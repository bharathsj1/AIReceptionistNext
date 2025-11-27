'use client';

import { Suspense } from 'react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import TestCallCard from '@/components/TestCallCard';

function TestCallPageContent() {
  return (
    <>
      <Header />
      <main className="py-16">
        <section className="container mx-auto px-4">
          <TestCallCard />
        </section>
      </main>
      <Footer />
    </>
  );
}

export default function TestCallPage() {
  return (
    <Suspense fallback={null}>
      <TestCallPageContent />
    </Suspense>
  );
}
