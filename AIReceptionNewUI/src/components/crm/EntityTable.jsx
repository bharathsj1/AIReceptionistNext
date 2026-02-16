export default function EntityTable({ columns = [], rows = [], emptyText = "No records yet.", onRowClick }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/40">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-white/10 text-sm">
          <thead className="bg-white/5 text-left text-xs uppercase tracking-[0.14em] text-slate-400">
            <tr>
              {columns.map((column) => (
                <th key={column.id} className="px-3 py-2 font-medium">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10 text-slate-100">
            {!rows.length ? (
              <tr>
                <td colSpan={Math.max(columns.length, 1)} className="px-3 py-4 text-sm text-slate-400">
                  {emptyText}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => onRowClick?.(row)}
                  className={onRowClick ? "cursor-pointer transition hover:bg-white/5" : ""}
                >
                  {columns.map((column) => (
                    <td key={`${row.id}-${column.id}`} className="px-3 py-2 align-top">
                      {column.render ? column.render(row) : row[column.id] ?? "—"}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

