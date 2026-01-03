// Central place for API URLs and future endpoints.
// Use environment variables to override defaults when needed.

const rawApiBase = import.meta.env.VITE_API_PROXY_BASE;
const devHost = (import.meta.env.VITE_FUNCTION_HOST || "http://localhost:7071").replace(
  /\/$/,
  ""
);
const devApiBase = `${devHost}/api`;
const isAzureHost =
  typeof rawApiBase === "string" &&
  rawApiBase.toLowerCase().includes("azurewebsites.net");

export const API_PROXY_BASE = import.meta.env.DEV
  ? rawApiBase && !isAzureHost
    ? rawApiBase
    : devApiBase
  : rawApiBase ?? "/api";
export const apiUrl = (path) =>
  `${API_PROXY_BASE}${path.startsWith("/") ? "" : "/"}${path}`;

export const API_URLS = {
  crawlKnowledgeBase: apiUrl("crawl-kb"),
  businessProfile: apiUrl("business-profile"),
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
  assignAiNumber: apiUrl("clients/assign-number"),
  subscriptionsStatus: apiUrl("subscriptions/status"),
  googleAuthUrl: apiUrl("auth/google/url"),
  googleAuthCallback: apiUrl("auth/google/callback"),
  googleDisconnect: apiUrl("auth/google/disconnect"),
  calendarEvents: apiUrl("calendar/events"),
  calendarCreate: apiUrl("calendar/create"),
  calendarUpdate: apiUrl("calendar/update"),
  calendarBook: apiUrl("calendar/book"),
  promptsGenerate: apiUrl("prompts/generate"),
  promptsActive: apiUrl("prompts/active"),
  promptsHistory: apiUrl("prompts/history"),
  promptsActivate: apiUrl("prompts/activate"),
  emailMessages: apiUrl("email/messages"),
  emailMessage: apiUrl("email/message"),
  emailAttachment: apiUrl("email/attachment"),
  emailReplyDraft: apiUrl("email/reply-draft"),
  emailComposeDraft: apiUrl("email/compose-draft"),
  emailSummary: apiUrl("email/summary"),
  emailClassify: apiUrl("email/classify"),
  emailActions: apiUrl("email/actions"),
  emailReplyVariants: apiUrl("email/reply-variants"),
  emailLabels: apiUrl("email/labels"),
  emailModify: apiUrl("email/modify"),
  emailTrash: apiUrl("email/trash"),
  emailDelete: apiUrl("email/delete"),
  emailSend: apiUrl("email/send"),
  dashboardCalls: apiUrl("dashboard/calls"),
  dashboardAgent: apiUrl("dashboard/agent"),
  dashboardBookingSettings: apiUrl("dashboard/booking-settings"),
  dashboardCallTranscript: apiUrl("dashboard/call-transcript"),
  tasks: apiUrl("tasks"),
  tasksStream: apiUrl("tasks/stream"),
  tasksChanges: apiUrl("tasks/changes"),
  calls: apiUrl("calls"),
  socialMetaAuthUrl: apiUrl("social/meta/auth-url"),
  socialMetaCallback: apiUrl("social/meta/callback"),
  socialConnections: apiUrl("social/connections"),
  socialDisconnect: apiUrl("social/connections/disconnect"),
  socialWhatsAppConnect: apiUrl("social/whatsapp/connect-manual"),
  socialInboxConversations: apiUrl("social/inbox/conversations"),
  socialInboxMessages: apiUrl("social/inbox/conversations"),
  socialInboxReply: apiUrl("social/inbox/conversations"),
  socialSuggestReply: apiUrl("social/ai/suggest-reply"),
  socialDrafts: apiUrl("social/posts/drafts"),
  socialDraftCreate: apiUrl("social/posts/draft"),
  socialDraftUpdate: apiUrl("social/posts/draft"),
  socialPublish: apiUrl("social/posts/publish"),
  socialSchedule: apiUrl("social/posts/schedule"),
  socialScheduledPosts: apiUrl("social/posts/scheduled"),
  socialXConnect: apiUrl("social/x/connect")
};


export default API_URLS;
