'use client';

import { Suspense } from 'react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import DashboardShell from '@/components/DashboardShell';

function DashboardPageContent() {
  return (
    <>
      <Header />
      <DashboardShell />
      <Footer />
    </>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <DashboardPageContent />
    </Suspense>
  );
}
