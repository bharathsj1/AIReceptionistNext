const columns = [
  {
    heading: "Company",
    links: [
      { href: "/about.html", label: "About Us" },
      { href: "/careers.html", label: "Careers" },
      { href: "/blog.html", label: "Blog" },
      { href: "/pricing.html", label: "Pricing" },
      { href: "/contact.html", label: "Contact" }
    ]
  }
];

const socials = [
  { href: "https://www.facebook.com/smartconnect4u", label: "Facebook", icon: "fb" },
  { href: "https://www.instagram.com/smartconnect_4u", label: "Instagram", icon: "ig" }
];

export default function Footer() {
  return (
    <footer className="relative mt-16 overflow-hidden rounded-t-[28px] bg-gradient-to-b from-[#0a0c1a] via-[#0b0f24] to-[#061531] text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_30%,rgba(74,144,255,0.25),transparent_35%),radial-gradient(circle_at_80%_10%,rgba(255,140,102,0.22),transparent_30%),radial-gradient(circle_at_70%_80%,rgba(47,128,237,0.18),transparent_40%)]" />
      <div className="relative mx-auto max-w-6xl px-6 pb-12 pt-14">
        <div className="flex flex-wrap items-start justify-between gap-10">
          <div className="min-w-[200px] space-y-3">
            <div className="inline-flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#5af3c1] via-[#5c7dff] to-[#3bb7ff] text-[#050915] font-extrabold">
                S4U
              </div>
              <div className="text-lg font-semibold text-slate-50">SmartConnect4u</div>
            </div>
            <p className="max-w-xs text-sm text-slate-300">
              Schedule, join, record, and summarize meetings with AI. Purpose-built automation for modern teams.
            </p>
          </div>

          <div className="flex flex-wrap gap-12">
            {columns.map((col) => (
              <div key={col.heading} className="min-w-[140px] space-y-3">
                <p className="text-sm font-semibold text-slate-100">{col.heading}</p>
                <ul className="space-y-2 text-sm text-slate-300">
                  {col.links.map((link) => (
                    <li key={link.href}>
                      <a className="transition hover:text-white" href={link.href}>
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-6">
          <a href="/contact.html" className="text-base font-semibold text-white transition hover:text-sky-200">
            Join us today →
          </a>
          <div className="flex items-center gap-4 text-slate-300">
            {socials.map((s) => (
              <a
                key={s.icon}
                href={s.href}
                aria-label={s.label}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-sm transition hover:border-white/40 hover:text-white"
              >
                {s.icon.toUpperCase()}
              </a>
            ))}
          </div>
        </div>

        <div className="mt-6 border-t border-white/10 pt-5 text-center text-xs text-slate-400">
          ©2025 SmartConnect4u · Designed with care
        </div>
      </div>
    </footer>
  );
}
