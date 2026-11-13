/**
 * REQ-310 (demo cycle 1, m13 + m32): the customer's link after a send.
 *
 * `CustomerLinkRow` — a persistent "Customer link · Q-001 · Copy · Open as
 * customer" row the chat renders under every send divider and on every sent
 * action_card, outside the send channel menu. REQ-472 (demo cycle 3,
 * p8-pair5-c): it names the document, or a cut path ("/q/e302…") when the
 * number isn't known — never the raw uuid; Copy and Open use the full link.
 *
 * `LinkToast` — the confirmation for any copy of that link: "Link copied",
 * or "Couldn't copy — here is the link" with the url selectable.
 */
import { I, ICN } from "../lib/dash-icons.tsx";
import { type Lang, tFor } from "../lib/i18n.ts";
import {
  customerLinkDisplay,
  customerLinkPath,
  type LinkToast as LinkToastState,
} from "../lib/customer-link.ts";

export function CustomerLinkRow(
  { quoteId, quoteNumber, sendLang, lang, onCopy }: {
    quoteId: string;
    /** REQ-472: "Q-001" — shown in place of the link when known. */
    quoteNumber?: string;
    /** REQ-586 (cycle 4, M11): the language the quote went out in — Open
     *  and Copy carry it as `?lang=`. */
    sendLang?: string;
    lang: Lang;
    onCopy: (quoteId: string, sendLang?: string) => void;
  },
) {
  const path = customerLinkPath(quoteId, sendLang);
  return (
    <div class="customer-link" data-cy="customer-link">
      <span class="customer-link__label">
        <I d={ICN.clip} size={12} sw={2.4} />{" "}
        {tFor(lang, "asstChat.customerLink.label")}
      </span>
      <code class="customer-link__path" title={path}>
        {customerLinkDisplay(quoteId, quoteNumber)}
      </code>
      <button
        type="button"
        class="customer-link__btn"
        data-cy="customer-link-copy"
        onClick={() => onCopy(quoteId, sendLang)}
      >
        {tFor(lang, "asstChat.customerLink.copy")}
      </button>
      <a
        class="customer-link__btn customer-link__btn--open"
        data-cy="customer-link-open"
        href={path}
        target="_blank"
        rel="noopener"
      >
        {tFor(lang, "asstChat.customerLink.open")}
      </a>
    </div>
  );
}

export function LinkToast(
  { toast, lang, onDismiss, onMarkSent }: {
    toast: LinkToastState | null;
    lang: Lang;
    onDismiss: () => void;
    /** REQ-572: "Mark as sent" — offered when the toast names a quote. */
    onMarkSent?: (quoteId: string) => void;
  },
) {
  if (!toast) return null;
  const failed = toast.kind === "failed";
  // REQ-572 (demo-loop cycle 4, p4-p7c): a copy of a quote that has not gone
  // out asks "Link copied — mark as sent?".
  const markId = onMarkSent ? toast.markQuoteId : undefined;
  return (
    <div
      class={`link-toast ${failed ? "link-toast--failed" : ""}`}
      data-cy="link-toast"
      role="status"
      aria-live="polite"
    >
      <span class="link-toast__icon" aria-hidden="true">
        <I d={failed ? ICN.alert : ICN.check} size={12} sw={3} />
      </span>
      <span class="link-toast__body">
        <span class="link-toast__text">
          {tFor(
            lang,
            failed
              ? "asstChat.customerLink.copyFailed"
              : markId
              ? "asstChat.customerLink.markSentAsk"
              : "asstChat.customerLink.copied",
          )}
        </span>
        {failed
          ? (
            <code class="link-toast__url" data-cy="link-toast-url">
              {toast.url}
            </code>
          )
          : null}
        {markId
          ? (
            <span class="link-toast__mark">
              <button
                type="button"
                class="link-toast__mark-btn"
                data-cy="link-toast-mark-sent"
                disabled={toast.marking}
                onClick={() => onMarkSent?.(markId)}
              >
                {tFor(lang, "asstChat.customerLink.markSent")}
              </button>
              {toast.markFailed
                ? (
                  <span class="link-toast__mark-err" role="alert">
                    {tFor(lang, "asstChat.customerLink.markSentFailed")}
                  </span>
                )
                : null}
            </span>
          )
          : null}
      </span>
      <button
        type="button"
        class="link-toast__close"
        aria-label={tFor(lang, "common.close")}
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}
