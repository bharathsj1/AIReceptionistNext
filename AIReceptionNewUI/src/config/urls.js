// Central place for API URLs and future endpoints.
// Use environment variables to override defaults when needed.

const API_PROXY_BASE =
  import.meta.env.VITE_API_PROXY_BASE ?? "/api";

export const API_URLS = {
  crawlKnowledgeBase: `${API_PROXY_BASE}/crawl-kb`,
  ultravoxPrompt: `${API_PROXY_BASE}/ultravox/prompt`,
  provisionClient: `${API_PROXY_BASE}/clients/provision`,
  authLogin: `${API_PROXY_BASE}/auth/login`,
  googleAuthUrl: `${API_PROXY_BASE}/auth/google/url`,
  googleAuthCallback: `${API_PROXY_BASE}/auth/google/callback`,
  calendarEvents: `${API_PROXY_BASE}/calendar/events`
};

export default API_URLS;
