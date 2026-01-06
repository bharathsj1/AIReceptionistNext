import { useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  Input
} from "../components/ui/index.jsx";
import {
  Mail,
  Phone,
  Search,
  Shield,
  UploadCloud,
  UserPlus,
  Users,
  X,
  RefreshCw
} from "lucide-react";
import { API_URLS } from "../config/urls";

const SOURCE_META = [
  { id: "all", label: "All contacts", icon: Users },
  { id: "gmail", label: "Gmail imports", icon: Mail },
  { id: "outlook", label: "Outlook imports", icon: Mail },
  { id: "task", label: "AI task leads", icon: Shield },
  { id: "manual", label: "Manual", icon: UserPlus }
];

const formatTag = (tag) => tag.replace(/_/g, " ");
const PHONE_TYPES = ["Work", "Mobile", "Home", "Other"];
const EMAIL_TYPES = ["Work", "Personal", "Other"];
const MARKETING_STATUSES = ["No consent", "Subscribed", "Unsubscribed", "Pending"];
const VISIBILITY_OPTIONS = ["Owner visibility group", "Team", "Public"];
const SYSTEM_TAG_PREFIXES = ["task:"];
const SYSTEM_TAGS = new Set(["ai_receptionist_task", "email_sent", "gmail_import", "outlook_import"]);

const getPrimaryValue = (list, fallback) => {
  if (Array.isArray(list)) {
    const match = list.find((item) => item?.value);
    if (match?.value) return match.value;
  }
  return fallback || "";
};

const extractUserLabels = (contact) => {
  const metaLabels = contact?.metadata?.labels;
  if (Array.isArray(metaLabels) && metaLabels.length) return metaLabels;
  const tags = Array.isArray(contact?.tags) ? contact.tags : [];
  return tags.filter((tag) => {
    if (SYSTEM_TAGS.has(tag)) return false;
    return !SYSTEM_TAG_PREFIXES.some((prefix) => tag.startsWith(prefix));
  });
};

const mergeSystemTags = (contact, labels) => {
  const tags = Array.isArray(contact?.tags) ? contact.tags : [];
  const systemTags = tags.filter((tag) => SYSTEM_TAGS.has(tag) || SYSTEM_TAG_PREFIXES.some((prefix) => tag.startsWith(prefix)));
  return Array.from(new Set([...(systemTags || []), ...(labels || [])]));
};

