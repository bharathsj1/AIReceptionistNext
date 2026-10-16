import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  AudioLines,
  Building2,
  LayoutDashboard,
  LogOut,
  Menu,
  PhoneCall,
  Settings2,
  Target,
  Users,
  X,
} from "lucide-react";
import Brand from "../components/Brand";
import AIOutreachScreen from "./AIOutreachScreen";
import { useDialogFocus } from "../components/ui/useDialogFocus";
import "./CallingWorkspace.css";

const navigation = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "campaigns", label: "Campaigns", icon: AudioLines },
  { id: "contacts", label: "Contacts", icon: Users },
  { id: "calls", label: "Call history", icon: PhoneCall },
  { id: "leads", label: "Interested leads", icon: Target },
];

export default function DashboardScreen({
  user,
  clientData,
  userProfile,
  onLogout,
  onSessionExpired,
  onResumeBusinessDetails,
}) {
  const [view, setView] = useState("overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia("(max-width: 960px)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(max-width: 960px)");
    const changed = () => {
      setIsMobile(media.matches);
      if (!media.matches) setMenuOpen(false);
    };
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  const menuRef = useRef(null);
  const mainRef = useRef(null);
  useDialogFocus(menuRef, menuOpen, () => setMenuOpen(false));
  const company =
    clientData?.business_name || userProfile?.business_name || "Your company";
  const name = user?.name || user?.email?.split("@")[0] || "Your account";
  const navigate = (next) => {
    setView(next);
    setMenuOpen(false);
  };
  useEffect(() => {
    document.title = `${view === "settings" ? "Calling setup" : navigation.find((item) => item.id === view)?.label} · Vedora Outreach`;
    mainRef.current?.scrollTo({ top: 0 });
  }, [view]);
  return (
    <div className="calling-workspace">
      {menuOpen && (
        <button
          className="calling-scrim"
          aria-label="Close navigation"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside
        className={`calling-sidebar ${menuOpen ? "is-open" : ""}`}
        ref={menuRef}
        role={menuOpen ? "dialog" : undefined}
        aria-modal={menuOpen || undefined}
        aria-hidden={isMobile && !menuOpen ? true : undefined}
        inert={isMobile && !menuOpen ? "" : undefined}
        aria-label="Calling workspace navigation"
        tabIndex={-1}
        id="calling-sidebar"
      >
        <div className="calling-brand-row">
          <button
            className="calling-brand-button"
            onClick={() => navigate("overview")}
            aria-label="Vedora Outreach overview"
          >
            <Brand />
          </button>
          <button
            className="calling-icon calling-mobile-close"
            onClick={() => setMenuOpen(false)}
            aria-label="Close navigation"
          >
            <X size={19} />
          </button>
        </div>
        <div className="calling-company">
          <span>
            <Building2 size={18} />
          </span>
          <div>
            <strong title={company}>{company}</strong>
            <small>Company workspace</small>
          </div>
        </div>
        <p className="calling-nav-caption">WORKSPACE</p>
        <nav aria-label="Calling navigation">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`calling-nav-item ${view === id ? "is-active" : ""}`}
              aria-current={view === id ? "page" : undefined}
              onClick={() => navigate(id)}
            >
              <Icon size={19} />
              <span>{label}</span>
              {view === id && <span className="calling-active-dot" />}
            </button>
          ))}
        </nav>
        <div className="calling-sidebar-note">
          <span className="calling-note-icon">
            <AudioLines size={21} />
          </span>
          <strong>A conversation. A new opportunity.</strong>
          <p>Give your team more time for the owners who want to hear more.</p>
          <button onClick={() => navigate("campaigns")}>
            Open campaigns <ArrowUpRight size={15} />
          </button>
        </div>
        <div className="calling-sidebar-footer">
          <button
            className={`calling-nav-item ${view === "settings" ? "is-active" : ""}`}
            aria-current={view === "settings" ? "page" : undefined}
            onClick={() => navigate("settings")}
          >
            <Settings2 size={19} />
            Calling setup
          </button>
          {onLogout && (
            <button className="calling-nav-item" onClick={onLogout}>
              <LogOut size={18} />
              Sign out
            </button>
          )}
          <div className="calling-account">
            <span>{name.slice(0, 2).toUpperCase()}</span>
            <div>
              <strong>{name}</strong>
              <small>{user?.email}</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="calling-workspace-body" inert={menuOpen ? "" : undefined}>
        <header className="calling-topbar">
          <div>
            <button
              className="calling-icon calling-mobile-toggle"
              aria-label="Open navigation"
              aria-controls="calling-sidebar"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <span className="calling-breadcrumb-slash">/</span>
            <strong>
              {view === "settings"
                ? "Calling setup"
                : navigation.find((item) => item.id === view)?.label}
            </strong>
          </div>
          <div>
            <span className="calling-region">
              <span className="calling-region-dot" />
              United Kingdom
            </span>
            <span className="calling-topbar-avatar" title={name}>
              {name.slice(0, 1).toUpperCase()}
            </span>
          </div>
        </header>
        <div className="calling-scroll-area" ref={mainRef}>
          <AIOutreachScreen
            user={user}
            onSignIn={onSessionExpired}
            view={view}
            onNavigate={navigate}
            company={company}
            clientData={clientData}
            onEditCompany={onResumeBusinessDetails}
          />
          <footer className="calling-page-footer">
            <span>Vedora Outreach</span>
            <span>Better conversations. Clearer next steps.</span>
          </footer>
        </div>
      </div>
    </div>
  );
}
