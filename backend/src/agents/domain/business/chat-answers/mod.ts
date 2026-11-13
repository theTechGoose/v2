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
 *
 * REQ-388 (demo-loop cycle 2, M19 + M23):
 *   owedReply — what a customer owes and when it is billed, from their own
 *   quotes and invoices, for "¿Cuánto me debe Ana López?" (M19: the model
 *   answered "El invoice ya se envió cuando firmó" for a job billed after
 *   completion, scheduled and unsent).
 *   pricingReply offers the draft ("Draft a quote at $X") instead of saying
 *   it wrote one, and prices every job a message asks about (M23).
 */
import { type Lang, t } from "@core/i18n/mod.ts";
import { isAccepted } from "#quote-flow/quote-status.ts";
import { formatShortDate } from "#quote-flow/format-helpers.ts";
import { docNumberOf } from "#documents/numbering.ts";
import {
  isOpenReceivable,
  receivableBalanceCents,
} from "@paperwork/domain/business/open-receivable/mod.ts";

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
  /** "competitive" | "market" | "premium" (SuggestPrices' tier id). */
  tier?: string;
  label: string;
  priceCents: number;
  rationale: string;
}

/** REQ-388 (M23): one more job the same message asked a price for. */
export interface PricedSubject {
  job: string;
  /** "to move a shower drain" — an action, not a thing. */
  action?: boolean;
  options: PricedTier[];
  basis?: string;
}

export interface PricingReplyInput {
  /** The job as the contractor wrote it ("panel swap 200a"). */
  job: string;
  /** REQ-388: asked "…charge TO move a drain" → "Here's what I'd charge to
   *  move a drain", never "for move a drain". */
  action?: boolean;
  /** "Austin, TX" — the market the tiers are priced for, when known. */
  where?: string;
  options: PricedTier[];
  /** SuggestPrices' basis ("labor_and_materials" → said so). */
  basis?: string;
  /** REQ-388 (M23): the other jobs the message asked about, each its own
   *  block (pair 7: the drain move, then the heated floor). */
  more?: PricedSubject[];
  /** REQ-388 (M23): a question is answered, never drafted — the reply
   *  offers the draft at this tier (the chat shows the button). */
  offerDraft?: { tier: string; amountCents: number };
  /** false: no draft can take the pick (locked, issued, terms phase, or
   *  none bound) — the reply ends at the prices. */
  offerUpdate?: boolean;
}

/** One block: the intro line and one plain-text line per tier. */
function pricedBlock(
  lang: Lang,
  where: string | undefined,
  s: PricedSubject,
): string[] {
  const key = `chatCoordinator.pricing.${s.action ? "introTo" : "intro"}${
    where ? "Where" : ""
  }`;
  const lines = [t(lang, key, { job: s.job, ...(where ? { where } : {}) })];
  for (const o of s.options) {
    const why = o.rationale?.trim();
    lines.push(`• ${o.label}: ${money(o.priceCents)}${why ? ` — ${why}` : ""}`);
  }
  return lines;
}

/** Intro line, one plain-text line per tier (a block per job), then what
 *  the prices cover and what happens next. */
export function pricingReply(lang: Lang, input: PricingReplyInput): string {
  const where = input.where?.trim() || undefined;
  const subjects: PricedSubject[] = [input, ...(input.more ?? [])];
  const blocks = subjects.map((s) => pricedBlock(lang, where, s).join("\n"));
  const tail: string[] = [];
  if (subjects.some((s) => s.basis === "labor_and_materials")) {
    tail.push(`${t(lang, "suggestPrices.basis.laborAndMaterials")}.`);
  }
  if (input.offerDraft) {
    tail.push(
      t(lang, "chatCoordinator.pricing.offer", {
        tier: input.offerDraft.tier,
        amount: money(input.offerDraft.amountCents),
      }),
    );
  } else if (input.offerUpdate !== false) {
    tail.push(t(lang, "chatCoordinator.pricing.pick"));
  }
  const last = blocks.length - 1;
  if (tail.length) blocks[last] = `${blocks[last]}\n${tail.join(" ")}`;
  return blocks.join("\n\n");
}

