'use client';

import { Suspense } from 'react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import CallsList from '@/components/CallsList';

function CallsPageContent() {
  return (
    <>
      <Header />
      <main className="py-12">
        <section className="container mx-auto space-y-4 px-4">
          <h1 className="text-2xl font-bold">Calls</h1>
          <CallsList />
        </section>
      </main>
      <Footer />
    </>
  );
}

export default function CallsPage() {
  return (
    <Suspense fallback={null}>
      <CallsPageContent />
    </Suspense>
  );
}
