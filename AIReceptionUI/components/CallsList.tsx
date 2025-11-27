import React from 'react';

export default function CallsList() {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {['Call Reasoning', 'Scheduling', 'Support'].map((reason) => (
        <article key={reason} className="call-card">
          <h3 className="text-lg font-semibold">{reason}</h3>
          <p className="call-meta">No calls yet</p>
          <div className="tag-row">
            <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/70">AI Receptionist</span>
          </div>
        </article>
      ))}
    </div>
  );
}

