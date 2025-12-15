// Central place for API URLs and future endpoints.
// Use environment variables to override defaults when needed.

export const API_PROXY_BASE = import.meta.env.VITE_API_PROXY_BASE ?? "/api";
export const apiUrl = (path) =>
  `${API_PROXY_BASE}${path.startsWith("/") ? "" : "/"}${path}`;

export const API_URLS = {
  crawlKnowledgeBase: apiUrl("crawl-kb"),
  ultravoxPrompt: apiUrl("ultravox/prompt"),
  provisionClient: apiUrl("clients/provision"),
  authSignup: apiUrl("auth/signup"),
  authLogin: apiUrl("auth/login"),
  authForgotPassword: apiUrl("auth/forgot-password"),
  authResetPassword: apiUrl("auth/reset-password"),
  authUserByEmail: apiUrl("auth/user-by-email"),
  clientsByEmail: apiUrl("clients/by-email"),
  clientsBusinessDetails: apiUrl("clients/business-details"),
  paymentsCreateSubscription: apiUrl("payments/create-subscription"),
  paymentsConfirmSubscription: apiUrl("payments/confirm-subscription"),
  ultravoxVoices: apiUrl("ultravox-voices"),
  ultravoxDemoCall: apiUrl("ultravox-demo-call"),
  dashboard: apiUrl("dashboard"),
  googleAuthUrl: apiUrl("auth/google/url"),
  googleAuthCallback: apiUrl("auth/google/callback"),
  calendarEvents: apiUrl("calendar/events"),
  calendarBook: apiUrl("calendar/book"),
  dashboardCalls: apiUrl("dashboard/calls"),
  dashboardAgent: apiUrl("dashboard/agent"),
  dashboardBookingSettings: apiUrl("dashboard/booking-settings"),
  dashboardCallTranscript: apiUrl("dashboard/call-transcript")
};


export default API_URLS;
