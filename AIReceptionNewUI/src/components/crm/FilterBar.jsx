export default function FilterBar({ filters = [], values = {}, onChange, actions = null }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {filters.map((filter) => {
          if (filter.type === "select") {
            return (
              <label key={filter.id} className="grid gap-1 text-xs text-slate-300">
                <span className="uppercase tracking-[0.16em] text-slate-400">{filter.label}</span>
                <select
                  value={values[filter.id] || ""}
                  onChange={(event) => onChange?.(filter.id, event.target.value)}
                  className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400"
                >
                  <option value="">All</option>
                  {(filter.options || []).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            );
          }
          return (
            <label key={filter.id} className="grid gap-1 text-xs text-slate-300">
              <span className="uppercase tracking-[0.16em] text-slate-400">{filter.label}</span>
              <input
                type={filter.type || "text"}
                value={values[filter.id] || ""}
                onChange={(event) => onChange?.(filter.id, event.target.value)}
                placeholder={filter.placeholder || ""}
                className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400"
              />
            </label>
          );
        })}
      </div>
      {actions ? <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

