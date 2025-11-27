'use client';

import Header from '@/components/Header';
import Footer from '@/components/Footer';
import TestCallCard from '@/components/TestCallCard';

export default function TestCallPage() {
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