export default function ContactsScreen({ email, onConnectGoogle, googleConnected, googleAccountEmail }) {
  const [contacts, setContacts] = useState([]);
  const [activeSource, setActiveSource] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedContact, setSelectedContact] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [importStatus, setImportStatus] = useState({ status: "idle", message: "" });
  const [modalOpen, setModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [sortMode, setSortMode] = useState("recent");
  const [form, setForm] = useState({
    name: "",
    organization: "",
    emails: [{ value: "", type: "Work" }],
    phones: [{ value: "", type: "Work" }],
    marketingStatus: "No consent",
    labels: "",
    owner: "",
    visibility: "Owner visibility group"
  });
  const outlookStateRef = useRef(null);
  const pageSize = 10;

  const counts = useMemo(() => {
    const base = { all: contacts.length, gmail: 0, outlook: 0, task: 0, manual: 0 };
    contacts.forEach((contact) => {
      const source = contact.source || "manual";
      base[source] = (base[source] || 0) + 1;
    });
    return base;
  }, [contacts]);

  const filteredContacts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return contacts.filter((contact) => {
      const sourceMatch = activeSource === "all" || contact.source === activeSource;
      if (!sourceMatch) return false;
      if (!query) return true;
      const name = contact.name || "";
      const mail = contact.email || "";
      const phone = contact.phone || "";
      return (
        name.toLowerCase().includes(query) ||
        mail.toLowerCase().includes(query) ||
        phone.toLowerCase().includes(query)
      );
    });
  }, [contacts, activeSource, search]);

  const sortedContacts = useMemo(() => {
    if (sortMode !== "alpha") return filteredContacts;
    const next = [...filteredContacts];
    next.sort((first, second) => {
      const firstKey = (first.name || first.email || "").trim().toLowerCase();
      const secondKey = (second.name || second.email || "").trim().toLowerCase();
      if (!firstKey && !secondKey) return 0;
      if (!firstKey) return 1;
      if (!secondKey) return -1;
      return firstKey.localeCompare(secondKey);
    });
    return next;
  }, [filteredContacts, sortMode]);

  const totalPages = Math.max(1, Math.ceil(sortedContacts.length / pageSize));
  const paginatedContacts = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedContacts.slice(start, start + pageSize);
  }, [sortedContacts, currentPage, pageSize]);

  const loadContacts = async () => {
    if (!email) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ email, limit: "500" });
      const res = await fetch(`${API_URLS.contacts}?${params.toString()}`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to load contacts.");
      }
      const data = await res.json();
      setContacts(Array.isArray(data?.contacts) ? data.contacts : []);
      setSelectedContact((prev) => {
        if (!prev) return null;
        return (data?.contacts || []).find((item) => item.id === prev.id) || null;
      });
    } catch (err) {
      setError(err?.message || "Failed to load contacts.");
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async (source) => {
    if (!email) return;
    setImportStatus({ status: "loading", message: "" });
    try {
      const res = await fetch(API_URLS.contactsImport, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source })
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Import failed.");
      }
      const data = await res.json();
      setImportStatus({
        status: "success",
        message: `Imported ${data?.imported ?? 0} ${source} contacts.`
      });
      await loadContacts();
    } catch (err) {
      setImportStatus({ status: "error", message: err?.message || "Import failed." });
    }
  };

  const beginOutlookConnect = async () => {
    if (!email) return;
    setImportStatus({ status: "loading", message: "" });
    try {
      const params = new URLSearchParams({ email });
      const res = await fetch(`${API_URLS.outlookAuthUrl}?${params.toString()}`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Unable to start Outlook sign-in.");
      }
      const data = await res.json();
      outlookStateRef.current = data?.state;
      const popup = window.open(data?.auth_url, "outlook-oauth", "width=520,height=640");
      if (!popup) {
        throw new Error("Please allow pop-ups to connect Outlook.");
      }
      setImportStatus({ status: "idle", message: "" });
    } catch (err) {
      setImportStatus({ status: "error", message: err?.message || "Outlook sign-in blocked." });
    }
  };

  const openCreateModal = () => {
    setEditingContact(null);
    setForm({
      name: "",
      organization: "",
      emails: [{ value: "", type: "Work" }],
      phones: [{ value: "", type: "Work" }],
      marketingStatus: "No consent",
      labels: "",
      owner: email || "",
      visibility: "Owner visibility group"
    });
    setModalOpen(true);
  };

  const openEditModal = () => {
    if (!selectedContact) return;
    const metadata = selectedContact.metadata || {};
    const emails = Array.isArray(metadata.emails) && metadata.emails.length
      ? metadata.emails
      : selectedContact.email
        ? [{ value: selectedContact.email, type: "Work" }]
        : [{ value: "", type: "Work" }];
    const phones = Array.isArray(metadata.phones) && metadata.phones.length
      ? metadata.phones
      : selectedContact.phone
        ? [{ value: selectedContact.phone, type: "Work" }]
        : [{ value: "", type: "Work" }];
    const labels = extractUserLabels(selectedContact);
    setEditingContact(selectedContact);
    setForm({
      name: selectedContact.name || "",
      organization: metadata.organization || "",
      emails,
      phones,
      marketingStatus: metadata.marketing_status || "No consent",
      labels: labels.join(", "),
      owner: metadata.owner || email || "",
      visibility: metadata.visibility || "Owner visibility group"
    });
    setModalOpen(true);
  };

  const updatePhone = (index, key, value) => {
    setForm((prev) => ({
      ...prev,
      phones: prev.phones.map((item, idx) => (idx === index ? { ...item, [key]: value } : item))
    }));
  };

  const addPhone = () => {
    setForm((prev) => ({
      ...prev,
      phones: [...prev.phones, { value: "", type: "Work" }]
    }));
  };

  const removePhone = (index) => {
    setForm((prev) => {
      const nextPhones = prev.phones.filter((_, idx) => idx !== index);
      return {
        ...prev,
        phones: nextPhones.length ? nextPhones : [{ value: "", type: "Work" }]
      };
    });
  };

  const updateEmail = (index, key, value) => {
    setForm((prev) => ({
      ...prev,
      emails: prev.emails.map((item, idx) => (idx === index ? { ...item, [key]: value } : item))
    }));
  };

  const addEmail = () => {
    setForm((prev) => ({
      ...prev,
      emails: [...prev.emails, { value: "", type: "Work" }]
    }));
  };

  const removeEmail = (index) => {
    setForm((prev) => {
      const nextEmails = prev.emails.filter((_, idx) => idx !== index);
      return {
        ...prev,
        emails: nextEmails.length ? nextEmails : [{ value: "", type: "Work" }]
      };
    });
  };

  const saveContact = async () => {
    if (!email) return;
    const labels = form.labels
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    const trimmedEmails = form.emails
      .map((item) => ({ value: String(item.value || "").trim(), type: item.type || "Work" }))
      .filter((item) => item.value);
    const trimmedPhones = form.phones
      .map((item) => ({ value: String(item.value || "").trim(), type: item.type || "Work" }))
      .filter((item) => item.value);
    const primaryEmail = getPrimaryValue(trimmedEmails, "");
    const primaryPhone = getPrimaryValue(trimmedPhones, "");
    const tags = mergeSystemTags(editingContact, labels);
    const payload = {
      email,
      name: form.name,
      contactEmail: primaryEmail,
      contactPhone: primaryPhone,
      tags,
      source: editingContact?.source || "manual",
      sourceRef: editingContact?.sourceRef || null,
      metadata: {
        organization: form.organization,
        emails: trimmedEmails,
        phones: trimmedPhones,
        marketing_status: form.marketingStatus,
        labels,
        owner: form.owner,
        visibility: form.visibility
      }
    };
    setImportStatus({ status: "loading", message: "" });
    try {
      const res = await fetch(API_URLS.contacts, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Unable to save contact.");
      }
      setModalOpen(false);
      setImportStatus({ status: "success", message: "Contact saved." });
      await loadContacts();
    } catch (err) {
      setImportStatus({ status: "error", message: err?.message || "Unable to save contact." });
    }
  };

  const deleteSelected = async () => {
    if (!email || !selectedContact) return;
    setImportStatus({ status: "loading", message: "" });
    try {
      const res = await fetch(API_URLS.contacts, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, id: selectedContact.id })
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Unable to delete contact.");
      }
      setSelectedContact(null);
      setImportStatus({ status: "success", message: "Contact deleted." });
      await loadContacts();
    } catch (err) {
      setImportStatus({ status: "error", message: err?.message || "Unable to delete contact." });
    }
  };

  useEffect(() => {
    loadContacts();
  }, [email]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeSource, search, sortMode]);

  useEffect(() => {
    const handler = (event) => {
      const payload = event.data || {};
      if (!payload?.outlook_account_email) return;
      if (outlookStateRef.current && payload?.state && payload.state !== outlookStateRef.current) {
        return;
      }
      setImportStatus({ status: "success", message: "Outlook connected." });
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1.6fr_1fr] h-[calc(100vh-120px)]">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-xl backdrop-blur">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-indigo-200">Contacts</p>
            <h3 className="text-lg font-semibold text-white">Directory</h3>
          </div>
          <Button variant="ghost" size="sm" onClick={loadContacts} disabled={loading}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
        <div className="mt-4 space-y-2">
          {SOURCE_META.map((source) => {
            const Icon = source.icon;
            const isActive = activeSource === source.id;
            return (
              <button
                key={source.id}
                type="button"
                onClick={() => setActiveSource(source.id)}
                className={`flex w-full items-center justify-between rounded-2xl border px-3 py-2 text-left text-xs transition ${
                  isActive
                    ? "border-indigo-400/60 bg-indigo-500/15 text-indigo-100"
                    : "border-white/10 bg-white/5 text-slate-200 hover:border-white/30 hover:bg-white/10"
                }`}
              >
                <span className="flex items-center gap-2">
                  <Icon className="h-4 w-4" />
                  {source.label}
                </span>
                <span className="text-[11px] text-slate-300">{counts[source.id] ?? 0}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-6 space-y-2 text-xs text-slate-300">
          <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Import</p>
            <div className="mt-3 flex flex-col gap-2">
              <Button
                variant={googleConnected ? "ghost" : "primary"}
                size="sm"
                onClick={() => onConnectGoogle?.({ force: true })}
              >
                <UploadCloud className="h-4 w-4" />
                {googleConnected ? "Gmail connected" : "Connect Gmail"}
              </Button>
              {googleConnected && googleAccountEmail ? (
                <span className="text-[10px] text-emerald-200">
                  {googleAccountEmail}
                </span>
              ) : null}
              <Button variant="default" size="sm" onClick={beginOutlookConnect}>
                <UploadCloud className="h-4 w-4" />
                Connect Outlook
              </Button>
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Sync contacts</p>
            <div className="mt-3 flex flex-col gap-2">
              <Button variant="ghost" size="sm" onClick={() => handleImport("gmail")}>
                Import Gmail
              </Button>
              <Button variant="ghost" size="sm" onClick={() => handleImport("outlook")}>
                Import Outlook
              </Button>
            </div>
          </div>
          <Button variant="success" size="sm" onClick={openCreateModal}>
            <UserPlus className="h-4 w-4" />
            New contact
          </Button>
          {importStatus.message ? (
            <div
              className={`rounded-xl border px-3 py-2 text-[11px] ${
                importStatus.status === "error"
                  ? "border-rose-400/40 bg-rose-500/10 text-rose-200"
                  : importStatus.status === "success"
                    ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-100"
                    : "border-white/10 bg-white/5 text-slate-200"
              }`}
            >
              {importStatus.message}
            </div>
          ) : null}
        </div>
      </div>

      <Card className="shadow-xl backdrop-blur flex flex-col min-h-0 h-full">
        <CardContent className="space-y-4 flex flex-col min-h-0 h-full">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-indigo-200">Contact list</p>
              <h3 className="text-lg font-semibold text-white">
                {activeSource === "all"
                  ? "All contacts"
                  : SOURCE_META.find((source) => source.id === activeSource)?.label}
              </h3>
            </div>
            <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
              <div className="relative w-full sm:w-64">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search name or email"
                  className="w-full rounded-2xl border border-white/10 bg-slate-900/50 py-2 pl-9 pr-3 text-xs text-white placeholder:text-slate-500 focus:border-indigo-300 focus:outline-none"
                />
              </div>
              <select
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value)}
                className="rounded-2xl border border-white/10 bg-slate-900/50 px-3 py-2 text-xs text-white focus:border-indigo-300 focus:outline-none"
              >
                <option value="recent">Sort: Recent</option>
                <option value="alpha">Sort: A-Z</option>
              </select>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto pr-1">
            {loading ? (
              <div className="rounded-2xl border border-white/10 bg-slate-900/40 px-4 py-6 text-sm text-slate-300">
                Loading contacts...
              </div>
            ) : error ? (
              <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-6 text-sm text-rose-200">
                {error}
              </div>
            ) : paginatedContacts.length ? (
              <div className="grid gap-3">
                {paginatedContacts.map((contact) => (
                (() => {
                  const metadata = contact.metadata || {};
                  const displayEmail = contact.email || getPrimaryValue(metadata.emails, "");
                  const displayPhone = contact.phone || getPrimaryValue(metadata.phones, "");
                  const labelSource = extractUserLabels(contact);
                  return (
                <button
                  key={contact.id}
                  type="button"
                  onClick={() => setSelectedContact(contact)}
                  className={`group rounded-2xl border px-4 py-3 text-left transition ${
                    selectedContact?.id === contact.id
                      ? "border-indigo-400/60 bg-indigo-500/15"
                      : "border-white/10 bg-white/5 hover:border-indigo-300/40 hover:bg-white/10"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">{contact.name || "Unnamed contact"}</p>
                      <p className="mt-1 text-xs text-slate-300">{displayEmail || "No email"}</p>
                      {displayPhone ? (
                        <p className="mt-1 text-xs text-slate-400">{displayPhone}</p>
                      ) : null}
                    </div>
                    <Badge className="border-white/10 bg-slate-900/40 text-slate-200">
                      {contact.source || "manual"}
                    </Badge>
                  </div>
                  {labelSource.length ? (
                    <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-slate-300">
                      {labelSource.slice(0, 3).map((tag) => (
                        <span key={`${contact.id}-${tag}`} className="rounded-full border border-white/10 px-2 py-0.5">
                          {formatTag(tag)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </button>
                  );
                })()
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-slate-900/40 px-4 py-6 text-sm text-slate-300">
                No contacts yet.
              </div>
            )}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
            <span>
              Showing{" "}
              {sortedContacts.length
                ? `${(currentPage - 1) * pageSize + 1}-${Math.min(
                    currentPage * pageSize,
                    sortedContacts.length
                  )}`
                : "0"}{" "}
              of {sortedContacts.length}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                disabled={currentPage <= 1}
              >
                Previous
              </Button>
              <span className="text-[11px] text-slate-400">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                disabled={currentPage >= totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-xl backdrop-blur">
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-indigo-200">Contact detail</p>
              <h3 className="text-lg font-semibold text-white">
                {selectedContact?.name || "Select a contact"}
              </h3>
            </div>
            {selectedContact ? (
              <button
                type="button"
                onClick={() => setSelectedContact(null)}
                className="rounded-full border border-white/10 p-2 text-slate-200 hover:border-white/30"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          {selectedContact ? (
            <>
              {(() => {
                const metadata = selectedContact.metadata || {};
                const emails = Array.isArray(metadata.emails) && metadata.emails.length
                  ? metadata.emails
                  : selectedContact.email
                    ? [{ value: selectedContact.email, type: "Work" }]
                    : [];
                const phones = Array.isArray(metadata.phones) && metadata.phones.length
                  ? metadata.phones
                  : selectedContact.phone
                    ? [{ value: selectedContact.phone, type: "Work" }]
                    : [];
                const labels = extractUserLabels(selectedContact);
                return (
              <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-4 text-xs text-slate-200">
                <div className="space-y-2">
                  {emails.length ? (
                    emails.map((item, idx) => (
                      <div key={`email-${idx}`} className="flex items-center gap-2">
                        <Mail className="h-4 w-4 text-indigo-200" />
                        <span>{item.value}</span>
                        <span className="text-[10px] text-slate-400">{item.type || "Work"}</span>
                      </div>
                    ))
                  ) : (
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-indigo-200" />
                      <span>No email address</span>
                    </div>
                  )}
                  {phones.length ? (
                    phones.map((item, idx) => (
                      <div key={`phone-${idx}`} className="flex items-center gap-2">
                        <Phone className="h-4 w-4 text-indigo-200" />
                        <span>{item.value}</span>
                        <span className="text-[10px] text-slate-400">{item.type || "Work"}</span>
                      </div>
                    ))
                  ) : (
                    <div className="flex items-center gap-2">
                      <Phone className="h-4 w-4 text-indigo-200" />
                      <span>No phone number</span>
                    </div>
                  )}
                </div>
                {labels.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {labels.map((tag) => (
                      <Badge key={`${selectedContact.id}-tag-${tag}`} className="border-white/10 bg-white/5 text-slate-100">
                        {formatTag(tag)}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
                );
              })()}
              <div className="grid gap-2 text-xs text-slate-300">
                <p>Source: {selectedContact.source || "manual"}</p>
                <p>Organization: {selectedContact.metadata?.organization || "—"}</p>
                <p>Marketing status: {selectedContact.metadata?.marketing_status || "—"}</p>
                <p>Owner: {selectedContact.metadata?.owner || "—"}</p>
                <p>Visibility: {selectedContact.metadata?.visibility || "—"}</p>
                <p>Last updated: {selectedContact.updatedAt ? new Date(selectedContact.updatedAt).toLocaleString() : "—"}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" size="sm" onClick={openEditModal}>
                  Edit contact
                </Button>
                <Button variant="danger" size="sm" onClick={deleteSelected}>
                  Delete
                </Button>
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-slate-900/40 px-4 py-6 text-sm text-slate-300">
              Choose a contact to view details.
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-indigo-200">
                {editingContact ? "Edit contact" : "New contact"}
              </p>
              <h4 className="text-lg font-semibold text-white">
                {editingContact ? "Update details" : "Create contact"}
              </h4>
            </div>
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="rounded-full border border-white/10 p-2 text-slate-200 hover:border-white/30"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-4 grid gap-4 text-xs text-slate-200">
            <div>
              <label className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Name</label>
              <Input
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Full name"
              />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Organization</label>
              <Input
                value={form.organization}
                onChange={(event) => setForm((prev) => ({ ...prev, organization: event.target.value }))}
                placeholder="Company or organization"
              />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Phone</label>
              <div className="mt-2 grid gap-2">
                {form.phones.map((phone, index) => (
                  <div key={`phone-${index}`} className="grid gap-2 sm:grid-cols-[1fr_120px_auto]">
                    <Input
                      value={phone.value}
                      onChange={(event) => updatePhone(index, "value", event.target.value)}
                      placeholder="Phone number"
                    />
                    <select
                      value={phone.type}
                      onChange={(event) => updatePhone(index, "type", event.target.value)}
                      className="rounded-2xl border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-white focus:border-indigo-300 focus:outline-none"
                    >
                      {PHONE_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                    {form.phones.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => removePhone(index)}
                        className="rounded-2xl border border-white/10 px-3 py-2 text-[11px] text-slate-200 hover:border-white/30"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addPhone}
                  className="text-left text-xs font-semibold text-indigo-200"
                >
                  + Add phone
                </button>
              </div>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Email</label>
              <div className="mt-2 grid gap-2">
                {form.emails.map((emailItem, index) => (
                  <div key={`email-${index}`} className="grid gap-2 sm:grid-cols-[1fr_120px_auto]">
                    <Input
                      value={emailItem.value}
                      onChange={(event) => updateEmail(index, "value", event.target.value)}
                      placeholder="Email address"
                    />
                    <select
                      value={emailItem.type}
                      onChange={(event) => updateEmail(index, "type", event.target.value)}
                      className="rounded-2xl border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-white focus:border-indigo-300 focus:outline-none"
                    >
                      {EMAIL_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                    {form.emails.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => removeEmail(index)}
                        className="rounded-2xl border border-white/10 px-3 py-2 text-[11px] text-slate-200 hover:border-white/30"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addEmail}
                  className="text-left text-xs font-semibold text-indigo-200"
                >
                  + Add email
                </button>
              </div>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Marketing status</label>
              <select
                value={form.marketingStatus}
                onChange={(event) => setForm((prev) => ({ ...prev, marketingStatus: event.target.value }))}
                className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-white focus:border-indigo-300 focus:outline-none"
              >
                {MARKETING_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Labels</label>
              <Input
                value={form.labels}
                onChange={(event) => setForm((prev) => ({ ...prev, labels: event.target.value }))}
                placeholder="Add labels"
              />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Owner</label>
              <Input
                value={form.owner}
                onChange={(event) => setForm((prev) => ({ ...prev, owner: event.target.value }))}
                placeholder="Owner"
              />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Visible to</label>
              <select
                value={form.visibility}
                onChange={(event) => setForm((prev) => ({ ...prev, visibility: event.target.value }))}
                className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-white focus:border-indigo-300 focus:outline-none"
              >
                {VISIBILITY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="success" onClick={saveContact}>
              Save contact
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
