import { apiUrl } from "../../config/urls.js";
import { authToken, hasCurrentSession, SignInRequiredError } from "../authSession.js";

export async function outreachRequest(path, user, body) {
  const token = authToken(user);
  if (!hasCurrentSession(user)) throw new SignInRequiredError();
  const response = await fetch(apiUrl(`outreach/${path}`), {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 401) throw new SignInRequiredError();
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error || "Outreach request failed");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}
