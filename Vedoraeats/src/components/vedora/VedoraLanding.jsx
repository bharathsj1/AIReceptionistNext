import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Calendar,
  Check,
  ChevronDown,
  Clock,
  CreditCard,
  Crown,
  Eye,
  Gem,
  Heart,
  MapPin,
  Menu,
  Moon,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Store,
  Utensils,
  Users,
  Wine,
  X
} from "lucide-react";
import { API_URLS } from "../../config/urls.js";
import {
  appScreens,
  benefitCards,
  experiencePackages,
  faqItems,
  howItWorksSteps,
  restaurantControls,
  restaurantExamples,
  surpriseLevels,
  useCases,
  vedoraNavItems,
  vedoraStats
} from "../../data/vedora.js";
import "./VedoraLanding.css";

const packageIcons = {
  Bronze: Utensils,
  Silver: Wine,
  Gold: Crown,
  Platinum: Gem
};

const initialWaitlistForm = {
  firstName: "",
  email: "",
  city: "",
  interestType: "Customer"
};

const initialPartnerForm = {
  restaurantName: "",
  contactName: "",
  email: "",
  phone: "",
  city: "",
  website: "",
  restaurantType: "",
  message: ""
};

const submitJson = async (endpoint, payload) => {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(data?.error || data?.message || "Unable to submit right now.");
  }

  return data;
};

function SectionIntro({ eyebrow, title, children, align = "center" }) {
  return (
    <div className={`vedora-section-intro vedora-section-intro--${align}`} data-reveal>
      <div className="vedora-eyebrow">
        <span />
        {eyebrow}
      </div>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </div>
  );
}

function AnchorButton({ href, variant = "primary", children, onClick }) {
  return (
    <a className={`vedora-button vedora-button--${variant}`} href={href} onClick={onClick}>
      <span>{children}</span>
      {variant === "primary" ? <ArrowRight aria-hidden /> : <ChevronDown aria-hidden />}
    </a>
  );
}

function FormStatus({ state, success }) {
  if (state.status === "idle") return null;
  return (
    <div className={`vedora-form-status vedora-form-status--${state.status}`} role="status" aria-live="polite">
      {state.status === "loading" ? "Sending..." : state.message || success}
    </div>
  );
}

function WaitlistForm() {
  const [form, setForm] = useState(initialWaitlistForm);
  const [status, setStatus] = useState({ status: "idle", message: "" });

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    setStatus({ status: "loading", message: "" });
    try {
      await submitJson(API_URLS.vedoraWaitlist, {
        first_name: form.firstName.trim(),
        email: form.email.trim(),
        city: form.city.trim(),
        interest_type: form.interestType
      });
      setForm(initialWaitlistForm);
      setStatus({
        status: "success",
        message: "You're on the list. We'll send you a hint when Vedora is ready near you."
      });
    } catch (error) {
      setStatus({ status: "error", message: error?.message || "Unable to join the waitlist right now." });
    }
  };

  return (
    <form className="vedora-form" onSubmit={onSubmit}>
      <label>
        <span>First name</span>
        <input value={form.firstName} onChange={update("firstName")} name="firstName" autoComplete="given-name" required />
      </label>
      <label>
        <span>Email</span>
        <input value={form.email} onChange={update("email")} name="email" type="email" autoComplete="email" required />
      </label>
      <label>
        <span>City</span>
        <input value={form.city} onChange={update("city")} name="city" autoComplete="address-level2" required />
      </label>
      <label>
        <span>I'm interested as</span>
        <select value={form.interestType} onChange={update("interestType")} name="interestType" required>
          <option>Customer</option>
          <option>Restaurant</option>
        </select>
      </label>
      <button className="vedora-button vedora-button--primary vedora-form-button" type="submit" disabled={status.status === "loading"}>
        <span>Join the Waitlist</span>
        <Send aria-hidden />
      </button>
      <FormStatus
        state={status}
        success="You're on the list. We'll send you a hint when Vedora is ready near you."
      />
    </form>
  );
}

