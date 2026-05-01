import { Injectable } from "#danet/core";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { ViewStore } from "@paperwork/domain/data/view-store/mod.ts";
import type { Customer, CustomerCard, CustomerStatus, CustomerLastTone } from "@crm/dto/customer.ts";
import type { Quote } from "@paperwork/dto/quote.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";
import type { View } from "@paperwork/dto/view.ts";
import { relativeTime } from "@core/business/relative-time/mod.ts";

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
 */
@Injectable()
export class BuildCustomerCards {
  constructor(
    private customers: CustomerStore,
    private quotes:    QuoteStore,
    private invoices:  InvoiceStore,
    private views:     ViewStore,
  ) {}

  async run(userId: string, now: Date = new Date()): Promise<CustomerCard[]> {
    const [customers, quotes, invoices, views] = await Promise.all([
      this.customers.listByUser(userId),
      this.quotes.listByUser(userId),
      this.invoices.listByUser(userId),
      this.views.listByType("quote"),
    ]);

    // Index quote → customerId so we can attribute view events back without
    // a second pass per customer.
    const quoteToCustomer = new Map<string, string | undefined>();
    for (const q of quotes) quoteToCustomer.set(q.id, q.customerId);

    return customers.map((c) => buildOne(c, quotes, invoices, views, quoteToCustomer, now));
  }
}

function buildOne(
  c: Customer,
  allQuotes: Quote[],
  allInvoices: Invoice[],
  allViews: View[],
  quoteToCustomer: Map<string, string | undefined>,
  now: Date,
): CustomerCard {
  const myQuotes   = allQuotes.filter((q) => q.customerId === c.id);
  const myInvoices = allInvoices.filter((i) => i.customerId === c.id);
  const myViews    = allViews.filter((v) => {
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
  const lastWhenRel = relativeTime(lastWhen, now);
  const lastTone: CustomerLastTone =
    daysSinceContact <= 7 ? "hot" : daysSinceContact <= 30 ? "warm" : "cold";

  // ---------------- balance ----------------
  // pending invoices owed → positive cents; overpaid/credits → negative.
  // Treat "deposit"/"credit" status as negative balance, "paid" as zero, "pending" as owed.
  let balanceCents = 0;
  for (const i of myInvoices) {
    // Audit1 #3 — invoice.amount is INTEGER CENTS now (no × 100).
    const cents = i.amount ?? 0;
    if (i.status === "pending") balanceCents += cents;
    else if (i.status === "credit" || i.status === "deposit") balanceCents -= cents;
  }
  const balanceSub = buildBalanceSub(balanceCents, myInvoices, myQuotes, now);

  // ---------------- jobs ----------------
  // "active job" = accepted quote without a paid invoice covering it
  const acceptedQuotes = myQuotes.filter((q) => q.status === "accepted" || q.acceptedAt);
  const paidInvoiceCount = myInvoices.filter((i) => i.status === "paid").length;
  const activeJobs = Math.max(0, acceptedQuotes.length - paidInvoiceCount);
  const overdueCount = myInvoices.filter(
    (i) => i.status === "pending" && i.dueDate < now.toISOString().slice(0, 10),
  ).length;
  const jobsSub =
    overdueCount > 0 ? "overdue"
    : activeJobs > 0 ? "active"
    : acceptedQuotes.length > 0 ? "scheduled"
    : "no active jobs";

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
    100
    - Math.min(daysSinceContact, 60) * 1.2
    + (revenue12moCents > 0 ? 20 : 0)
    + (c.vip ? 15 : 0)
    + (activeJobs > 0 ? 10 : 0),
    0, 100,
  );

  return {
    ...c,
    lastWhen,
    lastWhenRel,
    lastTone,
    balanceCents,
    balanceSub,
    activeJobs,
    jobsSub,
    status,
    temp,
    daysSinceContact,
    revenue12moCents,
  };
}

function deriveStatus(args: {
  balanceCents: number;
  acceptedQuotes: Quote[];
  myQuotes: Quote[];
  activeJobs: number;
  revenue12moCents: number;
  daysSinceContact: number;
  paidInvoiceCount: number;
}): CustomerStatus {
  const { balanceCents, acceptedQuotes, myQuotes, activeJobs, revenue12moCents, daysSinceContact } = args;
  if (balanceCents > 0) return "owes";
  if (acceptedQuotes.length > args.paidInvoiceCount) return "active";
  if (myQuotes.length > 0 && acceptedQuotes.length === 0) {
    const onlyOpen = myQuotes.every((q) => q.status === "draft" || q.status === "sent");
    if (onlyOpen) return "lead";
  }
  if (revenue12moCents > 0 && activeJobs === 0 && balanceCents === 0) return "regular";
  if (daysSinceContact > 60 && balanceCents <= 0) return "cold";
  // Fallback: if there's any non-decided open quote/contract treat as lead, else regular
  if (myQuotes.length > 0 && acceptedQuotes.length === 0) return "lead";
  return "regular";
}

function buildBalanceSub(
  balanceCents: number,
  invoices: Invoice[],
  quotes: Quote[],
  now: Date,
): string {
  const today = now.toISOString().slice(0, 10);
  if (balanceCents > 0) {
    const pending = invoices
      .filter((i) => i.status === "pending")
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const next = pending[0];
    if (next) {
      const dueDays = Math.round(
        (new Date(next.dueDate).getTime() - now.getTime()) / MS_PER_DAY,
      );
      const ref = next.id.slice(0, 8);
      if (next.dueDate < today) return `INV-${ref} · overdue`;
      return `INV-${ref} · due in ${dueDays} day${dueDays === 1 ? "" : "s"}`;
    }
    return "owes";
  }
  if (balanceCents < 0) return `${formatDollars(-balanceCents)} on file`;
  const openQuote = quotes.find((q) => q.status === "sent");
  if (openQuote) {
    // estimatedTotal is INTEGER CENTS now (audit1 #3).
    return `settled · quote out ${formatDollars(openQuote.estimatedTotal ?? 0)}`;
  }
  return "settled";
}

function formatDollars(cents: number): string {
  const dollars = Math.round(cents / 100);
  return `$${dollars.toLocaleString("en-US")}`;
}

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}
