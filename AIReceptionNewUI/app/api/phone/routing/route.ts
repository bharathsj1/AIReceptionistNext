import { NextResponse } from "next/server";

const resolveFunctionApiBase = () => {
  const host =
    process.env.NEXT_PUBLIC_FUNCTION_HOST ||
    process.env.VITE_FUNCTION_HOST ||
    "http://localhost:7071";
  return `${host.replace(/\/$/, "")}/api`;
};

const FUNCTION_API_BASE = resolveFunctionApiBase();

const proxyJson = async (url: string, init?: RequestInit) => {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  return NextResponse.json(payload, { status: response.status });
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get("email");
  const twilioNumber = searchParams.get("twilioNumber");
  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }
  const query = new URLSearchParams({ email });
  if (twilioNumber) query.set("twilioNumber", twilioNumber);
  const upstream = `${FUNCTION_API_BASE}/dashboard/routing-settings?${query.toString()}`;
  return proxyJson(upstream);
}

export async function PUT(request: Request) {
  const payload = await request.json().catch(() => ({}));
  return proxyJson(`${FUNCTION_API_BASE}/dashboard/routing-settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}
