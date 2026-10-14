import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  CircleCheck,
  Clock3,
  Headphones,
  Inbox,
  LayoutGrid,
  Mail,
  MessageCircle,
  Phone,
  Play,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import PricingPackages from "../components/PricingPackages";
import Brand from "../components/Brand";

const modules = [
  {
    id: "receptionist",
    icon: Phone,
    title: "A warm welcome. Every time.",
    label: "AI receptionist",
    copy: "Give every caller your full attention, even when your team is busy. Natural conversations, thoughtful routing, and all the details captured.",
    bullets: [
      "Answer calls around the clock",
      "Capture leads and book appointments",
      "Hand the right calls to the right people",
    ],
    color: "mint",
  },
  {
    id: "email-manager",
    icon: Mail,
    title: "An inbox that feels lighter.",
    label: "Email manager",
    copy: "Move from a pile of messages to a clear plan. Let AI summarise, prioritise, and draft while you stay in control of what gets sent.",
    bullets: [
      "See what needs your attention",
      "Review thoughtful reply drafts",
      "Keep follow-ups moving",
    ],
    color: "lilac",
  },
  {
    id: "social-manager",
    icon: MessageCircle,
    title: "Keep the conversation going.",
    label: "Social manager",
    copy: "Bring your social conversations and content into one workspace. Plan your next post and respond without losing the thread.",
    bullets: [
      "Connect your social channels",
      "Manage messages in one place",
      "Create and schedule your content",
    ],
    color: "peach",
  },
];
const faqs = [
  [
    "How does the AI learn about my business?",
    "Share your website during setup or enter your business details yourself. You can review the information and refine your receptionist’s instructions before going live.",
  ],
  [
    "Can I still speak to my customers?",
    "Of course. Configure routing rules and warm transfers so important conversations reach your team. AI handles the routine questions and captures context for you.",
  ],
  [
    "Can I use my existing tools?",
    "Connect supported Google or Outlook accounts for email and calendars, and bring your phone and social channels into the workspace. Available connections are shown in your settings.",
  ],
  [
    "Can I change my plan later?",
    "Choose the plan that fits your business today. You can review your subscription and usage in the workspace. For a tailored setup, get in touch with our team.",
  ],
];

function Reveal({ children, className = "", delay = 0 }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.12 }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

