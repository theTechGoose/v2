/**
 * REQ-702 (demo-loop cycle 5, m21): the invoice's dispatch + customer-link
 * actions, ONE component for the list card's back and the detail panel so
 * the two can't drift apart again (the panel never got the card's Send now,
 * and neither surface could copy the customer's link).
 *
 * - the stage action (`showStageCta`): Send now (scheduled), Finish + send
 *   (drafting), Send reminder (out / overdue) — see `detailStageAction`. The
 *   caller runs it (useInvoiceDispatch in islands/InvoicesPage.tsx).
 * - "View as customer": the public invoice at /i/:id, in its own language.
 * - "Copy link": the absolute link, with a "copied" / "couldn't copy — here
 *   it is" note — never a silent catch.
 */
import { useState } from "preact/hooks";
import { type Lang, tFor } from "../lib/i18n.ts";
import { invoiceLinkPath } from "../lib/customer-link.ts";
import {
  type CardStage,
  detailStageAction,
  type StageActionKind,
} from "../lib/invoice-card.ts";

export function InvoiceStageActions(
  {
    stage,
    invoiceId,
    invoiceLang,
    lang,
    busy,
    cyPrefix,
    showStageCta,
    onStageAction,
    primaryStyle,
    secondaryStyle,
  }: {
    stage: CardStage;
    invoiceId: string;
    /** REQ-586: the invoice's document language, carried as `?lang=`. */
    invoiceLang?: string | null;
    lang: Lang;
    busy: boolean;
    /** data-cy prefix: "invoice-detail" (panel) / "invoice-card" (card). */
    cyPrefix: string;
    /** the card keeps its own stage CTA; the panel renders this one. */
    showStageCta: boolean;
    onStageAction?: (kind: StageActionKind, e: Event) => unknown;
    primaryStyle?: string;
    secondaryStyle?: string;
  },
) {
  const [copyNote, setCopyNote] = useState<
    { ok: true } | { ok: false; url: string } | null
  >(null);
  const action = showStageCta ? detailStageAction(stage) : null;
  const path = invoiceLinkPath(invoiceId, invoiceLang);

  async function doCopy(e: Event) {
    e.stopPropagation();
    const url = `${globalThis.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopyNote({ ok: true });
      setTimeout(() => setCopyNote(null), 2000);
    } catch {
      setCopyNote({ ok: false, url });
    }
  }

  return (
    <>
      {action && (
        <button
          type="button"
          class="qcard__back-btn--primary"
          data-cy={`${cyPrefix}-cta-${stage}`}
          onClick={(e) => onStageAction?.(action.kind, e)}
          disabled={busy}
          style={primaryStyle}
        >
          {busy ? "…" : tFor(lang, action.labelKey)}
        </button>
      )}
      <a
        data-cy={`${cyPrefix}-open`}
        href={path}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        style={secondaryStyle
          ? `${secondaryStyle};text-decoration:none;display:inline-block`
          : undefined}
      >
        {tFor(lang, "invoicesPage.detail.viewAsCustomer")}
      </a>
      <button
        type="button"
        data-cy={`${cyPrefix}-copy-link`}
        onClick={doCopy}
        style={secondaryStyle}
      >
        {copyNote?.ok
          ? tFor(lang, "invoicesPage.detail.linkCopied")
          : tFor(lang, "invoicesPage.detail.copyLink")}
      </button>
      {copyNote && !copyNote.ok && (
        <span
          role="status"
          data-cy={`${cyPrefix}-copy-failed`}
          style="flex-basis:100%;font-size:12px;color:var(--fg-muted,#6b7560);user-select:all;word-break:break-all"
        >
          {tFor(lang, "invoicesPage.detail.copyFailed", { url: copyNote.url })}
        </span>
      )}
    </>
  );
}
