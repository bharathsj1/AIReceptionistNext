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

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.22),_transparent_40%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.16),_transparent_50%),#020617] px-4 py-8 text-slate-100">
      <div className="mx-auto max-w-md rounded-3xl border border-slate-700/80 bg-slate-900/85 p-6 shadow-2xl">
        <div className="flex flex-col items-center text-center">
          {card.photoUrl ? (
            <img
              src={card.photoUrl}
              alt={name}
              className="h-28 w-28 rounded-full border border-slate-600 object-cover"
            />
          ) : (
            <div className="flex h-28 w-28 items-center justify-center rounded-full border border-slate-600 bg-slate-800 text-2xl font-bold">
              {initialsFromName(name)}
            </div>
          )}
          <h1 className="mt-4 text-2xl font-semibold">{name}</h1>
          {title ? <p className="mt-1 text-sm text-slate-300">{title}</p> : null}
          <p className="mt-1 text-sm text-slate-400">{company}</p>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <a
            href={primaryPhone ? `tel:${primaryPhone}` : "#"}
            className="rounded-xl bg-cyan-500 px-4 py-3 text-center text-sm font-semibold text-slate-950"
          >
            Call
          </a>
          <a
            href={whatsappTarget ? `https://wa.me/${whatsappTarget}` : "#"}
            className="rounded-xl bg-emerald-500 px-4 py-3 text-center text-sm font-semibold text-slate-950"
          >
            WhatsApp
          </a>
          <a
            href={email ? `mailto:${email}` : "#"}
            className="rounded-xl bg-slate-200 px-4 py-3 text-center text-sm font-semibold text-slate-950"
          >
            Email
          </a>
          <a
            href={saveContactUrl}
            className="rounded-xl bg-amber-400 px-4 py-3 text-center text-sm font-semibold text-slate-950"
          >
            Save Contact
          </a>
        </div>

        <div className="mt-6 space-y-3 text-sm">
          {card.website ? (
            <p>
              <a className="text-cyan-300 underline" href={card.website} target="_blank" rel="noreferrer">
                {card.website}
              </a>
            </p>
          ) : null}
          {card.address ? (
            <p className="text-slate-300">
              {card.mapUrl ? (
                <a className="underline" href={card.mapUrl} target="_blank" rel="noreferrer">
                  {card.address}
                </a>
              ) : (
                card.address
              )}
            </p>
          ) : null}
          {card.linkedInUrl ? (
            <p>
              <a className="text-cyan-300 underline" href={card.linkedInUrl} target="_blank" rel="noreferrer">
                LinkedIn
              </a>
            </p>
          ) : null}
        </div>
      </div>
    </main>
  );
}
