import { apiUrl } from "../../config/urls";

export async function outreachRequest(path, user, body) {
  const token = user?.auth_token || user?.authToken;
  if (!token) throw new Error("Please sign in again to manage outreach campaigns.");
  const response = await fetch(apiUrl(`outreach/${path}`), {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Outreach request failed");
  return payload;
}
