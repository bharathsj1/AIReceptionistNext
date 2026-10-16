import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  AudioLines,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileText,
  LoaderCircle,
  MessageSquareText,
  PhoneCall,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { useDialogFocus } from "../ui/useDialogFocus";
import { outreachRequest } from "../../lib/api/outreach";
import { SignInRequiredError } from "../../lib/authSession";
import {
  callDate,
  callStatus,
  callDuration,
  conversationText,
  readable,
  saveText,
} from "../../lib/callHistory";
import "./ConversationDrawer.css";

const eventLabels = {
  manual_requested: "Call started manually",
  preparing: "Preparing call",
  voice_session_created: "AI conversation created",
  call_accepted: "Twilio call reference saved",
  "queued-provider": "Waiting at phone provider",
  initiated: "Dialling started",
  ringing: "Phone ringing",
  "in-progress": "Call answered",
  completed: "Call completed",
  busy: "Line busy",
  "no-answer": "No answer",
  failed: "Call failed",
  canceled: "Call cancelled",
  needs_review: "Call requires review",
  result_saved: "Owner response saved",
};

function CallReview({ lead, user, onReviewed, onAuthRequired }) {
  const [sid, setSid] = useState("");
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="calling-review-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        try {
          await outreachRequest(`leads/${lead.id}/review`, user, {
            call_sid: sid.trim(),
            confirmed_no_active_call: checked,
          });
          await onReviewed();
        } catch (err) {
          setError(err.message);
          if (err instanceof SignInRequiredError) onAuthRequired?.(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h4>Verify this call</h4>
      <p>Check the provider logs before continuing this campaign.</p>
      <label>
        Twilio Call SID
        <input
          value={sid}
          onChange={(event) => setSid(event.target.value)}
          placeholder="CA…"
        />
      </label>
      <label className="calling-checkbox">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => setChecked(event.target.checked)}
        />
        <span>
          I checked the logs and there is no active call. Skip this contact if
          no SID is provided.
        </span>
      </label>
      {error && (
        <p role="alert" className="calling-inline-warning">
          {error}
        </p>
      )}
      <button
        className="calling-button"
        disabled={busy || (!sid.trim() && !checked)}
      >
        {busy ? "Verifying…" : "Resolve call review"}
      </button>
    </form>
  );
}

function Highlight({ text, search }) {
  if (!search.trim()) return text;
  const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text
    .split(new RegExp(`(${escaped})`, "gi"))
    .map((part, i) =>
      part.toLowerCase() === search.trim().toLowerCase() ? (
        <mark key={i}>{part}</mark>
      ) : (
        part
      ),
    );
}

