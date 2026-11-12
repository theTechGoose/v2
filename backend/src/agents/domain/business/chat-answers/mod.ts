/**
 * REQ-368 (demo-loop cycle 1, M30 + M32) — the assistant's server-written
 * answers to the two asks the chat model got wrong in the demo. Pure: the
 * caller loads the data; these only write the words (contractor's language)
 * and pick what to show.
 *
 *   pricingReply — the three tiers the pricing helper suggested, for "how
 *   much do I charge for …?" (M30: the model refused).
 *   billingReply — where the bill for the conversation's quote stands, for
 *   "send him the deposit invoice" (M32: the model re-locked the signed
 *   quote; the deposit invoice had gone out at signing and nothing said so).
 */
import { type Lang, t } from "@core/i18n/mod.ts";
import { isAccepted } from "#quote-flow/quote-status.ts";
import { formatShortDate } from "#quote-flow/format-helpers.ts";
import { docNumberOf } from "#documents/numbering.ts";

/** "$1,600" — cents only when there are any ("$3,100.50"). */
function money(cents: number): string {
  const dollars = cents / 100;
  return "$" + dollars.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(dollars) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

// ---------------------------------------------------------------------------
// M30 — pricing
// ---------------------------------------------------------------------------

export interface PricedTier {
  label: string;
  priceCents: number;
  rationale: string;
}

export interface PricingReplyInput {
  /** The job as the contractor wrote it ("panel swap 200a"). */
  job: string;
  /** "Austin, TX" — the market the tiers are priced for, when known. */
  where?: string;
  options: PricedTier[];
  /** SuggestPrices' basis ("labor_and_materials" → said so). */
  basis?: string;
  /** The tier label the new draft was written at; absent when an existing
   *  draft was priced (the reply then offers to update it). */
  draftedAt?: string;
  /** false: no draft can take the pick (locked, issued, terms phase) — the
   *  reply ends at the prices. */
  offerUpdate?: boolean;
}

/** Intro line, one plain-text line per tier, then what the prices cover
 *  and what happens next. */
export function pricingReply(lang: Lang, input: PricingReplyInput): string {
  const where = input.where?.trim();
  const lines = [
    where
      ? t(lang, "chatCoordinator.pricing.introWhere", { job: input.job, where })
      : t(lang, "chatCoordinator.pricing.intro", { job: input.job }),
  ];
  for (const o of input.options) {
    const why = o.rationale?.trim();
    lines.push(`• ${o.label}: ${money(o.priceCents)}${why ? ` — ${why}` : ""}`);
  }
  const tail: string[] = [];
  if (input.basis === "labor_and_materials") {
    tail.push(`${t(lang, "suggestPrices.basis.laborAndMaterials")}.`);
  }
  if (input.draftedAt) {
    tail.push(
      t(lang, "chatCoordinator.pricing.drafted", { tier: input.draftedAt }),
    );
  } else if (input.offerUpdate !== false) {
    tail.push(t(lang, "chatCoordinator.pricing.pick"));
  }
  if (tail.length) lines.push(tail.join(" "));
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// M32 — billing
// ---------------------------------------------------------------------------

export interface BillingQuote {
  id: string;
  status?: string | null;
  /** A locked draft is still unsent — "send it first". */
  lockedAt?: string | null;
  sentAt?: string | null;
  acceptedAt?: string | null;
  acceptedName?: string | null;
  customerSnapshot?: { name?: string } | null;
}

export interface BillingInvoice {
  id: string;
  number?: string;
  status?: string;
  amount?: number;
  dueDate?: string;
  scheduledFor?: string;
  installmentIndex?: number;
  installmentTotal?: number;
  createdAt?: string;
  customerSnapshot?: { name?: string } | null;
  billTo?: { name?: string } | null;
}

export interface BillingReply {
  text: string;
  /** The invoice to show as a card — the first one still open (none once
   *  everything billed is paid; the text says so). */
  invoice?: {
    id: string;
    number: string;
    status: string;
    amountCents: number;
    dueDate?: string;
    /** Card title: "Invoice INV-001 · due Nov 19". */
    title: string;
    /** Card line: "Deposit (1 of 2)" / "Job total". */
    line: string;
  };
  /** Signed, but nothing billed yet: offer the "Continue to invoice" CTA. */
  offerInvoiceCta: boolean;
}

const CLOSED = new Set(["lost", "declined", "void"]);

function byInstallment(a: BillingInvoice, b: BillingInvoice): number {
  return (a.installmentIndex ?? 1) - (b.installmentIndex ?? 1) ||
    (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
}

/** Where the bill for `quote` stands, from its own invoices (void ones
 *  excluded by the caller or here). */
export function billingReply(
  lang: Lang,
  quote: BillingQuote,
  invoices: BillingInvoice[],
): BillingReply {
  const live = invoices.filter((i) => (i.status ?? "") !== "void");
  const name = quote.customerSnapshot?.name?.trim() ||
    quote.acceptedName?.trim() ||
    live.map((i) => i.customerSnapshot?.name?.trim() || i.billTo?.name?.trim())
      .find((n) => !!n) ||
    t(lang, "chatCoordinator.billing.customerFallback");
  const status = (quote.status ?? "draft").toLowerCase();
  const say = (key: string, vars: Record<string, string> = {}) =>
    t(lang, `chatCoordinator.billing.${key}`, { name, ...vars });

  if (CLOSED.has(status)) {
    return { text: say("declined"), offerInvoiceCta: false };
  }
  if (!isAccepted(quote)) {
    const notSent = status === "draft" && !quote.sentAt;
    return {
      text: say(notSent ? "notSent" : "notSigned"),
      offerInvoiceCta: false,
    };
  }

  const billed = live.filter((i) => i.status !== "scheduled").sort(
    byInstallment,
  );
  if (billed.length === 0) {
    return { text: say("noInvoiceYet"), offerInvoiceCta: true };
  }
  const open = billed.find((i) => i.status !== "paid");
  const shown = open ?? billed[billed.length - 1];
  const number = docNumberOf(shown);
  const amount = money(shown.amount ?? 0);
  const due = shown.dueDate ? formatShortDate(shown.dueDate, lang) : "";
  const index = shown.installmentIndex;
  const total = shown.installmentTotal ?? 1;
  // Signing bills the first milestone itself (SendSignedConfirmation stamps
  // the installment); any other invoice was sent by the contractor.
  const billedAtSigning = index === 1;

  const parts: string[] = [];
  if (!open) {
    parts.push(say("allPaid", { number, amount }));
  } else if (shown.status === "claimed") {
    parts.push(say("claimed", { number, amount }));
  } else if (shown.status === "draft") {
    parts.push(say("draftInvoice", { number, amount }));
  } else if (billedAtSigning) {
    parts.push(
      say(total > 1 ? "depositSent" : "invoiceSent", { number, amount, due }),
    );
  } else {
    parts.push(say("invoiceOut", { number, amount, due }));
  }
  const next = live
    .filter((i) => i.status === "scheduled")
    .sort(byInstallment)[0];
  if (open && next) {
    const when = next.scheduledFor ?? next.dueDate;
    parts.push(say("next", {
      number: docNumberOf(next),
      amount: money(next.amount ?? 0),
      date: when ? formatShortDate(when, lang) : "",
    }));
  }

  // No card once everything is paid, nor for a drafted invoice — the chat's
  // card renders a "draft" status with the quote's Lock-it-in buttons.
  if (!open || open.status === "draft") {
    return { text: parts.join(" "), offerInvoiceCta: false };
  }

  const line = index === 1 && total > 1
    ? t(lang, "chatCoordinator.billing.line.deposit", { index, total })
    : typeof index === "number" && total > 1
    ? t(lang, "chatCoordinator.billing.line.installment", { index, total })
    : t(lang, "chatCoordinator.billing.line.full");
  return {
    text: parts.join(" "),
    invoice: {
      id: shown.id,
      number,
      // The chat card's chip speaks quote statuses (cardChipKey): a payment
      // claim is still a sent invoice there — the text says it was claimed.
      status: shown.status === "claimed" ? "sent" : shown.status ?? "sent",
      amountCents: shown.amount ?? 0,
      ...(shown.dueDate ? { dueDate: shown.dueDate } : {}),
      title: due
        ? t(lang, "chatCoordinator.billing.cardTitle", { number, due })
        : number,
      line,
    },
    offerInvoiceCta: false,
  };
}
