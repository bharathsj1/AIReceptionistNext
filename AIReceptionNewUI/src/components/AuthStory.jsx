import { ArrowUpRight, Check, Phone, Sparkles } from "lucide-react";

export default function AuthStory({ checkoutPlanSummary }) {
  return (
    <aside className="auth-story">
      <span className="auth-story-label">
        <Sparkles size={16} /> A little less busywork
      </span>
      <h3>
        More human connections.
        <br />
        Less on your plate.
      </h3>
      <p>
        Your calls, messages, and follow-ups. One calm place to bring it all
        together.
      </p>
      <div className="auth-story-card">
        <span className="story-icon">
          <Phone size={20} />
        </span>
        <div>
          <strong>Your next conversation, covered.</strong>
          <span>AI answers. Your team stays in the loop.</span>
        </div>
        <ArrowUpRight size={18} />
      </div>
      <ul>
        {[
          "Answer calls around the clock",
          "Turn conversations into clear next steps",
          "Keep your calendar and CRM connected",
        ].map((text) => (
          <li key={text}>
            <Check size={16} />
            {text}
          </li>
        ))}
      </ul>
      {checkoutPlanSummary && (
        <div className="auth-selected-plan">
          <span>Your selected plan</span>
          <strong>
            {checkoutPlanSummary.name}
            <span>{checkoutPlanSummary.price}</span>
          </strong>
        </div>
      )}
      <div className="auth-story-foot">
        <span className="status-dot" /> Built around your business
      </div>
    </aside>
  );
}
