export const authToken = (user) => String(user?.auth_token || user?.authToken || "").trim();

export function hasCurrentSession(user, now = Date.now()) {
  if (!authToken(user)) return false;
  const expiry = user?.auth_token_expires_at || user?.authTokenExpiresAt;
  return !expiry || Date.parse(expiry) > now;
}

export class SignInRequiredError extends Error {
  constructor() {
    super("Your session has expired. Sign in to connect to this deployment.");
    this.name = "SignInRequiredError";
  }
}
