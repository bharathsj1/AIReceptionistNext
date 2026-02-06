import { useEffect, useMemo, useState, useRef } from "react";
import CapabilitiesSection from "../components/CapabilitiesSection";
// PricingPackages removed from home screen

const HERO_ROTATING_WORDS = [
  { word: "Reception", gradient: "linear-gradient(120deg, #f97316, #facc15)" },
  { word: "Emailing", gradient: "linear-gradient(120deg, #22c55e, #86efac)" },
  { word: "Chatting", gradient: "linear-gradient(120deg, #38bdf8, #60a5fa)" },
  { word: "Smart Calling", gradient: "linear-gradient(120deg, #a78bfa, #f472b6)" },
  { word: "Campaign", gradient: "linear-gradient(120deg, #fb7185, #f59e0b)" }
];
const HERO_ROTATE_INTERVAL_MS = 2000;
const HERO_FADE_MS = 300;

export default function LandingScreen({ onTry, onLogin, onSelectPlan, onShowService }) {
  const navItems = useMemo(
    () => [
      { id: "capabilities", label: "Capabilities" },
      { id: "technology", label: "Technology" },
      { id: "ai-team", label: "AI Team" },
      { id: "pricing", label: "Pricing" },
      { id: "testimonials", label: "Testimonials" }
    ],
    []
  );
  const [activeNavId, setActiveNavId] = useState(navItems[0]?.id || "");
  const activeNavIdRef = useRef(activeNavId);
  const [capNavOpen, setCapNavOpen] = useState(false);
  const [testimonialIndex, setTestimonialIndex] = useState(0);
  const [heroWordIndex, setHeroWordIndex] = useState(0);
  const [heroWordFading, setHeroWordFading] = useState(false);
  const testimonials = useMemo(
    () => [
      {
        name: "Alicia Morgan",
        role: "Operations Director, Apex Dental",
        focus: "AI Receptionist",
        quote:
          "Our AI receptionist books appointments after-hours, confirms visits, and answers routine questions instantly. No more missed calls, and our front desk finally has breathing room. Patients appreciate the quick answers and we see fewer no-shows each week."
      },
      {
        name: "Jesse Kim",
        role: "Founder, BlueOak Realty",
        focus: "AI Receptionist",
        quote:
          "Lead capture jumped because the AI receptionist qualifies callers, gathers requirements, and pushes the best leads straight to our agents in minutes. We spend less time on tire-kickers and more time closing. It also routes urgent calls to the right agent automatically."
      },
      {
        name: "Priya Das",
        role: "Head of Growth, Lumen Health",
        focus: "AI Social Media Manager",
        quote:
          "The AI social media manager keeps our calendar full of on-brand posts, monitors engagement, and replies to common questions faster than ever. We increased weekly engagement and click-throughs without extra hires. It even surfaces which topics to double down on."
      },
      {
        name: "Marco Silva",
        role: "Marketing Lead, Northbridge Fitness",
        focus: "AI Social Media Manager",
        quote:
          "We finally stopped scrambling for content. The AI schedules posts, answers DMs, and flags hot leads for our sales team. Class inquiries are handled 24/7, and the system nudges prospects to book a tour. The social channel feels active even on weekends."
      },
      {
        name: "Hannah Patel",
        role: "Customer Success Manager, ClearPath SaaS",
        focus: "AI Email Manager",
        quote:
          "Our AI email manager triages support emails, drafts responses, and escalates priority issues with full context. Resolution time is noticeably faster and our team stays focused on complex cases. It also tags renewals and upsell opportunities we used to miss."
      },
      {
        name: "Leo Martinez",
        role: "Owner, Vista Home Services",
        focus: "AI Email Manager",
        quote:
          "We were drowning in inbox noise. Now the AI sorts bids, follows up with prospects, and keeps jobs moving without missing deadlines. The auto-reminders alone saved us hours each week. Customers are happier because we respond the same day."
      },
      {
        name: "Sandra Okafor",
        role: "VP of Sales, BrightWave Logistics",
        focus: "AI Chat Bots",
        quote:
          "The AI chat bots handle pricing questions, collect shipment details, and qualify inbound traffic instantly. Our sales reps jump in only when it's a serious lead. We added a live handoff rule and conversions improved right away."
      },
      {
        name: "Nick Thompson",
        role: "eCommerce Manager, Finch & Co.",
        focus: "AI Chat Bots",
        quote:
          "Chat bots reduced cart abandonment by answering shipping questions and nudging shoppers to checkout. It feels like a 24/7 concierge that remembers our policies and promotions. We also cut down on repetitive support tickets."
      },
      {
        name: "Mei Chen",
        role: "Clinic Administrator, Riverstone Pediatrics",
        focus: "AI Receptionist",
        quote:
          "Parents love the instant answers. The AI receptionist handles routine requests, refills, and appointment changes so our team can focus on patient care. It’s friendly and consistent, which keeps our phones calm during peak hours."
      },
      {
        name: "Jordan Blake",
        role: "Managing Partner, Silverline Legal",
        focus: "AI Email Manager",
        quote:
          "Confidentiality was our top concern. The AI email manager keeps everything organized and our attorneys respond faster with better context. Intake emails are summarized clearly and routed to the right practice group. Clients notice the faster turnaround."
      }
    ],
    []
  );
  const activeTestimonial = testimonials[testimonialIndex % testimonials.length];
  const handlePrevTestimonial = () => {
    setTestimonialIndex((prev) => (prev - 1 + testimonials.length) % testimonials.length);
  };
  const handleNextTestimonial = () => {
    setTestimonialIndex((prev) => (prev + 1) % testimonials.length);
  };

  useEffect(() => {
    const timer = setInterval(() => {
      setHeroWordFading(true);
      setTimeout(() => {
        setHeroWordIndex((prev) => (prev + 1) % HERO_ROTATING_WORDS.length);
        setHeroWordFading(false);
      }, HERO_FADE_MS);
    }, HERO_ROTATE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    activeNavIdRef.current = activeNavId;
  }, [activeNavId]);

  useEffect(() => {
    const scroller = document.querySelector("[data-lenis-wrapper]");
    const targets = navItems.map((item) => document.getElementById(item.id)).filter(Boolean);
    if (!targets.length) return;

    const focusY = 160;
    const updateActive = () => {
      const viewTop = 0;
      const viewBottom = window.innerHeight || 0;
      let nextId = targets[0]?.id || "";
      let bestDistance = Number.POSITIVE_INFINITY;

      targets.forEach((target) => {
        const rect = target.getBoundingClientRect();
        const isVisible = rect.bottom > viewTop && rect.top < viewBottom;
        if (!isVisible) return;
        const distance = Math.abs(rect.top - focusY);
        if (distance < bestDistance) {
          bestDistance = distance;
          nextId = target.id;
        }
      });

      const lastTarget = targets[targets.length - 1];
      const scrollElement = scroller || document.documentElement;
      const scrollTop = scrollElement.scrollTop || window.scrollY || 0;
      const maxScroll = scrollElement.scrollHeight - scrollElement.clientHeight;
      if (lastTarget && maxScroll - scrollTop < 80) {
        nextId = lastTarget.id;
      }

      if (nextId && nextId !== activeNavIdRef.current) {
        setActiveNavId(nextId);
      }
    };

    const observer = new IntersectionObserver(
      () => {
        updateActive();
      },
      {
        root: scroller || null,
        rootMargin: "-35% 0px -50% 0px",
        threshold: [0.1, 0.2, 0.35, 0.5, 0.65, 0.8]
      }
    );

    targets.forEach((target) => observer.observe(target));
    window.addEventListener("resize", updateActive);
    updateActive();
    return () => {
      window.removeEventListener("resize", updateActive);
      observer.disconnect();
    };
  }, [navItems]);

  return (
    <>
      <section className="content content-landing hero hero-split hero-centered">
        <div className="hero-copy hero-centered-copy">
          <h1 className="hero-title large">
            <span className="hero-highlight">AI</span> that feels human.
          </h1>
        </div>
        <p className="hero-subtitle">
          The AI{" "}
          <span className="hero-rotating-slot">
            <span
              className={`hero-rotating-word ${heroWordFading ? "is-fading" : ""}`.trim()}
              style={{ backgroundImage: HERO_ROTATING_WORDS[heroWordIndex].gradient }}
            >
              {HERO_ROTATING_WORDS[heroWordIndex].word}
            </span>
          </span>{" "}
          platform for all your customer service
        </p>
        <p className="lead narrow hero-lead-single" style={{ margin: "8px 0 0" }}>
          Smart AI systems built to grow your business while you focus on what matters.
        </p>
        <button className="login-cta hero-centered-cta hero-main-cta" onClick={() => onShowService("receptionist")}>
          <span>Let’s create value together</span>
          <span aria-hidden>↗</span>
        </button>
      </section>

      <section className="content content-landing capability-shell">
        <div className="cap-nav-shell">
          <button
            className="cap-nav-toggle"
            type="button"
            aria-expanded={capNavOpen}
            aria-controls="cap-nav-menu"
            onClick={() => setCapNavOpen((prev) => !prev)}
          >
            <span>Sections</span>
            <span className="cap-nav-toggle-icon" aria-hidden>☰</span>
          </button>
          <div className={`cap-nav ${capNavOpen ? "is-open" : ""}`.trim()} id="cap-nav-menu">
            {navItems.map((item, idx) => (
              <a
                key={item.id}
                className={`cap-link ${activeNavId === item.id ? "is-active" : ""}`.trim()}
                href={`#${item.id}`}
                onClick={() => {
                  setActiveNavId(item.id);
                  setCapNavOpen(false);
                }}
                aria-current={activeNavId === item.id ? "true" : undefined}
              >
                <span className="cap-index">{String(idx + 1).padStart(2, "0")}</span> {item.label}
              </a>
            ))}
          </div>
        </div>

        <div className="cap-content">
          <div id="capabilities" className="cap-capabilities">
            <CapabilitiesSection />
          </div>
          <section className="cap-card promo-card">
            <div className="promo-media">
              <video
                className="promo-media__video"
                src="/social_media_1.mp4"
                autoPlay
                loop
                muted
                playsInline
              />
            </div>
            <div className="promo-copy">
              <div className="promo-pill">
                <span className="promo-pill__dot" />
                Omnichannel Inbox
              </div>
              <h2>Chats, calls and emails in one thread</h2>
              <p>
                SmartConnect4u unifies WhatsApp Business Calls, Messenger Calls and VoIP in the same thread as your
                messages and emails.
              </p>
              <p>
                No more silos or juggling multiple platforms; just one reliable record for every customer, no matter
                the channel.
              </p>
              <button type="button" className="promo-cta">See offer</button>
            </div>
          </section>

          <section id="technology" className="cap-card tech-shell">
            <div className="cap-card-head">
              <span className="cap-dot" aria-hidden />
              <span className="cap-card-label">TECHNOLOGY</span>
            </div>
            <h2 style={{ marginBottom: 8 }}>Built to be fast, safe, and human-friendly</h2>
            <p className="lead narrow" style={{ marginTop: 4, color: "#cfd9f6" }}>
              Reliability, security, and expert support so you can scale confidently.
            </p>
            <div className="tech-grid">
              {[
                {
                  title: "Designed for growth",
                  body:
                    "Quickest ROI with a roadmap shaped by you to scale revenue across the customer lifecycle—you'll grow with us, not outgrow us.",
                  iconClass: "tech-icon tech-icon--bars"
                },
                {
                  title: "Reliability at scale",
                  body:
                    "Best-in-class tech and enterprise-grade security for speed and stability, with 99.999% uptime under high chat volumes.",
                  iconClass: "tech-icon tech-icon--gem"
                },
                {
                  title: "Leading with experience",
                  body:
                    "Battle-tested customer conversations platform with years of market leadership and trusted by top platforms.",
                  iconClass: "tech-icon tech-icon--globe"
                },
                {
                  title: "Support you can trust",
                  body:
                    "Top-rated human support and expert guidance at every stage to help you scale confidently and achieve ambitious goals.",
                  iconClass: "tech-icon tech-icon--stack"
                }
              ].map((item) => (
                <div key={item.title} className="tech-card">
                  <div className={item.iconClass} aria-hidden />
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </div>
              ))}
            </div>
          </section>

          {[
            {
              id: "ai-team",
              title: "Your AI team on speed dial",
              body:
                "Work with specialists who tune prompts, evaluate outputs, and continuously improve performance for your business.",
              cta: "Meet the team"
            },
            {
              id: "pricing",
              title: "Pricing that scales with you",
              body:
                "Start fast and scale usage as you grow with clear plans and ROI tracking so you always see the value.",
              cta: "Check pricing"
            }
          ].map((section, idx) =>
            <article key={section.id} id={section.id} className="cap-card">
              <div className="cap-card-head">
                <span className="cap-dot" aria-hidden />
                <span className="cap-card-label">{section.id.replace("-", " ").toUpperCase()}</span>
              </div>
                <h2>{section.title}</h2>
                <p className="lead narrow" style={{ marginTop: 10 }}>{section.body}</p>
              <div className="cap-foot">
                <span className="cap-step">{String(idx + 2).padStart(2, "0")}</span>
                <button className="ghost small" type="button">{section.cta}</button>
              </div>
            </article>
          )}

          <section id="testimonials" className="cap-card testimonials-shell">
            <div className="testimonials-header">
              <span className="cap-dot" aria-hidden />
              <span className="cap-card-label">TESTIMONIALS</span>
            </div>
            <h2>Real Feedback, Real Results</h2>
            <p className="lead narrow" style={{ marginTop: 10, textAlign: "center" }}>
              Owners and teams share how SmartConnect4u AI products reduced overhead, lifted response rates, and
              kept pipelines moving with always-on support.
            </p>
            <div className="testimonial-showcase">
              <div className="testimonial-panel">
                <div className="testimonial-panel-head">
                  <div>
                    <h3>{activeTestimonial.name}</h3>
                    <p>{activeTestimonial.role}</p>
                  </div>
                  <span className="testimonial-tag">{activeTestimonial.focus}</span>
                </div>
                <p className="testimonial-quote">“{activeTestimonial.quote}”</p>
                <div className="testimonial-controls">
                  <button className="nav-dot" type="button" onClick={handlePrevTestimonial} aria-label="Previous testimonial">
                    ←
                  </button>
                  <span className="testimonial-count">
                    {String(testimonialIndex + 1).padStart(2, "0")} / {String(testimonials.length).padStart(2, "0")}
                  </span>
                  <button className="nav-dot" type="button" onClick={handleNextTestimonial} aria-label="Next testimonial">
                    →
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </section>

      <footer className="landing-footer content content-landing">
        <a className="landing-footer-link" href="/terms.html">
          Terms &amp; Conditions
        </a>
        <a className="landing-footer-link" href="/privacy.html">
          Privacy Policy
        </a>
        <a className="landing-footer-link" href="/contact.html">Contact</a>
      </footer>

      {/* Package plans removed from home screen */}
    </>
  );
}
