import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Command,
  LockKeyhole,
  LogOut,
  Menu,
  Moon,
  Search,
  Settings,
  Sun,
  X,
} from "lucide-react";
import Brand from "./Brand";
import { useDialogFocus } from "./ui/useDialogFocus";

const labels = {
  dashboard_analytics: "Overview",
  ai_receptionist: "AI receptionist",
  email_manager: "Email",
  social_media_manager: "Social",
  task_manager: "Tasks",
  crm_manager: "CRM",
  contacts: "Contacts",
  sales_dialer: "Sales dialer",
};

export function WorkspaceTopbar({
  label,
  businessName,
  user,
  dark,
  onTheme,
  onMenu,
  onSearch,
  menuOpen = false,
}) {
  const name = user?.name || user?.email?.split("@")[0] || "Your team";
  return (
    <header className="workspace-topbar">
      <button
        className="workspace-mobile-menu icon-button"
        onClick={onMenu}
        aria-label="Open workspace navigation"
        aria-controls="workspace-sidebar"
        aria-expanded={menuOpen}
      >
        <Menu size={20} />
      </button>
      <div className="workspace-breadcrumb">
        <span>{businessName || "My workspace"}</span>
        <span aria-hidden="true">/</span>
        <strong>{label}</strong>
      </div>
      <div className="workspace-topbar-actions">
        <button
          className="workspace-search-trigger"
          aria-label="Jump to a workspace tool"
          aria-haspopup="dialog"
          onClick={onSearch}
        >
          <Search size={16} />
          <span>Jump to…</span>
          <kbd>⌘ K</kbd>
        </button>
        <button
          className="icon-button"
          onClick={onTheme}
          aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
        >
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <span className="workspace-user" title={name}>
          {name.slice(0, 2).toUpperCase()}
        </span>
      </div>
    </header>
  );
}

export default function WorkspaceNavigation({
  tools,
  currentTool,
  settingsActive,
  isLocked,
  onSelect,
  onSettings,
  onLogout,
  onHome,
  onResume,
  menuOpen,
  setMenuOpen,
  searchOpen,
  setSearchOpen,
  user,
  businessName,
}) {
  const [query, setQuery] = useState("");
  const dialogRef = useRef(null);
  const menuRef = useRef(null);
  useDialogFocus(dialogRef, searchOpen, () => setSearchOpen(false));
  useDialogFocus(menuRef, menuOpen, () => setMenuOpen(false));
  useEffect(() => {
    const keydown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [setSearchOpen]);
  useEffect(() => {
    if (!searchOpen) setQuery("");
  }, [searchOpen]);
  const select = (id) => {
    onSelect(id);
    setMenuOpen(false);
    setSearchOpen(false);
  };
  const navigation = tools.map((tool) => ({
    ...tool,
    label: labels[tool.id] || tool.label,
  }));
  const results = navigation
    .filter((tool) =>
      `${tool.label} ${tool.copy || ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(b.label.toLowerCase().includes(query.toLowerCase())) -
        Number(a.label.toLowerCase().includes(query.toLowerCase())),
    );
  return (
    <>
      {menuOpen && (
        <button
          className="workspace-nav-scrim"
          aria-label="Close navigation"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside
        id="workspace-sidebar"
        ref={menuRef}
        className={`workspace-sidebar ${menuOpen ? "is-open" : ""}`}
        role={menuOpen ? "dialog" : undefined}
        aria-modal={menuOpen ? true : undefined}
        aria-label="Workspace navigation"
        tabIndex={-1}
      >
        <div className="workspace-sidebar-brand">
          <button onClick={onHome} aria-label="SmartConnect4u home">
            <Brand />
          </button>
          <button
            className="icon-button workspace-close-menu"
            onClick={() => setMenuOpen(false)}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>
        <div className="workspace-switcher">
          <span className="workspace-company-icon">
            {(businessName || "W").slice(0, 1).toUpperCase()}
          </span>
          <div>
            <strong>{businessName || "My workspace"}</strong>
            <span>Your connected business</span>
          </div>
        </div>
        <nav aria-label="Workspace tools">
          <p className="workspace-nav-label">WORKSPACE</p>
          {navigation.map((tool, index) => (
            <div key={tool.id}>
              {index === 1 && <p className="workspace-nav-label">YOUR TOOLS</p>}
              <button
                className="workspace-nav-link"
                aria-current={
                  currentTool === tool.id && !settingsActive
                    ? "page"
                    : undefined
                }
                onClick={() => select(tool.id)}
                title={
                  isLocked(tool.id)
                    ? `${tool.label} · explore access options`
                    : tool.label
                }
              >
                <tool.icon size={18} />
                <span>{tool.label}</span>
                {isLocked(tool.id) && (
                  <LockKeyhole size={12} className="workspace-lock" />
                )}
              </button>
            </div>
          ))}
        </nav>
        {onResume && (
          <div className="workspace-setup-card">
            <span>Make it yours</span>
            <p>Finish your business details to personalise your workspace.</p>
            <button onClick={onResume}>
              Continue setup <ArrowUpRight size={14} />
            </button>
          </div>
        )}
        <div className="workspace-sidebar-bottom">
          <button
            className="workspace-nav-link"
            aria-current={settingsActive ? "page" : undefined}
            onClick={() => {
              onSettings();
              setMenuOpen(false);
            }}
          >
            <Settings size={18} />
            <span>Settings</span>
          </button>
          {onLogout && (
            <button className="workspace-nav-link" onClick={onLogout}>
              <LogOut size={18} />
              <span>Sign out</span>
            </button>
          )}
          <div className="workspace-profile">
            <span>
              {(user?.name || user?.email || "S").slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong>{user?.name || "Your account"}</strong>
              <small>{user?.email || "Team workspace"}</small>
            </div>
          </div>
        </div>
      </aside>
      {searchOpen && (
        <div
          className="workspace-command-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setSearchOpen(false);
          }}
        >
          <section
            className="workspace-command"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Jump to a workspace tool"
            tabIndex={-1}
          >
            <div className="workspace-command-input">
              <Search size={19} />
              <input
                placeholder="Where would you like to go?"
                aria-label="Search workspace tools"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && results[0]) {
                    event.preventDefault();
                    select(results[0].id);
                  }
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    dialogRef.current
                      ?.querySelector(".workspace-command-results button")
                      ?.focus();
                  }
                }}
              />
              <button
                className="icon-button"
                onClick={() => setSearchOpen(false)}
                aria-label="Close search"
              >
                <X size={17} />
              </button>
            </div>
            <p>JUMP TO A TOOL</p>
            <div className="workspace-command-results">
              {results.map((tool) => (
                <button key={tool.id} onClick={() => select(tool.id)}>
                  <tool.icon size={19} />
                  <div>
                    <strong>{tool.label}</strong>
                    <span>{tool.copy || tool.eyebrow}</span>
                  </div>
                  <ArrowUpRight size={16} />
                </button>
              ))}
              {!results.length && (
                <div className="workspace-command-empty">
                  No tools match “{query}”. Try email, tasks, or contacts.
                </div>
              )}
            </div>
            <footer>
              <Command size={13} /> Jump between tools without losing your
              place.<kbd>Esc to close</kbd>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
