'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

const navLinks = [
  { label: 'Services', href: '/#services' },
  { label: 'How it Works', href: '/#process' },
  { label: 'Packages', href: '/payment' },
  { label: 'Benefits', href: '/#benefits' },
  { label: 'Company', href: '/#footer' },
];

export default function Header() {
  const pathname = usePathname();
  const params = useSearchParams();

  React.useEffect(() => {
    const hash = window.location.hash;
    if (hash) {
      const target = document.getElementById(hash.slice(1));
      if (target) target.scrollIntoView({ behavior: 'smooth' });
    }
  }, [pathname, params]);

  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-[#08061a]/80 backdrop-blur">
      <div className="container mx-auto flex items-center justify-between gap-4 px-4 py-4">
        <Link href="/" className="text-xl font-extrabold">
          SmartConnect4U
        </Link>
        <nav>
          <ul className="flex items-center gap-4 text-sm font-semibold text-white/70">
            {navLinks.map((link) => (
              <li key={link.label}>
                <Link href={link.href} className="hover:text-white">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex items-center gap-2 text-sm font-bold">
          <Link className="rounded-xl border border-white/10 px-3 py-2 text-white/80 hover:text-white" href="/login">
            Login
          </Link>
          <Link className="rounded-xl border border-white/10 px-3 py-2 text-white/80 hover:text-white" href="/#contact">
            Chat with Us
          </Link>
          <Link
            className="rounded-xl bg-gradient-to-r from-indigo-400 via-sky-400 to-emerald-300 px-4 py-2 text-black shadow-lg"
            href="/#contact"
          >
            Get Started
          </Link>
        </div>
      </div>
    </header>
  );
}