function RestaurantInterestForm() {
  const [form, setForm] = useState(initialPartnerForm);
  const [status, setStatus] = useState({ status: "idle", message: "" });

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    setStatus({ status: "loading", message: "" });
    try {
      await submitJson(API_URLS.vedoraPartnerInterest, {
        restaurant_name: form.restaurantName.trim(),
        contact_name: form.contactName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        city: form.city.trim(),
        restaurant_website: form.website.trim(),
        restaurant_type: form.restaurantType.trim(),
        message: form.message.trim()
      });
      setForm(initialPartnerForm);
      setStatus({
        status: "success",
        message: "Thanks. Vedora will follow up about partner availability and package fit."
      });
    } catch (error) {
      setStatus({ status: "error", message: error?.message || "Unable to send partner interest right now." });
    }
  };

  return (
    <form className="vedora-form vedora-form--partner" onSubmit={onSubmit}>
      <label>
        <span>Restaurant name</span>
        <input value={form.restaurantName} onChange={update("restaurantName")} name="restaurantName" required />
      </label>
      <label>
        <span>Contact name</span>
        <input value={form.contactName} onChange={update("contactName")} name="contactName" autoComplete="name" required />
      </label>
      <label>
        <span>Email</span>
        <input value={form.email} onChange={update("email")} name="email" type="email" autoComplete="email" required />
      </label>
      <label>
        <span>Phone optional</span>
        <input value={form.phone} onChange={update("phone")} name="phone" type="tel" autoComplete="tel" />
      </label>
      <label>
        <span>City</span>
        <input value={form.city} onChange={update("city")} name="city" autoComplete="address-level2" required />
      </label>
      <label>
        <span>Restaurant website</span>
        <input value={form.website} onChange={update("website")} name="website" type="url" placeholder="https://" />
      </label>
      <label className="vedora-form-wide">
        <span>Approximate restaurant type</span>
        <input
          value={form.restaurantType}
          onChange={update("restaurantType")}
          name="restaurantType"
          placeholder="Casual, premium, luxury, independent..."
          required
        />
      </label>
      <label className="vedora-form-wide">
        <span>Message optional</span>
        <textarea value={form.message} onChange={update("message")} name="message" rows="4" />
      </label>
      <button className="vedora-button vedora-button--primary vedora-form-button" type="submit" disabled={status.status === "loading"}>
        <span>Become a Vedora Partner</span>
        <Send aria-hidden />
      </button>
      <FormStatus state={status} success="Thanks. Vedora will follow up about partner availability and package fit." />
    </form>
  );
}

function PhoneMockup({ screen, index }) {
  return (
    <div className="vedora-phone" data-reveal style={{ "--delay": `${index * 90}ms` }}>
      <div className="vedora-phone-top">
        <span>{screen.eyebrow}</span>
        <Sparkles aria-hidden />
      </div>
      <div className="vedora-phone-body">
        <h3>{screen.title}</h3>
        <div className="vedora-phone-list">
          {screen.items.map((item) => (
            <div key={item} className="vedora-phone-chip">
              {item}
            </div>
          ))}
        </div>
      </div>
      <div className="vedora-phone-action">Continue</div>
    </div>
  );
}

