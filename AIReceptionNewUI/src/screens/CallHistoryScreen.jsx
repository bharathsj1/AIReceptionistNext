import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  LoaderCircle,
  MessageSquareText,
  PhoneCall,
  RefreshCw,
  Search,
  Target,
  X,
} from "lucide-react";
import { outreachRequest } from "../lib/api/outreach";
import { SignInRequiredError } from "../lib/authSession";
import {
  CALL_OUTCOMES,
  CALL_STATUSES,
  callDate,
  callStatus,
  callDuration,
  readable,
  transcriptState,
} from "../lib/callHistory";
import { downloadCsv } from "../components/outreach/CampaignWizard";
import ConversationDrawer from "../components/outreach/ConversationDrawer";
import "./CallHistoryScreen.css";

const initialFilters = {
  q: "",
  campaign_id: "",
  status: "",
  outcome: "",
  from: "",
  to: "",
};
export default function CallHistoryScreen({
  user,
  campaigns = [],
  refreshKey,
  onAuthRequired,
}) {
  const [filters, setFilters] = useState(initialFilters);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [reload, setReload] = useState(0);
  const version = useRef(0);
  const userRef = useRef(user);
  userRef.current = user;
  const authRef = useRef(onAuthRequired);
  authRef.current = onAuthRequired;
  const pageSize = 25;
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((current) =>
        current.q === search.trim()
          ? current
          : { ...current, q: search.trim() },
      );
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const current = ++version.current;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
    });
    for (const [key, value] of Object.entries(filters))
      if (value) params.set(key, value);
    outreachRequest(`calls?${params}`, userRef.current)
      .then((response) => {
        if (current !== version.current) return;
        if (
          !response.items.length &&
          response.total &&
          page > Math.ceil(response.total / pageSize)
        ) {
          setPage(Math.ceil(response.total / pageSize));
          return;
        }
        setData(response);
      })
      .catch((err) => {
        if (current === version.current) {
          setError(err.message);
          if (err instanceof SignInRequiredError) authRef.current?.(err);
        }
      })
      .finally(() => {
        if (current === version.current) setLoading(false);
      });
    return () => {
      version.current += 1;
    };
  }, [filters, page, refreshKey, reload]);
  const update = (key) => (event) => {
    setFilters((current) => ({ ...current, [key]: event.target.value }));
    setPage(1);
  };
  const clear = () => {
    setSearch("");
    setFilters(initialFilters);
    setPage(1);
  };
  const filtered = Object.values(filters).some(Boolean) || !!search;
  const items = data?.items || [];
  const stats = data?.stats;
  const pages = Math.max(1, Math.ceil((data?.total || 0) / pageSize));
  const exportPage = () =>
    downloadCsv("vedora-call-history.csv", [
      [
        "business",
        "phone",
        "campaign",
        "started_at_utc",
        "ended_at_utc",
        "talk_time_seconds",
        "call_status",
        "owner_response",
        "transcript_status",
        "twilio_reference",
        "ultravox_reference",
      ],
      ...items.map((call) => [
        call.restaurant_name,
        call.phone,
        call.campaign_name,
        call.started_at,
        call.ended_at,
        call.duration_seconds,
        call.status,
        call.result?.outcome,
        call.transcript_status,
        call.twilio_call_sid,
        call.ultravox_call_id,
      ]),
    ]);
  return (
    <div className="call-history">
      <div className="call-history-intro">
        <span>
          <PhoneCall size={16} />
          Every attempt is saved, including unanswered and failed calls.
        </span>
        <span>
          <CheckCircle2 size={14} />
          Transcripts saved to your workspace
        </span>
      </div>
      <div
        className="calling-stats call-history-stats"
        aria-label="Filtered call history totals"
      >
        {[
          [PhoneCall, "Call attempts", stats?.total],
          [CheckCircle2, "Completed calls", stats?.completed],
          [Target, "Interested owners", stats?.interested],
          [FileText, "With transcripts", stats?.with_transcript],
        ].map(([Icon, title, value]) => (
          <article className="calling-stat" key={title}>
            <div>
              <span>{title}</span>
              <span className="calling-stat-icon tone-mint">
                <Icon size={16} />
              </span>
            </div>
            <strong>
              {loading || error ? "—" : Number(value || 0).toLocaleString()}
            </strong>
            <small>
              {filtered ? "Matching your filters" : "Across all campaigns"}
            </small>
          </article>
        ))}
      </div>
      <section className="calling-panel" aria-label="Call history records">
        <header className="calling-panel-heading">
          <div>
            <h2>
              Call history{" "}
              <span className="calling-count">
                {error ? "Unavailable" : (data?.total ?? "…")}
              </span>
            </h2>
            <p>
              Newest calls first. Open any record for the conversation, summary,
              and activity.
            </p>
          </div>
          <button
            className="calling-button"
            disabled={!items.length || loading || !!error}
            onClick={exportPage}
          >
            <ArrowDownToLine size={15} />
            Export page
          </button>
        </header>
        <div className="call-history-filters">
          <label className="calling-search">
            <Search size={16} />
            <input
              aria-label="Search call history"
              placeholder="Search business, phone, owner, campaign, or call reference…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              maxLength={200}
            />
          </label>
          <div className="call-history-selects">
            <label>
              <span>Campaign</span>
              <select
                aria-label="Filter calls by campaign"
                value={filters.campaign_id}
                onChange={update("campaign_id")}
              >
                <option value="">All campaigns</option>
                {campaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Call status</span>
              <select
                aria-label="Filter call history by status"
                value={filters.status}
                onChange={update("status")}
              >
                <option value="">All call statuses</option>
                {CALL_STATUSES.map((status) => (
                  <option value={status} key={status}>
                    {callStatus(status)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Owner response</span>
              <select
                aria-label="Filter calls by outcome"
                value={filters.outcome}
                onChange={update("outcome")}
              >
                <option value="">All responses</option>
                {CALL_OUTCOMES.map((outcome) => (
                  <option value={outcome} key={outcome}>
                    {outcome === "uncaptured"
                      ? "Not captured"
                      : readable(outcome)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>From · London</span>
              <input
                aria-label="Calls from date"
                type="date"
                value={filters.from}
                max={filters.to || undefined}
                onChange={update("from")}
              />
            </label>
            <label>
              <span>Until · London</span>
              <input
                aria-label="Calls until date"
                type="date"
                value={filters.to}
                min={filters.from || undefined}
                onChange={update("to")}
              />
            </label>
          </div>
          {filtered && (
            <button className="calling-text-button" onClick={clear}>
              <X size={13} />
              Clear filters
            </button>
          )}
        </div>
        {error && (
          <div
            className="calling-alert is-error call-history-error"
            role="alert"
          >
            {error}
            <button
              className="calling-text-button"
              onClick={() => setReload((value) => value + 1)}
            >
              Retry
            </button>
          </div>
        )}
        {loading && !data ? (
          <div className="calling-loading" role="status">
            <LoaderCircle className="spin" size={23} />
            Loading call history…
          </div>
        ) : error ? (
          <div className="calling-empty">
            <PhoneCall size={27} />
            <h3>Call history couldn’t be loaded</h3>
            <p>
              Use Retry to reconnect. No existing calls or transcripts are
              changed.
            </p>
          </div>
        ) : items.length ? (
          <>
            <div
              className="calling-table-scroll call-history-desktop"
              aria-busy={loading}
            >
              <table className="calling-table call-history-table">
                <thead>
                  <tr>
                    <th>Business / phone</th>
                    <th>Campaign</th>
                    <th>Started · London</th>
                    <th>Talk time</th>
                    <th>Call status</th>
                    <th>Owner response</th>
                    <th>Transcript</th>
                    <th>
                      <span className="sr-only">Open conversation</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((call) => {
                    const [transcriptLabel, transcriptClass] =
                      transcriptState(call);
                    return (
                      <tr key={call.id}>
                        <td>
                          <button
                            className="call-history-business"
                            onClick={() => setSelected(call)}
                          >
                            <strong>{call.restaurant_name}</strong>
                            <small>{call.phone}</small>
                          </button>
                        </td>
                        <td className="call-history-campaign">
                          {call.campaign_name}
                        </td>
                        <td className="call-history-date">
                          {callDate(call.started_at)}
                        </td>
                        <td className="call-history-duration">
                          {callDuration(call.duration_seconds)}
                        </td>
                        <td>
                          <span
                            className={`calling-status status-${call.status}`}
                          >
                            <span />
                            {callStatus(call.status)}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`call-history-outcome outcome-${call.result?.outcome || "none"}`}
                          >
                            {call.result?.outcome
                              ? readable(call.result.outcome)
                              : [
                                    "preparing",
                                    "queued-provider",
                                    "initiated",
                                    "ringing",
                                    "in-progress",
                                  ].includes(call.status)
                                ? "Awaiting response"
                                : "Not captured"}
                          </span>
                        </td>
                        <td>
                          <button
                            className={`call-history-transcript transcript-${transcriptClass}`}
                            onClick={() => setSelected(call)}
                          >
                            <FileText size={14} />
                            {transcriptLabel}
                          </button>
                        </td>
                        <td>
                          <button
                            className="calling-icon"
                            aria-label={`Open conversation for ${call.restaurant_name}`}
                            onClick={() => setSelected(call)}
                          >
                            <ArrowRight size={17} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="call-history-mobile" aria-busy={loading}>
              {items.map((call) => {
                const [transcriptLabel, transcriptClass] =
                  transcriptState(call);
                return (
                  <article className="call-history-card" key={call.id}>
                    <button
                      className="call-history-card-heading"
                      aria-label={`Open conversation for ${call.restaurant_name}`}
                      onClick={() => setSelected(call)}
                    >
                      <span>
                        <strong>{call.restaurant_name}</strong>
                        <small>{call.phone}</small>
                      </span>
                      <ArrowRight size={17} />
                    </button>
                    <p>{call.campaign_name}</p>
                    <div className="call-history-card-time">
                      <span>{callDate(call.started_at)} · London</span>
                      <span>
                        Talk time {callDuration(call.duration_seconds)}
                      </span>
                    </div>
                    <div className="call-history-card-status">
                      <span className={`calling-status status-${call.status}`}>
                        <span />
                        {callStatus(call.status)}
                      </span>
                      <span
                        className={`call-history-outcome outcome-${call.result?.outcome || "none"}`}
                      >
                        {call.result?.outcome
                          ? readable(call.result.outcome)
                          : "Response not captured"}
                      </span>
                    </div>
                    <button
                      className={`call-history-card-transcript transcript-${transcriptClass}`}
                      onClick={() => setSelected(call)}
                    >
                      <FileText size={15} />
                      <span>{transcriptLabel}</span>
                      <span>View conversation</span>
                    </button>
                  </article>
                );
              })}
            </div>
          </>
        ) : (
          <div className="calling-empty">
            <span className="calling-empty-icon">
              <MessageSquareText size={27} />
            </span>
            <h3>
              {filtered
                ? "No calls match these filters"
                : "Your conversations will appear here"}
            </h3>
            <p>
              {filtered
                ? "Try a different search, date range, or call status."
                : "When a campaign starts calling, every attempt is logged here. Open a call to read its captured transcript and owner response."}
            </p>
            {filtered && (
              <button className="calling-button" onClick={clear}>
                Clear filters
              </button>
            )}
          </div>
        )}
        <footer className="call-history-pagination">
          <span role="status">
            {loading
              ? "Updating call history…"
              : error
                ? "History unavailable"
                : data?.total
                  ? `Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, data.total)} of ${data.total} calls`
                  : "No call attempts to display"}
          </span>
          <div>
            <button
              className="calling-button"
              aria-label="Previous call history page"
              disabled={page <= 1 || loading || !!error}
              onClick={() => setPage((value) => value - 1)}
            >
              <ChevronLeft size={15} />
              Previous
            </button>
            <span>
              Page {page} of {pages}
            </span>
            <button
              className="calling-button"
              aria-label="Next call history page"
              disabled={page >= pages || loading || !!error}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
              <ChevronRight size={15} />
            </button>
          </div>
        </footer>
      </section>
      <p className="call-history-note">
        <em>Talk time excludes call preparation.</em> Open a call to read its
        transcript, summary, and activity log.
      </p>
      {selected && (
        <ConversationDrawer
          key={selected.id}
          lead={selected}
          user={user}
          onClose={() => {
            setSelected(null);
            setReload((value) => value + 1);
          }}
          onReviewed={() => setReload((value) => value + 1)}
          onAuthRequired={onAuthRequired}
        />
      )}
    </div>
  );
}
