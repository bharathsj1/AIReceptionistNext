import { useEffect, useMemo, useState } from "react";
import { apiUrl } from "../config/urls.js";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,32}$/;

const digitsOnly = (value) => String(value || "").replace(/\D+/g, "");

const initialsFromName = (name) => {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "SC";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
};

const formatRole = (title, company) => {
  const safeTitle = String(title || "").trim();
  const safeCompany = String(company || "").trim();
  if (!safeTitle && !safeCompany) return "SMARTCONNECT4U";
  if (!safeTitle) return safeCompany.toUpperCase();
  if (!safeCompany) return safeTitle.toUpperCase();
  return `${safeTitle} AT ${safeCompany}`.toUpperCase();
};

const applyNoIndexMeta = () => {
  if (typeof document === "undefined") return () => {};
  let meta = document.querySelector('meta[name="robots"]');
  const created = !meta;
  const prev = meta ? meta.getAttribute("content") : null;
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "robots");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", "noindex,nofollow");
  return () => {
    if (!meta) return;
    if (created) {
      meta.remove();
      return;
    }
    if (prev === null) meta.removeAttribute("content");
    else meta.setAttribute("content", prev);
  };
};

export default function PrivateCardScreen({ token, accessKey }) {
  const [state, setState] = useState({ loading: true, error: "", card: null });

  useEffect(() => {
    const cleanup = applyNoIndexMeta();
    const prevTitle = document.title;
    document.title = "SmartConnect4u Card";
    return () => {
      cleanup();
      document.title = prevTitle;
    };
  }, []);

  useEffect(() => {
    const safeToken = String(token || "").trim();
    if (!TOKEN_PATTERN.test(safeToken)) {
      setState({ loading: false, error: "Card not found or disabled", card: null });
      return;
    }

    let cancelled = false;
    const params = new URLSearchParams({ token: safeToken });
    if (accessKey) params.set("k", String(accessKey).trim());

    fetch(`${apiUrl("private-card")}?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" }
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("Card not found or disabled");
        const data = await res.json();
        if (!cancelled) setState({ loading: false, error: "", card: data || null });
      })
      .catch(() => {
        if (!cancelled) setState({ loading: false, error: "Card not found or disabled", card: null });
      });

    return () => {
      cancelled = true;
    };
  }, [token, accessKey]);

  const view = useMemo(() => {
    if (!state.card) return null;
    const card = state.card;
    const name = String(card.fullName || "").trim() || "SmartConnect4u";
    const title = String(card.jobTitle || "").trim();
    const company = String(card.companyName || "").trim() || "SmartConnect4u";
    const roleText = formatRole(title, company);
    const primaryPhone = String(card.workPhone || card.mobilePhone || "").trim();
    const whatsappTarget = digitsOnly(card.whatsappPhone || card.mobilePhone);
    const email = String(card.email || "").trim();
    const hasPhone = Boolean(primaryPhone);
    const hasWhatsApp = Boolean(whatsappTarget);
    const hasEmail = Boolean(email);
    const hasMap = Boolean(card.mapUrl && card.address);

    const params = new URLSearchParams({ token: String(token || "").trim() });
    if (accessKey) params.set("k", String(accessKey).trim());
    const saveContactUrl = `${apiUrl("private-vcard")}?${params.toString()}`;
    const exchangeHref = hasWhatsApp
      ? `https://wa.me/${whatsappTarget}`
      : hasEmail
        ? `mailto:${email}`
        : hasPhone
          ? `tel:${primaryPhone}`
          : "#";

    return {
      card,
      name,
      company,
      roleText,
      saveContactUrl,
      exchangeHref,
      hasPhone,
      hasEmail,
      hasMap,
      primaryPhone,
      email
    };
  }, [accessKey, state.card, token]);

  if (state.loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#e8eddf] px-4 text-[#1d1d1d]">
        <p className="text-lg font-medium">Loading card...</p>
      </div>
    );
  }

  if (state.error || !view) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#e8eddf] px-4 text-[#1d1d1d]">
        <div className="rounded-2xl border border-black/10 bg-white px-6 py-5 text-center shadow">
          <p className="text-lg font-semibold">{state.error || "Card not found or disabled"}</p>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#e8eddf] px-3 py-6 text-[#161616] sm:px-6">
      <div className="mx-auto max-w-md rounded-[28px] border border-black/10 bg-[#eff3e6] p-3 shadow-[0_18px_45px_rgba(0,0,0,0.18)]">
        <div className="overflow-hidden rounded-[22px] bg-white">
          {view.card.photoUrl ? (
            <img src={view.card.photoUrl} alt={view.name} className="h-[320px] w-full object-cover" />
          ) : (
            <div className="flex h-[320px] w-full items-center justify-center bg-[#d8ddcf] text-6xl font-semibold text-[#73796d]">
              {initialsFromName(view.name)}
            </div>
          )}

          <div className="px-4 pb-4 pt-5">
            <h1 className="text-[46px] font-semibold leading-[1] tracking-[-0.03em]">{view.name}</h1>
            <p className="mt-2 text-sm font-semibold tracking-[0.04em] text-[#818181]">{view.roleText}</p>

            <div className="mt-5 rounded-2xl bg-[#f5f5f5] px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xl font-semibold tracking-tight">{view.company}</div>
                <div className="text-xs text-[#6e6e6e]">We connect. For real.</div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <a
            href={view.saveContactUrl}
            className="rounded-xl border border-black/8 bg-white px-3 py-4 text-center text-base font-semibold text-[#141414]"
          >
            Save Contact
          </a>
          <a href={view.exchangeHref} className="rounded-xl bg-[#dff25a] px-3 py-4 text-center text-base font-semibold text-[#141414]">
            Exchange Contact
          </a>
        </div>

        <div className="mt-3 rounded-xl border border-black/8 bg-white px-4 py-4">
          <h2 className="text-3xl font-semibold tracking-tight">My Bio</h2>
          <div className="mt-3 space-y-2 text-[15px] text-[#404040]">
            {view.card.department ? <p>{view.card.department}</p> : null}
            {view.card.address ? <p>{view.card.address}</p> : null}
            {view.card.website ? (
              <p>
                <a className="underline" href={view.card.website} target="_blank" rel="noreferrer">
                  {view.card.website}
                </a>
              </p>
            ) : null}
            {view.hasMap ? (
              <p>
                <a className="underline" href={view.card.mapUrl} target="_blank" rel="noreferrer">
                  Open in Maps
                </a>
              </p>
            ) : null}
            {view.card.linkedInUrl ? (
              <p>
                <a className="underline" href={view.card.linkedInUrl} target="_blank" rel="noreferrer">
                  LinkedIn
                </a>
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <a
            href={view.hasPhone ? `tel:${view.primaryPhone}` : "#"}
            className={`rounded-xl border border-black/8 px-3 py-3 text-center text-sm font-semibold ${
              view.hasPhone ? "bg-white text-[#141414]" : "pointer-events-none bg-[#ececec] text-[#777]"
            }`}
          >
            Call
          </a>
          <a
            href={view.hasEmail ? `mailto:${view.email}` : "#"}
            className={`rounded-xl border border-black/8 px-3 py-3 text-center text-sm font-semibold ${
              view.hasEmail ? "bg-white text-[#141414]" : "pointer-events-none bg-[#ececec] text-[#777]"
            }`}
          >
            Email
          </a>
        </div>
      </div>
    </main>
  );
}