export default function VedoraLanding() {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState(0);

  const handleNavClick = (event) => {
    const href = event.currentTarget.getAttribute("href");
    if (!href?.startsWith("#")) return;
    const target = document.querySelector(href);
    if (!target) return;
    event.preventDefault();
    setMenuOpen(false);
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    const id = "vedora-fonts";
    if (!document.getElementById(id)) {
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href =
        "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,700&display=swap";
      document.head.appendChild(link);
    }

    document.title = "Vedora - Surprise Dining Experiences";
  }, []);

  useEffect(() => {
    const previousBodyBackground = document.body.style.backgroundColor;
    const previousHtmlBackground = document.documentElement.style.backgroundColor;
    document.body.style.backgroundColor = "#070507";
    document.documentElement.style.backgroundColor = "#070507";

    const scrollToHash = () => {
      const hash = window.location.hash || window.__VEDORA_INITIAL_HASH__;
      if (!hash || hash === "#") return;
      const target = document.querySelector(hash);
      if (!target) return;
      requestAnimationFrame(() => {
        target.scrollIntoView({ behavior: "auto", block: "start" });
      });
    };

    const scheduleHashScroll = () => {
      scrollToHash();
      const timeouts = [120, 360, 800].map((delay) => window.setTimeout(scrollToHash, delay));
      return () => timeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };

    let clearScheduled = scheduleHashScroll();
    const onHashChange = () => {
      clearScheduled?.();
      clearScheduled = scheduleHashScroll();
    };

    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("load", onHashChange);
    return () => {
      clearScheduled?.();
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("load", onHashChange);
      document.body.style.backgroundColor = previousBodyBackground;
      document.documentElement.style.backgroundColor = previousHtmlBackground;
    };
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const revealNodes = Array.from(root.querySelectorAll("[data-reveal]"));
    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    revealNodes.forEach((node) => revealObserver.observe(node));

    const tiltNodes = Array.from(root.querySelectorAll(".vedora-tilt"));
    const prefersFinePointer = window.matchMedia?.("(pointer: fine)")?.matches;
    const tiltHandlers = prefersFinePointer
      ? tiltNodes.map((card) => {
          const onMove = (event) => {
            const rect = card.getBoundingClientRect();
            const rotateX = ((event.clientY - rect.top - rect.height / 2) / rect.height) * -7;
            const rotateY = ((event.clientX - rect.left - rect.width / 2) / rect.width) * 7;
            card.style.transform = `translateY(-4px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
          };
          const onLeave = () => {
            card.style.transform = "";
          };
          card.addEventListener("mousemove", onMove);
          card.addEventListener("mouseleave", onLeave);
          return { card, onMove, onLeave };
        })
      : [];

    return () => {
      revealObserver.disconnect();
      tiltHandlers.forEach(({ card, onMove, onLeave }) => {
        card.removeEventListener("mousemove", onMove);
        card.removeEventListener("mouseleave", onLeave);
      });
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return undefined;

    let width = 0;
    let height = 0;
    let rafId = 0;

    const resize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };

    const points = Array.from({ length: 70 }, () => ({
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      size: 0,
      opacity: 0
    }));

    const resetPoint = (point) => {
      point.x = Math.random() * width;
      point.y = Math.random() * height;
      point.vx = (Math.random() - 0.5) * 0.18;
      point.vy = (Math.random() - 0.5) * 0.18;
      point.size = Math.random() * 1.1 + 0.35;
      point.opacity = Math.random() * 0.28 + 0.08;
    };

    resize();
    points.forEach(resetPoint);
    window.addEventListener("resize", resize);

    const animate = () => {
      ctx.clearRect(0, 0, width, height);
      points.forEach((point) => {
        point.x += point.vx;
        point.y += point.vy;
        if (point.x < 0 || point.x > width || point.y < 0 || point.y > height) {
          resetPoint(point);
        }
        ctx.beginPath();
        ctx.arc(point.x, point.y, point.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(244, 207, 137, ${point.opacity})`;
        ctx.fill();
      });
      rafId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div className="vedora-page" ref={rootRef}>
      <canvas className="vedora-particles" ref={canvasRef} aria-hidden="true" />

      <div className="vedora-announcement">
        <span>Vedora is coming soon.</span>
        <strong>Launching soon in selected UK cities.</strong>
      </div>

      <header className="vedora-nav">
        <a className="vedora-brand" href="#top" onClick={handleNavClick} aria-label="VEDORA home">
          <span className="vedora-brand-mark">V</span>
          <span>VEDORA</span>
        </a>
        <nav className={`vedora-nav-links ${menuOpen ? "is-open" : ""}`} aria-label="Primary navigation">
          {vedoraNavItems.map((item) => (
            <a key={item.href} href={item.href} onClick={handleNavClick}>
              {item.label}
            </a>
          ))}
          <a className="vedora-nav-cta" href="#waitlist" onClick={handleNavClick}>
            Join Waitlist
          </a>
        </nav>
        <button
          className="vedora-menu-button"
          type="button"
          aria-label={menuOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((current) => !current)}
        >
          {menuOpen ? <X aria-hidden /> : <Menu aria-hidden />}
        </button>
      </header>

      <main>
        <section className="vedora-hero" id="top">
          <img
            src="/media/vedora-dining-hero.png"
            alt="An elegant restaurant table at night with a phone ready for a Vedora booking"
            className="vedora-hero-image"
            fetchPriority="high"
          />
          <div className="vedora-hero-shade" />
          <div className="vedora-hero-grid" aria-hidden="true" />

          <div className="vedora-hero-content">
            <div className="vedora-hero-copy" data-reveal>
              <div className="vedora-pill">
                <Sparkles aria-hidden />
                Surprise dining, launching soon
              </div>
              <h1>
                <span>VEDORA</span>
                <strong>Surprise dining experiences</strong>
              </h1>
              <p className="vedora-hero-line">Tell us the mood. We'll plan the mystery.</p>
              <p className="vedora-hero-text">
                Set your occasion, mood, location and price. Vedora matches you with a restaurant and creates a
                fixed-price dining experience around you.
              </p>
              <div className="vedora-hero-actions">
                <AnchorButton href="#waitlist" onClick={handleNavClick}>
                  Join the Waitlist
                </AnchorButton>
                <AnchorButton href="#how" variant="secondary" onClick={handleNavClick}>
                  See How It Works
                </AnchorButton>
              </div>
              <div className="vedora-hero-note">
                <ShieldCheck aria-hidden />
                <span>Know the price. Keep the surprise. Optional extras are separate.</span>
              </div>
            </div>

            <div className="vedora-hero-product vedora-tilt" data-reveal>
              <div className="vedora-product-top">
                <div className="vedora-window-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <span>vedoraeats.com</span>
              </div>
              <div className="vedora-product-body">
                <div className="vedora-brief-panel">
                  <span className="vedora-mini-label">Tonight's brief</span>
                  <h2>Anniversary dinner</h2>
                  <div className="vedora-brief-grid">
                    <div>
                      <Heart aria-hidden />
                      Romantic
                    </div>
                    <div>
                      <MapPin aria-hidden />
                      London
                    </div>
                    <div>
                      <CreditCard aria-hidden />
                      Gold £50 pp
                    </div>
                    <div>
                      <Eye aria-hidden />
                      Mystery Venue
                    </div>
                  </div>
                </div>
                <div className="vedora-match-panel">
                  <span className="vedora-mini-label">Vedora match</span>
                  <div className="vedora-match-card">
                    <div>
                      <span>Restaurant hidden</span>
                      <strong>Premium 3-course experience</strong>
                    </div>
                    <div className="vedora-score">92%</div>
                  </div>
                  <div className="vedora-progress-row">
                    <span>Dietary fit</span>
                    <div><i style={{ width: "94%" }} /></div>
                  </div>
                  <div className="vedora-progress-row">
                    <span>Mood match</span>
                    <div><i style={{ width: "88%" }} /></div>
                  </div>
                  <div className="vedora-clue-box">
                    <Moon aria-hidden />
                    First clue arrives at 5:30 PM
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="vedora-stat-strip" aria-label="Vedora launch highlights">
          {vedoraStats.map((stat) => (
            <div key={stat.label} className="vedora-stat-cell">
              <strong>{stat.value}</strong>
              <span>{stat.label}</span>
            </div>
          ))}
        </section>

        <section className="vedora-ticker" aria-label="Vedora use cases">
          <div className="vedora-ticker-track">
            {[...useCases, ...useCases].map((item, index) => (
              <span key={`${item}-${index}`}>
                <Star aria-hidden />
                {item}
              </span>
            ))}
          </div>
        </section>

        <section className="vedora-section vedora-section--deep" id="how">
          <div className="vedora-container">
            <SectionIntro eyebrow="How Vedora Works" title="Choose your budget. Choose the mood. Vedora finds the experience.">
              From a short dining brief to a confirmed mystery table, Vedora keeps the planning simple and the evening
              memorable.
            </SectionIntro>
            <div className="vedora-steps">
              {howItWorksSteps.map((step, index) => (
                <article className="vedora-step" key={step.title} data-reveal style={{ "--delay": `${index * 80}ms` }}>
                  <div className="vedora-step-number">{index + 1}</div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                  <div className="vedora-step-tags">
                    {step.tags.map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="vedora-section" id="experiences">
          <div className="vedora-container">
            <SectionIntro eyebrow="Fixed Price Packages" title="Experience tiers, not restaurant ratings.">
              Pick the package that fits the night. Restaurants choose which packages make sense for their menu,
              availability and commercial model.
            </SectionIntro>
            <div className="vedora-package-grid">
              {experiencePackages.map((tier) => {
                const Icon = packageIcons[tier.name] || Utensils;
                return (
                  <article
                    className={`vedora-package vedora-package--${tier.tone} ${tier.featured ? "is-featured" : ""} vedora-tilt`}
                    key={tier.name}
                    data-reveal
                  >
                    {tier.featured && <div className="vedora-package-badge">Popular for evenings</div>}
                    <div className="vedora-package-icon">
                      <Icon aria-hidden />
                    </div>
                    <div>
                      <h3>{tier.name}</h3>
                      <div className="vedora-package-price">
                        <strong>{tier.price}</strong>
                        <span>{tier.suffix}</span>
                      </div>
                    </div>
                    <p>{tier.summary}</p>
                    <ul>
                      {tier.details.map((detail) => (
                        <li key={detail}>
                          <Check aria-hidden />
                          {detail}
                        </li>
                      ))}
                    </ul>
                  </article>
                );
              })}
            </div>
            <p className="vedora-section-note">Package availability varies by city, date, time and restaurant.</p>
          </div>
        </section>

        <section className="vedora-section vedora-section--deep" id="surprise">
          <div className="vedora-container">
            <SectionIntro eyebrow="Surprise Levels" title="Decide how much of the night stays hidden.">
              Vedora can keep the restaurant quiet while still giving you enough confidence to dress, travel and enjoy
              the evening.
            </SectionIntro>
            <div className="vedora-surprise-grid">
              {surpriseLevels.map((level, index) => (
                <article className="vedora-surprise-card vedora-tilt" key={level.name} data-reveal>
                  <div className="vedora-surprise-index">0{index + 1}</div>
                  <h3>{level.name}</h3>
                  <p>{level.description}</p>
                  <div className="vedora-surprise-reveal">
                    {level.reveal.map((item) => (
                      <span key={item}>{item}</span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="vedora-section" id="why">
          <div className="vedora-container">
            <div className="vedora-split">
              <SectionIntro eyebrow="Why Vedora" title="Dinner without the endless search." align="left">
                You choose the budget. We handle the discovery. The result is a premium evening with less scrolling,
                less bill anxiety and more anticipation.
              </SectionIntro>
              <div className="vedora-benefit-grid">
                {benefitCards.map((benefit, index) => (
                  <article className="vedora-benefit" key={benefit.title} data-reveal style={{ "--delay": `${index * 55}ms` }}>
                    <Check aria-hidden />
                    <div>
                      <h3>{benefit.title}</h3>
                      <p>{benefit.body}</p>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="vedora-section vedora-section--feature" id="off-peak">
          <div className="vedora-container">
            <div className="vedora-offpeak">
              <div data-reveal>
                <div className="vedora-eyebrow">
                  <span />
                  Off-Peak Premium
                </div>
                <h2>Premium dining. Unexpected value.</h2>
                <p>
                  Some restaurants may open selected quieter times at a special Vedora package price without changing
                  the quality of the experience.
                </p>
                <p>
                  A luxury restaurant stays a luxury restaurant. Selected availability simply brings the experience
                  within a different budget.
                </p>
              </div>
              <div className="vedora-offpeak-card vedora-tilt" data-reveal>
                <div className="vedora-offpeak-row">
                  <span>PLATINUM EXPERIENCE</span>
                  <strong>Normally £75</strong>
                </div>
                <div className="vedora-offpeak-arrow">
                  <ArrowRight aria-hidden />
                </div>
                <div className="vedora-offpeak-row vedora-offpeak-row--highlight">
                  <span>VEDORA OFF-PEAK</span>
                  <strong>£50</strong>
                </div>
                <div className="vedora-offpeak-meta">
                  <Clock aria-hidden />
                  Mon-Thu, 12 PM-4 PM, selected availability
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="vedora-section" id="app">
          <div className="vedora-container">
            <SectionIntro eyebrow="App Preview" title="A mobile-first way to plan a night out.">
              The Vedora app is still being built. The website is your way to join early before selected city launches.
            </SectionIntro>
            <div className="vedora-phone-stage">
              {appScreens.map((screen, index) => (
                <PhoneMockup key={screen.title} screen={screen} index={index} />
              ))}
            </div>
          </div>
        </section>

        <section className="vedora-section vedora-section--deep" id="restaurants">
          <div className="vedora-container">
            <div className="vedora-restaurant-grid">
              <div data-reveal>
                <div className="vedora-eyebrow">
                  <span />
                  For Restaurants
                </div>
                <h2>Fill more tables. Keep control of your margins.</h2>
                <p>
                  Vedora brings prepaid customers with a clear budget. Restaurants decide what is commercially viable,
                  what is included and when packages are available.
                </p>
                <AnchorButton href="#restaurant-interest" onClick={handleNavClick}>
                  Join as a Restaurant
                </AnchorButton>
              </div>
              <div className="vedora-control-panel" data-reveal>
                {restaurantControls.map((control) => (
                  <div key={control}>
                    <SlidersHorizontal aria-hidden />
                    <span>{control}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="vedora-partner-examples" data-reveal>
              {restaurantExamples.map((example) => (
                <article key={example.name}>
                  <h3>{example.name}</h3>
                  <div className="vedora-tier-tags">
                    {["Bronze", "Silver", "Gold", "Platinum", "Off-peak Platinum"].map((tier) => {
                      const enabled = example.tiers.includes(tier);
                      const disabled = example.disabled.includes(tier);
                      return (
                        <span key={tier} className={enabled ? "is-enabled" : disabled ? "is-disabled" : ""}>
                          {enabled && <Check aria-hidden />}
                          {tier}
                        </span>
                      );
                    })}
                  </div>
                </article>
              ))}
            </div>

            <div className="vedora-flow" data-reveal>
              <div>
                <Users aria-hidden />
                <span>Customer pays Vedora</span>
              </div>
              <ArrowRight aria-hidden />
              <div>
                <Store aria-hidden />
                <span>Restaurant confirms</span>
              </div>
              <ArrowRight aria-hidden />
              <div>
                <Calendar aria-hidden />
                <span>Customer attends</span>
              </div>
              <ArrowRight aria-hidden />
              <div>
                <CreditCard aria-hidden />
                <span>Restaurant receives agreed payout</span>
              </div>
            </div>
          </div>
        </section>

        <section className="vedora-section vedora-section--forms" id="waitlist">
          <div className="vedora-container">
            <div className="vedora-form-grid">
              <div data-reveal>
                <div className="vedora-eyebrow">
                  <span />
                  Customer Waitlist
                </div>
                <h2>Join before Vedora launches near you.</h2>
                <p>
                  Tell us where you are and whether you are joining as a diner or restaurant. We will send you a hint
                  when Vedora is ready in your city.
                </p>
                <div className="vedora-trust-list">
                  <div>
                    <ShieldCheck aria-hidden />
                    Fixed included package price
                  </div>
                  <div>
                    <Search aria-hidden />
                    Curated restaurant discovery
                  </div>
                  <div>
                    <Sparkles aria-hidden />
                    Surprise level under your control
                  </div>
                </div>
              </div>
              <div data-reveal>
                <WaitlistForm />
              </div>
            </div>
          </div>
        </section>

        <section className="vedora-section vedora-section--partner-form" id="restaurant-interest">
          <div className="vedora-container">
            <div className="vedora-form-grid vedora-form-grid--wide">
              <div data-reveal>
                <div className="vedora-eyebrow">
                  <span />
                  Restaurant Partner Interest
                </div>
                <h2>Become a Vedora Partner.</h2>
                <p>
                  Restaurants are not required to discount their full menu. You decide which packages you support,
                  which dishes are included and when Vedora bookings are available.
                </p>
              </div>
              <div data-reveal>
                <RestaurantInterestForm />
              </div>
            </div>
          </div>
        </section>

        <section className="vedora-section vedora-section--deep" id="faq">
          <div className="vedora-container">
            <SectionIntro eyebrow="FAQ" title="Questions before the reveal.">
              A few practical details for diners and restaurants while Vedora prepares for launch.
            </SectionIntro>
            <div className="vedora-faq-list">
              {faqItems.map((item, index) => (
                <article className={`vedora-faq ${openFaq === index ? "is-open" : ""}`} key={item.q} data-reveal>
                  <button type="button" onClick={() => setOpenFaq(openFaq === index ? -1 : index)}>
                    <span>{item.q}</span>
                    <ChevronDown aria-hidden />
                  </button>
                  <div className="vedora-faq-answer">
                    <p>{item.a}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="vedora-final" id="final">
          <div className="vedora-container" data-reveal>
            <div className="vedora-final-mark">VEDORA</div>
            <h2>Choose your budget. Keep the surprise.</h2>
            <p>Discover dinner differently when Vedora launches in selected UK cities.</p>
            <div className="vedora-hero-actions">
              <AnchorButton href="#waitlist" onClick={handleNavClick}>
                Join the Waitlist
              </AnchorButton>
              <AnchorButton href="#restaurant-interest" variant="secondary" onClick={handleNavClick}>
                Become a Partner
              </AnchorButton>
            </div>
          </div>
        </section>
      </main>

      <footer className="vedora-footer">
        <div className="vedora-container">
          <div className="vedora-footer-grid">
            <a className="vedora-brand" href="#top" onClick={handleNavClick}>
              <span className="vedora-brand-mark">V</span>
              <span>VEDORA</span>
            </a>
            <nav aria-label="Footer navigation">
              {vedoraNavItems.map((item) => (
                <a key={item.href} href={item.href} onClick={handleNavClick}>
                  {item.label}
                </a>
              ))}
            </nav>
            <div className="vedora-footer-copy">
              <span>vedoraeats.com</span>
              <span>Launching soon in selected UK cities.</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
