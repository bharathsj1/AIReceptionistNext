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
    <header className="absolute top-0 z-30 w-full bg-transparent">
      <div className="mx-auto flex w-[min(1000px,calc(100%-1.5rem))] items-center justify-center pt-3">
        <div className="flex w-full items-center justify-between rounded-full bg-[#141824]/70 px-4 py-1 shadow-lg backdrop-blur transition-all duration-200 hover:bg-[#141824]/90 hover:shadow-xl">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-full px-2 text-sm font-semibold text-white transition-colors duration-200 hover:bg-white/5"
          >
            <span className="h-7 w-7 rounded-full bg-gradient-to-br from-purple-500 to-indigo-500" />
            <span>SmartConnect4U</span>
          </Link>
          <nav className="hidden items-center gap-2 text-xs font-semibold text-slate-200 sm:flex">
            {navLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="rounded-full px-3 py-1 transition-all duration-200 hover:bg-gradient-to-r hover:from-purple-500/30 hover:to-indigo-500/30 hover:text-white"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2 text-sm font-bold">
            <Link
              className="hidden rounded-full bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-100 transition-all duration-200 hover:scale-105 hover:bg-gradient-to-r hover:from-purple-500/20 hover:to-indigo-500/20 sm:inline-flex"
              href="/login"
            >
              Login
            </Link>
            <Link
              className="hidden rounded-full bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-100 transition-all duration-200 hover:scale-105 hover:bg-gradient-to-r hover:from-purple-500/20 hover:to-indigo-500/20 sm:inline-flex"
              href="/#contact"
            >
              Chat with Us
            </Link>
            <Link
              className="rounded-full bg-gradient-to-r from-purple-500 to-indigo-500 px-4 py-1.5 text-xs font-semibold text-white shadow-lg transition-all duration-200 hover:scale-110 hover:shadow-[0_0_30px_rgba(129,140,248,0.45)]"
              href="/#contact"
            >
              Get Started
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
