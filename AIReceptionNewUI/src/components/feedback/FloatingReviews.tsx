import React from "react";

type Review = {
  id: string;
  name: string;
  title: string;
  company: string;
  tag: string;
  quote: string;
};

const reviews: Review[] = [
  {
    id: "r1",
    name: "Alicia Morgan",
    title: "Operations Director",
    company: "Apex Dental",
    tag: "AI RECEPTIONIST",
    quote: "After-hours callers get answered, routed, and booked automatically. Missed calls dropped and no-shows are down."
  },
  {
    id: "r2",
    name: "Jesse Kim",
    title: "Founder",
    company: "BlueOak Realty",
    tag: "UNIFIED INBOX",
    quote: "WhatsApp, Messenger, and email finally live in one thread. Agents reply faster and prospects stay warm."
  },
  {
    id: "r3",
    name: "Priya Das",
    title: "Head of Growth",
    company: "Lumen Health",
    tag: "SOCIAL",
    quote: "Drafts, schedules, and DMs are handled before my team wakes up. Engagement is steady even on weekends."
  },
  {
    id: "r4",
    name: "Marco Silva",
    title: "Marketing Lead",
    company: "Northbridge Fitness",
    tag: "AI RECEPTIONIST",
    quote: "Class inquiries are answered instantly and routed to the right coach. Walk-ins are up, drop-offs are down."
  },
  {
    id: "r5",
    name: "Hannah Patel",
    title: "Customer Success Manager",
    company: "ClearPath SaaS",
    tag: "EMAIL",
    quote: "The AI drafts clean replies and flags renewals. We respond same-day without hiring another rep."
  },
  {
    id: "r6",
    name: "Leo Martinez",
    title: "Owner",
    company: "Vista Home Services",
    tag: "FOLLOW-UPS",
    quote: "Automated reminders keep bids moving. Customers get updates before they ask. Our close rate improved."
  },
  {
    id: "r7",
    name: "Sandra Okafor",
    title: "VP of Sales",
    company: "BrightWave Logistics",
    tag: "AI CHAT",
    quote: "Pricing questions are answered on the spot; qualified leads hit our inbox with full context."
  },
  {
    id: "r8",
    name: "Nick Thompson",
    title: "eCommerce Manager",
    company: "Finch & Co.",
    tag: "LIVE CART HELP",
    quote: "Cart abandonment fell because shipping questions get real answers in seconds, not canned links."
  },
  {
    id: "r9",
    name: "Mei Chen",
    title: "Clinic Administrator",
    company: "Riverstone Pediatrics",
    tag: "AFTER-HOURS",
    quote: "Parents can reschedule or request refills overnight. Morning call volume is finally calm."
  },
  {
    id: "r10",
    name: "Jordan Blake",
    title: "Managing Partner",
    company: "Silverline Legal",
    tag: "SECURE EMAIL",
    quote: "Intake emails are summarized and routed with zero drift. Attorneys start with the facts, not the clutter."
  },
  {
    id: "r11",
    name: "Diana Flores",
    title: "Owner",
    company: "Glow Salon",
    tag: "BOOKINGS",
    quote: "No more missed calls for appointments. AI books, confirms, and sends prep instructions automatically."
  },
  {
    id: "r12",
    name: "Anand Verma",
    title: "COO",
    company: "CloudSupport.io",
    tag: "TICKETS",
    quote: "Level-1 issues are answered by AI; escalations arrive with context. First-response time is minutes."
  },
  {
    id: "r13",
    name: "Sarah Green",
    title: "Head of Patient Experience",
    company: "Harbor Mental Health",
    tag: "INTAKE",
    quote: "Sensitive inbound gets a calm, consistent first touch. Staff jump in only when it’s high priority."
  },
  {
    id: "r14",
    name: "Omar Khalid",
    title: "GM",
    company: "Metro Car Care",
    tag: "SERVICE DESK",
    quote: "Quotes, drop-offs, and ETA updates are handled 24/7. Customers say it feels like we’re always open."
  },
  {
    id: "r15",
    name: "Emily Ross",
    title: "Director of Ops",
    company: "Cedar Veterinary",
    tag: "VOICEMAIL TO LIVE",
    quote: "Voicemails become transcripts and follow-up texts within minutes. Pet parents get answers right away."
  },
  {
    id: "r16",
    name: "Luis Ramirez",
    title: "Franchise Owner",
    company: "Urban Fitness",
    tag: "INBOUND LEADS",
    quote: "Meta + WhatsApp leads are auto-qualified and booked for tours. My trainers stay focused on clients."
  },
  {
    id: "r17",
    name: "Kate Wilson",
    title: "Director of Support",
    company: "Helio Desk",
    tag: "QUALITY",
    quote: "AI suggests drafts; humans approve. Tone is consistent, and QA time shrunk without losing accuracy."
  },
  {
    id: "r18",
    name: "Arjun Shah",
    title: "Head of CX",
    company: "BrightPay",
    tag: "MULTI-CHANNEL",
    quote: "One thread for phone, WhatsApp, and email means nothing slips. Our CSAT climbed each month."
  }
];

