import {
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  Check,
  FileSpreadsheet,
  PhoneCall,
  Target,
  Users,
} from "lucide-react";
import Brand from "../components/Brand";
import "./OutreachLanding.css";

export default function LandingScreen({ onTry, onLogin }) {
  return (
    <div className="outreach-landing">
      <section className="outreach-home-hero">
        <div className="outreach-home-copy">
          <span className="outreach-home-kicker">
            <span />
            COMPANY OUTREACH, BUILT AROUND CONVERSATION
          </span>
          <h1>
            Your next partnership
            <br />
            starts with <em>a call.</em>
          </h1>
          <p>
            Put your company’s pitch into motion. Upload your contacts, let AI
            have the first conversation, and give your team interested owners to
            follow up with.
          </p>
          <div className="outreach-home-actions">
            <button className="sc-button sc-button-primary" onClick={onTry}>
              Build your calling workspace <ArrowUpRight size={18} />
            </button>
            <button className="outreach-home-login" onClick={onLogin}>
              Already have an account? <ArrowRight size={16} />
            </button>
          </div>
          <div className="outreach-home-benefits">
            <span>
              <Check size={14} />
              UK outbound calling
            </span>
            <span>
              <Check size={14} />
              Your offer, your contacts
            </span>
            <span>
              <Check size={14} />
              Clear team handoffs
            </span>
          </div>
        </div>
        <div
          className="outreach-home-visual"
          aria-label="How company outreach works"
        >
          <div className="outreach-home-orbit" />
          <div className="outreach-home-orbit is-outer" />
          <div className="outreach-home-file">
            <span>
              <FileSpreadsheet size={19} />
            </span>
            <div>
              <strong>Your contact list</strong>
              <small>The right people to call</small>
            </div>
            <Check size={16} />
          </div>
          <div className="outreach-home-call">
            <header>
              <span className="outreach-home-agent">
                <AudioLines size={23} />
              </span>
              <div>
                <strong>Your AI calling assistant</strong>
                <span>One good introduction at a time</span>
              </div>
            </header>
            <div className="outreach-home-wave" aria-hidden="true">
              {[
                17, 29, 44, 26, 57, 75, 40, 63, 85, 46, 70, 34, 58, 78, 47, 27,
                43, 21, 33,
              ].map((height, i) => (
                <i style={{ height }} key={i} />
              ))}
            </div>
            <footer>
              <span>Introduce your company</span>
              <ArrowRight size={12} />
              <span>Understand interest</span>
            </footer>
          </div>
          <div className="outreach-home-lead">
            <span>
              <Target size={21} />
            </span>
            <div>
              <small>THE NEXT STEP</small>
              <strong>
                An interested owner.
                <br />A prepared team.
              </strong>
            </div>
            <ArrowUpRight size={19} />
          </div>
          <span className="outreach-home-visual-note">
            Your list → A conversation → An opportunity
          </span>
        </div>
      </section>
      <section className="outreach-home-strip">
        <span>ONE FOCUSED WORKSPACE</span>
        <div>
          <FileSpreadsheet size={17} />
          Contacts
        </div>
        <i />
        <div>
          <AudioLines size={18} />
          Campaigns
        </div>
        <i />
        <div>
          <PhoneCall size={17} />
          Conversations
        </div>
        <i />
        <div>
          <Target size={17} />
          Interested leads
        </div>
      </section>
      <section className="outreach-home-section" id="how-it-works">
        <div className="outreach-home-section-title">
          <div>
            <span className="outreach-home-kicker">
              FROM YOUR FIRST LIST TO YOUR NEXT PARTNERSHIP
            </span>
            <h2>
              A little preparation.
              <br />A lot more possibility.
            </h2>
          </div>
          <p>
            Keep the first conversation moving, and let your team focus on the
            people who want to hear more.
          </p>
        </div>
        <div className="outreach-home-steps">
          {[
            [
              FileSpreadsheet,
              "01",
              "Bring your contacts.",
              "Upload your UK restaurant contacts from a CSV. Check the imported details before calling.",
            ],
            [
              AudioLines,
              "02",
              "Give your AI a clear pitch.",
              "Share your verified benefits, choose a caller ID, and set your calling window. Start when you’re ready.",
            ],
            [
              Target,
              "03",
              "Turn interest into a next step.",
              "Review owner responses, contact details, callback preferences, and follow-up permission in your workspace.",
            ],
          ].map(([Icon, number, title, copy]) => (
            <article key={number}>
              <div>
                <span>
                  <Icon size={24} />
                </span>
                <small>{number}</small>
              </div>
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="outreach-home-focus" id="features">
        <div>
          <span className="outreach-home-kicker">
            LESS ADMIN. MORE CONVERSATION.
          </span>
          <h2>
            Everything your calling
            <br />
            team needs to move forward.
          </h2>
          <p>
            A dedicated place to launch campaigns, see what happened, and find
            the next opportunity.
          </p>
          <button className="sc-button sc-button-primary" onClick={onTry}>
            Start with your company <ArrowUpRight size={17} />
          </button>
        </div>
        <ul>
          {[
            [
              Users,
              "Your contacts, in context",
              "See each business, phone number, and call status.",
            ],
            [
              PhoneCall,
              "A clear view of every attempt",
              "Review outcomes and captured conversation summaries.",
            ],
            [
              Target,
              "Interested leads, ready for your team",
              "Export lead details and send permitted follow-ups to your team.",
            ],
            [
              Check,
              "You choose when calling starts",
              "Review your campaign first. Start, pause, and resume from one place.",
            ],
          ].map(([Icon, title, copy]) => (
            <li key={title}>
              <span>
                <Icon size={19} />
              </span>
              <div>
                <h3>{title}</h3>
                <p>{copy}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <footer className="outreach-home-footer">
        <Brand />
        <span>Better conversations. Clearer next steps.</span>
        <button onClick={onLogin}>
          Sign in <ArrowRight size={14} />
        </button>
      </footer>
    </div>
  );
}
