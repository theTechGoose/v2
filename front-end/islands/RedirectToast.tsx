/**
 * Tiny one-shot toast island. Reads a known query parameter on mount and
 * surfaces an explanatory line for ~6 seconds. Used by /messages →
 * /assistant redirect (P6.14) so the silent jump is no longer confusing.
 */
import { useEffect, useState } from "preact/hooks";

const MESSAGES: Record<string, string> = {
  messages: "We've consolidated messaging into the assistant.",
};

export default function RedirectToast() {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (typeof globalThis.location === "undefined") return;
    const params = new URLSearchParams(globalThis.location.search);
    const from = params.get("from");
    const msg = from ? MESSAGES[from] : undefined;
    if (!msg) return;
    setText(msg);

    // Strip the param so reloads don't keep firing the toast.
    if (typeof globalThis.history !== "undefined") {
      params.delete("from");
      const qs = params.toString();
      const url = globalThis.location.pathname + (qs ? `?${qs}` : "") + globalThis.location.hash;
      globalThis.history.replaceState(null, "", url);
    }

    const timer = setTimeout(() => setText(null), 6000);
    return () => clearTimeout(timer);
  }, []);

  if (!text) return null;

  return (
    <div
      role="status"
      style="position:fixed;top:18px;left:50%;transform:translateX(-50%);background:var(--brand-teal,#1A535C);color:#fff;padding:10px 18px;border-radius:999px;font-size:13.5px;font-weight:500;box-shadow:0 4px 14px rgba(0,0,0,0.18);z-index:9999;max-width:90vw"
    >
      {text}
    </div>
  );
}
