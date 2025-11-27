import React from 'react';

export default function SectionShell({
  id,
  title,
  pill,
  children,
}: {
  id?: string;
  title: string;
  pill?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="py-12">
      <div className="container mx-auto space-y-4 px-4">
        <div className="space-y-2 text-center">
          {pill && (
            <div className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-white/70">
              {pill}
            </div>
          )}
          <h2 className="text-3xl font-bold">{title}</h2>
        </div>
        {children}
      </div>
    </section>
  );
}
