const LOCAL_FUNCTION_BASE = "http://localhost:7071";

const normalizeBase = (value) => String(value || "").trim().replace(/\/$/, "");

const isLocalHost = () => {
  if (typeof window === "undefined") return false;
  const host = String(window.location.hostname || "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0";
};

const explicitBase = import.meta.env.VITE_API_BASE || import.meta.env.VITE_FUNCTION_BASE;
const PRIMARY_FUNCTION_BASE = normalizeBase(explicitBase || (isLocalHost() ? LOCAL_FUNCTION_BASE : ""));
const API_PROXY_BASE = PRIMARY_FUNCTION_BASE
  ? PRIMARY_FUNCTION_BASE.endsWith("/api")
    ? PRIMARY_FUNCTION_BASE
    : `${PRIMARY_FUNCTION_BASE}/api`
  : "";

export const apiUrl = (path) => {
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  return API_PROXY_BASE ? `${API_PROXY_BASE}/${cleanPath}` : `/api/${cleanPath}`;
};

export const API_URLS = {
  vedoraWaitlist: apiUrl("vedora/waitlist"),
  vedoraPartnerInterest: apiUrl("vedora/restaurant-interest")
};

export default API_URLS;
