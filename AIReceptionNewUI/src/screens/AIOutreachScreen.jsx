import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  Building2,
  CheckCircle2,
  ChevronLeft,
  FileSpreadsheet,
  LoaderCircle,
  Pause,
  Phone,
  PhoneCall,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Target,
  Users,
} from "lucide-react";
import { outreachRequest } from "../lib/api/outreach";
import { hasCurrentSession, SignInRequiredError } from "../lib/authSession";
import ConversationDrawer from "../components/outreach/ConversationDrawer";
import ManualCallDialog from "../components/outreach/ManualCallDialog";
import EmailVerificationPanel from "../components/outreach/EmailVerificationPanel";
import BillingWorkspace, { WalletSummary, CampaignPriceDialog } from "../components/outreach/BillingWorkspace";
import NumbersWorkspace, { DashboardNumbers, BuyNumberDialog, SmsDialog } from "../components/outreach/NumbersWorkspace";
import CallHistoryScreen from "./CallHistoryScreen";
import CampaignWizard, {
  downloadCsv,
  downloadTemplate,
} from "../components/outreach/CampaignWizard";

const label = (value) =>
  String(value || "unknown")
    .replaceAll("_", " ")
    .replaceAll("-", " ");
const terminal = new Set([
  "completed",
  "busy",
  "no_answer",
  "no-answer",
  "failed",
  "canceled",
]);
const date = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";
const pageTitles = {
  billing: ["Your balance. Your control.", "Manage calling credits, payments, and monthly number subscriptions."],
  numbers: ["Your numbers. Your connections.", "Manage your account’s calling numbers and send text messages."],
  overview: [
    "Every call starts an opportunity.",
    "Your campaigns, conversations, and next steps. All in one place.",
  ],
  campaigns: [
    "Make your next connection.",
    "Create a campaign, share your pitch, and let the conversations begin.",
  ],
  contacts: [
    "Good conversations start here.",
    "Review the people and businesses in your calling lists.",
  ],
  calls: [
    "Every conversation, accounted for.",
    "Search every call, see its outcome, and read the conversation transcript.",
  ],
  leads: [
    "Meet your next partnerships.",
    "Interested owners, captured details, and clear follow-up permissions.",
  ],
  settings: [
    "Set up for a good conversation.",
    "Your company, calling numbers, and the services behind your campaigns.",
  ],
};

