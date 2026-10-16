import assert from "node:assert/strict";
import test from "node:test";
import { localBusinessReview, localResumeStage } from "../src/lib/localSetup.js";

test("website review uses source text and retains entered business details", () => {
  const content = "We offer delivery and catering for restaurants across London.\nOpening hours: Monday to Friday, 10:00–18:00.\nOur address is 12 Example Street, London.\nContact our owner at owner@example.com for restaurant partnerships.";
  const review = localBusinessReview({ businessName: "Example Bistro", businessPhone: "+442079460018" }, { pages: [{ content }] });
  assert.equal(review.businessName, "Example Bistro");
  assert.equal(review.businessPhone, "+442079460018");
  assert.equal(review.businessSummary, content);
  assert.equal(review.businessEmail, "owner@example.com");
  assert.match(review.hours, /10:00–18:00/);
  assert.match(review.location, /12 Example Street/);
  assert.match(review.services, /catering/);
});

test("review respects field limits and never invents absent business facts", () => {
  const blank = localBusinessReview({ businessEmail: "existing@example.com" }, { pages: [] });
  assert.equal(blank.businessSummary, "");
  assert.equal(blank.hours, "");
  assert.equal(blank.location, "");
  assert.equal(blank.businessEmail, "existing@example.com");
  const long = localBusinessReview({}, { pages: [{ content: "Opening hours: " + "x".repeat(8000) }] });
  assert.equal(long.businessSummary.length, 5000);
  assert.equal(long.hours.length, 1000);
});

test("refresh resumes authenticated company setup and interrupted crawls can be retried", () => {
  const saved = { isLoggedIn: true, user: { auth_token: "local-test-token" }, stage: "businessInfoReview" };
  assert.equal(localResumeStage(saved, "/login"), "businessInfoReview");
  assert.equal(localResumeStage({ ...saved, stage: "loading" }, "/signup"), "crawlForm");
  assert.equal(localResumeStage({ ...saved, isLoggedIn: false }, "/login"), null);
  assert.equal(localResumeStage({ ...saved, user: {} }, "/login"), null);
  assert.equal(localResumeStage(saved, "/about"), null);
});
