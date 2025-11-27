import React from 'react';

export default function BookingsList() {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {['Consultation', 'Follow-up', 'Demo'].map((type) => (
        <article key={type} className="booking-card">
          <h3 className="text-lg font-semibold">{type}</h3>
          <p className="booking-meta">No bookings yet</p>
          <div className="tag-row">
            <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/70">Calendar</span>
          </div>
        </article>
      ))}
    </div>
  );
}
