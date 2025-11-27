'use client';

import { Suspense } from 'react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import ReadyForm from '@/components/ReadyForm';

function ReadyPageContent() {
  return (
    <>
      <Header />
      <main className="py-16">
        <section className="container mx-auto px-4">
          <ReadyForm />
        </section>
      </main>
      <Footer />
    </>
  );
}

export default function ReadyPage() {
  return (
    <Suspense fallback={null}>
      <ReadyPageContent />
    </Suspense>
  );
}
