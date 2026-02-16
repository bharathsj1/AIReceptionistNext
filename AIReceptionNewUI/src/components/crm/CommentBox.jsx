import { useState } from "react";

export default function CommentBox({ onSubmit, busy = false, placeholder = "Add a comment..." }) {
  const [text, setText] = useState("");

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    await onSubmit?.(trimmed);
    setText("");
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full resize-y rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400"
      />
      <div className="mt-2 flex items-center justify-end">
        <button
          type="button"
          disabled={busy || !text.trim()}
          onClick={handleSubmit}
          className="rounded-lg border border-indigo-300/50 bg-indigo-500/20 px-3 py-1.5 text-xs font-semibold text-indigo-100 disabled:opacity-50"
        >
          {busy ? "Posting..." : "Post comment"}
        </button>
      </div>
    </div>
  );
}

