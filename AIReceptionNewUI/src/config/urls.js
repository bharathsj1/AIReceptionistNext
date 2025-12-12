// Central place for API URLs and future endpoints.
// Use environment variables to override defaults when needed.

const API_PROXY_BASE =
  import.meta.env.VITE_API_PROXY_BASE ?? "/api";

export const API_URLS = {
  crawlKnowledgeBase: `${API_PROXY_BASE}/crawl-kb`,
  ultravoxPrompt: `${API_PROXY_BASE}/ultravox/prompt`,
  provisionClient: `${API_PROXY_BASE}/clients/provision`,
  authLogin: `${API_PROXY_BASE}/auth/login`,
  authForgotPassword: `${API_PROXY_BASE}/auth/forgot-password`,
  authResetPassword: `${API_PROXY_BASE}/auth/reset-password`,
  dashboard: `${API_PROXY_BASE}/dashboard`,
  googleAuthUrl: `${API_PROXY_BASE}/auth/google/url`,
  googleAuthCallback: `${API_PROXY_BASE}/auth/google/callback`,
  calendarEvents: `${API_PROXY_BASE}/calendar/events`,
  dashboardCalls: `${API_PROXY_BASE}/dashboard/calls`,
  dashboardAgent: `${API_PROXY_BASE}/dashboard/agent`
};

export default API_URLS;
