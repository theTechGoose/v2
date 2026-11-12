/**
 * REQ-310 (demo cycle 1, m13 + m32): the customer's link after a send.
 *
 * `CustomerLinkRow` — a persistent "Customer link · /q/:id · Copy · Open as
 * customer" row the chat renders under every send divider and on every sent
 * action_card, outside the send channel menu.
 *
 * `LinkToast` — the confirmation for any copy of that link: "Link copied",
 * or "Couldn't copy — here is the link" with the url selectable.
 */
import { I, ICN } from "../lib/dash-icons.tsx";
import { type Lang, tFor } from "../lib/i18n.ts";
import {
  customerLinkPath,
  type LinkToast as LinkToastState,
} from "../lib/customer-link.ts";

export function CustomerLinkRow(
  { quoteId, lang, onCopy }: {
    quoteId: string;
    lang: Lang;
    onCopy: (quoteId: string) => void;
  },
) {
  const path = customerLinkPath(quoteId);
  return (
    <div class="customer-link" data-cy="customer-link">
      <span class="customer-link__label">
        <I d={ICN.clip} size={12} sw={2.4} />{" "}
        {tFor(lang, "asstChat.customerLink.label")}
      </span>
      <code class="customer-link__path">{path}</code>
      <button
        type="button"
        class="customer-link__btn"
        data-cy="customer-link-copy"
        onClick={() => onCopy(quoteId)}
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
  { toast, lang, onDismiss }: {
    toast: LinkToastState | null;
    lang: Lang;
    onDismiss: () => void;
  },
) {
  if (!toast) return null;
  const failed = toast.kind === "failed";
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
