import {
  ArrowRight,
  AudioLines,
  CalendarDays,
  Check,
  CheckCheck,
  Mail,
  MessageCircle,
  Phone,
  Sparkles,
} from "lucide-react";
import UltravoxDemo from "../components/UltravoxDemo";
import Footer from "../components/Footer";

const services = {
  receptionist: {
    icon: Phone,
    label: "AI receptionist",
    headline: "Make every caller feel welcome.",
    copy: "A natural voice for your business, with the knowledge to help and the judgment to bring your team into the conversation.",
    features: [
      "A greeting that sounds like your business",
      "Business knowledge you can review and refine",
      "Call routing, transcripts, and clear follow-ups",
    ],
    steps: [
      [
        "Tell us what matters",
        "Share your business details and the questions customers ask most.",
      ],
      [
        "Find your voice",
        "Choose a voice and personalise your greeting and instructions.",
      ],
      [
        "Stay in the conversation",
        "Review calls and follow-ups from your connected workspace.",
      ],
    ],
  },
  "email-manager": {
    icon: Mail,
    label: "Email manager",
    headline: "A clear head. A clearer inbox.",
    copy: "From the first enquiry to the final follow-up, keep every thread moving with AI summaries and drafts you can make your own.",
    features: [
      "Your messages, prioritised and summarised",
      "AI reply drafts with you in control",
      "Contacts and follow-ups in the same workspace",
    ],
    steps: [
      [
        "Connect your inbox",
        "Bring supported email accounts into your workspace.",
      ],
      [
        "Get to the important part",
        "Review summaries, tags, and suggested next steps.",
      ],
      [
        "Reply with confidence",
        "Refine your drafts and keep the conversation moving.",
      ],
    ],
  },
  "social-manager": {
    icon: MessageCircle,
    label: "Social manager",
    headline: "Stay social. Stay organised.",
    copy: "Create, plan, and respond from one place. Give your team a shared view of the conversations happening around your business.",
    features: [
      "Connected social messages in one inbox",
      "AI assistance for your next caption",
      "A plan for your scheduled posts",
    ],
    steps: [
      [
        "Connect your channels",
        "Choose the supported social accounts you want to manage.",
      ],
      [
        "Make it your own",
        "Write your post or start with an AI-assisted caption.",
      ],
      [
        "Keep things moving",
        "Schedule content and respond to incoming conversations.",
      ],
    ],
  },
  "crm-lead-manager": {
    icon: CheckCheck,
    label: "CRM & leads",
    headline: "A home for every next step.",
    copy: "Bring your contacts, deals, tasks, and comments together. Give every conversation a clear owner and every opportunity a way forward.",
    features: [
      "A shared view of contacts and deals",
      "Task ownership and progress you can follow",
      "Conversation history and team comments",
    ],
    steps: [
      ["Bring people together", "Organise contacts and companies in your CRM."],
      [
        "Choose the next step",
        "Create tasks, track deals, and assign the right teammate.",
      ],
      ["See the whole story", "Keep notes, comments, and activity connected."],
    ],
  },
};
export default function ProjectsScreen({
  serviceSlug = "receptionist",
  onStartSignup,
}) {
  const service = services[serviceSlug] || services.receptionist;
  const Icon = service.icon;
  return (
    <div className="solution-page">
      <section className="solution-hero">
        <span className="pill-label">
          <Icon size={14} />
          {service.label}
        </span>
        <h1>{service.headline}</h1>
        <p>{service.copy}</p>
        <button className="sc-button sc-button-primary" onClick={onStartSignup}>
          Build my workspace <ArrowRight size={16} />
        </button>
      </section>
      <section className="solution-benefits">
        {service.features.map((feature) => (
          <div key={feature}>
            <Check size={19} />
            <h3>{feature}</h3>
          </div>
        ))}
      </section>
      {serviceSlug === "receptionist" && (
        <section className="solution-demo">
          <div>
            <p className="eyebrow">HEAR THE DIFFERENCE</p>
            <h2>Start a conversation.</h2>
            <p>
              Explore the live voice demo and see how a receptionist can help
              your customers.
            </p>
          </div>
          <UltravoxDemo />
        </section>
      )}
      <section className="solution-steps">
        <p className="eyebrow">A THOUGHTFUL WORKFLOW</p>
        <h2>Bring it all together.</h2>
        <div className="how-steps">
          {service.steps.map(([title, copy], index) => (
            <article key={title}>
              <span className="how-number">0{index + 1}</span>
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="solution-cta">
        <Sparkles size={22} />
        <h2>Your next day, a little easier.</h2>
        <button className="sc-button sc-button-primary" onClick={onStartSignup}>
          Get started <ArrowRight size={16} />
        </button>
      </section>
      <Footer />
    </div>
  );
}