export default function ConversationDrawer({
  lead,
  user,
  onClose,
  onReviewed,
  onAuthRequired,
}) {
  const ref = useRef(null);
  const messagesRef = useRef(null);
  const bodyRef = useRef(null);
  const requestVersion = useRef(0);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState(
    lead.status === "needs_review" ? "summary" : "transcript",
  );
  const [search, setSearch] = useState("");
  const matchRef = useRef(0);
  const userRef = useRef(user);
  userRef.current = user;
  const authRef = useRef(onAuthRequired);
  authRef.current = onAuthRequired;
  useDialogFocus(ref, true, onClose);
  const load = useCallback(
    async (force = false) => {
      if (inFlight.current) return;
      inFlight.current = true;
      const version = ++requestVersion.current;
      setRefreshing(true);
      try {
        const response = await outreachRequest(
          `leads/${lead.id}/conversation${force ? "?refresh=true" : ""}`,
          userRef.current,
        );
        if (!mounted.current || version !== requestVersion.current) return;
        setData(response);
        setError("");
      } catch (err) {
        if (mounted.current && version === requestVersion.current) {
          setError(err.message);
          if (err instanceof SignInRequiredError) authRef.current?.(err);
        }
      } finally {
        if (mounted.current && version === requestVersion.current) {
          setLoading(false);
          setRefreshing(false);
        }
        if (version === requestVersion.current) inFlight.current = false;
      }
    },
    [lead.id],
  );
  useEffect(() => {
    mounted.current = true;
    load();
    return () => {
      mounted.current = false;
    };
  }, [load]);
  useEffect(() => {
    if (
      data?.transcript?.is_final ||
      data?.transcript?.status === "not_started" ||
      (data?.transcript?.status === "unavailable" &&
        !data?.call?.ultravox_call_id)
    )
      return;
    const timer = setInterval(() => load(), 30000);
    return () => clearInterval(timer);
  }, [
    data?.transcript?.is_final,
    data?.transcript?.status,
    data?.call?.ultravox_call_id,
    load,
  ]);
  useEffect(() => {
    matchRef.current = 0;
  }, [search]);
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [tab]);
  const call = data?.call || lead;
  const transcript = data?.transcript;
  const messages = transcript?.messages || [];
  const matches = search.trim()
    ? messages.reduce(
        (count, item) =>
          count +
          item.text.toLowerCase().split(search.trim().toLowerCase()).length -
          1,
        0,
      )
    : 0;
  const review = async () => {
    await load(true);
    await onReviewed?.();
  };
  return (
    <div
      className="calling-dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="calling-dialog conversation-dialog"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="conversation-title"
        tabIndex={-1}
      >
        <header className="calling-dialog-heading">
          <div>
            <span className="calling-eyebrow">CALL RECORD / CONVERSATION</span>
            <h2 id="conversation-title">{call.restaurant_name}</h2>
            <p className="conversation-subtitle">
              {call.phone}
              <span>·</span>
              {call.campaign_name || "Campaign conversation"}
            </p>
          </div>
          <button
            className="calling-icon"
            onClick={onClose}
            aria-label="Close conversation details"
          >
            <X size={20} />
          </button>
        </header>
        <div className="conversation-meta">
          <div>
            <span>Started · London</span>
            <strong>{callDate(call.started_at)}</strong>
          </div>
          <div>
            <span>Talk time</span>
            <strong>{callDuration(call.duration_seconds)}</strong>
          </div>
          <div>
            <span>Call status</span>
            <strong className="conversation-capitalize">
              {callStatus(call.status)}
            </strong>
          </div>
          <div>
            <span>Owner response</span>
            <strong className="conversation-capitalize">
              {readable(call.result?.outcome)}
            </strong>
          </div>
        </div>
        <div
          className="conversation-tabs"
          role="tablist"
          aria-label="Conversation sections"
        >
          {[
            ["transcript", MessageSquareText, "Transcript"],
            ["summary", FileText, "Summary & details"],
            ["activity", Clock3, "Activity log"],
          ].map(([id, Icon, title]) => (
            <button
              key={id}
              id={`conversation-tab-${id}`}
              role="tab"
              aria-selected={tab === id}
              aria-controls={`conversation-panel-${id}`}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
              onKeyDown={(event) => {
                if (
                  ["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)
                ) {
                  event.preventDefault();
                  const ids = ["transcript", "summary", "activity"];
                  const next =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? 2
                        : (ids.indexOf(tab) +
                            (event.key === "ArrowRight" ? 1 : 2)) %
                          3;
                  setTab(ids[next]);
                  ref.current
                    ?.querySelector(`#conversation-tab-${ids[next]}`)
                    ?.focus();
                }
              }}
            >
              <Icon size={15} />
              {title}
              {id === "transcript" && messages.length > 0 && (
                <span>{messages.length}</span>
              )}
            </button>
          ))}
        </div>
        <div
          className="conversation-body"
          ref={bodyRef}
          role="tabpanel"
          id={`conversation-panel-${tab}`}
          aria-labelledby={`conversation-tab-${tab}`}
          tabIndex={0}
        >
          {error && (
            <div className="calling-alert is-error" role="alert">
              {error}
              <button
                className="calling-text-button"
                onClick={() => load(true)}
                disabled={refreshing}
              >
                Try again
              </button>
            </div>
          )}
          {tab === "transcript" && (
            <>
              <div className="conversation-transcript-toolbar">
                <span
                  className={`conversation-sync-state state-${transcript?.status || "pending"}`}
                >
                  <span />
                  {loading
                    ? "Loading conversation…"
                    : call.call_type === "normal"
                      ? "Normal call · no AI transcript"
                    : transcript?.is_final
                      ? messages.length
                        ? "Saved transcript"
                        : "No spoken transcript"
                      : messages.length
                        ? "Partial transcript · updates automatically"
                        : transcript?.status === "not_started"
                          ? "Not called yet"
                          : transcript?.status === "unavailable"
                            ? "Transcript unavailable"
                            : "Awaiting transcript"}
                </span>
                <button
                  className="calling-text-button"
                  onClick={() => load(true)}
                  disabled={refreshing}
                >
                  <RefreshCw size={14} className={refreshing ? "spin" : ""} />
                  {refreshing ? "Checking…" : "Refresh"}
                </button>
              </div>
              {transcript?.error && (
                <div className="calling-alert" role="status">
                  {transcript.error}
                </div>
              )}
              {messages.length > 0 && (
                <div className="conversation-search">
                  <Search size={16} />
                  <input
                    aria-label="Search transcript"
                    placeholder="Find in this conversation…"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  <span>
                    {search.trim()
                      ? `${matches} matches`
                      : `${messages.length} messages`}
                  </span>
                  {matches > 0 && (
                    <button
                      className="calling-icon"
                      aria-label="Next transcript match"
                      onClick={() => {
                        const marks =
                          messagesRef.current?.querySelectorAll("mark");
                        if (marks?.length) {
                          marks[matchRef.current % marks.length].scrollIntoView(
                            { block: "center", behavior: "smooth" },
                          );
                          matchRef.current += 1;
                        }
                      }}
                    >
                      <ChevronDown size={17} />
                    </button>
                  )}
                </div>
              )}
              {loading && !messages.length ? (
                <div className="conversation-empty" role="status">
                  <LoaderCircle className="spin" size={24} />
                  <h3>Loading the conversation</h3>
                  <p>
                    Checking for the latest transcript and saved call details.
                  </p>
                </div>
              ) : messages.length ? (
                <div className="conversation-messages" ref={messagesRef}>
                  {messages.map((message, index) => (
                    <article
                      className={`conversation-message speaker-${message.speaker}`}
                      key={message.id || index}
                    >
                      <span className="conversation-speaker-icon">
                        {message.speaker === "ai" ? (
                          <AudioLines size={17} />
                        ) : (
                          <PhoneCall size={16} />
                        )}
                      </span>
                      <div>
                        <header>
                          <strong>
                            {message.speaker === "ai" ? "Vedora AI" : "Contact"}
                          </strong>
                          {message.offset_seconds !== null &&
                            message.offset_seconds !== undefined && (
                              <time>
                                {callDuration(message.offset_seconds)}
                              </time>
                            )}
                        </header>
                        <p>
                          <Highlight text={message.text} search={search} />
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="conversation-empty">
                  <MessageSquareText size={29} />
                  <h3>
                    {call.call_type === "normal" ? "Normal phone call" : transcript?.status === "not_started"
                      ? "This contact hasn’t been called yet"
                      : transcript?.status === "empty"
                        ? "No spoken conversation was captured"
                        : transcript?.status === "unavailable"
                          ? "Transcript isn’t available yet"
                          : "The transcript is being prepared"}
                  </h3>
                  <p>
                    {call.call_type === "normal" ? "You spoke through the browser using Twilio. Call status, duration and activity are saved. Recording and AI transcripts are not enabled for normal calls." : transcript?.status === "not_started"
                      ? "A call record and transcript will appear after calling starts."
                      : !call.ultravox_call_id
                        ? "No Ultravox conversation is linked to this attempt. Call status and any saved owner response are still available."
                        : transcript?.status === "empty"
                          ? "The provider returned no spoken messages for this call. Check the call status and activity log for what happened."
                          : "Call details are saved. Transcript messages will appear when Ultravox returns them. You can refresh to check again."}
                  </p>
                </div>
              )}
              {transcript?.synced_at && (
                <p className="conversation-saved-note">
                  <CheckCircle2 size={13} />
                  <span>
                    Saved to your workspace · {callDate(transcript.synced_at)}
                    {!transcript.is_final && (
                      <> · <em>This transcript may still be incomplete.</em></>
                    )}
                  </span>
                </p>
              )}
            </>
          )}
          {tab === "summary" && (
            <>
              <div className="calling-result-summary">
                <h3>Conversation summary</h3>
                <p>
                  {call.result?.summary || (call.call_type === "normal"
                    ? "You spoke directly with the contact. Normal calls save call details and activity without an AI summary or transcript."
                    : "No structured owner response was captured for this attempt. Check the transcript and call status for the available conversation details.")}
                </p>
              </div>
              <dl className="calling-result-details">
                {[
                  ["Owner", call.result?.owner_name],
                  ["Email", call.result?.owner_email],
                  ["Preferred callback", call.result?.preferred_callback_time],
                  [
                    "Follow-up permission",
                    call.result
                      ? call.result.follow_up_permission
                        ? "Granted"
                        : "Not granted"
                      : "Not captured",
                  ],
                  ["Outbound number", call.caller_id],
                  ["Ended · London", callDate(call.ended_at)],
                  ["Team notification", readable(call.notification_status)],
                  ["Twilio reference", call.twilio_call_sid],
                  ["Ultravox reference", call.ultravox_call_id],
                ].map(([name, value]) => (
                  <div key={name}>
                    <dt>{name}</dt>
                    <dd>{value || "Not captured"}</dd>
                  </div>
                ))}
              </dl>
              {call.error && <p className="calling-alert">{call.error}</p>}
              {call.status === "needs_review" && (
                <CallReview
                  lead={call}
                  user={user}
                  onReviewed={review}
                  onAuthRequired={onAuthRequired}
                />
              )}
            </>
          )}
          {tab === "activity" && (
            <div className="conversation-activity">
              <p>
                Call events are saved as they arrive. Times are shown in
                Europe/London.
              </p>
              {data?.events?.length ? (
                <ol>
                  {data.events.map((event) => (
                    <li key={event.id}>
                      <span />
                      <div>
                        <strong>
                          {eventLabels[event.event] || readable(event.event)}
                        </strong>
                        {event.detail && <p>{readable(event.detail)}</p>}
                        <time>{callDate(event.at)}</time>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="conversation-empty">
                  <Clock3 size={26} />
                  <h3>
                    {loading
                      ? "Loading activity…"
                      : "No detailed events saved for this call"}
                  </h3>
                  <p>
                    Older call records may have start and end times without a
                    full event timeline. New calls log activity as it happens.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
        <footer className="calling-dialog-footer">
          <button className="calling-button" onClick={onClose}>
            Close details
          </button>
          <button
            className="calling-button is-primary"
            disabled={!messages.length}
            onClick={() =>
              saveText(
                `conversation-${call.id.replace(/[^a-zA-Z0-9_-]/g, "")}.txt`,
                conversationText(call, transcript),
              )
            }
          >
            <ArrowDownToLine size={15} />
            Download transcript
          </button>
        </footer>
      </section>
    </div>
  );
}
