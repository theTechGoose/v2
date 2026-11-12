import { Injectable } from "#danet/core";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { ViewStore } from "@paperwork/domain/data/view-store/mod.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import type {
  Customer,
  CustomerCard,
  CustomerDocument,
  CustomerLastTone,
  CustomerStatus,
} from "@crm/dto/customer.ts";
import type { Quote } from "@paperwork/dto/quote.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";
import type { ChangeOrder } from "@paperwork/dto/change-order.ts";
import {
  isOpenReceivable,
  receivableBalanceCents,
} from "@paperwork/domain/business/open-receivable/mod.ts";
import type { View } from "@paperwork/dto/view.ts";
import { docNumberOf } from "#documents/numbering.ts";
import { invoiceState, quoteState } from "#documents/versions.ts";
import { t } from "@core/i18n/mod.ts";
import {
  balanceSubLabel,
  type BalanceSubParts,
} from "#quote-flow/balance-sub.ts";

const MS_PER_DAY = 86_400_000;
const TWELVE_MONTHS_MS = 365 * MS_PER_DAY;

/**
 * BuildCustomerCards — single-source of truth for the /clients page row.
 *
 * Reads the four stores once each (cheap KV index → in-memory filter), folds
 * each customer's quotes/invoices/views into the derived rollup the frontend
 * card consumes. Pure read coordinator; no new persistence.
 *
 * Status precedence + temp formula are encoded here exactly as §2.2 of
 * reference/backend.md describes — the frontend must not re-derive.
 *
 * REQ-367 (demo-loop cycle 1, m10): the card carries DATA, never words in the
 * viewer's language — `lastWhen` (the timestamp, not "hace un momento") and
 * `jobsSub` (a kind, not "sin trabajos activos"). The client words both in the
 * language that is live when it renders, so an EN/ES switch reaches them
 * without a refetch. The coordinator takes no language on purpose.
 */
@Injectable()
export class BuildCustomerCards {
  constructor(
    private customers: CustomerStore,
    private quotes: QuoteStore,
    private invoices: InvoiceStore,
    private views: ViewStore,
    // REQ-565 (demo m33): the card lists the customer's change orders too
    private changeOrders: ChangeOrderStore = new ChangeOrderStore(),
  ) {}

  async run(
    userId: string,
    now: Date = new Date(),
  ): Promise<CustomerCard[]> {
    const [customers, quotes, invoices, views, changeOrders] = await Promise
      .all([
        this.customers.listByUser(userId),
        this.quotes.listByUser(userId),
        this.invoices.listByUser(userId),
        this.views.listByType("quote"),
        this.changeOrders.listByUser(userId),
      ]);

    // Index quote → customerId so we can attribute view events back without
    // a second pass per customer.
    const quoteToCustomer = new Map<string, string | undefined>();
    for (const q of quotes) quoteToCustomer.set(q.id, q.customerId);

    return customers.map((c) =>
      buildOne(c, quotes, invoices, views, quoteToCustomer, now, changeOrders)
    );
  }
}