function WorkspacePreview() {
  const [active, setActive] = useState("inbox");
  return (
    <div
      className="workspace-preview"
      aria-label="Illustrative workspace preview"
    >
      <div className="preview-top">
        <Brand compact />
        <span>Acme workspace</span>
        <span className="preview-live">
          <span className="status-dot" /> Workspace preview
        </span>
      </div>
      <div className="preview-body">
        <div className="preview-rail">
          {[
            [LayoutGrid, "overview"],
            [Inbox, "inbox"],
            [Phone, "calls"],
            [CheckCheck, "tasks"],
          ].map(([Icon, id]) => (
            <button
              type="button"
              key={id}
              className={active === id ? "is-active" : ""}
              aria-label={`Preview ${id}`}
              aria-pressed={active === id}
              onClick={() => setActive(id)}
            >
              <Icon size={18} />
            </button>
          ))}
        </div>
        <div className="preview-content">
          <div className="preview-heading">
            <div>
              <span>YOUR DAY, AT A GLANCE</span>
              <h3>
                {active === "calls"
                  ? "Every call, covered."
                  : active === "tasks"
                    ? "A clear next step."
                    : active === "overview"
                      ? "Room to focus."
                      : "Good morning, Alex"}
              </h3>
            </div>
            <span className="preview-avatar">A</span>
          </div>
          <div className="preview-stats">
            <div>
              <span>Conversations</span>
              <strong>
                24 <small>today</small>
              </strong>
            </div>
            <div>
              <span>Ready to review</span>
              <strong>
                03{" "}
                <span className="preview-spark">
                  <Sparkles size={13} />
                </span>
              </strong>
            </div>
          </div>
          <div className="preview-list-title">
            <span>
              {active === "tasks"
                ? "Next up"
                : active === "calls"
                  ? "Recent conversations"
                  : "Your unified inbox"}
            </span>
            <span>Illustrative data</span>
          </div>
          {(active === "tasks"
            ? [
                [
                  "JL",
                  "Follow up with Jamie",
                  "New enquiry · assigned to you",
                  "Today",
                ],
                [
                  "EM",
                  "Confirm Emily’s booking",
                  "Appointment request",
                  "Today",
                ],
                ["RK", "Send the quote to Ryan", "Email follow-up", "Tomorrow"],
              ]
            : [
                [
                  "JL",
                  "Jamie Lewis",
                  "Can I book a consultation this week?",
                  "2m",
                ],
                [
                  "EM",
                  "Emily Morgan",
                  "Thanks, Thursday works perfectly.",
                  "12m",
                ],
                ["RK", "Ryan Kim", "Could you send me a quote?", "34m"],
              ]
          ).map(([initials, name, message, time], index) => (
            <motion.div
              key={name}
              className="preview-message"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <span className={`preview-person person-${index}`}>
                {initials}
              </span>
              <div>
                <strong>{name}</strong>
                <p>{message}</p>
              </div>
              <span>{time}</span>
            </motion.div>
          ))}
          <div className="preview-ai-note">
            <Sparkles size={16} />
            <div>
              <strong>A head start on your next reply.</strong>
              <span>AI drafts. You make it personal.</span>
            </div>
            <ArrowUpRight size={17} />
          </div>
        </div>
      </div>
      <div className="preview-call">
        <span className="preview-call-icon">
          <Phone size={16} />
        </span>
        <div>
          <strong>One less missed conversation.</strong>
          <span>Your AI receptionist is on it.</span>
        </div>
        <div className="waveform" aria-hidden="true">
          {[8, 18, 26, 12, 22, 30, 16, 10].map((height, i) => (
            <i key={i} style={{ height, animationDelay: `${i * 0.12}s` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function LandingScreen({
  onTry,
  onLogin,
  onSelectPlan,
  onShowService,
  geoCountryCode,
  fxRates,
}) {
  const [selectedModule, setSelectedModule] = useState(0);
  const current = modules[selectedModule];
  const Icon = current.icon;
  return (
    <div className="marketing-page">
      <section className="marketing-hero">
        <div className="hero-orbit" aria-hidden="true" />
        <Reveal className="hero-copy">
          <span className="pill-label">
            <span className="status-dot" /> Your business, a little more
            connected
          </span>
          <h1>
            Great conversations.
            <br />
            <span>Less busywork.</span>
          </h1>
          <p>
            Meet the calm behind your busy business. Calls, emails, social
            messages, and follow-ups — thoughtfully connected in one AI-powered
            workspace.
          </p>
          <div className="hero-actions">
            <button className="sc-button sc-button-primary" onClick={onTry}>
              Build my workspace <ArrowRight size={17} />
            </button>
            <a className="sc-button sc-button-secondary" href="/contact.html">
              <Play size={15} /> Book a demo
            </a>
          </div>
          <div className="hero-reassurance">
            <span>
              <Check size={14} /> Your team stays in control
            </span>
            <span>
              <Check size={14} /> Built around your business
            </span>
          </div>
        </Reveal>
        <Reveal className="hero-product" delay={0.12}>
          <WorkspacePreview />
        </Reveal>
      </section>
      <section className="connection-strip" aria-label="Connected channels">
        <span>ALL YOUR CONVERSATIONS, TOGETHER</span>
        <div>
          {[
            [Phone, "Phone"],
            [Mail, "Email"],
            [MessageCircle, "WhatsApp"],
            [Users, "Facebook"],
            [Inbox, "Instagram"],
            [CalendarDays, "Calendar"],
          ].map(([Icon, name]) => (
            <span key={name}>
              <Icon size={17} />
              {name}
            </span>
          ))}
        </div>
      </section>
      <section className="marketing-section" id="features">
        <Reveal className="section-heading">
          <span className="eyebrow">ONE WORKSPACE. MORE POSSIBILITIES.</span>
          <h2>
            Make room for
            <br />
            the work you love.
          </h2>
          <p>
            Let AI handle the repetitive parts. Keep your attention on the
            people and decisions that matter.
          </p>
        </Reveal>
        <Reveal className="module-showcase">
          <div
            className="module-tabs"
            role="tablist"
            aria-label="Explore your tools"
          >
            {modules.map((module, index) => (
              <button
                key={module.id}
                type="button"
                role="tab"
                id={`module-tab-${index}`}
                aria-selected={selectedModule === index}
                aria-controls="module-panel"
                tabIndex={selectedModule === index ? 0 : -1}
                className={selectedModule === index ? "is-active" : ""}
                onClick={() => setSelectedModule(index)}
                onKeyDown={(event) => {
                  if (
                    ["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                      event.key,
                    )
                  ) {
                    event.preventDefault();
                    const next =
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? modules.length - 1
                          : (index +
                              (event.key === "ArrowRight" ? 1 : -1) +
                              modules.length) %
                            modules.length;
                    setSelectedModule(next);
                    document.getElementById(`module-tab-${next}`)?.focus();
                  }
                }}
              >
                <module.icon size={18} />
                {module.label}
              </button>
            ))}
          </div>
          <div
            id="module-panel"
            role="tabpanel"
            aria-labelledby={`module-tab-${selectedModule}`}
            className={`module-panel module-${current.color}`}
          >
            <div className="module-copy">
              <span className="module-icon">
                <Icon size={24} />
              </span>
              <h3>{current.title}</h3>
              <p>{current.copy}</p>
              <ul>
                {current.bullets.map((text) => (
                  <li key={text}>
                    <CircleCheck size={17} />
                    {text}
                  </li>
                ))}
              </ul>
              <button
                className="text-action"
                onClick={() => onShowService?.(current.id)}
              >
                Explore {current.label.toLowerCase()} <ArrowUpRight size={17} />
              </button>
            </div>
            <div className="module-illustration">
              <span className="module-art-orbit" />
              <div className="module-art-center">
                <Icon size={42} strokeWidth={1.4} />
              </div>
              <div className="module-art-note">
                <Sparkles size={17} />
                <span>
                  {selectedModule === 0
                    ? "A new enquiry, captured."
                    : selectedModule === 1
                      ? "Your reply draft is ready."
                      : "Your next post, planned."}
                </span>
                <Check size={17} />
              </div>
              <span className="module-art-label">
                A smoother day starts here.
              </span>
            </div>
          </div>
        </Reveal>
        <div className="feature-trio">
          {[
            [
              CheckCheck,
              "From conversation to action",
              "Give every follow-up a home with tasks, contacts, and a connected CRM.",
            ],
            [
              CalendarDays,
              "Keep everyone in the loop",
              "Manage appointments and meetings alongside the conversations that started them.",
            ],
            [
              ShieldCheck,
              "Your business. Your controls.",
              "Shape your AI’s voice, routing, and behaviour. Give each teammate the access they need.",
            ],
          ].map(([Icon, title, text], index) => (
            <Reveal className="feature-mini" key={title} delay={index * 0.06}>
              <span>
                <Icon size={22} />
              </span>
              <h3>{title}</h3>
              <p>{text}</p>
            </Reveal>
          ))}
        </div>
      </section>
      <section className="marketing-how" id="how-it-works">
        <div className="marketing-section">
          <Reveal className="section-heading">
            <span className="eyebrow">A SIMPLE START</span>
            <h2>
              From hello
              <br />
              to ready to go.
            </h2>
            <p>
              A guided setup that feels like a conversation, with space to make
              it yours.
            </p>
          </Reveal>
          <div className="how-steps">
            {[
              [
                "01",
                "Tell us about your business",
                "Share your website or add your details. Review what your AI should know.",
              ],
              [
                "02",
                "Make it sound like you",
                "Choose your plan, voice, and greeting. Set up how calls reach your team.",
              ],
              [
                "03",
                "Bring your team together",
                "Connect your channels and start managing conversations in your workspace.",
              ],
            ].map(([number, title, text], index) => (
              <Reveal key={number} delay={index * 0.08}>
                <span className="how-number">{number}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>
      <section className="marketing-section marketing-pricing" id="plans">
        <Reveal>
          <PricingPackages
            onSelectPackage={onSelectPlan}
            geoCountryCode={geoCountryCode}
            fxRates={fxRates}
          />
        </Reveal>
      </section>
      <section className="marketing-section faq-section">
        <Reveal>
          <span className="eyebrow">GOOD QUESTIONS</span>
          <h2>
            A little clarity
            <br />
            before you start.
          </h2>
          <a className="text-action" href="/contact.html">
            Talk to a real person <ArrowUpRight size={17} />
          </a>
        </Reveal>
        <div>
          {faqs.map(([question, answer]) => (
            <details key={question} className="faq-item">
              <summary>
                {question}
                <ChevronDown size={18} />
              </summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </section>
      <Reveal className="marketing-final">
        <span className="pill-label">
          <Sparkles size={15} /> One workspace. A little more breathing room.
        </span>
        <h2>
          Let’s make your
          <br />
          next day feel different.
        </h2>
        <div className="hero-actions">
          <button className="sc-button sc-button-primary" onClick={onTry}>
            Get started <ArrowRight size={17} />
          </button>
          <button className="sc-button sc-button-secondary" onClick={onLogin}>
            Open my workspace
          </button>
        </div>
      </Reveal>
      <footer className="marketing-footer">
        <div>
          <Brand />
          <p>Thoughtfully connected. Ready for what’s next.</p>
        </div>
        <nav aria-label="Footer">
          {[
            ["/about", "About"],
            ["/careers.html", "Careers"],
            ["/blog.html", "Journal"],
            ["/contact.html", "Contact"],
            ["/privacy.html", "Privacy"],
            ["/terms.html", "Terms"],
          ].map(([href, label]) => (
            <a key={href} href={href}>
              {label}
            </a>
          ))}
        </nav>
        <span>© {new Date().getFullYear()} SmartConnect4u</span>
      </footer>
    </div>
  );
}
