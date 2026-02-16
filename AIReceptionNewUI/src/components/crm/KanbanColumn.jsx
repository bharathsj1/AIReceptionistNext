const PRIORITY_CLASS = {
  low: "text-emerald-300",
  med: "text-sky-300",
  high: "text-amber-300",
  urgent: "text-rose-300",
};

export default function KanbanColumn({
  title,
  items = [],
  onItemClick,
  onMove,
  emptyText = "No items",
}) {
  const handleDrop = (event) => {
    event.preventDefault();
    const itemId = event.dataTransfer.getData("text/plain");
    if (!itemId) return;
    onMove?.(itemId, title);
  };

  return (
    <section
      className="min-h-[240px] rounded-2xl border border-white/10 bg-white/5 p-3"
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold uppercase tracking-[0.18em] text-indigo-200">{title}</h4>
        <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-slate-300">
          {items.length}
        </span>
      </div>
      <div className="grid gap-2">
        {!items.length ? (
          <p className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-xs text-slate-400">
            {emptyText}
          </p>
        ) : (
          items.map((item) => (
            <button
              key={item.id}
              type="button"
              draggable
              onDragStart={(event) => event.dataTransfer.setData("text/plain", item.id)}
              onClick={() => onItemClick?.(item)}
              className="rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-left transition hover:border-indigo-300/50 hover:bg-slate-900"
            >
              <p className="text-sm font-semibold text-white">{item.title || item.name || "Untitled"}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
                {item.priority ? (
                  <span className={PRIORITY_CLASS[String(item.priority).toLowerCase()] || "text-slate-300"}>
                    {String(item.priority).toUpperCase()}
                  </span>
                ) : null}
                {item.dueDate ? <span>Due {new Date(item.dueDate).toLocaleDateString()}</span> : null}
                {item.assignedToEmail ? <span>{item.assignedToEmail}</span> : null}
              </div>
            </button>
          ))
        )}
      </div>
    </section>
  );
}

