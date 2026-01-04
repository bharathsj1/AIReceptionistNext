import API_URLS from "../../config/urls";

const withParams = (base, params = {}) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    search.set(key, value);
  });
  const query = search.toString();
  return query ? `${base}?${query}` : base;
};

export const fetchTasks = async ({ email, status = "ALL", search }) => {
  const url = withParams(API_URLS.tasks, { email, status, search });
  const res = await fetch(url);
  const text = await res.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!res.ok) {
    throw new Error(payload?.error || payload?.message || "Failed to fetch tasks");
  }
  return payload?.tasks || [];
};

export const fetchTaskDetail = async ({ email, id }) => {
  const url = withParams(`${API_URLS.tasks}/${id}`, { email });
  const res = await fetch(url);
  const text = await res.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!res.ok) {
    throw new Error(payload?.error || payload?.message || "Failed to fetch task");
  }
  return payload?.task || null;
};

export const acceptTask = async ({ email, id }) => {
  const url = withParams(`${API_URLS.tasks}/${id}/accept`, { email });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email })
  });
  const text = await res.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!res.ok) {
    throw new Error(payload?.error || payload?.message || "Failed to accept task");
  }
  return payload;
};

export const rejectTask = async ({ email, id, reason }) => {
  const url = withParams(`${API_URLS.tasks}/${id}/reject`, { email });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, reason })
  });
  const text = await res.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!res.ok) {
    throw new Error(payload?.error || payload?.message || "Failed to reject task");
  }
  return payload;
};

export const deleteTask = async ({ email, id }) => {
  const url = withParams(`${API_URLS.tasks}/${id}`, { email });
  const res = await fetch(url, { method: "DELETE" });
  const text = await res.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!res.ok) {
    throw new Error(payload?.error || payload?.message || "Failed to delete task");
  }
  return payload;
};

export const buildTaskStreamUrl = ({ email, since, timeout }) =>
  withParams(API_URLS.tasksStream, { email, since, timeout });

export const fetchTaskChanges = async ({ email, since, timeout = 25 }) => {
  const url = withParams(API_URLS.tasksChanges, { email, since, timeout });
  const res = await fetch(url);
  const text = await res.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!res.ok) {
    throw new Error(payload?.error || payload?.message || "Failed to fetch task changes");
  }
  return payload;
};
