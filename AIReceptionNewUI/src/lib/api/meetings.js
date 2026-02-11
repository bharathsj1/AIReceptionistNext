import { API_URLS } from "../../config/urls";

const defaultHeaders = (tenantId, userId, email) => {
  const headers = {
    "Content-Type": "application/json",
  };
  if (tenantId) headers["x-tenant-id"] = tenantId;
  if (userId) headers["x-user-id"] = userId;
  if (email) headers["x-user-email"] = email;
  return headers;
};

export async function listMeetings({ tenantId, userId, email }) {
  const res = await fetch(API_URLS.jitsiMeetings, { headers: defaultHeaders(tenantId, userId, email) });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error || "Failed to load meetings");
  return payload?.meetings || [];
}

export async function createMeeting({ tenantId, userId, email, title, scheduledFor, publicJoin }) {
  const res = await fetch(API_URLS.jitsiMeetings, {
    method: "POST",
    headers: defaultHeaders(tenantId, userId, email),
    body: JSON.stringify({ title, scheduledFor, publicJoin }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error || "Failed to create meeting");
  return payload;
}

export async function getMeeting({ tenantId, userId, email, meetingId }) {
  const res = await fetch(API_URLS.jitsiMeeting(meetingId), { headers: defaultHeaders(tenantId, userId, email) });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error || "Failed to load meeting");
  return payload;
}

export async function uploadMeetingAudio({ tenantId, userId, email, meetingId, blob }) {
  const form = new FormData();
  form.append("audio", blob, "meeting-audio.webm");
  const headers = defaultHeaders(tenantId, userId, email);
  delete headers["Content-Type"]; // let browser set multipart boundary
  const res = await fetch(API_URLS.jitsiMeetingAudio(meetingId), {
    method: "POST",
    headers,
    body: form,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error || "Upload failed");
  return payload;
}

export async function getArtifacts({ tenantId, userId, email, meetingId }) {
  const res = await fetch(API_URLS.jitsiMeetingArtifacts(meetingId), { headers: defaultHeaders(tenantId, userId, email) });
  const payload = await res.json().catch(() => ({}));
  if (res.status === 202) return { status: payload?.status || "processing" };
  if (!res.ok) throw new Error(payload?.error || "Failed to load artifacts");
  return payload;
}

export async function summarizeMeeting({ tenantId, userId, email, meetingId }) {
  const res = await fetch(API_URLS.jitsiMeetingSummarize(meetingId), {
    method: "POST",
    headers: defaultHeaders(tenantId, userId, email),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error || "Summarize failed");
  return payload;
}

export async function saveMeetingTasks({ tenantId, userId, email, meetingId, tasks }) {
  const res = await fetch(API_URLS.jitsiMeetingTasks(meetingId), {
    method: "POST",
    headers: defaultHeaders(tenantId, userId, email),
    body: JSON.stringify({ tasks }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error || "Save tasks failed");
  return payload?.tasks || tasks;
}
