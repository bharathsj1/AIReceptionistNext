export default function DashboardScreen({
  activeTab,
  setActiveTab,
  ranges,
  dateRange,
  setDateRange,
  aiNumber,
  recentCalls,
  user,
  agentDetails,
  setAgentDetails,
  handleGoHome,
  calendarStatus,
  calendarLoading,
  calendarEvents,
  calendarError,
  loadCalendarEvents,
  handleCalendarDisconnect,
  beginGoogleLogin,
  status
}) {
  return (
    <section className="dashboard-shell">
      <aside className="dash-nav">
        <div className="nav-brand">
          <span className="brand-mark">AI</span>
          <div>
            <div className="brand-name">Reception</div>
            <div className="tag pill">User</div>
          </div>
        </div>
        <nav className="nav-list">
          <button className={`nav-item ${activeTab === "dashboard" ? "active" : ""}`} onClick={() => setActiveTab("dashboard")}>
            Dashboard
          </button>
          <button className={`nav-item ${activeTab === "calls" ? "active" : ""}`} onClick={() => setActiveTab("calls")}>
            Calls
          </button>
          <button className={`nav-item ${activeTab === "bookings" ? "active" : ""}`} onClick={() => setActiveTab("bookings")}>
            Bookings
          </button>
          <button className={`nav-item ${activeTab === "business" ? "active" : ""}`} onClick={() => setActiveTab("business")}>
            My Business
          </button>
          <button className={`nav-item ${activeTab === "settings" ? "active" : ""}`} onClick={() => setActiveTab("settings")}>
            Receptionist Settings
          </button>
          <button className={`nav-item ${activeTab === "routing" ? "active" : ""}`} onClick={() => setActiveTab("routing")}>
            Call Routing
          </button>
        </nav>
        <div className="nav-user">
          <div className="avatar">U</div>
          <div>
            <div className="nav-user-name">{user?.name || "You"}</div>
            <div className="hint">{user?.email || "user@example.com"}</div>
          </div>
        </div>
      </aside>
      <div className="dash-main">
        <div className="dash-topbar">
          <div className="top-actions">
            <div className="dropdown">
              <button className="ghost small dropdown-toggle">
                <span role="img" aria-label="calendar">📅</span> {dateRange}
              </button>
              <div className="dropdown-menu">
                {ranges.map((range) => (
                  <button
                    key={range}
                    className={`dropdown-item ${range === dateRange ? "active" : ""}`}
                    onClick={() => setDateRange(range)}
                  >
                    {range}
                    {range === dateRange && <span className="check">✓</span>}
                  </button>
                ))}
              </div>
            </div>
            <div className="ai-number">
              <span className="label">AI Number</span>
              <span className="value number-link">{aiNumber}</span>
              <span className="status-dot" aria-label="online" />
            </div>
          </div>
        </div>

        <div className="dashboard-header">
          <div>
            <p className="eyebrow">Dashboard & Analytics</p>
            <h2>Monitor calls and agent performance</h2>
            <p className="lead narrow">
              Track your receptionist, tune prompts, and keep admins in the loop.
            </p>
          </div>
        </div>

        {activeTab === "dashboard" && (
          <>
            <div className="card">
              <div className="card-header">
                <h3>Recent Calls</h3>
                <button className="text-link">View all calls</button>
              </div>
              <div className="table">
                <div className="table-head">
                  <span>Start Time</span>
                  <span>Caller</span>
                  <span>Phone</span>
                  <span>Duration</span>
                  <span>Call Reason</span>
                  <span>Lead Score</span>
                  <span>Action</span>
                </div>
                {recentCalls.length === 0 ? (
                  <div className="table-empty">
                    No calls yet — incoming calls will appear here.
                  </div>
                ) : (
                  recentCalls.map((call) => (
                    <div className="table-row" key={call.id}>
                      <span>{call.startTime}</span>
                      <span>{call.caller}</span>
                      <span>{call.phone}</span>
                      <span>{call.duration}</span>
                      <span>{call.reason}</span>
                      <span>{call.score}</span>
                      <button className="ghost small">View</button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="card-grid">
              <div className="card">
                <h3>Call Reasons</h3>
                <p className="hint">Last 14 days</p>
                <div className="empty-state">
                  <div className="icon">📊</div>
                  <p>Reasons will populate after your first calls.</p>
                </div>
              </div>
              <div className="card">
                <h3>Daily Call Volume</h3>
                <p className="hint">Last 14 days</p>
                <div className="empty-state">
                  <div className="icon">📈</div>
                  <p>Call trends will display here.</p>
                </div>
              </div>
            </div>

            <div className="card-grid metrics">
              <div className="metric-card">
                <div>
                  <p className="hint">Total Calls</p>
                  <div className="metric-value">0</div>
                  <p className="hint">Last 14 days</p>
                </div>
                <div className="metric-icon">📞</div>
              </div>
              <div className="metric-card">
                <div>
                  <p className="hint">Average Call Length</p>
                  <div className="metric-value">0:00</div>
                  <p className="hint">Last 14 days</p>
                </div>
                <div className="metric-icon">⏱</div>
              </div>
              <div className="metric-card">
                <div>
                  <p className="hint">Total Minutes</p>
                  <div className="metric-value">0</div>
                  <p className="hint">Last 14 days</p>
                </div>
                <div className="metric-icon">⏲</div>
              </div>
            </div>
          </>
        )}

        {activeTab === "settings" && (
          <div className="card-grid wide">
            <div className="panel">
              <h3>Receptionist settings</h3>
              <label>Agent name</label>
              <input
                type="text"
                value={agentDetails.agentName}
                onChange={(e) => setAgentDetails({ ...agentDetails, agentName: e.target.value })}
              />
              <label>Greeting</label>
              <textarea
                rows={3}
                value={agentDetails.greeting}
                onChange={(e) => setAgentDetails({ ...agentDetails, greeting: e.target.value })}
              />
              <label>Escalation rule</label>
              <textarea
                rows={2}
                value={agentDetails.escalation}
                onChange={(e) => setAgentDetails({ ...agentDetails, escalation: e.target.value })}
              />
              <label>FAQs</label>
              <textarea
                rows={3}
                value={agentDetails.faq}
                onChange={(e) => setAgentDetails({ ...agentDetails, faq: e.target.value })}
              />
              <div className="button-row">
                <button className="ghost small" type="button" onClick={handleGoHome}>
                  ← Back to home
                </button>
                <button className="primary" type="button">
                  Save changes
                </button>
              </div>
            </div>
            <div className="panel admin-panel">
              <h3>Admin oversight</h3>
              <p className="hint">Admins can review all agents and monitor edits.</p>
              <div className="admin-table">
                <div className="admin-row header">
                  <span>User</span>
                  <span>Agent</span>
                  <span>Status</span>
                </div>
                {["Alex", "Jordan", "Sam"].map((userRow) => (
                  <div className="admin-row" key={userRow}>
                    <span>{userRow}</span>
                    <span>Ultravox Concierge</span>
                    <span className="pill">Active</span>
                  </div>
                ))}
              </div>
              <div className="admin-actions">
                <button className="ghost small" type="button">Switch to admin view</button>
                <button className="ghost small" type="button">Monitor changes</button>
              </div>
            </div>
          </div>
        )}

        {activeTab === "calls" && (
          <div className="card">
            <div className="card-header">
              <h3>Calls</h3>
            </div>
            <div className="table">
              <div className="table-head">
                <span>Start Time</span>
                <span>Caller</span>
                <span>Phone</span>
                <span>Duration</span>
                <span>Reason</span>
                <span>Outcome</span>
              </div>
              <div className="table-empty">No calls yet.</div>
            </div>
          </div>
        )}

        {activeTab === "bookings" && (
          <div className="card">
            <h3>Bookings</h3>
            <p className="hint">Connect your calendar so your AI Receptionist can share availability and take bookings.</p>
            {!calendarStatus ? (
              <div className="calendar-connect">
                <div className="calendar-header">
                  <div className="bubble">💬</div>
                  <div>
                    <h4>Your AI Receptionist takes messages</h4>
                    <p className="hint">
                      Your AI gathers customer details and lets them know you'll get back to them. You then call or text them back yourself.
                    </p>
                  </div>
                </div>
                <div className="calendar-body">
                  <h4>Ready to connect your calendar?</h4>
                  <p className="lead narrow">
                    Use Google to authenticate and we will pull a read-only view of your upcoming events.
                  </p>
                  <div className="calendar-options">
                    <button className="calendar-card" onClick={beginGoogleLogin} disabled={status === "loading"}>
                      <span className="icon">📆</span>
                      <span className="title">Connect Google Calendar</span>
                    </button>
                    <button className="calendar-card" disabled>
                      <span className="icon">📧</span>
                      <span className="title">Outlook (soon)</span>
                    </button>
                  </div>
                  <p className="hint">Takes about 30 seconds</p>
                  {calendarError && <div className="status error inline">{calendarError}</div>}
                </div>
                <div className="calendar-footnotes">
                  <span>🔒 Read-only. Your AI can check availability but cannot modify your calendar.</span>
                  <span>👁 Private. Only free/busy status is visible, not event details.</span>
                </div>
              </div>
            ) : (
              <div className="calendar-success">
                <div className="bubble success">✓</div>
                <div>
                  <h4>Connected to {calendarStatus}</h4>
                  <p className="hint">Your AI can now share availability and accept bookings.</p>
                  {calendarLoading ? (
                    <div className="loader small calendar-loader">
                      <span />
                      <span />
                      <span />
                    </div>
                  ) : calendarEvents.length === 0 ? (
                    <div className="empty-state">
                      <div className="icon">🗓</div>
                      <p>No upcoming events found.</p>
                    </div>
                  ) : (
                    <div className="calendar-events">
                      {calendarEvents.map((event) => (
                        <div className="event-row" key={event.id}>
                          <div>
                            <div className="event-title">{event.summary || "No title"}</div>
                            <div className="hint">
                              {event.start?.dateTime || event.start?.date} → {event.end?.dateTime || event.end?.date}
                            </div>
                          </div>
                          <div className="pill">Google</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="calendar-actions">
                  <button className="ghost small" onClick={() => loadCalendarEvents()}>
                    Refresh
                  </button>
                  <button className="ghost small" onClick={handleCalendarDisconnect}>
                    Disconnect
                  </button>
                </div>
                {calendarError && <div className="status error inline">{calendarError}</div>}
              </div>
            )}
          </div>
        )}

        {activeTab === "business" && (
          <div className="card">
            <h3>My Business</h3>
            <div className="empty-state">
              <div className="icon">🏢</div>
              <p>Configure business info, hours, and teams.</p>
            </div>
          </div>
        )}

        {activeTab === "routing" && (
          <div className="card">
            <h3>Call Routing</h3>
            <div className="empty-state">
              <div className="icon">🔀</div>
              <p>Set routing rules and fallbacks.</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
