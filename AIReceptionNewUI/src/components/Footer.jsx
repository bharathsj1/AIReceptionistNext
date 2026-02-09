export default function Footer() {
  const links = [
    { href: "/terms.html", label: "Terms & Conditions" },
    { href: "/privacy.html", label: "Privacy Policy" },
    { href: "/contact.html", label: "Contact" }
  ];

  return (
    <footer className="mt-12 border-t border-white/10 bg-[#05060e]/50 px-6 py-10">
      <div className="mx-auto flex max-w-5xl flex-wrap justify-center gap-4">
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className="min-w-[180px] rounded-md border border-indigo-200/30 bg-slate-900/60 px-5 py-3 text-center text-sm font-semibold uppercase tracking-[0.12em] text-slate-100 transition hover:-translate-y-0.5 hover:border-indigo-100/60 hover:bg-slate-800/70 hover:text-white"
          >
            {link.label}
          </a>
        ))}
      </div>
    </footer>
  );
}
