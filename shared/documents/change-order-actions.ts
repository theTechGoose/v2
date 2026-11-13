/**
 * REQ-462 (demo-loop cycle 3, M26) — the change-order actions on the quote
 * panel. A signed quote said "Signed — later changes go on a change order"
 * and offered nothing, and each change-order row was a bare link: a pending
 * order could be neither corrected nor withdrawn there. Pure, so the panel
 * and the tests read the same rules.
 */
import { isChangeOrderMutable } from "../quote-flow/adjustment-guards.ts";
import { telHref } from "../quote-flow/format-helpers.ts";

/** Invoice statuses a change order can no longer land on. */
const CLOSED_INVOICE = new Set(["paid", "void", "canceled", "cancelled"]);

export type NewChangeOrderTarget =
  /** the newest invoice that is still open — the order goes on it */
  | { kind: "invoice"; invoiceId: string; invoiceNumber: string }
  /** nothing open yet, something still to invoice: invoice first (REQ-238) */
  | { kind: "invoice_first" }
  /** every invoice is paid: extra work goes on a new invoice (REQ-202) */
  | { kind: "new_invoice" };

/**
 * Where a new change order on this quote goes: its newest invoice that is
 * not paid, void or canceled (the ledger lists invoices in number order).
 */
export function newChangeOrderTarget(ledger: {
  invoices: readonly { id: string; number: string; status: string }[];
  remainingToInvoiceCents: number;
}): NewChangeOrderTarget {
  const open = ledger.invoices.filter((i) =>
    !CLOSED_INVOICE.has((i.status ?? "").toLowerCase())
  );
  const last = open[open.length - 1];
  if (last) {
    return { kind: "invoice", invoiceId: last.id, invoiceNumber: last.number };
  }
  return ledger.remainingToInvoiceCents > 0
    ? { kind: "invoice_first" }
    : { kind: "new_invoice" };
}

/** REQ-655 (demo-loop cycle 5, p18-9c): the new invoice for extra work on a
 *  job whose every invoice is paid — linked to the quote (`quoteId`, which
 *  prefills its customer and job) and marked as extra work (`extra=1`). */
export function extraWorkInvoiceHref(quoteId: string): string {
  return `/invoices?new=1&quoteId=${encodeURIComponent(quoteId)}&extra=1`;
}

/** REQ-655: does this /invoices query open the extra-work invoice? Only with
 *  the quote it bills against. */
export function isExtraWorkLink(search: string): boolean {
  const q = new URLSearchParams(search);
  return q.get("extra") === "1" && !!q.get("quoteId");
}

/**
 * REQ-655 (p18-9c): the signed quote's button, decided BEFORE it renders. On
 * a fully paid job "New change order" led to "a change order has nowhere to
 * go" and a blank, unlinked invoice; there it is "Bill extra work" and goes
 * straight to the linked new invoice. Otherwise it opens the change-order
 * panel (`href: null`).
 */
export function newChangeOrderButton(
  target: NewChangeOrderTarget,
  quoteId: string,
): {
  labelKey: "quotes.ledger.newChangeOrder" | "quotes.ledger.billExtraWork";
  href: string | null;
} {
  return target.kind === "new_invoice"
    ? {
      labelKey: "quotes.ledger.billExtraWork",
      href: extraWorkInvoiceHref(quoteId),
    }
    : { labelKey: "quotes.ledger.newChangeOrder", href: null };
}

/** Edit and Withdraw on a change-order row: an order the customer has not
 *  approved (P-41 — the server refuses the rest), on a known invoice. */
export function changeOrderRowActions(
  co: { status?: string; invoiceId?: string },
): { edit: boolean; withdraw: boolean } {
  const ok = isChangeOrderMutable(co) && !!co.invoiceId;
  return { edit: ok, withdraw: ok };
}

/**
 * REQ-683 (demo-loop cycle 5, m41) — the "{number} saved as Version {n} — back
 * to pending" note an Edit leaves on its row. It is the row's own memory of
 * the save, so it stands only while the live order still IS that version,
 * waiting: once the customer approves or declines it, or it moves on to a
 * newer version, the ledger has its own word and the note goes (pair 5 saw it
 * beside "Approved" until a reload). The version to show, or null.
 */
export function changeOrderSavedNote(
  co: { status?: string; version?: number },
  savedVersion: number | null,
): number | null {
  if (savedVersion === null) return null;
  const pending = (co.status ?? "").toLowerCase() === "pending";
  return pending && co.version === savedVersion ? savedVersion : null;
}

/** Dollars as typed ("1,000", "$1,000.50", "-50", "−50") → signed integer
 *  cents; null when it is not an amount other than zero. */
export function changeOrderCents(dollars: string): number | null {
  const s = (dollars ?? "").trim().replace(/−/g, "-").replace(/[$,\s]/g, "");
  if (!/^-?\d+(?:\.\d{1,2})?$|^-?\.\d{1,2}$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return Number.isFinite(cents) && cents !== 0 ? cents : null;
}

export type ChangeOrderBody =
  | { ok: true; body: { description: string; deltaAmountCents: number } }
  | { ok: false; reason: "description" | "amount" };

/** The body POST / PUT /invoices/:id/change-orders take, or what is missing. */
export function changeOrderBody(
  input: { description: string; dollars: string },
): ChangeOrderBody {
  const description = (input.description ?? "").trim();
  if (!description) return { ok: false, reason: "description" };
  const cents = changeOrderCents(input.dollars);
  if (cents === null) return { ok: false, reason: "amount" };
  return { ok: true, body: { description, deltaAmountCents: cents } };
}

/**
 * REQ-565 (demo-loop cycle 4, m33) — the ways a change order leaves its row on
 * the quote panel: its full link (Copy link), a text to the customer's phone
 * and an email to her address, both prefilled with that link. With no phone or
 * email on file the text / email still open, prefilled, for the contractor to
 * pick the recipient — never a dead button.
 */
export function changeOrderShareLinks(input: {
  origin: string;
  /** the order's own page, "/co/<id>" */
  path: string;
  phone?: string | null;
  email?: string | null;
  subject: string;
  text: string;
}): { url: string; sms: string; email: string } {
  const url = `${input.origin.replace(/\/+$/, "")}${input.path}`;
  const phone = input.phone?.trim();
  const to = phone ? telHref(phone).replace(/^tel:/, "") : "";
  const email = input.email?.trim() ?? "";
  return {
    url,
    sms: `sms:${to}?body=${encodeURIComponent(input.text)}`,
    email: `mailto:${email}?subject=${encodeURIComponent(input.subject)}&body=${
      encodeURIComponent(input.text)
    }`,
  };
}
