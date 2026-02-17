import { headers } from "next/headers";

type CardData = {
  fullName?: string;
  jobTitle?: string;
  department?: string;
  companyName?: string;
  workPhone?: string;
  mobilePhone?: string;
  whatsappPhone?: string;
  email?: string;
  website?: string;
  address?: string;
  mapUrl?: string;
  linkedInUrl?: string;
  photoUrl?: string;
};

type PageProps = {
  params: { token: string };
  searchParams?: { k?: string | string[] };
};

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,32}$/;

const resolveFunctionApiBase = () => {
  const explicitHost = process.env.NEXT_PUBLIC_FUNCTION_HOST || process.env.VITE_FUNCTION_HOST;
  if (explicitHost) return `${explicitHost.replace(/\/$/, "")}/api`;

  const h = headers();
  const host = h.get("x-forwarded-host") || h.get("host");
  const protocol = h.get("x-forwarded-proto") || "https";
  if (host) return `${protocol}://${host.replace(/\/$/, "")}/api`;

  return "https://smartconnect4u.com/api";
};

const digitsOnly = (value: string | undefined) => (value || "").replace(/\D+/g, "");

const normalizeKey = (value: string | string[] | undefined) => {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
};

const buildQuery = (token: string, key: string) => {
  const params = new URLSearchParams({ token });
  if (key) params.set("k", key);
  return params.toString();
};

const initialsFromName = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "SC";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
};

const formatRole = (title: string, company: string) => {
  if (!title && !company) return "SMARTCONNECT4U";
  if (!title) return company.toUpperCase();
  if (!company) return title.toUpperCase();
  return `${title} AT ${company}`.toUpperCase();
};

export default async function PrivateCardPage({ params, searchParams }: PageProps) {
  const token = (params?.token || "").trim();
  const key = normalizeKey(searchParams?.k).trim();

  if (!TOKEN_PATTERN.test(token)) {
    return (
      <main className="min-h-screen bg-slate-950 px-5 py-10 text-slate-50">
        <div className="mx-auto max-w-md rounded-3xl border border-slate-800 bg-slate-900/80 p-7">
          <h1 className="text-xl font-semibold">Card not found or disabled</h1>
        </div>
      </main>
    );
  }

  const query = buildQuery(token, key);
  const cardResponse = await fetch(`${resolveFunctionApiBase()}/private-card?${query}`, { cache: "no-store" });
  if (!cardResponse.ok) {
    return (
      <main className="min-h-screen bg-slate-950 px-5 py-10 text-slate-50">
        <div className="mx-auto max-w-md rounded-3xl border border-slate-800 bg-slate-900/80 p-7">
          <h1 className="text-xl font-semibold">Card not found or disabled</h1>
        </div>
      </main>
    );
  }

  const card = (await cardResponse.json()) as CardData;
  const name = (card.fullName || "").trim() || "SmartConnect4u";
  const title = (card.jobTitle || "").trim();
  const company = (card.companyName || "").trim() || "SmartConnect4u";
  const primaryPhone = (card.workPhone || card.mobilePhone || "").trim();
  const whatsappTarget = digitsOnly(card.whatsappPhone || card.mobilePhone);
  const email = (card.email || "").trim();
  const queryString = buildQuery(token, key);
  const saveContactUrl = `/api/private-vcard?${queryString}`;
  const hasPhone = Boolean(primaryPhone);
  const hasWhatsApp = Boolean(whatsappTarget);
  const hasEmail = Boolean(email);
  const hasMap = Boolean(card.mapUrl && card.address);
  const roleText = formatRole(title, company);

  return (
    <main className="min-h-screen bg-[#e8eddf] px-3 py-6 text-[#161616] sm:px-6">
      <div className="mx-auto max-w-md rounded-[28px] border border-black/10 bg-[#eff3e6] p-3 shadow-[0_18px_45px_rgba(0,0,0,0.18)]">
        <div className="overflow-hidden rounded-[22px] bg-white">
          {card.photoUrl ? (
            <img src={card.photoUrl} alt={name} className="h-[320px] w-full object-cover" />
          ) : (
            <div className="flex h-[320px] w-full items-center justify-center bg-[#d8ddcf] text-6xl font-semibold text-[#73796d]">
              {initialsFromName(name)}
            </div>
          )}

          <div className="px-4 pb-4 pt-5">
            <h1 className="text-[46px] font-semibold leading-[1] tracking-[-0.03em]">{name}</h1>
            <p className="mt-2 text-sm font-semibold tracking-[0.04em] text-[#818181]">{roleText}</p>

            <div className="mt-5 rounded-2xl bg-[#f5f5f5] px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xl font-semibold tracking-tight">{company}</div>
                <div className="text-xs text-[#6e6e6e]">We connect. For real.</div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <a
            href={saveContactUrl}
            className="rounded-xl border border-black/8 bg-white px-3 py-4 text-center text-base font-semibold text-[#141414]"
          >
            Save Contact
          </a>
          <a
            href={hasWhatsApp ? `https://wa.me/${whatsappTarget}` : hasEmail ? `mailto:${email}` : hasPhone ? `tel:${primaryPhone}` : "#"}
            className={`rounded-xl px-3 py-4 text-center text-base font-semibold ${
              hasWhatsApp || hasEmail || hasPhone ? "bg-[#dff25a] text-[#141414]" : "pointer-events-none bg-[#dadada] text-[#707070]"
            }`}
          >
            Exchange Contact
          </a>
        </div>

        <div className="mt-3 rounded-xl border border-black/8 bg-white px-4 py-4">
          <h2 className="text-3xl font-semibold tracking-tight">My Bio</h2>
          <div className="mt-3 space-y-2 text-[15px] text-[#404040]">
            {card.department ? <p>{card.department}</p> : null}
            {card.address ? <p>{card.address}</p> : null}
            {card.website ? (
              <p>
                <a className="underline" href={card.website} target="_blank" rel="noreferrer">
                  {card.website}
                </a>
              </p>
            ) : null}
            {hasMap ? (
              <p>
                <a className="underline" href={card.mapUrl} target="_blank" rel="noreferrer">
                  Open in Maps
                </a>
              </p>
            ) : null}
            {card.linkedInUrl ? (
              <p>
                <a className="underline" href={card.linkedInUrl} target="_blank" rel="noreferrer">
                  LinkedIn
                </a>
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <a
            href={hasPhone ? `tel:${primaryPhone}` : "#"}
            className={`rounded-xl border border-black/8 px-3 py-3 text-center text-sm font-semibold ${
              hasPhone ? "bg-white text-[#141414]" : "pointer-events-none bg-[#ececec] text-[#777]"
            }`}
          >
            Call
          </a>
          <a
            href={hasEmail ? `mailto:${email}` : "#"}
            className={`rounded-xl border border-black/8 px-3 py-3 text-center text-sm font-semibold ${
              hasEmail ? "bg-white text-[#141414]" : "pointer-events-none bg-[#ececec] text-[#777]"
            }`}
          >
            Email
          </a>
        </div>
      </div>
    </main>
  );
}