/** REQ-388 (M23 + m38): the prices a pricing answer gave, one line per job
 *  ("panel swap 200a: Competitive $1,800 · Market $2,400 · Premium $3,100")
 *  — what the chat model explains from, and what a follow-up is priced
 *  consistently with. */
export function pricingContext(subjects: PricedSubject[]): string {
  return subjects.map((s) =>
    `${s.job}: ${
      s.options.map((o) => `${o.label} ${money(o.priceCents)}`).join(" · ")
    }`
  ).join("\n");
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
  /** REQ-556: how signing's confirmation reached the customer ([] = nobody;
   *  absent on invoices billed before it was recorded). */
  deliveredVia?: string[];
}

/** REQ-673 (demo-loop cycle 5, p18-3e): a change order on the job — a
 *  pending one is mentioned ("Plus CO-001 (+$40) is waiting for Maria's
 *  approval"); an approved one is already in its invoice's amount. */
export interface BillingChangeOrder {
  id: string;
  number?: string;
  status?: string;
  deltaAmountCents?: number;
  invoiceId?: string;
  quoteId?: string;
  customerId?: string;
}

/** "+$40" / "-$40" — a change order's signed delta. */
function signedMoney(cents: number): string {
  return `${cents < 0 ? "-" : "+"}${money(Math.abs(cents))}`;
}

