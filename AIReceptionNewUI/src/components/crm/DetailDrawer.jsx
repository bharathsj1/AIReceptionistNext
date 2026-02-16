export default function DetailDrawer({ open, title, subtitle, onClose, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/50 p-2 sm:p-4">
      <div className="h-full w-full max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-slate-950 shadow-2xl">
        <div className="flex items-start justify-between border-b border-white/10 px-4 py-3">
          <div>
            <h3 className="text-lg font-semibold text-white">{title}</h3>
            {subtitle ? <p className="text-xs text-slate-400">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-300 hover:text-white"
          >
            Close
          </button>
        </div>
        <div className="h-[calc(100%-58px)] overflow-y-auto px-4 py-3">{children}</div>
      </div>
    </div>
  );
}