function Status({ value }) {
  return (
    <span className={`calling-status status-${value || "unknown"}`}>
      <span />
      {label(value)}
    </span>
  );
}
function EmptyState({ icon: Icon = PhoneCall, title, children, action }) {
  return (
    <div className="calling-empty">
      <span className="calling-empty-icon">
        <Icon size={27} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
function Wave({ large = false }) {
  return (
    <div
      className={`calling-wave ${large ? "is-large" : ""}`}
      aria-hidden="true"
    >
      {[
        14, 24, 40, 22, 50, 68, 36, 54, 80, 46, 64, 32, 52, 74, 40, 24, 44, 18,
        30,
      ].map((height, i) => (
        <i key={i} style={{ height: large ? height : height / 2 }} />
      ))}
    </div>
  );
}

export default function AIOutreachScreen({
  user,
  onSignIn,
  view = "overview",
  onNavigate,
  company = "Your company",
  clientData,
  onEditCompany,
}) {
  const [config, setConfig] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [campaign, setCampaign] = useState(null);
  const [error, setError] = useState("");
  const [authRequired, setAuthRequired] = useState(!hasCurrentSession(user));
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importErrors, setImportErrors] = useState([]);
  const [wizard, setWizard] = useState(false);
  const [manualDial, setManualDial] = useState(false);
  const [priceApproval, setPriceApproval] = useState(null);
  const [manualCaller, setManualCaller] = useState("");
  const [smsFrom, setSmsFrom] = useState(null);
  const [buyNumber, setBuyNumber] = useState(false);
  const [purchaseToReview, setPurchaseToReview] = useState(null);
  const [manualRecord, setManualRecord] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [leadId, setLeadId] = useState(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [lastUpdated, setLastUpdated] = useState(null);
  const selectedRef = useRef("");
  const generation = useRef(0);
  const userRef = useRef(user);
  userRef.current = user;
  const failed = useCallback((err) => {
    setError(err.message);
    if (err instanceof SignInRequiredError) setAuthRequired(true);
  }, []);
  const load = useCallback(async (id = selectedRef.current) => {
    const version = ++generation.current;
    const [settings, list] = await Promise.all([
      outreachRequest("config", userRef.current),
      outreachRequest("campaigns", userRef.current),
    ]);
    if (version !== generation.current) return;
    const nextId = list.items.some((item) => item.id === id)
      ? id
      : list.items[0]?.id || "";
    const detail = nextId
      ? await outreachRequest(`campaigns/${nextId}`, userRef.current)
      : null;
    if (version !== generation.current) return;
    selectedRef.current = nextId;
    setSelectedId(nextId);
    setCampaign(detail?.campaign || null);
    setConfig(settings);
    setCampaigns(list.items);
    setLastUpdated(new Date());
    setError("");
  }, []);
  useEffect(() => {
    if (authRequired) {
      setLoading(false);
      return;
    }
    let mounted = true;
    load()
      .catch(failed)
      .finally(() => {
        if (mounted) setLoading(false);
      });
    const timer = setInterval(() => load().catch(failed), 15000);
    return () => {
      mounted = false;
      clearInterval(timer);
      generation.current += 1;
    };
  }, [authRequired, load, failed, user?.auth_token, user?.authToken]);
  useEffect(() => {
    setQuery("");
    setFilter("all");
    setLeadId(null);
    setManualRecord(null);
  }, [view]);
  const refresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } catch (err) {
      failed(err);
    } finally {
      setRefreshing(false);
    }
  };
  const select = async (id, showDetail = false) => {
    selectedRef.current = id;
    setSelectedId(id);
    setCampaign(null);
    setLeadId(null);
    if (showDetail) {
      setQuery("");
      setFilter("all");
      setDetailOpen(true);
      onNavigate?.("campaigns");
    }
    try {
      await load(id);
    } catch (err) {
      failed(err);
    }
  };
  const create = async (form) => {
    const payload = await outreachRequest("campaigns", userRef.current, form);
    generation.current += 1;
    selectedRef.current = payload.campaign.id;
    setSelectedId(payload.campaign.id);
    setCampaign(payload.campaign);
    setCampaigns((current) => [
      payload.campaign,
      ...current.filter((item) => item.id !== payload.campaign.id),
    ]);
    setImportErrors(payload.import_errors || []);
    setWizard(false);
    setDetailOpen(true);
    onNavigate?.("campaigns");
    load(payload.campaign.id).catch(failed);
  };
  const action = async (value, quoteId = null) => {
    setBusy(true);
    setError("");
    try {
      if (value === "start" && !config?.billing?.is_platform_admin && !quoteId) {
        const data = await outreachRequest(`billing/campaigns/${selectedId}/quote`, userRef.current);
        setPriceApproval({ ...data.quote, campaign_id: selectedId });
        return;
      }
      const payload = await outreachRequest(
        `campaigns/${priceApproval?.campaign_id || selectedId}`,
        userRef.current,
        { action: value, ...(quoteId ? { quote_id: quoteId } : {}) },
      );
      setPriceApproval(null);
      setCampaign(payload.campaign);
      await load();
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
    }
  };
  const total = campaigns.reduce((sum, item) => sum + item.total, 0);
  const attempted = campaigns.reduce(
    (sum, item) =>
      sum +
      Object.entries(item.counts || {}).reduce(
        (count, [status, amount]) =>
          count + (status !== "queued" && status !== "skipped" ? amount : 0),
        0,
      ),
    0,
  );
  const interested = campaigns.reduce((sum, item) => sum + item.interested, 0);
  const running = campaigns.filter((item) => item.status === "running").length;
  const sent = campaigns.reduce((sum, item) => sum + item.emails_sent, 0);
  const scopedLeads = (campaign?.leads || []).filter((lead) =>
    view === "leads"
      ? lead.result?.outcome === "interested"
      : view === "calls"
        ? !["queued", "skipped"].includes(lead.status)
        : true,
  );
  const leads = scopedLeads.filter(
    (lead) =>
      `${lead.restaurant_name} ${lead.phone} ${lead.result?.owner_name || ""} ${lead.result?.owner_email || ""}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === "all" || lead.status === filter),
  );
  const visibleCampaigns = campaigns.filter(
    (item) =>
      item.name.toLowerCase().includes(query.toLowerCase()) &&
      (filter === "all" || item.status === filter),
  );
  const currentLead = manualRecord || campaign?.leads?.find((lead) => lead.id === leadId);
  const dialFrom = (number) => { setManualCaller(number); setManualDial(true); };
  const numbersChanged = () => { load().catch(failed); };
  const newButton = (
    <button
      className="calling-button is-primary"
      onClick={() => {
        setImportErrors([]);
        setWizard(true);
      }}
    >
      <Plus size={17} />
      New campaign
    </button>
  );
  const scopeSelect = (
    <label className="calling-scope">
      <span>Campaign</span>
      <select
        aria-label="Select campaign"
        value={selectedId}
        onChange={(event) => select(event.target.value)}
        disabled={!campaigns.length}
      >
        {!campaigns.length && <option value="">No campaigns yet</option>}
        {campaigns.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
    </label>
  );
  const exportLeads = () =>
    downloadCsv("vedora-interested-leads.csv", [
      [
        "restaurant",
        "phone",
        "owner",
        "email",
        "callback",
        "follow_up_permission",
        "summary",
        "notification_status",
      ],
      ...leads.map((lead) => [
        lead.restaurant_name,
        lead.phone,
        lead.result?.owner_name,
        lead.result?.owner_email,
        lead.result?.preferred_callback_time,
        lead.result?.follow_up_permission ? "yes" : "no",
        lead.result?.summary,
        lead.notification_status,
      ]),
    ]);
  const campaignTable = (items) => (
    <div className="calling-table-scroll">
      <table className="calling-table">
        <thead>
          <tr>
            <th>Campaign</th>
            <th>Status</th>
            <th>Contacts</th>
            <th>Interested</th>
            <th>Progress</th>
            <th>
              <span className="sr-only">Open campaign</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const finished = Object.entries(item.counts || {}).reduce(
              (sum, [status, count]) =>
                sum +
                (terminal.has(status) || status === "skipped" ? count : 0),
              0,
            );
            const progress = item.total
              ? Math.round((finished / item.total) * 100)
              : 0;
            return (
              <tr key={item.id}>
                <td>
                  <button
                    className="calling-campaign-name"
                    onClick={() => select(item.id, true)}
                  >
                    <span className="calling-table-icon">
                      <AudioLines size={18} />
                    </span>
                    <span>
                      <strong>{item.name}</strong>
                      <small>Created {date(item.created_at)}</small>
                    </span>
                  </button>
                </td>
                <td>
                  <Status value={item.status} />
                </td>
                <td>{item.total.toLocaleString()}</td>
                <td>
                  <span className="calling-interested-count">
                    {item.interested}
                  </span>
                </td>
                <td>
                  <div className="calling-progress">
                    <span>
                      <i style={{ width: `${progress}%` }} />
                    </span>
                    <small>{progress}%</small>
                  </div>
                </td>
                <td>
                  <button
                    className="calling-icon"
                    aria-label={`Open ${item.name}`}
                    onClick={() => select(item.id, true)}
                  >
                    <ArrowUpRight size={17} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
  const leadTable = (
    <div className="calling-table-scroll">
      <table className="calling-table">
        <thead>
          <tr>
            <th>Business / contact</th>
            <th>{view === "leads" ? "Owner" : "Call status"}</th>
            <th>{view === "leads" ? "Follow-up" : "Outcome"}</th>
            <th>{view === "leads" ? "Team handoff" : "Details"}</th>
            <th>
              <span className="sr-only">View conversation</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => (
            <tr key={lead.id}>
              <td>
                <strong>{lead.restaurant_name}</strong>
                <small>{lead.phone}</small>
              </td>
              <td>
                {view === "leads" ? (
                  <>
                    <strong>
                      {lead.result?.owner_name || "Name not captured"}
                    </strong>
                    <small>
                      {lead.result?.owner_email || "Email not captured"}
                    </small>
                  </>
                ) : (
                  <Status value={lead.status} />
                )}
              </td>
              <td>
                {view === "leads" ? (
                  <>
                    <span>
                      {lead.result?.follow_up_permission
                        ? "Permission granted"
                        : "No permission"}
                    </span>
                    <small>
                      {lead.result?.preferred_callback_time ||
                        "No callback time captured"}
                    </small>
                  </>
                ) : (
                  <span className="calling-outcome">
                    {lead.result
                      ? label(lead.result.outcome)
                      : lead.status === "completed"
                        ? "No result captured"
                        : "Awaiting result"}
                  </span>
                )}
              </td>
              <td>
                {view === "leads" ? (
                  <Status value={lead.notification_status} />
                ) : (
                  <button
                    className="calling-text-button"
                    onClick={() => setLeadId(lead.id)}
                  >
                    {lead.status === "needs_review"
                      ? "Review call"
                      : "View details"}
                  </button>
                )}
              </td>
              <td>
                <button
                  className="calling-icon"
                  aria-label={`View ${lead.restaurant_name}`}
                  onClick={() => setLeadId(lead.id)}
                >
                  <ArrowUpRight size={17} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  if (authRequired)
    return (
      <section className="calling-content">
        <EmptyState
          title="Sign in to your calling workspace"
          action={
            <button className="calling-button is-primary" onClick={onSignIn}>
              Sign in <ArrowRight size={16} />
            </button>
          }
        >
          Your saved session is no longer valid for this deployment.
        </EmptyState>
      </section>
    );
  return (
    <section className="calling-content" aria-label="Company calling workspace">
      <div className="calling-page-heading">
        <div>
          <span className="calling-eyebrow">
            {view === "overview"
              ? "YOUR OUTREACH, AT A GLANCE"
              : `COMPANY OUTREACH / ${view === "settings" ? "CALLING SETUP" : view === "calls" ? "CALL HISTORY" : view.toUpperCase()}`}
          </span>
          <h1>{pageTitles[view][0]}</h1>
          <p>{pageTitles[view][1]}</p>
        </div>
        <div className="calling-heading-actions">
          <button
            className="calling-icon calling-refresh"
            disabled={refreshing || loading}
            onClick={refresh}
            aria-label="Refresh calling data"
          >
            <RefreshCw size={17} className={refreshing ? "spin" : ""} />
          </button>
          {!["settings", "numbers", "billing"].includes(view) && newButton}
          {view !== "settings" && (
            <button className="calling-button" onClick={() => dialFrom("")} disabled={loading}>
              <PhoneCall size={17} />
              Dial a number
            </button>
          )}
        </div>
      </div>
      {error && (
        <div className="calling-alert is-error" role="alert">
          <span>{error}</span>
          <button className="calling-text-button" onClick={refresh}>
            Retry
          </button>
        </div>
      )}
      {loading ? (
        <div className="calling-loading" role="status">
          <LoaderCircle className="spin" size={23} />
          Loading your calling workspace…
        </div>
      ) : !lastUpdated && error ? (
        <div className="calling-panel">
          <EmptyState
            title="We couldn’t load your calling workspace"
            action={
              <button
                className="calling-button"
                onClick={refresh}
                disabled={refreshing}
              >
                Try again <RefreshCw size={15} />
              </button>
            }
          >
            Check your connection and try again. Your campaigns will appear when
            the service is available.
          </EmptyState>
        </div>
      ) : (
        <>
          {view === "overview" && (
            <>
              <WalletSummary billing={config?.billing} onOpen={() => onNavigate?.("billing")} />
              <DashboardNumbers
                numbers={config?.numbers || []}
                error={config?.number_error}
                onCall={dialFrom}
                onMessage={setSmsFrom}
                onManage={() => onNavigate?.("numbers")}
              />
              <div className="calling-hero">
                <div className="calling-hero-copy">
                  <span className="calling-hero-label">
                    <span />
                    BUILT FOR YOUR NEXT CONNECTION
                  </span>
                  <h2>
                    Your pitch.
                    <br />
                    More possibilities.
                  </h2>
                  <p>
                    Upload a contact list. Let AI introduce your company,
                    understand interest, and bring the right owners to your
                    team.
                  </p>
                  <button
                    className="calling-button is-lime"
                    onClick={() => setWizard(true)}
                  >
                    {campaigns.length
                      ? "Create a campaign"
                      : "Create your first campaign"}
                    <ArrowUpRight size={17} />
                  </button>
                  <span className="calling-hero-foot">
                    <Phone size={13} />
                    UK calling <i />
                    Natural AI conversations <i />
                    Team handoff
                  </span>
                </div>
                <div className="calling-hero-art">
                  <div className="calling-orbit orbit-one" />
                  <div className="calling-orbit orbit-two" />
                  <div className="calling-voice-card">
                    <span>
                      <span className="calling-voice-icon">
                        <AudioLines size={22} />
                      </span>
                      <span>
                        <strong>Made for conversation</strong>
                        <small>AI outbound calling</small>
                      </span>
                    </span>
                    <Wave large />
                    <div>
                      <span>Introduce</span>
                      <ArrowRight size={12} />
                      <span>Listen</span>
                      <ArrowRight size={12} />
                      <span>Connect</span>
                    </div>
                  </div>
                  <div className="calling-art-tag">
                    <Target size={15} />
                    <span>
                      Capture interest.
                      <br />
                      <strong>Make the next step clear.</strong>
                    </span>
                  </div>
                </div>
              </div>
              <div className="calling-stats">
                {[
                  {
                    icon: AudioLines,
                    value: campaigns.length,
                    title: "Total campaigns",
                    detail: `${running} currently running`,
                    tone: "mint",
                  },
                  {
                    icon: PhoneCall,
                    value: attempted,
                    title: "Calls attempted",
                    detail: `Across ${total.toLocaleString()} contacts`,
                    tone: "blue",
                  },
                  {
                    icon: Target,
                    value: interested,
                    title: "Interested owners",
                    detail: "Captured from conversations",
                    tone: "peach",
                  },
                  {
                    icon: CheckCircle2,
                    value: sent,
                    title: "Team handoffs",
                    detail: "Summaries accepted by provider",
                    tone: "lilac",
                  },
                ].map(({ icon: Icon, value, title, detail, tone }) => (
                  <article className="calling-stat" key={title}>
                    <div>
                      <span>{title}</span>
                      <span className={`calling-stat-icon tone-${tone}`}>
                        <Icon size={17} />
                      </span>
                    </div>
                    <strong>{value.toLocaleString()}</strong>
                    <small>{detail}</small>
                  </article>
                ))}
              </div>
              <div className="calling-overview-grid">
                <div className="calling-panel">
                  <header className="calling-panel-heading">
                    <div>
                      <h2>Your campaigns</h2>
                      <p>Every list is a new set of possibilities.</p>
                    </div>
                    <button
                      className="calling-text-button"
                      onClick={() => {
                        setDetailOpen(false);
                        onNavigate?.("campaigns");
                      }}
                    >
                      View all <ArrowRight size={15} />
                    </button>
                  </header>
                  {campaigns.length ? (
                    campaignTable(campaigns.slice(0, 4))
                  ) : (
                    <EmptyState
                      icon={AudioLines}
                      title={
                        error
                          ? "Campaigns could not be loaded"
                          : "Your first conversation starts here"
                      }
                      action={
                        !error && (
                          <button
                            className="calling-button"
                            onClick={() => setWizard(true)}
                          >
                            <Plus size={16} />
                            Create a campaign
                          </button>
                        )
                      }
                    >
                      {error
                        ? "Use Retry above to reconnect to your workspace."
                        : "Add your pitch and contacts. Review everything before your AI makes the first call."}
                    </EmptyState>
                  )}
                </div>
                <aside className="calling-panel calling-how-it-works">
                  <span className="calling-eyebrow">FROM LIST TO LEAD</span>
                  <h2>
                    A simple path to
                    <br />
                    your next partnership.
                  </h2>
                  <ol>
                    {[
                      [
                        FileSpreadsheet,
                        "Bring your contacts",
                        "Upload a CSV of UK restaurant owners.",
                      ],
                      [
                        AudioLines,
                        "Let the conversation flow",
                        "Your AI explains the offer and listens.",
                      ],
                      [
                        Target,
                        "Give your team the next step",
                        "Interested-owner details, ready to follow up.",
                      ],
                    ].map(([Icon, title, text], index) => (
                      <li key={title}>
                        <span>
                          <Icon size={18} />
                        </span>
                        <div>
                          <small>0{index + 1}</small>
                          <strong>{title}</strong>
                          <p>{text}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                  <button
                    className="calling-text-button"
                    onClick={downloadTemplate}
                  >
                    Get the contact template <ArrowDownToLine size={15} />
                  </button>
                </aside>
              </div>
              {config?.configuration_errors?.length > 0 && (
                <div className="calling-setup-reminder">
                  <span>
                    <Settings2 size={19} />
                    <span>
                      <strong>
                        A few things to connect before your first call
                      </strong>
                      <small>
                        You can prepare campaigns while your administrator
                        finishes calling setup.
                      </small>
                    </span>
                  </span>
                  <button
                    className="calling-button"
                    onClick={() => onNavigate?.("settings")}
                  >
                    View calling setup <ArrowRight size={15} />
                  </button>
                </div>
              )}
            </>
          )}
          {view === "campaigns" && (
            <>
              {detailOpen && selectedId ? (
                <div className="calling-panel calling-campaign-detail">
                  <header className="calling-panel-heading">
                    <div>
                      <button
                        className="calling-text-button"
                        onClick={() => {
                          setDetailOpen(false);
                          setImportErrors([]);
                        }}
                      >
                        <ChevronLeft size={15} />
                        All campaigns
                      </button>
                      <h2>{campaign?.name || "Loading campaign…"}</h2>
                      {campaign && (
                        <p>
                          {campaign.caller_id} ·{" "}
                          {String(campaign.start_hour).padStart(2, "0")}:00–
                          {String(campaign.end_hour).padStart(2, "0")}:00 ·
                          Weekdays, London
                        </p>
                      )}
                    </div>
                    {campaign && (
                      <div className="calling-detail-actions">
                        <Status value={campaign.status} />
                        {campaign.status === "running" ? (
                          <button
                            className="calling-button"
                            onClick={() => action("pause")}
                            disabled={busy}
                          >
                            <Pause size={16} />
                            Pause campaign
                          </button>
                        ) : (
                          ["draft", "paused"].includes(campaign.status) && (
                            <button
                              className="calling-button is-primary"
                              onClick={() => action("start")}
                              disabled={
                                busy ||
                                !!config?.configuration_errors?.length ||
                                !campaign.counts.queued ||
                                campaign.counts.needs_review > 0
                              }
                            >
                              <Play size={15} />
                              {campaign.status === "paused"
                                ? "Resume calling"
                                : "Start calling"}
                            </button>
                          )
                        )}
                      </div>
                    )}
                  </header>
                  {campaign && (
                    <>
                      <div className="calling-detail-stats">
                        {[
                          [campaign.total, "Contacts"],
                          [campaign.counts.queued || 0, "Waiting to call"],
                          [campaign.interested, "Interested"],
                          [campaign.counts.skipped || 0, "Skipped"],
                        ].map(([value, title]) => (
                          <div key={title}>
                            <strong>{value}</strong>
                            <span>{title}</span>
                          </div>
                        ))}
                      </div>
                      {campaign.error && (
                        <div className="calling-alert is-error">
                          {campaign.error}
                        </div>
                      )}
                      {campaign.counts.needs_review > 0 && (
                        <div className="calling-alert">
                          A call needs review before this campaign can resume.
                          Open its details below to check it against Twilio.
                        </div>
                      )}
                      {config?.configuration_errors?.length > 0 && (
                        <div className="calling-alert">
                          Calling setup is incomplete.{" "}
                          <button
                            className="calling-text-button"
                            onClick={() => onNavigate?.("settings")}
                          >
                            View setup
                          </button>
                        </div>
                      )}
                      {importErrors.length > 0 && (
                        <div className="calling-alert">
                          <strong>
                            {importErrors.length} CSV{" "}
                            {importErrors.length === 1 ? "row" : "rows"}{" "}
                            excluded
                          </strong>
                          <ul>
                            {importErrors.slice(0, 20).map((item) => (
                              <li key={item.row}>
                                Row {item.row}: {item.error}
                              </li>
                            ))}
                          </ul>
                          {importErrors.length > 20 && (
                            <p>Showing the first 20 errors.</p>
                          )}
                        </div>
                      )}
                      <div className="calling-campaign-pitch">
                        <h3>Conversation brief</h3>
                        <p>{campaign.benefits}</p>
                      </div>
                      <div className="calling-handoff-note">
                        <ShieldCheck size={17} />
                        <p>
                          Interested owners who grant follow-up permission are
                          sent to <strong>{campaign.notification_email}</strong>
                          . Pausing stops new calls; an active conversation can
                          finish.
                        </p>
                      </div>
                      <div className="calling-panel-subheading">
                        <h3>Campaign contacts</h3>
                        <span>
                          {campaign.total}{" "}
                          {campaign.total === 1 ? "contact" : "contacts"}
                        </span>
                      </div>
                      {leadTable}
                    </>
                  )}
                </div>
              ) : (
                <div className="calling-panel">
                  <header className="calling-panel-heading">
                    <div>
                      <h2>
                        All campaigns{" "}
                        <span className="calling-count">
                          {campaigns.length}
                        </span>
                      </h2>
                      <p>
                        Manage the conversations happening for your company.
                      </p>
                    </div>
                  </header>
                  <div className="calling-table-toolbar">
                    <label className="calling-search">
                      <Search size={17} />
                      <input
                        aria-label="Search campaigns"
                        placeholder="Search campaigns…"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                      />
                    </label>
                    <select
                      aria-label="Filter campaigns by status"
                      value={filter}
                      onChange={(event) => setFilter(event.target.value)}
                    >
                      <option value="all">All statuses</option>
                      {["draft", "running", "paused", "completed"].map(
                        (status) => (
                          <option key={status} value={status}>
                            {label(status)}
                          </option>
                        ),
                      )}
                    </select>
                  </div>
                  {visibleCampaigns.length ? (
                    campaignTable(visibleCampaigns)
                  ) : (
                    <EmptyState
                      icon={AudioLines}
                      title={
                        campaigns.length
                          ? "No matching campaigns"
                          : "Make room for your first campaign"
                      }
                      action={
                        campaigns.length ? (
                          <button
                            className="calling-button"
                            onClick={() => {
                              setQuery("");
                              setFilter("all");
                            }}
                          >
                            Clear filters
                          </button>
                        ) : (
                          newButton
                        )
                      }
                    >
                      {campaigns.length
                        ? "Try a different name or status."
                        : "A pitch, a contact list, and a clear next step for your team."}
                    </EmptyState>
                  )}
                </div>
              )}
            </>
          )}
          {view === "calls" && (
            <CallHistoryScreen
              user={user}
              campaigns={campaigns}
              refreshKey={lastUpdated?.getTime()}
              onAuthRequired={failed}
            />
          )}
          {view === "numbers" && (
            <NumbersWorkspace
              user={user}
              numbers={config?.numbers || []}
              refreshKey={lastUpdated?.getTime()}
              onCall={dialFrom}
              onMessage={setSmsFrom}
              onBuy={() => { setPurchaseToReview(null); setBuyNumber(true); }}
              onReviewPurchase={(purchase) => { setPurchaseToReview(purchase); setBuyNumber(true); }}
              onAuthRequired={failed}
            />
          )}
          {view === "billing" && <BillingWorkspace user={user} onAuthRequired={failed} onChanged={numbersChanged} />}
          {["contacts", "leads"].includes(view) && (
            <div className="calling-panel">
              <header className="calling-panel-heading">
                <div>
                  <h2>
                    {view === "leads"
                      ? "Interested owners"
                      : view === "calls"
                        ? "Campaign call history"
                        : "Campaign contacts"}{" "}
                    <span className="calling-count">{scopedLeads.length}</span>
                  </h2>
                  <p>
                    {view === "leads"
                      ? "Check follow-up permission before contacting an owner."
                      : "Choose a campaign to explore its contacts and conversations."}
                  </p>
                </div>
                {view === "leads" ? (
                  <button
                    className="calling-button"
                    onClick={exportLeads}
                    disabled={!leads.length}
                  >
                    <ArrowDownToLine size={16} />
                    Export leads
                  </button>
                ) : view === "contacts" ? (
                  <button className="calling-button" onClick={downloadTemplate}>
                    <FileSpreadsheet size={16} />
                    CSV template
                  </button>
                ) : null}
              </header>
              <div className="calling-table-toolbar">
                {scopeSelect}
                <label className="calling-search">
                  <Search size={17} />
                  <input
                    aria-label="Search contacts"
                    placeholder="Search business, owner, or number…"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
                {view !== "leads" && (
                  <select
                    aria-label="Filter contacts by call status"
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                  >
                    <option value="all">All statuses</option>
                    {[...new Set(scopedLeads.map((lead) => lead.status))].map(
                      (status) => (
                        <option key={status} value={status}>
                          {label(status)}
                        </option>
                      ),
                    )}
                  </select>
                )}
              </div>
              {selectedId && !campaign ? (
                <div className="calling-loading" role="status">
                  <LoaderCircle size={20} className="spin" />
                  Loading campaign…
                </div>
              ) : leads.length ? (
                leadTable
              ) : (
                <EmptyState
                  icon={
                    view === "leads"
                      ? Target
                      : view === "calls"
                        ? PhoneCall
                        : Users
                  }
                  title={
                    query || filter !== "all"
                      ? "No matching contacts"
                      : view === "leads"
                        ? "Your next partnership is a conversation away"
                        : view === "calls"
                          ? "Ready when your first call is"
                          : "Your contact list starts here"
                  }
                  action={
                    query || filter !== "all" ? (
                      <button
                        className="calling-button"
                        onClick={() => {
                          setQuery("");
                          setFilter("all");
                        }}
                      >
                        Clear filters
                      </button>
                    ) : !campaigns.length ? (
                      newButton
                    ) : (
                      <button
                        className="calling-button"
                        onClick={() => select(selectedId, true)}
                      >
                        View campaign <ArrowRight size={15} />
                      </button>
                    )
                  }
                >
                  {query || filter !== "all"
                    ? "Try a different search or clear the filters."
                    : view === "leads"
                      ? "Interested owners will appear here once your AI captures their response."
                      : view === "calls"
                        ? "Start a campaign to see its call activity and captured outcomes here."
                        : "Upload a CSV when you create a campaign to bring your contacts into the workspace."}
                </EmptyState>
              )}
            </div>
          )}
          {view === "settings" && (
            <div className="calling-settings-grid">
              <section className="calling-panel">
                <header className="calling-panel-heading">
                  <div>
                    <h2>Your company</h2>
                    <p>The business behind every introduction.</p>
                  </div>
                  <Building2 size={21} />
                </header>
                <div className="calling-settings-body">
                  <span className="calling-company-monogram">
                    {company.slice(0, 1)}
                  </span>
                  <h3>{company}</h3>
                  <p>
                    {clientData?.website_url &&
                    clientData.website_url !== "pending"
                      ? clientData.website_url
                      : "Add your website during company setup."}
                  </p>
                  <dl className="calling-result-details">
                    <div>
                      <dt>Contact number</dt>
                      <dd>{clientData?.business_phone || "Not added"}</dd>
                    </div>
                    <div>
                      <dt>Workspace account</dt>
                      <dd>{user?.email}</dd>
                    </div>
                    <div>
                      <dt>Calling market</dt>
                      <dd>United Kingdom</dd>
                    </div>
                    <div>
                      <dt>Calling schedule</dt>
                      <dd>Weekdays · Europe/London</dd>
                    </div>
                  </dl>
                  <button className="calling-button" onClick={onEditCompany}>
                    Edit company details <ArrowUpRight size={15} />
                  </button>
                </div>
              </section>
              <section className="calling-panel">
                <header className="calling-panel-heading">
                  <div>
                    <h2>Calling readiness</h2>
                    <p>
                      {!config
                        ? "Configuration is unavailable."
                        : config.configuration_errors?.length
                          ? "Your administrator has a few connections to finish."
                          : "The required provider settings are present."}
                    </p>
                  </div>
                  <Settings2 size={21} />
                </header>
                <div className="calling-settings-body">
                  {[
                    ["Twilio", "Outbound phone calls", ["TWILIO"]],
                    ["Ultravox", "AI voice conversations", ["ULTRAVOX"]],
                    [
                      "Team handoff",
                      "Interested-owner notifications",
                      ["SMTP", "FROM_EMAIL"],
                    ],
                    [
                      "Call callbacks",
                      "Secure conversation results",
                      ["OUTREACH_TOOL_SECRET", "API_PUBLIC_BASE_URL"],
                    ],
                  ].map(([name, detail, keys]) => {
                    const missing =
                      !config ||
                      config.configuration_errors?.some((message) =>
                        keys.some((key) => message.includes(key)),
                      );
                    return (
                      <div className="calling-provider" key={name}>
                        <span className="calling-provider-icon">
                          {name === "Twilio" ? (
                            <PhoneCall size={19} />
                          ) : name === "Ultravox" ? (
                            <AudioLines size={19} />
                          ) : name === "Team handoff" ? (
                            <Target size={19} />
                          ) : (
                            <ShieldCheck size={19} />
                          )}
                        </span>
                        <div>
                          <strong>{name}</strong>
                          <small>{detail}</small>
                        </div>
                        <Status
                          value={
                            !config
                              ? "unknown"
                              : missing
                                ? "setup_required"
                                : "configured"
                          }
                        />
                      </div>
                    );
                  })}
                  <div className="calling-number-section">
                    <h3>Lead summary emails</h3>
                    <dl className="calling-result-details">
                      <div><dt>From</dt><dd>{config?.from_email || "Unavailable"}</dd></div>
                      <div><dt>Default recipient</dt><dd>{config?.notification_email || "Unavailable"}</dd></div>
                    </dl>
                    <p>New campaigns and manual calls use this recipient by default. You can change it when preparing a call.</p>
                  </div>
                  <div className="calling-number-section">
                    <h3>Outbound numbers</h3>
                    {config?.caller_ids?.length ? (
                      config.caller_ids.map((number) => (
                        <div className="calling-caller-number" key={number}>
                          <Phone size={17} />
                          <strong>{number}</strong>
                          <span>Available caller ID</span>
                        </div>
                      ))
                    ) : (
                      <p>
                        No active calling number is assigned to this account.
                        Ask your administrator to assign a Twilio caller ID.
                      </p>
                    )}
                  </div>
                  <EmailVerificationPanel key={user?.email} user={user} onAuthRequired={failed} />
                  <p className="calling-fine-print">
                    Provider credentials and caller-number assignments are
                    managed by your deployment administrator. “Configured”
                    confirms that settings are present; it does not verify
                    provider connectivity.
                  </p>
                  {config?.configuration_errors?.length > 0 && (
                    <details className="calling-config-details">
                      <summary>Administrator setup details</summary>
                      <ul>
                        {config.configuration_errors.map((message) => (
                          <li key={message}>{message}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              </section>
              <section className="calling-panel calling-settings-policy">
                <ShieldCheck size={24} />
                <div>
                  <h3>Respect the person at the other end.</h3>
                  <p>
                    Campaigns use UK contacts. Previous opt-outs are skipped.
                    The AI captures follow-up permission so your team knows the
                    next step.
                  </p>
                </div>
              </section>
            </div>
          )}
          <div className="calling-sync">
            <span className="calling-region-dot" />
            {lastUpdated
              ? `Updated ${lastUpdated.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} · Refreshes every 15 seconds`
              : "Waiting for calling data"}
            <span>UK · Europe/London</span>
          </div>
        </>
      )}
      {wizard && (
        <CampaignWizard
          user={user}
          config={config}
          company={company}
          onClose={() => setWizard(false)}
          onCreate={create}
        />
      )}
      {manualDial && (
        <ManualCallDialog
          user={user}
          config={config}
          campaigns={campaigns}
          defaultCampaign={campaign}
          defaultCallerId={manualCaller}
          onAddBalance={() => { setManualDial(false); onNavigate?.("billing"); }}
          onClose={() => setManualDial(false)}
          onStarted={() => { load().catch(failed); }}
          onConversation={(call) => {
            setManualDial(false);
            setManualRecord(call);
          }}
          onAuthRequired={failed}
        />
      )}
      {smsFrom !== null && (
        <SmsDialog user={user} numbers={config?.numbers || []} initialFrom={smsFrom}
          onClose={() => setSmsFrom(null)} onChanged={numbersChanged} onAuthRequired={failed} />
      )}
      {buyNumber && (
        <BuyNumberDialog user={user} initialPurchase={purchaseToReview} onClose={() => setBuyNumber(false)}
          onChanged={numbersChanged} onAuthRequired={failed} />
      )}
      {priceApproval && <CampaignPriceDialog quote={priceApproval} billing={config?.billing} busy={busy} error={error}
        onClose={() => { if (!busy) setPriceApproval(null); }}
        onApprove={() => action("start", priceApproval.id)}
        onAddBalance={() => { setPriceApproval(null); onNavigate?.("billing"); }} />}
      {currentLead && (
        <ConversationDrawer
          key={currentLead.id}
          lead={currentLead}
          user={user}
          onClose={() => { setLeadId(null); setManualRecord(null); }}
          onReviewed={refresh}
        />
      )}
    </section>
  );
}
