import Brand from "./Brand";
export default function Footer() {
  return (
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
  );
}
