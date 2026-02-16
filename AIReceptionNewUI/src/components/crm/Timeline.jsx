const TIME_FIELDS = ["timestamp", "createdAt", "updatedAt", "linkedAt", "ts"];

const itemTime = (item) => {
  for (const field of TIME_FIELDS) {
    if (item?.[field]) return item[field];
  }
  return null;
};

const itemTitle = (item) => {
  if (item.kind === "comment") return "Comment";
  if (item.kind === "audit") return item.action || "Change";
  if (item.kind === "activity") return item.title || item.type || "Activity";
  if (item.kind === "email_link") return item.subject || "Linked email";
  return item.title || "Update";
};

const itemBody = (item) => {
  if (item.kind === "comment") return item.text || "";
  if (item.kind === "audit") return item.action || "";
  if (item.kind === "activity") return item.description || "";
  if (item.kind === "email_link") return item.snippet || "";
  return "";
};

export default function Timeline({ items = [], emptyText = "No timeline events yet." }) {
  if (!items.length) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-xs text-slate-400">
        {emptyText}
      </div>
    );
  }
  return (
    <ol className="grid gap-2">
      {items.map((item) => {
        const when = itemTime(item);
        return (
          <li key={`${item.kind || "event"}-${item.id}`} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-white">{itemTitle(item)}</p>
              {when ? (
                <span className="text-[11px] text-slate-400">{new Date(when).toLocaleString()}</span>
              ) : null}
            </div>
            {itemBody(item) ? <p className="mt-1 text-xs text-slate-300">{itemBody(item)}</p> : null}
            <p className="mt-1 text-[11px] text-slate-500">
              {(item.createdByEmail || item.actorEmail || item.linkedByEmail || "").toString()}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

