import { useMemo } from "react";

const normalizeTwilioCountry = (code) => {
  const upper = String(code || "").trim().toUpperCase();
  if (upper === "UK") return "GB";
  return upper;
};

const filterTwilioNumbersForCountry = (numbers, countryCode) => {
  const safeNumbers = Array.isArray(numbers) ? numbers : [];
  const country = normalizeTwilioCountry(countryCode);

  if (country === "GB") {
    return safeNumbers.filter((item) => {
      const type = String(item?.number_type || "").toLowerCase();
      const phone = String(item?.phone_number || "");
      if (type) return type === "mobile";
      return phone.startsWith("+447");
    });
  }

  if (country === "CA") {
    return safeNumbers.filter((item) => {
      const type = String(item?.number_type || "").toLowerCase();
      if (!type) return true;
      return type === "local";
    });
  }

  return safeNumbers;
};

export default function NumberSelectionScreen({
  paymentInfo,
  availableNumbers,
  numbersLoading,
  numbersError,
  numbersCountry,
  assignedNumber,
  selectedNumber,
  onSelectNumber,
  onRefreshNumbers,
  onContinue
}) {
  const email = paymentInfo?.email || "your email";
  const safeNumbers = Array.isArray(availableNumbers) ? availableNumbers : [];
  const filteredNumbers = useMemo(
    () => filterTwilioNumbersForCountry(safeNumbers, numbersCountry),
    [safeNumbers, numbersCountry]
  );
  const hasAssignedNumber = Boolean(assignedNumber);
  const activeSelectedNumber = selectedNumber || assignedNumber || "";
  const isSelectable = filteredNumbers.some((item) => item?.phone_number === activeSelectedNumber);
  const canContinue = Boolean(hasAssignedNumber || isSelectable);
  const countryLabel = numbersCountry ? numbersCountry.toUpperCase() : "your region";
  const selectionLabel = useMemo(() => {
    if (!activeSelectedNumber) return "Select a number to continue setup.";
    return `Selected number: ${activeSelectedNumber}`;
  }, [activeSelectedNumber]);

  return (
    <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-6 shadow-[0_20px_90px_rgba(15,23,42,0.35)] backdrop-blur md:p-10 screen-panel">
      <div className="pointer-events-none absolute -left-24 top-0 h-48 w-48 rounded-full bg-emerald-400/15 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-56 w-56 rounded-full bg-sky-400/15 blur-3xl" />

      <div className="relative flex flex-col gap-2 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200">
          Number selection
        </p>
        <h2 className="text-3xl font-semibold text-white md:text-4xl">
          Choose your AI receptionist number
        </h2>
        <p className="text-sm text-slate-200/80 md:text-base">
          We’ll reserve one number for {email}. These options are based on {countryLabel}.
        </p>
      </div>

      <div className="relative mt-6 rounded-2xl border border-white/10 bg-white/10 p-4 text-left text-slate-100">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-white">Available numbers</p>
            <p className="mt-1 text-xs text-slate-200/80">
              Showing {filteredNumbers.length} supported numbers near {countryLabel}. Refresh to see a new set.
            </p>
          </div>
          <button
            type="button"
            onClick={onRefreshNumbers}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:border-emerald-300/40 hover:text-emerald-100"
          >
            Refresh numbers
          </button>
        </div>

        {hasAssignedNumber ? (
          <div className="mt-4 rounded-xl border border-emerald-300/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            You already have a number: <strong>{assignedNumber}</strong>
          </div>
        ) : null}

        {numbersLoading ? (
          <div className="mt-4 rounded-xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-slate-200">
            Loading available numbers...
          </div>
        ) : numbersError ? (
          <div className="mt-4 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {numbersError}
          </div>
        ) : filteredNumbers.length ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {filteredNumbers.map((number) => {
              const phone = number?.phone_number || "";
              const isSelected = phone && phone === activeSelectedNumber;
              const meta = [number?.locality, number?.region].filter(Boolean).join(", ");
              return (
                <button
                  type="button"
                  key={phone || number?.friendly_name}
                  onClick={() => onSelectNumber?.(phone)}
                  className={`rounded-2xl border px-4 py-3 text-left transition ${
                    isSelected
                      ? "border-emerald-300/70 bg-emerald-500/15 text-emerald-50"
                      : "border-white/10 bg-slate-900/50 text-slate-100 hover:border-emerald-300/40"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-base font-semibold">
                        {number?.friendly_name || phone || "Available number"}
                      </p>
                      <p className="mt-1 text-xs text-slate-300">
                        {meta || "Local number"} {number?.iso_country ? `• ${number.iso_country}` : ""}
                        {number?.number_type ? ` • ${String(number.number_type).toUpperCase()}` : ""}
                      </p>
                    </div>
                    <span
                      className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${
                        isSelected
                          ? "border-emerald-300/70 bg-emerald-500/20 text-emerald-50"
                          : "border-white/10 text-slate-200"
                      }`}
                    >
                      {isSelected ? "Selected" : "Select"}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-slate-200">
            No numbers available right now. Try refresh.
          </div>
        )}
      </div>

      <div className="relative mt-6 flex flex-col items-center gap-3">
        <p className="text-xs text-slate-300">{selectionLabel}</p>
        <button
          type="button"
          className="primary"
          onClick={onContinue}
          disabled={!canContinue}
        >
          Continue setup
        </button>
      </div>
    </section>
  );
}
