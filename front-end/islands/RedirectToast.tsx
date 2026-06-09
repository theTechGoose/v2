/**
 * Tiny one-shot toast island. Reads a known query parameter on mount and
 * surfaces an explanatory line for ~6 seconds. Used by /messages →
 * /assistant redirect (P6.14) so the silent jump is no longer confusing.
 */
import { useEffect, useState } from "preact/hooks";
import { type Lang, langSignal, tFor } from "../lib/i18n.ts";

const MESSAGE_KEYS: Record<string, string> = {
  messages: "redirectToast.messagesConsolidated",
};

// `lang` prop kept as an optional SSR seed but ignored; the island
// self-sources the live UI language from `langSignal`.
export default function RedirectToast(_props: { lang?: Lang }) {
  // Read langSignal.value during render so the toast resolves in (and
  // re-renders on) the live UI language.
  const lang = langSignal.value;
  const [key, setKey] = useState<string | null>(null);

  useEffect(() => {
    if (typeof globalThis.location === "undefined") return;
    const params = new URLSearchParams(globalThis.location.search);
    const from = params.get("from");
    const k = from ? MESSAGE_KEYS[from] : undefined;
    if (!k) return;
    setKey(k);

    // Strip the param so reloads don't keep firing the toast.
    if (typeof globalThis.history !== "undefined") {
      params.delete("from");
      const qs = params.toString();
      const url = globalThis.location.pathname + (qs ? `?${qs}` : "") +
        globalThis.location.hash;
      globalThis.history.replaceState(null, "", url);
    }

    const timer = setTimeout(() => setKey(null), 6000);
    return () => clearTimeout(timer);
  }, []);

  if (!key) return null;
  // Resolve against the reactive `lang` so a live language flip while the
  // toast is visible re-localizes the line.
  const text = tFor(lang, key);

  return (
    <div
      role="status"
      style="position:fixed;top:18px;left:50%;transform:translateX(-50%);background:var(--brand-teal,#1A535C);color:#fff;padding:10px 18px;border-radius:999px;font-size:13.5px;font-weight:500;box-shadow:0 4px 14px rgba(0,0,0,0.18);z-index:9999;max-width:90vw"
    >
      {text}
    </div>
  );
}
