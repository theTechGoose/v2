import { useEffect, useState } from "preact/hooks";
import { langSignal, STRINGS } from "../lib/lang.ts";

const PINK = "#FF6B6B";
const TEAL = "#144852";

/**
 * WelcomeBackToast — a 3-second pill that fades in on the dashboard
 * for returning users coming back from /verify with `?welcome=back`
 * in the URL. Drops the query param via history.replaceState so a
 * page refresh doesn't re-trigger.
 *
 * Self-gating: if `?welcome=back` isn't present, renders nothing.
 */
export default function WelcomeBackToast() {
  const [show, setShow] = useState(false);
  const [name, setName] = useState<string>("");

  useEffect(() => {
    if (typeof globalThis.window === "undefined") return;
    const params = new URLSearchParams(globalThis.location.search);
    if (params.get("welcome") !== "back") return;

    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/me", { credentials: "include" });
        if (!r.ok) return;
        const me = await r.json() as { name?: string };
        if (!cancelled) {
          const first = (me.name ?? "").trim().split(/\s+/)[0] ?? "";
          setName(first);
          setShow(true);
        }
      } catch { /* network blip — render the generic version */ }
    })();

    // Drop the query so a refresh doesn't re-flash. Defer past mount
    // so the URL change doesn't race the params check above.
    setTimeout(() => {
      try {
        const url = new URL(globalThis.location.href);
        url.searchParams.delete("welcome");
        globalThis.history.replaceState(null, "", url.toString());
      } catch { /* ignore */ }
    }, 50);

    const t = setTimeout(() => setShow(false), 3000);
    return () => { cancelled = true; clearTimeout(t); };
  }, []);

  if (!show) return null;
  const lang = langSignal.value;
  const tpl = STRINGS[lang]["welcome.back"];
  const message = tpl.replace("{firstName}", name || (lang === "es" ? "amigo" : "friend"));

  return (
    <div
      role="status"
      aria-live="polite"
      style={`position:fixed;top:18px;right:18px;z-index:9999;padding:10px 16px 10px 14px;display:inline-flex;align-items:center;gap:10px;background:#fff;border:1px solid rgba(0,0,0,0.06);border-radius:999px;box-shadow:0 6px 24px rgba(0,0,0,0.10),0 1px 3px rgba(0,0,0,0.04);font-family:inherit;font-size:14px;font-weight:600;color:${TEAL};animation:pm-toast-in 280ms cubic-bezier(0.34,1.56,0.64,1) both;pointer-events:none`}
    >
      <span aria-hidden="true" style={`display:inline-flex;width:22px;height:22px;border-radius:50%;background:${PINK};color:#fff;align-items:center;justify-content:center;font-size:13px`}>👋</span>
      <span>{message}</span>
      <style>{`
        @keyframes pm-toast-in {
          0%   { opacity: 0; transform: translateY(-6px) scale(0.96); }
          100% { opacity: 1; transform: translateY(0)    scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          [role=status][style*="pm-toast-in"] { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
