import { AudioLines } from "lucide-react";

export default function Brand({ compact = false }) {
  return (
    <span className={`sc-brand ${compact ? "sc-brand--compact" : ""}`}>
      <span className="sc-brand-mark">
        <AudioLines size={22} strokeWidth={2.3} aria-hidden="true" />
      </span>
      {!compact && (
        <span>
          vedora<span className="sc-brand-suffix"> outreach</span>
        </span>
      )}
    </span>
  );
}
