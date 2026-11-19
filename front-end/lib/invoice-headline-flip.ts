/**
 * REQ-984 (LOOP-007 q1-60) — keep the /i/:id headline in step with the badge.
 *
 * The headline ("INV-001 · Version 1 · Sent") is rendered on the server. An
 * island that flips the [data-status-pill] badge after a claim or a card
 * payment (UX-35) calls this to rebuild the [data-cy=invoice-headline] line
 * from the parts the route put on it, with the same shared invoiceHeadline —
 * so the page never reads "Sent" under AWAITING CONFIRMATION.
 */
import {
  invoiceHeadline,
  type Lang,
} from "../../shared/documents/linked-view.ts";

/** the headline the server would render once the invoice is in `state` */
export function headlineFor(
  el: { getAttribute(name: string): string | null },
  state: "claimed" | "paid",
  lang: Lang,
  now: string = new Date().toISOString(),
): string | undefined {
  const number = el.getAttribute("data-headline-number");
  if (!number) return undefined;
  return invoiceHeadline(
    {
      number,
      version: Number(el.getAttribute("data-headline-version")) || 1,
      state,
      // the route dates a paid bill by its payment, anything else by publishing
      date: state === "paid"
        ? now
        : el.getAttribute("data-headline-published") ?? undefined,
      internal: el.getAttribute("data-headline-internal") === "1",
      dueDate: el.getAttribute("data-headline-due") ?? undefined,
    },
    lang,
  );
}

/** rewrite the page's headline in place (decorative — a reload renders the same) */
export function flipInvoiceHeadline(
  state: "claimed" | "paid",
  lang: Lang,
): void {
  try {
    const el = document.querySelector<HTMLElement>(
      "[data-cy='invoice-headline']",
    );
    if (!el) return;
    const text = headlineFor(el, state, lang);
    if (text) el.textContent = text;
  } catch { /* decorative */ }
}
