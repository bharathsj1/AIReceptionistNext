'use client';

import Header from '@/components/Header';
import Footer from '@/components/Footer';
import ReadyForm from '@/components/ReadyForm';

export default function ReadyPage() {
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