function buildOne(
  c: Customer,
  allQuotes: Quote[],
  allInvoices: Invoice[],
  allViews: View[],
  quoteToCustomer: Map<string, string | undefined>,
  now: Date,
  allChangeOrders: ChangeOrder[] = [],
): CustomerCard {
  const myQuotes = allQuotes.filter((q) => q.customerId === c.id);
  const myInvoices = allInvoices.filter((i) => i.customerId === c.id);
  // REQ-565: an order is the customer's when it names her, or (rows written
  // before it carried customerId) its quote or invoice is hers
  const myQuoteIds = new Set(myQuotes.map((q) => q.id));
  const myInvoiceIds = new Set(myInvoices.map((i) => i.id));
  const myChangeOrders = allChangeOrders.filter((co) =>
    co.customerId
      ? co.customerId === c.id
      : (co.quoteId != null && myQuoteIds.has(co.quoteId)) ||
        myInvoiceIds.has(co.invoiceId)
  );
  const myViews = allViews.filter((v) => {
    const cid = quoteToCustomer.get(v.paperworkId);
    return cid === c.id;
  });

  // ---------------- last activity ----------------
  const eventTimes: number[] = [];
  for (const q of myQuotes) eventTimes.push(new Date(q.updatedAt).getTime());
  for (const i of myInvoices) eventTimes.push(new Date(i.updatedAt).getTime());
  for (const v of myViews) eventTimes.push(new Date(v.viewedAt).getTime());
  // Floor to customer createdAt so brand-new customers don't show "never"
  eventTimes.push(new Date(c.createdAt).getTime());
  const lastTs = Math.max(...eventTimes);
  const lastWhen = new Date(lastTs).toISOString();
  const daysSinceContact = Math.floor((now.getTime() - lastTs) / MS_PER_DAY);
  const lastTone: CustomerLastTone = daysSinceContact <= 7
    ? "hot"
    : daysSinceContact <= 30
    ? "warm"
    : "cold";

  // ---------------- balance ----------------
  // Invoices still owed → positive cents; overpaid/credits → negative.
  // REQ-016 (NW-14 side-find): the invoice lifecycle is
  // scheduled|draft|sent|viewed|claimed|paid|void — every status between
  // "delivered to the customer" and "paid" is owed, not only the legacy
  // "pending". A sent invoice used to show $0 owed on /clients.
  // "deposit"/"credit" reduce the balance; "paid"/"void"/unsent are zero.
  let balanceCents = 0;
  for (const i of myInvoices) {
    // Audit1 #3 — invoice.amount is INTEGER CENTS now (no × 100).
    // REQ-397: owed = the shared open-receivable rule, at what is still owed.
    const cents = i.amount ?? 0;
    if (isOpenReceivable(i)) balanceCents += receivableBalanceCents(i);
    else if (i.status === "credit" || i.status === "deposit") {
      balanceCents -= cents;
    }
  }
  // REQ-350 + REQ-367: the sub-line as data the client words in the live
  // language; `balanceSub` is the same words in English (the neutral base).
  const balanceSubParts = buildBalanceSub(
    balanceCents,
    myInvoices,
    myQuotes,
    now,
  );
  const balanceSub = balanceSubLabel(balanceSubParts, "en", t);

  // ---------------- jobs ----------------
  // "active job" = accepted quote without a paid invoice covering it
  const acceptedQuotes = myQuotes.filter((q) =>
    q.status === "accepted" || q.acceptedAt
  );
  const paidInvoiceCount = myInvoices.filter((i) => i.status === "paid").length;
  const activeJobs = Math.max(0, acceptedQuotes.length - paidInvoiceCount);
  const overdueCount = myInvoices.filter(
    (i) => isOpenReceivable(i) && i.dueDate < now.toISOString().slice(0, 10),
  ).length;
  // P-34/P-64: the story line's "· active" in the viewer's language — REQ-367:
  // a kind the client words in the live language (clientsDisplay.jobsSub.*).
  const jobsSub: CustomerCard["jobsSub"] = overdueCount > 0
    ? "overdue"
    : activeJobs > 0
    ? "active"
    : acceptedQuotes.length > 0
    ? "scheduled"
    : "none";

  // ---------------- 12-month revenue ----------------
  const twelveMoAgo = now.getTime() - TWELVE_MONTHS_MS;
  let revenue12moCents = 0;
  for (const i of myInvoices) {
    if (i.status !== "paid" || !i.paidAt) continue;
    const t = new Date(i.paidAt).getTime();
    // INTEGER CENTS passthrough.
    if (t >= twelveMoAgo) revenue12moCents += i.amount ?? 0;
  }

  // ---------------- status precedence ----------------
  const status: CustomerStatus = deriveStatus({
    balanceCents,
    acceptedQuotes,
    myQuotes,
    activeJobs,
    revenue12moCents,
    daysSinceContact,
    paidInvoiceCount,
  });

  // ---------------- temp ----------------
  const temp = clamp(
    100 -
      Math.min(daysSinceContact, 60) * 1.2 +
      (revenue12moCents > 0 ? 20 : 0) +
      (c.vip ? 15 : 0) +
      (activeJobs > 0 ? 10 : 0),
    0,
    100,
  );

  return {
    ...c,
    lastWhen,
    lastTone,
    balanceCents,
    balanceSub,
    balanceSubParts,
    activeJobs,
    jobsSub,
    status,
    temp,
    daysSinceContact,
    revenue12moCents,
    documents: documentsFor(myQuotes, myInvoices, myChangeOrders),
  };
}

/**
 * REQ-323 (demo-loop cycle 1, m20): the customer's documents for the card back —
 * one row per quote and per invoice (the onboarding sample excluded), newest
 * first, each with its own number (REQ-204: never an id slice), its lifecycle
 * state and the page that opens it.
 *
 * REQ-565 (demo-loop cycle 4, m33): and one row per change order (its number,
 * state, signed amount and /co link); a quote is worded at the agreed total —
 * the quote plus its approved change orders, as the quote's ledger and card
 * count it (REQ-205/481) — with what those orders added alongside.
 */
/** REQ-551 (demo-loop cycle 4, B2): the paid revenue no customer card can
 *  carry — invoices with no customer, or whose customer is gone — on the
 *  same 12-month, paid-amount rule as a card's `revenue12moCents`. The
 *  leaderboard reports it rather than saying there are no paid invoices. */
export function unassignedPaidRevenue(
  invoices: ReadonlyArray<
    { customerId?: string; status?: string; paidAt?: string; amount?: number }
  >,
  customerIds: ReadonlySet<string>,
  now: Date = new Date(),
): { invoiceCount: number; revenue12moCents: number } {
  const twelveMoAgo = now.getTime() - TWELVE_MONTHS_MS;
  let invoiceCount = 0;
  let revenue12moCents = 0;
  for (const i of invoices) {
    if (i.customerId && customerIds.has(i.customerId)) continue;
    if (i.status !== "paid" || !i.paidAt) continue;
    if (new Date(i.paidAt).getTime() < twelveMoAgo) continue;
    invoiceCount++;
    revenue12moCents += i.amount ?? 0;
  }
  return { invoiceCount, revenue12moCents };
}

