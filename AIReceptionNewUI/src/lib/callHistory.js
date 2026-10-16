export const CALL_STATUSES = [
  "preparing",
  "queued-provider",
  "initiated",
  "ringing",
  "in-progress",
  "completed",
  "busy",
  "no-answer",
  "failed",
  "canceled",
  "needs_review",
];
export const CALL_OUTCOMES = [
  "interested",
  "not_interested",
  "callback_requested",
  "wrong_number",
  "owner_unavailable",
  "do_not_call",
  "uncaptured",
];
export const readable = (value) =>
  String(value || "Not captured")
    .replaceAll("_", " ")
    .replaceAll("-", " ");
export function callStatus(value) {
  return (
    {
      preparing: "Preparing",
      "queued-provider": "Waiting to dial",
      initiated: "Dialling",
      ringing: "Ringing",
      "in-progress": "In conversation",
      completed: "Completed",
      busy: "Busy",
      "no-answer": "No answer",
      failed: "Failed",
      canceled: "Cancelled",
      needs_review: "Needs review",
    }[value] || readable(value)
  );
}

export function callDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("en-GB", {
        timeZone: "Europe/London",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
}
export function callDuration(value) {
  if (
    value === null ||
    value === undefined ||
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0
  )
    return "—";
  const seconds = Math.floor(value);
  const hours = Math.floor(seconds / 3600);
  return `${hours ? `${hours}:` : ""}${hours ? String(Math.floor((seconds % 3600) / 60)).padStart(2, "0") : Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
export function transcriptState(call) {
  const status = call?.transcript_status || "pending";
  if (status === "partial") return ["Partial transcript", "partial"];
  if (status === "ready") return ["Transcript ready", "ready"];
  if (status === "empty") return ["No spoken transcript", "empty"];
  if (status === "not_started") return ["Not called yet", "empty"];
  if (status === "unavailable") return ["Unavailable", "unavailable"];
  return ["Awaiting transcript", "pending"];
}
export function conversationText(call, transcript) {
  const lines = [
    "Vedora Outreach · Conversation transcript",
    `Business: ${call.restaurant_name}`,
    `Phone: ${call.phone}`,
    `Campaign: ${call.campaign_name || "Not captured"}`,
    `Started (Europe/London): ${callDate(call.started_at)}`,
    `Talk time: ${callDuration(call.duration_seconds)}`,
    `Call status: ${callStatus(call.status)}`,
    `Outcome: ${readable(call.result?.outcome)}`,
    `Transcript: ${transcript.is_final ? "Final" : "Partial · may be incomplete"}`,
    `Twilio reference: ${call.twilio_call_sid || "Not captured"}`,
    `Ultravox reference: ${call.ultravox_call_id || "Not captured"}`,
    "",
  ];
  for (const message of transcript.messages || []) {
    const time = callDuration(message.offset_seconds);
    lines.push(
      `${time === "—" ? "" : `[${time}] `}${message.speaker === "ai" ? "Vedora AI" : "Contact"}: ${message.text}`,
    );
    lines.push("");
  }
  return lines.join("\n");
}
export function saveText(filename, text) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/plain;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
