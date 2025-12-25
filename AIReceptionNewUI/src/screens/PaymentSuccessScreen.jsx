import { useEffect, useMemo, useState } from "react";

export default function PaymentSuccessScreen({
  paymentInfo,
  voices,
  selectedVoiceId,
  onSelectVoice,
  welcomeMessage,
  onWelcomeMessageChange,
  onContinue
}) {
  const email = paymentInfo?.email || "your email";
  const receiptUrl = paymentInfo?.receiptUrl || paymentInfo?.invoiceUrl || null;
  const safeVoices = Array.isArray(voices) ? voices : [];
  const resolveSampleUrl = (rawUrl) => {
    const url = String(rawUrl || "").trim();
    if (!url) return "";
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
    if (url.startsWith("//")) {
      const host = url.slice(2).split("/")[0];
      if (!host.includes(".")) return "";
      return `https:${url}`;
    }
    if (url.startsWith("/")) return "";
    const host = url.split("/")[0];
    if (!host.includes(".")) return "";
    return `https://${url}`;
  };
  const getPrimaryLanguage = (voice) => {
    const raw = voice?.primaryLanguage || voice?.primary_language || "";
    return String(raw || "").trim();
  };
  const getVoiceSample = (voice) =>
    resolveSampleUrl(
      voice?.sample ||
        voice?.sample_url ||
        voice?.sampleUrl ||
        voice?.preview_url ||
        voice?.previewUrl ||
        voice?.audio_url ||
        voice?.audioUrl ||
        voice?.demo_url ||
        voice?.demoUrl ||
        ""
    );
  const [selectedLanguage, setSelectedLanguage] = useState("all");
  const languageOptions = useMemo(() => {
    const set = new Set();
    safeVoices.forEach((voice) => {
      const lang = getPrimaryLanguage(voice);
      if (lang) set.add(lang);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [safeVoices]);
  const languageCounts = useMemo(() => {
    const counts = {};
    safeVoices.forEach((voice) => {
      const lang = getPrimaryLanguage(voice);
      if (!lang) return;
      counts[lang] = (counts[lang] || 0) + 1;
    });
    return counts;
  }, [safeVoices]);

  const filteredVoices = useMemo(() => {
    if (selectedLanguage === "all") return safeVoices;
    return safeVoices.filter((voice) => getPrimaryLanguage(voice) === selectedLanguage);
  }, [safeVoices, selectedLanguage]);

  const sortedVoices = useMemo(() => {
    return [...filteredVoices].sort((a, b) => {
      const aHasSample = Boolean(getVoiceSample(a));
      const bHasSample = Boolean(getVoiceSample(b));
      if (aHasSample === bHasSample) {
        return String(a?.name || "").localeCompare(String(b?.name || ""));
      }
      return aHasSample ? -1 : 1;
    });
  }, [filteredVoices]);

  const selectedVoice =
    sortedVoices.find(
      (voice) => (voice?.id || voice?.voiceId || voice?.voice_id || voice?.name) === selectedVoiceId
    ) || sortedVoices[0];
  const selectedSample = getVoiceSample(selectedVoice);

  useEffect(() => {
    if (!sortedVoices.length || !onSelectVoice) return;
    const exists = sortedVoices.some(
      (voice) => (voice?.id || voice?.voiceId || voice?.voice_id || voice?.name) === selectedVoiceId
    );
    if (!exists) {
      const next = sortedVoices[0];
      const voiceId = next?.id || next?.voiceId || next?.voice_id || next?.name;
      if (voiceId) onSelectVoice(voiceId);
    }
  }, [onSelectVoice, selectedVoiceId, sortedVoices]);

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

      <div className="relative mt-6 rounded-2xl border border-white/10 bg-white/10 p-4 text-left text-slate-100">
        <p className="text-sm font-semibold text-white">Choose voice + welcome message</p>
        <p className="mt-1 text-xs text-slate-200/80">
          Pick a voice and preview samples before we provision your agent.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-300">
          <label className="flex items-center gap-2">
            Language
            <select
              value={selectedLanguage}
              onChange={(event) => setSelectedLanguage(event.target.value)}
              className="rounded-lg border border-white/10 bg-slate-900/60 px-2 py-1 text-xs text-slate-100 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
            >
              <option value="all">All languages</option>
              {languageOptions.map((option) => (
                <option key={option} value={option}>
                  {option} {languageCounts[option] ? `(${languageCounts[option]})` : ""}
                </option>
              ))}
            </select>
          </label>
          <span className="text-xs text-slate-400">
            {sortedVoices.length} voices
          </span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr]">
          <label className="grid gap-2 text-xs text-slate-200/80">
            Voice
            <select
              value={selectedVoiceId || ""}
              onChange={(event) => onSelectVoice?.(event.target.value)}
              className="rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
            >
              {(sortedVoices.length ? sortedVoices : safeVoices).map((voice) => {
                const voiceId = voice?.id || voice?.voiceId || voice?.voice_id || voice?.name;
                return (
                  <option key={voiceId || voice?.name} value={voiceId}>
                    {voice?.name || voiceId}
                  </option>
                );
              })}
            </select>
          </label>
          <label className="grid gap-2 text-xs text-slate-200/80">
            Welcome message
            <textarea
              rows={3}
              value={welcomeMessage || ""}
              onChange={(event) => onWelcomeMessageChange?.(event.target.value)}
              placeholder="Hi! Thanks for calling. How can I help?"
              className="rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
            />
          </label>
        </div>
        {selectedSample ? (
          <div className="mt-3 text-xs text-slate-300">
            Selected voice preview:
            <audio controls className="mt-2 w-full" src={selectedSample}>
              Your browser does not support audio playback.
            </audio>
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
