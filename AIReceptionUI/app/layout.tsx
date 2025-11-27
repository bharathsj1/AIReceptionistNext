import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SmartConnect4U | AI Receptionist',
  description: 'AI tools for business automation that work like part of your team.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gradient-to-b from-[#0d1021] via-[#0b0f1c] to-[#0a0c18] text-slate-100 font-sans">
        {children}
      </body>
    </html>
  );
}
