import {
  createContext,
  useContext,
  useMemo
} from "react";

const TabsContext = createContext(null);

export const Tabs = ({ value, onValueChange, className = "", children }) => {
  const contextValue = useMemo(
    () => ({ value, onValueChange }),
    [value, onValueChange]
  );
  return (
    <TabsContext.Provider value={contextValue}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
};

export const TabsList = ({ className = "", children }) => (
  <div className={`flex flex-wrap gap-2 ${className}`.trim()}>{children}</div>
);

export const TabsTrigger = ({ value, className = "", variant = "default", children }) => {
  const ctx = useContext(TabsContext);
  const isActive = ctx?.value === value;
  const variants = {
    default: {
      active: "border-emerald-300/70 bg-emerald-400/15 text-emerald-50",
      inactive: "border-white/10 bg-white/5 text-slate-200 hover:border-white/30 hover:bg-white/10"
    },
    all: {
      active: "border-slate-300/70 bg-slate-400/15 text-slate-900",
      inactive: "border-slate-200 bg-white text-slate-800 hover:border-slate-300"
    },
    new: {
      active: "border-emerald-300/80 bg-emerald-400/25 text-emerald-900",
      inactive: "border-emerald-200 bg-emerald-50 text-emerald-900 hover:border-emerald-300"
    },
    accepted: {
      active: "border-indigo-300/80 bg-indigo-400/25 text-indigo-900",
      inactive: "border-indigo-200 bg-indigo-50 text-indigo-900 hover:border-indigo-300"
    },
    rejected: {
      active: "border-rose-300/80 bg-rose-400/25 text-rose-900",
      inactive: "border-rose-200 bg-rose-50 text-rose-900 hover:border-rose-300"
    }
  };
  const tone = variants[variant] || variants.default;
  return (
    <button
      type="button"
      onClick={() => ctx?.onValueChange?.(value)}
      className={`rounded-full border px-3 py-1 text-xs font-semibold transition sm:text-sm ${
        isActive ? tone.active : tone.inactive
      } ${className}`.trim()}
    >
      {children}
    </button>
  );
};

export const Card = ({ className = "", children }) => (
  <div className={`rounded-3xl border border-white/10 bg-white/5 ${className}`.trim()}>
    {children}
  </div>
);

export const CardHeader = ({ className = "", children }) => (
  <div className={`px-4 pt-4 ${className}`.trim()}>{children}</div>
);

export const CardContent = ({ className = "", children }) => (
  <div className={`px-4 pb-4 ${className}`.trim()}>{children}</div>
);

export const Badge = ({ className = "", children }) => (
  <span
    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${className}`.trim()}
  >
    {children}
  </span>
);

export const Button = ({
  className = "",
  variant = "default",
  size = "md",
  type = "button",
  ...props
}) => {
  const variants = {
    default: "border-white/10 bg-white/10 text-white hover:border-white/30 hover:bg-white/20",
    primary: "border-indigo-300/50 bg-indigo-500/25 text-indigo-50 hover:border-indigo-200/80 hover:bg-indigo-500/40",
    success: "border-emerald-300/60 bg-emerald-500/25 text-emerald-50 hover:border-emerald-200 hover:bg-emerald-500/40",
    danger: "border-rose-300/60 bg-rose-500/20 text-rose-100 hover:border-rose-200 hover:bg-rose-500/35",
    ghost: "border-white/0 bg-transparent text-slate-200 hover:border-white/10 hover:bg-white/5"
  };
  const sizes = {
    sm: "px-3 py-1 text-xs",
    md: "px-3.5 py-2 text-xs",
    lg: "px-4 py-2 text-sm"
  };
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-xl border font-semibold transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60 ${
        variants[variant] || variants.default
      } ${sizes[size] || sizes.md} ${className}`.trim()}
      {...props}
    />
  );
};

export const Input = ({ className = "", ...props }) => (
  <input
    className={`w-full rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-2 text-sm text-white outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/40 ${className}`.trim()}
    {...props}
  />
);

export const Skeleton = ({ className = "" }) => (
  <div
    className={`animate-pulse rounded-xl bg-white/10 ${className}`.trim()}
  />
);

export const Dialog = ({ open, onOpenChange, children }) => {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onOpenChange?.(false);
        }
      }}
    >
      {children}
    </div>
  );
};

export const DialogContent = ({ className = "", children }) => (
  <div
    className={`w-full max-w-2xl rounded-3xl border border-white/10 bg-slate-950/90 p-6 shadow-2xl backdrop-blur ${className}`.trim()}
  >
    {children}
  </div>
);

export const DropdownMenu = ({ className = "", children }) => (
  <details className={`relative ${className}`.trim()}>
    {children}
  </details>
);

export const DropdownMenuTrigger = ({ className = "", children }) => (
  <summary
    className={`list-none cursor-pointer rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-200 hover:border-white/30 hover:bg-white/10 ${className}`.trim()}
  >
    {children}
  </summary>
);

export const DropdownMenuContent = ({ className = "", children }) => (
  <div
    className={`absolute right-0 z-10 mt-2 w-44 rounded-2xl border border-white/10 bg-slate-950/95 p-1 text-xs text-slate-200 shadow-xl ${className}`.trim()}
  >
    {children}
  </div>
);

export const DropdownMenuItem = ({ className = "", ...props }) => (
  <button
    type="button"
    className={`w-full rounded-xl px-3 py-2 text-left hover:bg-white/10 ${className}`.trim()}
    {...props}
  />
);
