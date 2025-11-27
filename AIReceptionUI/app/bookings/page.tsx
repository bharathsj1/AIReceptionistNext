'use client';

import { Suspense } from 'react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import BookingsList from '@/components/BookingsList';

function BookingsPageContent() {
  return (
    <>
      <Header />
      <main className="py-12">
        <section className="container mx-auto space-y-4 px-4">
          <h1 className="text-2xl font-bold">Bookings</h1>
          <BookingsList />
        </section>
      </main>
      <Footer />
    </>
  );
}

export default function BookingsPage() {
  return (
    <Suspense fallback={null}>
      <BookingsPageContent />
    </Suspense>
  );
}