export function documentsFor(
  quotes: Quote[],
  invoices: Invoice[],
  changeOrders: ChangeOrder[] = [],
): CustomerDocument[] {
  const rows: CustomerDocument[] = [];
  const approvedByQuote = new Map<string, number>();
  for (const co of changeOrders) {
    if (co.status !== "approved" || !co.quoteId) continue;
    approvedByQuote.set(
      co.quoteId,
      (approvedByQuote.get(co.quoteId) ?? 0) + Math.round(co.deltaAmountCents),
    );
  }
  for (const q of quotes) {
    if (q.isSample) continue;
    const approved = approvedByQuote.get(q.id) ?? 0;
    rows.push({
      kind: "quote",
      id: q.id,
      number: docNumberOf(q),
      state: quoteState(q),
      amountCents: Math.max(0, (q.estimatedTotal ?? 0) + approved),
      ...(approved !== 0 ? { changeOrdersCents: approved } : {}),
      url: `/quotes?open=${q.id}`,
      updatedAt: q.updatedAt,
    });
  }
  for (const co of changeOrders) {
    rows.push({
      kind: "change_order",
      id: co.id,
      number: docNumberOf(co),
      state: co.status,
      amountCents: Math.round(co.deltaAmountCents),
      url: `/co/${co.id}`,
      updatedAt: co.updatedAt,
    });
  }
  for (const i of invoices) {
    rows.push({
      kind: "invoice",
      id: i.id,
      number: docNumberOf(i),
      state: invoiceState(i),
      amountCents: i.amount ?? 0,
      url: `/i/${i.id}`,
      updatedAt: i.updatedAt,
    });
  }
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function deriveStatus(args: {
  balanceCents: number;
  acceptedQuotes: Quote[];
  myQuotes: Quote[];
  activeJobs: number;
  revenue12moCents: number;
  daysSinceContact: number;
  paidInvoiceCount: number;
}): CustomerStatus {
  const {
    balanceCents,
    acceptedQuotes,
    myQuotes,
    activeJobs,
    revenue12moCents,
    daysSinceContact,
  } = args;
  if (balanceCents > 0) return "owes";
  if (acceptedQuotes.length > args.paidInvoiceCount) return "active";
  if (myQuotes.length > 0 && acceptedQuotes.length === 0) {
    const onlyOpen = myQuotes.every((q) =>
      q.status === "draft" || q.status === "sent"
    );
    if (onlyOpen) return "lead";
  }
  if (revenue12moCents > 0 && activeJobs === 0 && balanceCents === 0) {
    return "regular";
  }
  if (daysSinceContact > 60 && balanceCents <= 0) return "cold";
  // Fallback: if there's any non-decided open quote treat as lead
  if (myQuotes.length > 0 && acceptedQuotes.length === 0) return "lead";
  // REQ-271 (demo i18n-formatting-m5): nothing on the books yet — no quote, no paid invoice —
  // is a new customer, never a "regular".
  if (myQuotes.length === 0 && args.paidInvoiceCount === 0) return "new";
  return "regular";
}

/**
 * REQ-350 (demo-loop cycle 1, m9): the balance sub-line used to be English
 * literals ("owes", "· overdue", "due in N days", "on file") that a Spanish
 * story template printed verbatim ("$600 pendiente · owes."). REQ-367: it is
 * data — the reader words it (shared balanceSubLabel) in its own language.
 */
function buildBalanceSub(
  balanceCents: number,
  invoices: Invoice[],
  quotes: Quote[],
  now: Date,
): BalanceSubParts {
  const today = now.toISOString().slice(0, 10);
  if (balanceCents > 0) {
    const pending = invoices
      .filter(isOpenReceivable)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const next = pending[0];
    if (next) {
      const dueDays = Math.round(
        (new Date(next.dueDate).getTime() - now.getTime()) / MS_PER_DAY,
      );
      // REQ-204: the invoice's own number ("INV-5000"), never an id slice
      const ref = docNumberOf(next);
      if (next.dueDate < today) return { kind: "overdue", ref };
      if (dueDays <= 0) return { kind: "dueToday", ref };
      return { kind: "dueIn", ref, days: dueDays };
    }
    return { kind: "owes" };
  }
  if (balanceCents < 0) return { kind: "onFile", amountCents: -balanceCents };
  const openQuote = quotes.find((q) => q.status === "sent");
  if (openQuote) {
    // estimatedTotal is INTEGER CENTS now (audit1 #3).
    return { kind: "quoteOut", amountCents: openQuote.estimatedTotal ?? 0 };
  }
  return { kind: "settled" };
}

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}
