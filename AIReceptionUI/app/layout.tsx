import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SmartConnect4U | AI Receptionist',
  description: 'AI tools for business automation that work like part of your team.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#030212] text-[#e7e7ff] font-sans">{children}</body>
    </html>
  );
}
