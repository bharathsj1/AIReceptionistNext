import assert from "node:assert/strict";
import test from "node:test";
import {
  callDate,
  callDuration,
  conversationText,
  transcriptState,
} from "../src/lib/callHistory.js";

test("call history distinguishes zero talk time from missing duration", () => {
  assert.equal(callDuration(0), "0:00");
  assert.equal(callDuration(65.9), "1:05");
  assert.equal(callDuration(3661), "1:01:01");
  for (const value of [null, undefined, NaN, Infinity, -1, "45"])
    assert.equal(callDuration(value), "—");
});

test("call times use London daylight saving rather than the viewer's local zone", () => {
  assert.match(callDate("2026-07-09T23:30:00Z"), /10 Jul 2026, 00:30/);
  assert.match(callDate("2026-12-09T23:30:00Z"), /09 Dec 2026, 23:30/);
  assert.equal(callDate(null), "—");
  assert.equal(callDate("invalid"), "—");
});

test("transcript export contains both speakers, call identity, timing and incomplete status", () => {
  const call = {
    restaurant_name: "The Bistro",
    phone: "+442079460018",
    campaign_name: "Partnerships",
    started_at: "2026-10-15T10:00:00Z",
    duration_seconds: 65,
    status: "completed",
    result: {
      outcome: "interested",
      summary: "Summary is not the spoken transcript",
    },
    twilio_call_sid: "CA-test",
    ultravox_call_id: "UV-test",
  };
  const transcript = {
    is_final: false,
    messages: [
      { speaker: "ai", text: "May I speak to the owner?", offset_seconds: 0 },
      {
        speaker: "contact",
        text: "Yes, this is the owner.\nPlease send details.",
        offset_seconds: 2.5,
      },
    ],
  };
  const output = conversationText(call, transcript);
  assert.match(output, /Partial · may be incomplete/);
  assert.match(output, /\[0:00\] Vedora AI: May I speak to the owner\?/);
  assert.match(output, /\[0:02\] Contact: Yes, this is the owner\./);
  assert.match(output, /Campaign: Partnerships/);
  assert.match(output, /Twilio reference: CA-test/);
  assert.match(output, /Ultravox reference: UV-test/);
  assert.doesNotMatch(output, /Summary is not the spoken transcript/);
});

test("history labels preserve the distinction between partial, empty and unavailable transcripts", () => {
  assert.equal(
    transcriptState({ transcript_status: "ready" })[0],
    "Transcript ready",
  );
  assert.equal(
    transcriptState({ transcript_status: "partial" })[0],
    "Partial transcript",
  );
  assert.equal(
    transcriptState({ transcript_status: "empty" })[0],
    "No spoken transcript",
  );
  assert.equal(
    transcriptState({ transcript_status: "unavailable" })[0],
    "Unavailable",
  );
  assert.equal(transcriptState({})[0], "Awaiting transcript");
});
