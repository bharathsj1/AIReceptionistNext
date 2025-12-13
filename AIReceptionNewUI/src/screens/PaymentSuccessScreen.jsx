export default function PaymentSuccessScreen({ paymentInfo, onContinue }) {
  const email = paymentInfo?.email || "your email";
  const receiptUrl = paymentInfo?.receiptUrl || paymentInfo?.invoiceUrl || null;

  return (
    <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-6 shadow-[0_20px_90px_rgba(15,23,42,0.35)] backdrop-blur md:p-10 screen-panel">
      <div className="pointer-events-none absolute -left-24 top-0 h-48 w-48 rounded-full bg-emerald-400/15 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-56 w-56 rounded-full bg-indigo-400/15 blur-3xl" />

      <div className="relative flex flex-col gap-2 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200">
          Payment received
        </p>
        <h2 className="text-3xl font-semibold text-white md:text-4xl">Thank you for your payment</h2>
        <p className="text-sm text-slate-200/80 md:text-base">
          We’ve emailed a receipt to {email}. Your AI receptionist setup will begin now.
        </p>
      </div>

      <div className="relative mt-6 rounded-2xl border border-white/10 bg-white/10 p-4 text-left text-slate-100">
        <p className="text-sm font-semibold text-white">What’s next?</p>
        <ul className="mt-2 space-y-2 text-sm text-slate-100/90">
          <li>• Generating your Ultravox prompt.</li>
          <li>• Provisioning your AI receptionist client.</li>
          <li>• Assigning your Twilio number.</li>
        </ul>
        {receiptUrl ? (
          <div className="mt-3">
            <a
              href={receiptUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-semibold text-emerald-200 underline"
            >
              View receipt
            </a>
          </div>
        ) : null}
      </div>

      <div className="relative mt-6 flex justify-center">
        <button
          type="button"
          className="primary"
          onClick={onContinue}
        >
          Continue setup
        </button>
      </div>
    </section>
  );
}
