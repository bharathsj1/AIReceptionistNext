export const formatDateShort = (value) => {
  if (!value) return "–";
  try {
    const d = new Date(value);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(value);
  }
};
