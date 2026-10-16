export function localBusinessReview(defaults, data) {
  const pages = Array.isArray(data?.pages) ? data.pages : [];
  const text = pages.map((page) => page.content || "").filter(Boolean).join("\n\n");
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  return {
    ...defaults,
    businessSummary: text.slice(0, 5000),
    businessEmail: text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || defaults.businessEmail,
    hours: lines.filter((line) => /\b(hours|opening|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(line)).join("\n").slice(0, 1000),
    location: lines.filter((line) => /\b(address|located|location)\b/i.test(line)).join("\n").slice(0, 1000),
    services: lines.filter((line) => /\b(services|we offer|delivery|collection|catering)\b/i.test(line)).join("\n").slice(0, 1000),
  };
}

export function localResumeStage(saved, path) {
  if (!saved?.isLoggedIn || !saved.user?.auth_token || !["/", "/login", "/signup"].includes(path)) return null;
  if (saved.stage === "loading") return "crawlForm";
  return ["businessDetails", "crawlForm", "businessInfoReview", "businessInfoManual"].includes(saved.stage) ? saved.stage : null;
}
