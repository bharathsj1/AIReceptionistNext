import React from 'react';
import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="border-t border-white/10 bg-[#08061a]/90 py-8" id="footer">
      <div className="container mx-auto grid gap-6 px-4 md:grid-cols-4">
        <div className="space-y-3">
          <div className="text-xl font-extrabold">SmartConnect4U</div>
          <p className="text-white/70">Automation you can trust to keep customers and operations moving.</p>
          <div className="flex gap-3 text-white/70">
            <a href="#" aria-label="LinkedIn">
              in
            </a>
            <a href="#" aria-label="Twitter">
              𝕏
            </a>
            <a href="#" aria-label="YouTube">
              ▶
            </a>
          </div>
        </div>
        <div>
          <h4 className="font-semibold">Services</h4>
          <ul className="space-y-1 text-white/70">
            <li>
              <a href="/#services">AI Call Answering</a>
            </li>
            <li>
              <a href="/#services">AI Invoice Creation</a>
            </li>
            <li>
              <a href="/#services">AI Social Media</a>
            </li>
          </ul>
        </div>
        <div>
          <h4 className="font-semibold">Solutions</h4>
          <ul className="space-y-1 text-white/70">
            <li>
              <a href="/#process">How it works</a>
            </li>
            <li>
              <Link href="/payment">Packages</Link>
            </li>
            <li>
              <a href="/#benefits">Benefits</a>
            </li>
          </ul>
        </div>
        <div>
          <h4 className="font-semibold">Company</h4>
          <ul className="space-y-1 text-white/70">
            <li>
              <a href="/#about">About</a>
            </li>
            <li>
              <a href="/#contact">Get Started</a>
            </li>
          </ul>
        </div>
      </div>
      <div className="container mx-auto flex flex-wrap items-center justify-between gap-3 px-4 pt-6 text-sm text-white/60">
        <p>©2025 SmartConnect4U. All trademarks are property of their respective owners.</p>
        <div className="flex gap-3">
          <a href="#">Privacy Policy</a>
          <a href="#">Terms of Service</a>
          <a href="#">Intellectual Property Rights</a>
        </div>
      </div>
    </footer>
  );
}