/** REQ-673: one sentence per change order still waiting for the customer. */
function pendingChangeOrders(
  lang: Lang,
  name: string,
  changeOrders: BillingChangeOrder[] = [],
): string[] {
  return changeOrders
    .filter((c) => c.status === "pending")
    .map((c) =>
      t(lang, "chatCoordinator.owed.pendingChangeOrder", {
        name,
        number: docNumberOf(c),
        delta: signedMoney(c.deltaAmountCents ?? 0),
      })
    );
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
    /** REQ-583 (demo-loop cycle 4, M2): not sent yet (scheduled / drafted) —
     *  the card offers "Send now". */
    offerSend?: boolean;
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
  /** REQ-673: the quote's change orders — a pending one is mentioned. */
  changeOrders: BillingChangeOrder[] = [],
  /** REQ-656 (demo-loop cycle 5, M9): the contractor said the job is done
   *  ("Trabajo terminado, factura a María López…"). */
  opts: { jobDone?: boolean } = {},
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

  // REQ-656 (demo-loop cycle 5, M9): the job is done and an invoice is still
  // waiting for its date — sending it now is the answer, with Send now on
  // its card. Pair 1 got "nothing is billed yet" and the date it would go
  // out. Nothing is sent without the tap (REQ-583).
  const waiting = live.filter((i) => i.status === "scheduled")
    .sort(byInstallment)[0];
  if (opts.jobDone && waiting) {
    const when = waiting.scheduledFor ?? waiting.dueDate;
    return {
      text: say(when ? "jobDoneSendNow" : "jobDoneSendNowNoDate", {
        number: docNumberOf(waiting),
        amount: money(waiting.amount ?? 0),
        date: when ? formatShortDate(when, lang) : "",
      }),
      invoice: invoiceCard(lang, waiting),
      offerInvoiceCta: false,
    };
  }

  const billed = live.filter((i) => i.status !== "scheduled").sort(
    byInstallment,
  );
  if (billed.length === 0) {
    // REQ-388 (M19): "payment upon completion" / "Net N" bill after the job
    // (REQ-316) — signing scheduled the invoice and sent nothing. Say when it
    // goes out; "Continue to invoice" would bill the job a second time.
    const scheduled = live.filter((i) => i.status === "scheduled")
      .sort(byInstallment)[0];
    if (scheduled) {
      // REQ-673 (cycle 5, p18-3e): one sentence — "nothing is billed yet"
      // and "the $280 invoice hasn't gone out yet" said the same thing twice.
      return {
        text: [
          say("nothingBilledScheduled", {
            scheduled: scheduledClause(lang, scheduled),
          }),
          ...pendingChangeOrders(lang, name, changeOrders),
        ].join(" "),
        // REQ-583 (demo-loop cycle 4, M2): and the scheduled invoice itself,
        // with Send now — pair 3 / 9 had nothing to press.
        invoice: invoiceCard(lang, scheduled),
        offerInvoiceCta: false,
      };
    }
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
  // the installment); any other invoice was sent by the contractor — and so
  // was a scheduled one (REQ-388: a pay-after-completion invoice carries its
  // scheduledFor after it is sent; signing sent nothing).
  const billedAtSigning = index === 1 && !shown.scheduledFor;

  const parts: string[] = [];
  if (!open) {
    parts.push(say("allPaid", { number, amount }));
  } else if (shown.status === "claimed") {
    parts.push(say("claimed", { number, amount }));
  } else if (shown.status === "draft") {
    parts.push(say("draftInvoice", { number, amount }));
  } else if (
    billedAtSigning && Array.isArray(shown.deliveredVia) &&
    shown.deliveredVia.length === 0
  ) {
    // REQ-556 (demo-loop cycle 4, M7): signing billed it but no email or
    // text reached the customer — never "went out automatically".
    parts.push(
      say(total > 1 ? "depositUndelivered" : "invoiceUndelivered", {
        number,
        amount,
        due,
      }),
    );
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
  // REQ-583: also once all that is billed is paid — when the balance goes out
  if (next) {
    const when = next.scheduledFor ?? next.dueDate;
    parts.push(say("next", {
      number: docNumberOf(next),
      amount: money(next.amount ?? 0),
      date: when ? formatShortDate(when, lang) : "",
    }));
  }

  // REQ-583 (demo-loop cycle 4, M2): the card is the open invoice — a drafted
  // one too, with Send now (the chat's invoice card has none of the quote
  // card's buttons) — or, once all that is billed is paid, the next scheduled
  // one with Send now. None when nothing more is to come.
  const card = open ?? next;
  parts.push(...pendingChangeOrders(lang, name, changeOrders)); // REQ-673
  return {
    text: parts.join(" "),
    ...(card ? { invoice: invoiceCard(lang, card) } : {}),
    offerInvoiceCta: false,
  };
}

/** The card for one invoice: number, amount, due date, which payment it is —
 *  and (REQ-583) "Send now" while it has not gone out (scheduled / drafted).
 *  Also the card ChatBilling shows after a send or a payment. */
export function invoiceCard(
  lang: Lang,
  inv: BillingInvoice,
): NonNullable<BillingReply["invoice"]> {
  const number = docNumberOf(inv);
  const due = inv.dueDate ? formatShortDate(inv.dueDate, lang) : "";
  const index = inv.installmentIndex;
  const total = inv.installmentTotal ?? 1;
  const line = index === 1 && total > 1
    ? t(lang, "chatCoordinator.billing.line.deposit", { index, total })
    : typeof index === "number" && total > 1
    ? t(lang, "chatCoordinator.billing.line.installment", { index, total })
    : t(lang, "chatCoordinator.billing.line.full");
  const unsent = inv.status === "scheduled" || inv.status === "draft";
  return {
    id: inv.id,
    number,
    // The chat card's chip: a payment claim is still a sent invoice there —
    // the text says it was claimed.
    status: inv.status === "claimed" ? "sent" : inv.status ?? "sent",
    amountCents: inv.amount ?? 0,
    ...(inv.dueDate ? { dueDate: inv.dueDate } : {}),
    title: due
      ? t(lang, "chatCoordinator.billing.cardTitle", { number, due })
      : number,
    line,
    ...(unsent ? { offerSend: true } : {}),
  };
}

// ---------------------------------------------------------------------------
// REQ-388 (M19) — what a customer owes
// ---------------------------------------------------------------------------

/** "The $400 invoice (INV-001) hasn't gone out yet — it's scheduled for Nov
 *  26, due Dec 11." */
function scheduledSentence(lang: Lang, i: BillingInvoice): string {
  const number = docNumberOf(i);
  const amount = money(i.amount ?? 0);
  const when = i.scheduledFor ?? i.dueDate;
  const date = when ? formatShortDate(when, lang) : "";
  const due = i.dueDate && i.dueDate !== when
    ? formatShortDate(i.dueDate, lang)
    : "";
  const key = !date ? "scheduledNoDate" : due ? "scheduledDue" : "scheduled";
  return t(lang, `chatCoordinator.owed.${key}`, { number, amount, date, due });
}

/** REQ-673: "INV-001 for $280 goes out Nov 12, due Dec 12" — the scheduled
 *  invoice as a clause of the one sentence that says nothing is billed. */
function scheduledClause(lang: Lang, i: BillingInvoice): string {
  const number = docNumberOf(i);
  const amount = money(i.amount ?? 0);
  const when = i.scheduledFor ?? i.dueDate;
  const date = when ? formatShortDate(when, lang) : "";
  const due = i.dueDate && i.dueDate !== when
    ? formatShortDate(i.dueDate, lang)
    : "";
  const key = !date ? "goesOutNoDate" : due ? "goesOutDue" : "goesOut";
  return t(lang, `chatCoordinator.owed.${key}`, { number, amount, date, due });
}

export interface OwedQuote extends BillingQuote {
  number?: string;
  estimatedTotal?: number;
}

export interface OwedInvoice extends BillingInvoice {
  quoteId?: string;
  /** REQ-474: part payments / paid stamp — owed now is what is still owed. */
  paidCents?: number | null;
  paidAt?: string;
}

export interface OwedReplyInput {
  /** The customer, as the contractor knows them ("Ana López"). */
  name: string;
  /** Their quotes (deleted ones already left out by the store). */
  quotes: OwedQuote[];
  /** Their invoices — on those quotes or billed to them directly. */
  invoices: OwedInvoice[];
  /** "YYYY-MM-DD" — an invoice due before it is overdue. */
  today?: string;
  /** REQ-673: their change orders — a pending one is mentioned, never
   *  counted as owed or to be billed (the customer has not approved it). */
  changeOrders?: BillingChangeOrder[];
}

export interface OwedReply {
  text: string;
  /** REQ-474 (cycle 3, M17): owed NOW — the open receivable (sent / viewed /
   *  claimed / pending, unpaid), at what is still owed on each. The same
   *  rule as the Clientes card's balance (REQ-397 `isOpenReceivable`). */
  owedCents: number;
  /** REQ-474: signed work not billed yet — drafted and scheduled invoices
   *  and the part of a signed quote not invoiced. Never added to owed. */
  upcomingCents: number;
}

const byDate = (a?: string, b?: string) => (a ?? "~").localeCompare(b ?? "~");

/**
 * REQ-388 (M19): what `name` owes and when — "Ana López todavía no te debe
 * nada — $400 aún no se ha facturado. La factura de $400 (INV-001) todavía
 * no se ha enviado — está programada para el 26 nov y vence el 11 dic."
 * REQ-474 (M17): owed NOW (open receivable, the Clientes card's rule) and
 * still-to-bill are told apart, never summed. From their own data: open invoices
 * (oldest due first), drafted ones, scheduled ones (soonest first), the part
 * of a signed quote not yet invoiced; with nothing owed, whether they are
 * paid up or what is waiting for a signature or to be sent. Never claims an
 * invoice went out unless its status says so.
 */
export function owedReply(lang: Lang, input: OwedReplyInput): OwedReply {
  const name = input.name.trim() ||
    t(lang, "chatCoordinator.billing.customerFallback");
  const say = (key: string, vars: Record<string, string> = {}) =>
    t(lang, `chatCoordinator.owed.${key}`, { name, ...vars });
  const live = input.invoices.filter((i) => (i.status ?? "") !== "void");
  const status = (q: OwedQuote) => (q.status ?? "draft").toLowerCase();
  const signed = input.quotes.filter((q) =>
    isAccepted(q) && !CLOSED.has(status(q))
  );

  const open = live.filter((i) => isOpenReceivable(i))
    .sort((a, b) => byDate(a.dueDate, b.dueDate));
  const drafts = live.filter((i) => i.status === "draft");
  const scheduled = live.filter((i) => i.status === "scheduled")
    .sort((a, b) =>
      byDate(a.scheduledFor ?? a.dueDate, b.scheduledFor ?? b.dueDate)
    );
  const unbilled = signed.map((q) => {
    const invoiced = live.filter((i) => i.quoteId === q.id)
      .reduce((s, i) => s + (i.amount ?? 0), 0);
    return { q, cents: Math.max(0, (q.estimatedTotal ?? 0) - invoiced) };
  }).filter((u) => u.cents > 0);

  const sum = (xs: { amount?: number }[]) =>
    xs.reduce((s, i) => s + (i.amount ?? 0), 0);
  // REQ-474 (cycle 3, M17): owed now and still-to-bill are told apart — a
  // scheduled INV-001 plus a direct INV-002 read "$360 owed" while the
  // Clientes card said $180.
  const owedCents = open.reduce((s, i) => s + receivableBalanceCents(i), 0);
  const upcomingCents = sum(drafts) + sum(scheduled) +
    unbilled.reduce((s, u) => s + u.cents, 0);

  const parts: string[] = [];
  // REQ-673 (cycle 5, p18-3e): all that is coming is one scheduled invoice —
  // one sentence, "Maria doesn't owe you anything yet — INV-001 for $280 goes
  // out Nov 12", not "$280 isn't billed yet. The $280 invoice hasn't gone out
  // yet — …".
  const onlyScheduled = owedCents === 0 && drafts.length === 0 &&
      unbilled.length === 0 && scheduled.length === 1
    ? scheduled[0]
    : undefined;
  if (onlyScheduled) {
    parts.push(say("notYetScheduled", {
      scheduled: scheduledClause(lang, onlyScheduled),
    }));
  } else if (owedCents > 0 && upcomingCents > 0) {
    parts.push(say("owesNow", {
      now: money(owedCents),
      later: money(upcomingCents),
    }));
  } else if (owedCents > 0) {
    parts.push(say("owes", { amount: money(owedCents) }));
  } else if (upcomingCents > 0) {
    parts.push(say("notYet", { later: money(upcomingCents) }));
  } else if (live.some((i) => i.status === "paid")) {
    parts.push(say("paidUp"));
  } else {
    parts.push(say("nothing"));
  }
  for (const i of open) {
    const number = docNumberOf(i);
    const amount = money(receivableBalanceCents(i));
    const due = i.dueDate ? formatShortDate(i.dueDate, lang) : "";
    if (i.status === "claimed") {
      parts.push(
        t(lang, "chatCoordinator.billing.claimed", { name, number, amount }),
      );
    } else if (input.today && i.dueDate && i.dueDate < input.today) {
      parts.push(say("overdue", { number, amount, due }));
    } else {
      parts.push(say(due ? "sent" : "sentNoDue", { number, amount, due }));
    }
  }
  for (const i of drafts) {
    parts.push(
      t(lang, "chatCoordinator.billing.draftInvoice", {
        number: docNumberOf(i),
        amount: money(i.amount ?? 0),
      }),
    );
  }
  if (!onlyScheduled) {
    for (const i of scheduled) parts.push(scheduledSentence(lang, i));
  }
  for (const u of unbilled) {
    parts.push(say("unbilled", {
      amount: money(u.cents),
      number: docNumberOf(u.q),
    }));
  }
  if (owedCents === 0 && upcomingCents === 0) {
    for (const q of input.quotes) {
      if (isAccepted(q) || CLOSED.has(status(q))) continue;
      const vars = {
        number: docNumberOf(q),
        amount: money(q.estimatedTotal ?? 0),
      };
      const unsent = status(q) === "draft" && !q.sentAt;
      parts.push(say(unsent ? "unsent" : "waiting", vars));
    }
  }
  parts.push(...pendingChangeOrders(lang, name, input.changeOrders));
  return { text: parts.join(" "), owedCents, upcomingCents };
}
