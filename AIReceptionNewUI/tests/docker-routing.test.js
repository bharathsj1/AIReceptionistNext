import assert from "node:assert/strict";
import test from "node:test";
import API_URLS, { API_PROXY_BASE, JITSI_API_BASE, apiUrl } from "../src/config/urls.js";
import { authToken, hasCurrentSession, SignInRequiredError } from "../src/lib/authSession.js";
import { outreachRequest } from "../src/lib/api/outreach.js";

test("all API destinations stay on the current origin, including meetings", () => {
  assert.equal(API_PROXY_BASE, "/api");
  assert.equal(JITSI_API_BASE, "/api");
  assert.equal(apiUrl("outreach/config"), "/api/outreach/config");
  assert.equal(API_URLS.jitsiMeetings, "/api/meetings");
  for (const [name, value] of Object.entries(API_URLS)) {
    const url = typeof value === "function" ? value("example") : value;
    assert.ok(url.startsWith("/api/"), `${name} must stay on the current origin`);
    assert.equal(url.includes("://"), false, name);
  }
});

test("a cached email without a signed session and expired sessions require sign-in", () => {
  assert.equal(hasCurrentSession({ email: "owner@example.com" }), false);
  assert.equal(hasCurrentSession({ auth_token: " " }), false);
  assert.equal(hasCurrentSession({ auth_token: "test-token", auth_token_expires_at: "2025-01-01T00:00:00Z" }), false);
  assert.equal(hasCurrentSession({ auth_token: "test-token", auth_token_expires_at: "invalid" }), false);
  assert.equal(hasCurrentSession({ authToken: "test-token", authTokenExpiresAt: "2035-01-01T00:00:00Z" }), true);
  assert.equal(authToken({ auth_token: " test-token " }), "test-token");
});

test("outreach requires a token before sending a request and uses the Docker proxy", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ caller_ids: [] }), { status: 200 });
  });
  await assert.rejects(outreachRequest("config", { email: "owner@example.com" }), SignInRequiredError);
  assert.equal(calls.length, 0);
  await outreachRequest("config", { auth_token: "test-token" });
  assert.equal(calls[0].url, "/api/outreach/config");
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-token");
});

test("a token rejected by the new backend leads to sign-in, with no alternate-host retry", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    return new Response("{}", { status: 401 });
  });
  await assert.rejects(outreachRequest("config", { auth_token: "old-deployment-token" }), SignInRequiredError);
  assert.equal(calls, 1);
});
