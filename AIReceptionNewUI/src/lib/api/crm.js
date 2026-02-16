import { API_URLS } from "../../config/urls";

const defaultHeaders = (email) => {
  const headers = {
    "Content-Type": "application/json",
  };
  if (email) headers["x-user-email"] = email;
  return headers;
};

const withQuery = (baseUrl, query = {}) => {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    params.set(key, String(value));
  });
  return `${baseUrl}${params.toString() ? `?${params.toString()}` : ""}`;
};

const parsePayload = async (res) => {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

const request = async (url, { method = "GET", email, query, body } = {}) => {
  const fullUrl = query ? withQuery(url, query) : url;
  const res = await fetch(fullUrl, {
    method,
    headers: defaultHeaders(email),
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await parsePayload(res);
  if (!res.ok) {
    throw new Error(payload?.error || payload?.message || "CRM request failed");
  }
  return payload;
};

const requestFile = async (url, { email, query } = {}) => {
  const fullUrl = query ? withQuery(url, query) : url;
  const res = await fetch(fullUrl, {
    method: "GET",
    headers: defaultHeaders(email),
  });
  if (!res.ok) {
    const payload = await parsePayload(res);
    throw new Error(payload?.error || payload?.message || "CRM export failed");
  }
  return res.text();
};

export const fetchCrmDashboard = ({ email, query = {} }) =>
  request(API_URLS.crmDashboard, { email, query });

export const listCrmUsers = ({ email }) =>
  request(API_URLS.crmUsers, { email });

export const listCrmTasks = ({ email, query = {} }) =>
  request(API_URLS.crmTasks, { email, query });

export const createCrmTask = ({ email, data }) =>
  request(API_URLS.crmTasks, { method: "POST", email, body: { email, ...(data || {}) } });

export const updateCrmTask = ({ email, taskId, data }) =>
  request(API_URLS.crmTask(taskId), { method: "PATCH", email, body: { email, ...(data || {}) } });

export const getCrmTask = ({ email, taskId }) =>
  request(API_URLS.crmTask(taskId), { email });

export const deleteCrmTask = ({ email, taskId }) =>
  request(API_URLS.crmTask(taskId), { method: "DELETE", email });

export const listCrmTaskComments = ({ email, taskId, query = {} }) =>
  request(API_URLS.crmTaskComments(taskId), { email, query });

export const createCrmTaskComment = ({ email, taskId, text, mentions = [] }) =>
  request(API_URLS.crmTaskComments(taskId), {
    method: "POST",
    email,
    body: { email, text, mentions },
  });

export const listCrmComments = ({ email, query = {} }) =>
  request(API_URLS.crmComments, { email, query });

export const createCrmComment = ({ email, data }) =>
  request(API_URLS.crmComments, { method: "POST", email, body: { email, ...(data || {}) } });

export const updateCrmComment = ({ email, commentId, data }) =>
  request(API_URLS.crmComment(commentId), { method: "PATCH", email, body: { email, ...(data || {}) } });

export const deleteCrmComment = ({ email, commentId }) =>
  request(API_URLS.crmComment(commentId), { method: "DELETE", email, body: { email } });

export const listCrmDeals = ({ email, query = {} }) =>
  request(API_URLS.crmDeals, { email, query });

export const createCrmDeal = ({ email, data }) =>
  request(API_URLS.crmDeals, { method: "POST", email, body: { email, ...(data || {}) } });

export const updateCrmDeal = ({ email, dealId, data }) =>
  request(API_URLS.crmDeal(dealId), { method: "PATCH", email, body: { email, ...(data || {}) } });

export const getCrmDeal = ({ email, dealId }) =>
  request(API_URLS.crmDeal(dealId), { email });

export const listCrmDealComments = ({ email, dealId, query = {} }) =>
  request(API_URLS.crmDealComments(dealId), { email, query });

export const createCrmDealComment = ({ email, dealId, text, mentions = [] }) =>
  request(API_URLS.crmDealComments(dealId), {
    method: "POST",
    email,
    body: { email, text, mentions },
  });

export const listCrmCompanies = ({ email, query = {} }) =>
  request(API_URLS.crmCompanies, { email, query });

export const createCrmCompany = ({ email, data }) =>
  request(API_URLS.crmCompanies, { method: "POST", email, body: { email, ...(data || {}) } });

export const listCrmContacts = ({ email, query = {} }) =>
  request(API_URLS.crmContacts, { email, query });

export const createCrmContact = ({ email, data }) =>
  request(API_URLS.crmContacts, { method: "POST", email, body: { email, ...(data || {}) } });

export const updateCrmContact = ({ email, contactId, data }) =>
  request(API_URLS.crmContact(contactId), { method: "PATCH", email, body: { email, ...(data || {}) } });

export const listCrmContactComments = ({ email, contactId, query = {} }) =>
  request(API_URLS.crmContactComments(contactId), { email, query });

export const createCrmContactComment = ({ email, contactId, text, mentions = [] }) =>
  request(API_URLS.crmContactComments(contactId), {
    method: "POST",
    email,
    body: { email, text, mentions },
  });

export const listCrmNotifications = ({ email, query = {} }) =>
  request(API_URLS.crmNotifications, { email, query });

export const markCrmNotificationRead = ({ email, notifId }) =>
  request(API_URLS.crmNotificationRead(notifId), { method: "PATCH", email, body: { email } });

export const listCrmActivities = ({ email, query = {} }) =>
  request(API_URLS.crmActivities, { email, query });

export const createCrmActivity = ({ email, data }) =>
  request(API_URLS.crmActivities, { method: "POST", email, body: { email, ...(data || {}) } });

export const listCrmEmailLinks = ({ email, query = {} }) =>
  request(API_URLS.crmEmailLinks, { email, query });

export const createCrmEmailLink = ({ email, data }) =>
  request(API_URLS.crmEmailLinks, { method: "POST", email, body: { email, ...(data || {}) } });

export const listCrmAudit = ({ email, query = {} }) =>
  request(API_URLS.crmAudit, { email, query });

export const exportCrmTasksReport = ({ email, query = {} }) =>
  requestFile(API_URLS.crmTasksReport, { email, query });

export const exportCrmDealsReport = ({ email, query = {} }) =>
  requestFile(API_URLS.crmDealsReport, { email, query });
