import { API_URLS } from "../../config/urls";

const defaultHeaders = (clientId, userId, email) => {
  const headers = {
    "Content-Type": "application/json",
  };
  if (clientId) headers["x-client-id"] = clientId;
  if (userId) headers["x-user-id"] = userId;
  if (email) headers["x-user-email"] = email;
  return headers;
};

export async function listClientUsers({ clientId, userId, email }) {
  const res = await fetch(API_URLS.clientUsersList, {
    headers: defaultHeaders(clientId, userId, email),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.error || "Unable to load users");
  }
  return {
    users: payload?.users || [],
    remaining: payload?.remaining_slots ?? 0,
    limit: payload?.limit ?? 5,
  };
}

export async function createClientUser({ clientId, userId, email, newEmail, password, role = "admin" }) {
  const res = await fetch(API_URLS.clientUsersCreate, {
    method: "POST",
    headers: defaultHeaders(clientId, userId, email),
    body: JSON.stringify({ clientId, email: newEmail, password, role }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.error || "Unable to create user");
  }
  return payload;
}

export async function deleteClientUser({ clientId, userId, email, targetUserId }) {
  const res = await fetch(API_URLS.clientUsersDelete(targetUserId), {
    method: "DELETE",
    headers: defaultHeaders(clientId, userId, email),
  });
  if (!res.ok && res.status !== 204) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload?.error || "Unable to delete user");
  }
  return true;
}

export async function updateClientUser({ clientId, userId, email, targetUserId, data }) {
  const res = await fetch(API_URLS.clientUsersUpdate(targetUserId), {
    method: "PATCH",
    headers: defaultHeaders(clientId, userId, email),
    body: JSON.stringify({ clientId, ...data }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.error || "Unable to update user");
  }
  return payload;
}

