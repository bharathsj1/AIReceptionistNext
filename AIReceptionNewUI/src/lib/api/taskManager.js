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

const parseResponse = async (res) => {
  const text = await res.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!res.ok) {
    throw new Error(payload?.error || payload?.message || "Request failed");
  }
  return payload;
};

export const fetchTaskManagerItems = async ({ email, start, end }) => {
  const url = withParams(API_URLS.taskManager, {
    email,
    from: start,
    to: end
  });
  const res = await fetch(url);
  const payload = await parseResponse(res);
  return payload?.items || [];
};

export const createTaskManagerItem = async ({
  email,
  title,
  description,
  start,
  end,
  sourceType,
  sourceId
}) => {
  const res = await fetch(API_URLS.taskManager, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      title,
      description,
      start,
      end,
      sourceType,
      sourceId
    })
  });
  const payload = await parseResponse(res);
  return payload?.item;
};

export const updateTaskManagerItem = async ({
  email,
  id,
  title,
  description,
  start,
  end,
  status
}) => {
  const res = await fetch(`${API_URLS.taskManager}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      title,
      description,
      start,
      end,
      status
    })
  });
  const payload = await parseResponse(res);
  return payload?.item;
};

export const deleteTaskManagerItem = async ({ email, id }) => {
  const url = withParams(`${API_URLS.taskManager}/${id}`, { email });
  const res = await fetch(url, { method: "DELETE" });
  const payload = await parseResponse(res);
  return payload;
};
