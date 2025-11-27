import React from 'react';
import Link from 'next/link';

export default function DashboardShell() {
  return (
    <div className="dash-layout">
      <aside className="dash-sidebar">
        <div className="dash-brand">
          <span className="text-lg font-bold">SmartConnect4U</span>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">Free trial</span>
        </div>
        <nav className="dash-nav">
          <Link className="dash-link active" href="/dashboard">
            ▣ Dashboard
          </Link>
          <Link className="dash-link" href="/calls">
            📞 Calls
          </Link>
          <Link className="dash-link" href="/bookings">
            📅 Bookings
          </Link>
          <Link className="dash-link" href="#">
            🏢 My Business
          </Link>
          <Link className="dash-link" href="#">
            🤖 Receptionist Settings
          </Link>
          <Link className="dash-link" href="#">
            🔀 Call Routing
          </Link>
        </nav>
      </aside>
      <main className="dash-main space-y-4">
        <header className="dash-top">
          <div className="promo">⚡ Limited Time: Subscribe now & save 20% forever</div>
          <button className="rounded-xl bg-gradient-to-r from-indigo-400 via-sky-400 to-emerald-300 px-4 py-2 text-sm font-bold text-black shadow-lg">
            Upgrade Now →
          </button>
        </header>
        <section className="dash-header-row">
          <div>
            <h1 className="text-2xl font-bold">Dashboard & Analytics</h1>
            <p className="text-white/70">Monitor your AI receptionist&apos;s performance and call insights.</p>
          </div>
          <div className="dash-filters">
            <button className="filter-btn">Last 14 days ▾</button>
            <div className="ai-number">
              AI Number: <a className="text-emerald-300" href="tel:07426407308">07426407308</a>{' '}
              <span className="status-dot inline-block" aria-hidden="true" />
            </div>
          </div>
        </section>
        <section className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-xl">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Recent Calls</h3>
            <a className="text-emerald-300" href="#">
              View all calls
            </a>
          </div>
          <div className="table">
            <div className="table-head">
              <span>Start Time</span>
              <span>Caller Name</span>
              <span>Phone Number</span>
              <span>Duration</span>
              <span>Call Reason</span>
              <span>Lead Score</span>
              <span>Action Required</span>
              <span>View</span>
            </div>
            <div className="table-empty">No calls yet — when calls come in, the most recent ones will be displayed here.</div>
          </div>
        </section>
        <section className="dash-grid">
          <article className="card">
            <div className="card-head">
              <h3>Call Reasons</h3>
              <span className="muted-label">Last 14 days</span>
            </div>
            <div className="chart-empty">Call categorisation will appear after your first calls</div>
          </article>
          <article className="card">
            <div className="card-head">
              <h3>Daily Call Volume</h3>
              <span className="muted-label">Last 14 days</span>
            </div>
            <div className="chart-empty">Your call trends will display here</div>
          </article>
        </section>
        <section className="dash-stats">
          {['Total Calls', 'Average Call Length', 'Total Minutes'].map((label) => (
            <div key={label} className="stat-card">
              <p className="stat-label">{label}</p>
              <p className="stat-value">0</p>
              <p className="muted-label">Last 14 days</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
