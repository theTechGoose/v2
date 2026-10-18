import type { Lang } from "../lib/lang.ts";
import { tFor } from "../lib/i18n.ts";

/**
 * REQ-082 — "for the fake you should have a pop up with the code." The popup every page that
 * sends a code shows on the fakes: the six digits big, "Use this code" fills them in, the close
 * puts it away. Self-styled so it reads the same on /verify, /landing2 and any page after them.
 * Rendered by islands only (the code exists on the client after the send), never by SSR.
 */
export default function DevCodeCard(
  { lang, code, onUse, onClose }: {
    lang: Lang;
    code: string;
    onUse: () => void;
    onClose: () => void;
  },
) {
  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label={tFor(lang, "devCode.title")}
      data-cy="dev-code"
      style="position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;width:min(420px,calc(100vw - 32px));box-sizing:border-box;padding:16px 18px;border:3px solid #15202b;border-radius:16px;background:#fff7d6;color:#15202b;box-shadow:6px 6px 0 #15202b;font-family:inherit"
    >
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
        <strong style="font-size:15px">{tFor(lang, "devCode.title")}</strong>
        <button
          type="button"
          data-cy="dev-code-close"
          aria-label={tFor(lang, "devCode.close")}
          onClick={onClose}
          style="appearance:none;border:2px solid #15202b;background:#fff;border-radius:999px;width:30px;height:30px;font:inherit;font-weight:800;cursor:pointer;line-height:1"
        >
          ×
        </button>
      </div>
      <div
        data-cy="dev-code-value"
        style="font-size:34px;font-weight:800;letter-spacing:0.18em;margin:8px 0 6px;font-variant-numeric:tabular-nums"
      >
        {code}
      </div>
      <p style="margin:0 0 12px;font-size:13px;line-height:1.4">
        {tFor(lang, "devCode.body")}
      </p>
      <button
        type="button"
        data-cy="dev-code-use"
        onClick={onUse}
        style="appearance:none;border:3px solid #15202b;border-radius:12px;padding:10px 16px;background:#3ea448;color:#fff;font:inherit;font-weight:800;font-size:15px;cursor:pointer;box-shadow:3px 3px 0 #15202b;width:100%"
      >
        {tFor(lang, "devCode.use")}
      </button>
    </div>
  );
}
