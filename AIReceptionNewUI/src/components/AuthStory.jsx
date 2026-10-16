import { ArrowUpRight, Check, Phone, Sparkles } from "lucide-react";

export default function AuthStory({ checkoutPlanSummary }) {
  return (
    <aside className="auth-story">
      <span className="auth-story-label">
        <Sparkles size={16} /> YOUR NEXT OPPORTUNITY STARTS HERE
      </span>
      <h3>
        Your pitch.
        <br />
        More possibilities.
      </h3>
      <p>
        One focused workspace for your company’s outbound calls, owner
        conversations, and interested leads.
      </p>
      <div className="auth-story-card">
        <span className="story-icon">
          <Phone size={20} />
        </span>
        <div>
          <strong>Make the first connection.</strong>
          <span>
            AI introduces your company. Your team takes the next step.
          </span>
        </div>
        <ArrowUpRight size={18} />
      </div>
      <ul>
        {[
          "Upload contacts and build your campaign",
          "Explain your offer in a natural conversation",
          "Capture interest and follow-up permission",
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
