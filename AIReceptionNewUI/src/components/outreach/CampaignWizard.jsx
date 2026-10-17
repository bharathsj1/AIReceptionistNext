import { useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileSpreadsheet,
  LoaderCircle,
  UploadCloud,
  X,
} from "lucide-react";
import { useDialogFocus } from "../ui/useDialogFocus";

export function downloadCsv(filename, rows) {
  const cell = (value) => {
    let text = String(value ?? "");
    if (/^[\s]*[=+@-]/.test(text) && !/^\+44\d+$/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const blob = new Blob(
    [rows.map((row) => row.map(cell).join(",")).join("\r\n")],
    { type: "text/csv;charset=utf-8" },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadTemplate() {
  downloadCsv("vedora-contacts-template.csv", [
    [
      "phone",
      "restaurant_name",
      "owner_name",
      "email",
      "city",
    ],
  ]);
}

export default function CampaignWizard({ user, config, onClose, onCreate, company }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    name: "",
    benefits: config?.company_pitch || "",
    notification_email: user?.email || config?.notification_email || "",
    caller_id: config?.caller_ids?.[0] || "",
  });
  const [file, setFile] = useState(null);
  const [csv, setCsv] = useState("");
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef(null);
  const fileVersion = useRef(0);
  const close = () => {
    if (!busy) onClose();
  };
  useDialogFocus(dialogRef, true, close);
  const update = (key) => (event) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));
  const readFile = async (selected) => {
    const version = ++fileVersion.current;
    setFile(null);
    setCsv("");
    setError("");
    setReading(false);
    if (!selected) return;
    if (
      !selected.name.toLowerCase().endsWith(".csv") ||
      selected.size > 2 * 1024 * 1024 ||
      !selected.size
    ) {
      setError("Choose a non-empty CSV file up to 2 MB.");
      return;
    }
    setReading(true);
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        await selected.arrayBuffer(),
      );
      if (version !== fileVersion.current) return;
      setFile(selected);
      setCsv(text);
    } catch {
      if (version === fileVersion.current)
        setError("Save your CSV with UTF-8 encoding and try again.");
    } finally {
      if (version === fileVersion.current) setReading(false);
    }
  };
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    if (step < 2) {
      setStep(step + 1);
      return;
    }
    setBusy(true);
    try {
      await onCreate({
        ...form,
        csv_text: csv,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="calling-dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        className="calling-dialog calling-wizard"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="campaign-wizard-title"
        tabIndex={-1}
      >
        <header className="calling-dialog-heading">
          <div>
            <span className="calling-eyebrow">LET’S START A CONVERSATION</span>
            <h2 id="campaign-wizard-title">New campaign</h2>
          </div>
          <button
            className="calling-icon"
            onClick={close}
            disabled={busy}
            aria-label="Close campaign creation"
          >
            <X size={20} />
          </button>
        </header>
        <ol className="calling-wizard-steps">
          {["Your pitch", "Your contacts", "Calling details"].map(
            (title, index) => (
              <li
                key={title}
                className={
                  index === step
                    ? "is-current"
                    : index < step
                      ? "is-complete"
                      : ""
                }
                aria-current={index === step ? "step" : undefined}
              >
                <span>{index < step ? <Check size={14} /> : index + 1}</span>
                {title}
              </li>
            ),
          )}
        </ol>
        <form onSubmit={submit} className="calling-wizard-form">
          {step === 0 && (
            <div className="calling-form-fields">
              <div>
                <h3>What should your AI talk about?</h3>
                <p>
                  A clear, accurate pitch makes every conversation more useful.
                </p>
              </div>
              <label>
                Campaign name
                <input
                  autoFocus
                  required
                  maxLength={150}
                  placeholder="e.g. Manchester restaurant partnerships"
                  value={form.name}
                  onChange={update("name")}
                />
              </label>
              <label>
                Your offer and benefits
                <textarea
                  required
                  rows={7}
                  maxLength={12000}
                  placeholder={`Describe what ${company === "Your company" ? "your company" : company} offers, who it helps, and the benefits the AI should explain. Only include confirmed facts and pricing.`}
                  value={form.benefits}
                  onChange={update("benefits")}
                />
              </label>
              <div className="calling-info">
                <AudioWave />
                <p>
                  The AI introduces itself, explains your offer, and asks about
                  interest. It collects the owner’s name, contact details,
                  callback preference, and follow-up permission.
                </p>
              </div>
            </div>
          )}
          {step === 1 && (
            <div className="calling-form-fields">
              <div>
                <h3>Bring your next opportunities.</h3>
                <p>
                  Upload your UK restaurant contacts. You’ll review the import
                  before any calls start.
                </p>
              </div>
              <label
                className={`calling-dropzone ${file ? "has-file" : ""}`}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  readFile(event.dataTransfer.files?.[0]);
                }}
              >
                <input
                  type="file"
                  accept=".csv,text/csv"
                  aria-label="Upload contacts CSV"
                  onChange={(event) => readFile(event.target.files?.[0])}
                />
                <span className="calling-drop-icon">
                  {file ? (
                    <FileSpreadsheet size={29} />
                  ) : (
                    <UploadCloud size={29} />
                  )}
                </span>
                <strong>
                  {reading
                    ? "Reading your file…"
                    : file
                      ? file.name
                      : "Choose a CSV or drop it here"}
                </strong>
                <span>
                  {file
                    ? `${(file.size / 1024).toFixed(1)} KB · Click to replace`
                    : "UTF-8 CSV · Up to 2 MB"}
                </span>
              </label>
              <button
                className="calling-text-button"
                type="button"
                onClick={downloadTemplate}
              >
                <FileSpreadsheet size={16} />
                Download CSV template <ArrowRight size={14} />
              </button>
              <div className="calling-csv-guide">
                <strong>A few details for a good introduction</strong>
                <p>
                  Required: <code>phone</code> and <code>restaurant_name</code>.
                </p>
                <p>
                  Optional: owner_name, email, city, and any other context. UK
                  numbers can start with 020, 07, or +44.
                </p>
              </div>
              <p className="calling-fine-print">
                Previously opted-out contacts are skipped automatically.
              </p>
            </div>
          )}
          {step === 2 && (
            <div className="calling-form-fields">
              <div>
                <h3>The right number. The right time.</h3>
                <p>
                  Set a calling window and tell us where to send
                  interested-owner summaries.
                </p>
              </div>
              <label>
                Outbound caller ID
                <select
                  required
                  value={form.caller_id}
                  onChange={update("caller_id")}
                >
                  <option value="">Select a calling number</option>
                  {config?.caller_ids?.map((number) => (
                    <option key={number}>{number}</option>
                  ))}
                </select>
              </label>
              {!config?.caller_ids?.length && (
                <p className="calling-inline-warning">
                  No active caller ID is available. Your administrator needs to
                  assign a Twilio number to this account.
                </p>
              )}
              <label>
                Team notification email
                <input
                  required
                  type="email"
                  maxLength={254}
                  placeholder="partnerships@yourcompany.com"
                  value={form.notification_email}
                  onChange={update("notification_email")}
                />
                <small>
                  Interested owners who allow follow-up are automatically sent
                  to your team.
                </small>
              </label>
              <p className="calling-fine-print">
                Available any day, at any time. Calls run one at a time per
                campaign. Creating a campaign imports your contacts; calling
                starts only when you choose “Start calling”.
              </p>
              <div className="calling-import-summary">
                <FileSpreadsheet size={20} />
                <div>
                  <strong>{file?.name}</strong>
                  <span>{form.name}</span>
                </div>
                <Check size={18} />
              </div>
            </div>
          )}
          {error && (
            <div className="calling-alert is-error" role="alert">
              {error}
            </div>
          )}
          <footer className="calling-dialog-footer">
            <button
              type="button"
              className="calling-button"
              disabled={busy}
              onClick={() => (step ? setStep(step - 1) : close())}
            >
              {step ? <ArrowLeft size={16} /> : null}
              {step ? "Back" : "Cancel"}
            </button>
            <span>Step {step + 1} of 3</span>
            <button
              className="calling-button is-primary"
              disabled={
                busy ||
                reading ||
                (step === 1 && !csv) ||
                (step === 2 && !form.caller_id)
              }
            >
              {busy ? <LoaderCircle size={16} className="spin" /> : null}
              {busy
                ? "Importing…"
                : step === 2
                  ? "Import & review"
                  : "Continue"}
              <ArrowRight size={16} />
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function AudioWave() {
  return (
    <span className="calling-mini-wave" aria-hidden="true">
      {[10, 20, 15, 28, 18].map((height, i) => (
        <i key={i} style={{ height }} />
      ))}
    </span>
  );
}