type RowProps = {
  items: Review[];
  direction: "ltr" | "rtl";
  duration?: number;
};

const ReviewRow: React.FC<RowProps> = ({ items, direction, duration = 48 }) => {
  const duplicated = [...items, ...items];
  const isRTL = direction === "rtl";
  return (
    <div
      className={`group relative flex gap-6 md:gap-8 px-4 md:px-6 ${isRTL ? "animate-marquee-rtl" : "animate-marquee-ltr"} hover:[animation-play-state:paused]`}
      style={
        {
          "--marquee-duration": `${duration}s`
        } as React.CSSProperties
      }
      aria-label="Scrolling reviews row"
    >
        {duplicated.map((review, idx) => (
          <article
            key={`${review.id}-${idx}`}
            className="review-card w-[60%] max-w-[320px] min-w-[240px] min-h-[220px] shrink-0 overflow-hidden rounded-3xl bg-[#0f0c1a]/85 p-6 shadow-[0_18px_40px_rgba(0,0,0,0.35)] backdrop-blur-lg transition duration-200 hover:-translate-y-1 hover:shadow-[0_28px_60px_rgba(0,0,0,0.45)]"
          >
          <header className="flex items-start justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-slate-50">{review.name}</span>
              <span className="text-xs text-slate-300/80">
                {review.title}, {review.company}
              </span>
            </div>
            <span className="rounded-full border border-indigo-200/30 bg-indigo-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-100">
              {review.tag}
            </span>
          </header>
          <p className="mt-6 text-base leading-7 text-slate-100/90">
            “{review.quote}”
          </p>
        </article>
      ))}
    </div>
  );
};

const FloatingReviews: React.FC = () => {
  const midpoint = Math.ceil(reviews.length / 2);
  const rowA = reviews.slice(0, midpoint);
  const rowB = reviews.slice(midpoint);

  return (
    <section
      className="relative overflow-hidden rounded-3xl p-4 md:p-6"
      aria-label="Customer reviews marquee"
    >
      <div className="relative grid gap-4">
        <div className="overflow-hidden">
          <ReviewRow items={rowA} direction="ltr" duration={52} />
        </div>
        <div className="overflow-hidden">
          <ReviewRow items={rowB.length ? rowB : rowA} direction="rtl" duration={62} />
        </div>
      </div>

      <style>
        {`
          @keyframes marquee-ltr {
            0% { transform: translateX(-50%); }
            100% { transform: translateX(0); }
          }
          @keyframes marquee-rtl {
            0% { transform: translateX(0); }
            100% { transform: translateX(-50%); }
          }
          .animate-marquee-ltr {
            animation: marquee-ltr var(--marquee-duration, 50s) linear infinite;
          }
          .animate-marquee-rtl {
            animation: marquee-rtl var(--marquee-duration, 60s) linear infinite;
          }
          @media (hover: hover) {
            .animate-marquee-ltr:hover,
            .animate-marquee-rtl:hover {
              animation-play-state: paused;
            }
          }
          @media (prefers-reduced-motion: reduce) {
            .animate-marquee-ltr,
            .animate-marquee-rtl {
              animation: none !important;
            }
          }
          .review-card {
            position: relative;
            isolation: isolate;
          }
          .review-card::before {
            content: '';
            position: absolute;
            inset: -10%;
            background:
              radial-gradient(circle at 20% 30%, rgba(132,0,255,0.14), transparent 45%),
              radial-gradient(circle at 80% 20%, rgba(56,189,248,0.12), transparent 40%),
              radial-gradient(circle at 50% 80%, rgba(99,102,241,0.12), transparent 42%);
            filter: blur(12px);
            opacity: 0.8;
            transition: opacity 0.3s ease;
            z-index: 0;
          }
          .review-card::after {
            content: '';
            position: absolute;
            inset: 0;
            background:
              radial-gradient(circle at var(--glow-x,50%) var(--glow-y,50%), rgba(132,0,255,0.28), transparent 55%),
              radial-gradient(circle at 10% 10%, rgba(255,255,255,0.06), transparent 35%);
            opacity: 0.0;
            mix-blend-mode: screen;
            transition: opacity 0.3s ease;
            z-index: 1;
          }
          .review-card:hover::after {
            opacity: 0.65;
          }
          .review-card:hover::before {
            opacity: 1;
          }
          .review-card .particle-dot {
            position: absolute;
            width: 4px;
            height: 4px;
            border-radius: 999px;
            background: rgba(255,255,255,0.35);
            box-shadow: 0 0 8px rgba(132,0,255,0.35);
            opacity: 0.7;
            animation: floaty 6s ease-in-out infinite;
            z-index: 2;
          }
          @keyframes floaty {
            0% { transform: translateY(0); opacity: 0.6; }
            50% { transform: translateY(-6px); opacity: 1; }
            100% { transform: translateY(0); opacity: 0.6; }
          }
        `}
      </style>
    </section>
  );
};

export default FloatingReviews;
