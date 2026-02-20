// Central place for API URLs and future endpoints.
// Local dev (localhost) automatically points to local Functions runtime.
const PROD_FUNCTION_BASE = "https://aireceptionist-func.azurewebsites.net";
const LOCAL_FUNCTION_BASE = "http://localhost:7071";

const normalizeBase = (value) => String(value || "").trim().replace(/\/$/, "");

const isLocalHost = () => {
  if (typeof window === "undefined") return false;
  const host = String(window.location.hostname || "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0";
};

const explicitBase =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_FUNCTION_BASE ||
  import.meta.env.NEXT_PUBLIC_API_BASE;

const PRIMARY_FUNCTION_BASE = normalizeBase(explicitBase || (isLocalHost() ? LOCAL_FUNCTION_BASE : PROD_FUNCTION_BASE));
const PRIMARY_API_BASE = PRIMARY_FUNCTION_BASE.endsWith("/api")
  ? PRIMARY_FUNCTION_BASE
  : `${PRIMARY_FUNCTION_BASE}/api`;

// Dedicated Jitsi/meetings function app base
const rawJitsiBase =
  import.meta.env.VITE_JITSI_API_BASE || import.meta.env.NEXT_PUBLIC_JITSI_API_BASE;
const normalizedJitsiBase =
  typeof rawJitsiBase === "string" ? rawJitsiBase.replace(/\/$/, "") : "";
const JITSI_API_BASE = normalizedJitsiBase || PRIMARY_API_BASE;

export { JITSI_API_BASE };
export const jitsiApiUrl = (path) =>
  `${JITSI_API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;

export const API_PROXY_BASE = PRIMARY_API_BASE;
export const apiUrl = (path) =>
  `${API_PROXY_BASE}${path.startsWith("/") ? "" : "/"}${path}`;

export const API_URLS = {
  // Jitsi meetings app (new function app)
  jitsiMeetings: jitsiApiUrl("meetings"),
  jitsiMeeting: (id) => jitsiApiUrl(`meetings/${id}`),
  jitsiMeetingAudio: (id) => jitsiApiUrl(`meetings/${id}/audio`),
  jitsiMeetingArtifacts: (id) => jitsiApiUrl(`meetings/${id}/artifacts`),
  jitsiMeetingSummarize: (id) => jitsiApiUrl(`meetings/${id}/summarize`),
  jitsiMeetingTasks: (id) => jitsiApiUrl(`meetings/${id}/tasks`),

  crawlKnowledgeBase: apiUrl("crawl-kb"),
  businessProfile: apiUrl("business-profile"),
  ultravoxPrompt: apiUrl("ultravox/prompt"),
  provisionClient: apiUrl("clients/provision"),
  authSignup: apiUrl("auth/signup"),
  authLogin: apiUrl("auth/login"),
  authEmailExists: apiUrl("auth/email-exists"),
  authForgotPassword: apiUrl("auth/forgot-password"),
  authResetPassword: apiUrl("auth/reset-password"),
  authUserByEmail: apiUrl("auth/user-by-email"),
  clientsByEmail: apiUrl("clients/by-email"),
  clientsBusinessDetails: apiUrl("clients/business-details"),
  paymentsPublicConfig: apiUrl("payments/public-config"),
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
  outlookAuthUrl: apiUrl("auth/outlook/url"),
  outlookAuthCallback: apiUrl("auth/outlook/callback"),
  outlookDisconnect: apiUrl("auth/outlook/disconnect"),
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
  emailThread: apiUrl("email/thread"),
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
  inbox: apiUrl("inbox"),
  emailWatch: apiUrl("email/watch"),
  emailNotifications: apiUrl("email/notifications"),
  emailFeedback: apiUrl("email/feedback"),
  emailSettings: apiUrl("email/settings"),
  contacts: apiUrl("contacts"),
  contactsImport: apiUrl("contacts/import"),
  contactsSuggest: apiUrl("contacts/suggest"),
  dashboardCalls: apiUrl("dashboard/calls"),
  dashboardAnalytics: apiUrl("dashboard/analytics"),
  dashboardRecordingMedia: apiUrl("dashboard/recordings"),
  dashboardAgent: apiUrl("dashboard/agent"),
  taskManager: apiUrl("task-manager"),
  dashboardBookingSettings: apiUrl("dashboard/booking-settings"),
  dashboardRoutingSettings: apiUrl("dashboard/routing-settings"),
  dashboardCallTranscript: apiUrl("dashboard/call-transcript"),
  tasks: apiUrl("tasks"),
  tasksStream: apiUrl("tasks/stream"),
  tasksChanges: apiUrl("tasks/changes"),
  calls: apiUrl("calls"),
  twilioAvailableNumbers: apiUrl("twilio/available-numbers"),
  voiceToken: apiUrl("voice/token"),
  voiceTwiml: apiUrl("voice/twiml"),
  voiceDialout: apiUrl("voice/dialout"),
  voiceLogs: apiUrl("voice/logs"),
  voiceTokenDialer: apiUrl("voice-token"),
  voiceOutboundDialer: apiUrl("voice-outbound"),
  callHistory: apiUrl("call-history"),
  activePhoneNumbers: apiUrl("active-phone-numbers"),
  socialMetaAuthUrl: apiUrl("social/meta/auth-url"),
  socialMetaCallback: apiUrl("social/meta/callback"),
  socialConnections: apiUrl("social/connections"),
  socialDisconnect: apiUrl("social/connections/disconnect"),
  socialWhatsAppAuthUrl: apiUrl("social/whatsapp/auth-url"),
  socialWhatsAppCallback: apiUrl("social/whatsapp/callback"),
  socialWhatsAppConnect: apiUrl("social/whatsapp/connect-manual"),
  socialWhatsAppSend: apiUrl("social/whatsapp/send"),
  socialInboxConversations: apiUrl("social/inbox/conversations"),
  socialInboxMessages: apiUrl("social/inbox/conversations"),
  socialInboxReply: apiUrl("social/inbox/conversations"),
  socialSuggestReply: apiUrl("social/ai/suggest-reply"),
  socialMediaUpload: apiUrl("social/media/upload"),
  socialDrafts: apiUrl("social/posts/drafts"),
  socialDraftCreate: apiUrl("social/posts/draft"),
  socialDraftUpdate: apiUrl("social/posts/draft"),
  socialPublish: apiUrl("social/posts/publish"),
  socialSchedule: apiUrl("social/posts/schedule"),
  socialScheduledPosts: apiUrl("social/posts/scheduled"),
  socialXConnect: apiUrl("social/x/connect"),
  socialAICaption: apiUrl("social/ai/caption"),
  clientUsersList: apiUrl("auth/client-users/list"),
  clientUsersCreate: apiUrl("auth/client-users"),
  clientUsersDelete: (id) => apiUrl(`auth/client-users/${id}`),
  clientUsersUpdate: (id) => apiUrl(`auth/client-users/${id}/update`),
  crmDashboard: apiUrl("crm/dashboard"),
  crmUsers: apiUrl("crm/users"),
  crmTasks: apiUrl("crm/tasks"),
  crmTask: (id) => apiUrl(`crm/tasks/${id}`),
  crmTaskComments: (id) => apiUrl(`crm/tasks/${id}/comments`),
  crmDeals: apiUrl("crm/deals"),
  crmDeal: (id) => apiUrl(`crm/deals/${id}`),
  crmDealComments: (id) => apiUrl(`crm/deals/${id}/comments`),
  crmCompanies: apiUrl("crm/companies"),
  crmCompany: (id) => apiUrl(`crm/companies/${id}`),
  crmContacts: apiUrl("crm/contacts"),
  crmContact: (id) => apiUrl(`crm/contacts/${id}`),
  crmContactComments: (id) => apiUrl(`crm/contacts/${id}/comments`),
  crmComments: apiUrl("crm/comments"),
  crmComment: (id) => apiUrl(`crm/comments/${id}`),
  crmActivities: apiUrl("crm/activities"),
  crmEmailLinks: apiUrl("crm/email-links"),
  crmNotifications: apiUrl("crm/notifications"),
  crmNotificationRead: (id) => apiUrl(`crm/notifications/${id}/read`),
  crmAudit: apiUrl("crm/audit"),
  crmTasksReport: apiUrl("crm/reports/tasks"),
  crmDealsReport: apiUrl("crm/reports/deals"),
  chat: apiUrl("chat")
  ,
  liveHandoff: apiUrl("live-handoff")
};


export default API_URLS;
