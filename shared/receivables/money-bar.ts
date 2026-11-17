/**
 * REQ-798 — the dashboard's money bar: the business's money in five buckets, QuickBooks' order,
 * each carrying the documents behind it so a click on a segment lists them one by one.
 *
 * Pure: quotes + jobs + invoices in, buckets out. Every amount is INTEGER CENTS.
 */

export const MONEY_BUCKET_KEYS = [
  "estimates",
  "unbilled",
  "overdue",
  "open",
  "paid",
] as const;
export type MoneyBucketKey = typeof MONEY_BUCKET_KEYS[number];

/** The order a bucket is picked when nothing is selected yet: what needs attention first. */
const DEFAULT_ORDER: MoneyBucketKey[] = [
  "overdue",
  "open",
  "unbilled",
  "estimates",
  "paid",
];

/** Statuses of an invoice that is out and still collecting — the REQ-397 open-receivable rule
 *  (backend open-receivable/mod.ts): sent / viewed / claimed and the legacy partly-paid "pending",
 *  unpaid, with a balance. */
const OPEN_INVOICE = new Set(["pending", "sent", "viewed", "claimed"]);
/** Statuses of an invoice that counts as billed against its quote. */
const BILLED_INVOICE = new Set([
  "scheduled",
  "pending",
  "sent",
  "viewed",
  "claimed",
  "paid",
]);
const WON_QUOTE = new Set(["accepted", "won"]);
const PAID_WINDOW_DAYS = 30;

export interface MoneyBarQuote {
  id: string;
  status?: string;
  estimatedTotal?: number | null;
  customerName?: string | null;
  customerId?: string;
  jobName?: string;
  summary?: string;
  number?: string;
  sentAt?: string;
  isSample?: boolean;
}
export interface MoneyBarJob {
  id: string;
  customer: { id: string; name: string };
  quote: { id: string; summary: string };
  totalCents: number;
}
export interface MoneyBarInvoice {
  id: string;
  status?: string;
  quoteId?: string;
  customerId?: string;
  amount?: number;
  paidCents?: number;
  paidAt?: string;
  dueDate: string;
  jobName?: string;
  number?: string;
  updatedAt: string;
  billTo?: { name?: string; businessName?: string };
}

export interface MoneyBarItem {
  id: string;
  kind: "quote" | "job" | "invoice";
  /** who it is with — the customer */
  title: string;
  /** what it is for */
  job?: string;
  /** "INV-001" / "Q-004"; "#ABCD" for rows older than numbering */
  number: string;
  /** the amount this bucket counts for the row */
  cents: number;
  url: string;
  // invoice
  dueDate?: string;
  /** > 0 only in the overdue bucket */
  daysOverdue?: number;
  paidAt?: string;
  // quote
  sentAt?: string;
  // job
  agreedCents?: number;
  billedCents?: number;
}

export interface MoneyBucket {
  key: MoneyBucketKey;
  cents: number;
  count: number;
  items: MoneyBarItem[];
}

export interface MoneyBarData {
  buckets: MoneyBucket[];
  /** every open balance, overdue or not — "money owed to you" */
  owedCents: number;
  /** the five amounts together — what the segments share */
  totalCents: number;
}

const shortId = (id: string) => `#${id.slice(0, 6).toUpperCase()}`;

function startOfDay(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

function daysUntil(iso: string, now: Date): number {
  const due = new Date(iso + "T00:00:00");
  if (Number.isNaN(due.getTime())) return 0;
  return Math.round((due.getTime() - startOfDay(now)) / 86_400_000);
}

function balanceOf(i: MoneyBarInvoice): number {
  const amount = Math.round(i.amount ?? 0);
  const paid = Math.round(i.paidCents ?? 0);
  return Math.max(0, amount - paid);
}

export function buildMoneyBar(
  { quotes, jobs, invoices, customerNames, now }: {
    quotes: MoneyBarQuote[];
    jobs: MoneyBarJob[];
    invoices: MoneyBarInvoice[];
    customerNames: Map<string, string>;
    now: Date;
  },
): MoneyBarData {
  const nameFor = (i: MoneyBarInvoice) =>
    (i.customerId && customerNames.get(i.customerId)) ||
    i.billTo?.name || i.billTo?.businessName || "—";

  // estimates: sent quotes
  const estimates: MoneyBarItem[] = quotes
    .filter((q) => q.status === "sent" && q.isSample !== true)
    .map((q) => ({
      id: q.id,
      kind: "quote" as const,
      title: q.customerName ||
        (q.customerId && customerNames.get(q.customerId)) || "—",
      job: q.jobName ?? q.summary,
      number: q.number ?? shortId(q.id),
      cents: Math.round(q.estimatedTotal ?? 0),
      url: `/quotes?open=${q.id}`,
      sentAt: q.sentAt,
    }))
    .sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? ""));

  // unbilled: won jobs' agreed total minus what has been invoiced against the quote
  const billedByQuote = new Map<string, number>();
  for (const i of invoices) {
    if (!i.quoteId || !BILLED_INVOICE.has(i.status ?? "")) continue;
    billedByQuote.set(
      i.quoteId,
      (billedByQuote.get(i.quoteId) ?? 0) + Math.round(i.amount ?? 0),
    );
  }
  const quoteById = new Map(quotes.map((q) => [q.id, q] as const));
  const unbilled: MoneyBarItem[] = [];
  for (const j of jobs) {
    const q = quoteById.get(j.quote.id);
    if (q && (q.isSample === true || !WON_QUOTE.has(q.status ?? ""))) continue;
    const agreed = Math.round(j.totalCents);
    const billed = billedByQuote.get(j.quote.id) ?? 0;
    const left = agreed - billed;
    if (left <= 0) continue;
    unbilled.push({
      id: j.quote.id,
      kind: "job",
      title: j.customer.name,
      job: q?.jobName ?? j.quote.summary,
      number: q?.number ?? shortId(j.quote.id),
      cents: left,
      url: `/quotes?open=${j.quote.id}`,
      agreedCents: agreed,
      billedCents: billed,
    });
  }
  unbilled.sort((a, b) => b.cents - a.cents);

  // overdue / open: every invoice that is out, split on its due date
  const overdue: MoneyBarItem[] = [];
  const open: MoneyBarItem[] = [];
  for (const i of invoices) {
    if (!OPEN_INVOICE.has(i.status ?? "")) continue;
    if (i.paidAt || balanceOf(i) <= 0) continue;
    const days = daysUntil(i.dueDate, now);
    const item: MoneyBarItem = {
      id: i.id,
      kind: "invoice",
      title: nameFor(i),
      job: i.jobName,
      number: i.number ?? shortId(i.id),
      cents: balanceOf(i),
      url: `/invoices?open=${i.id}`,
      dueDate: i.dueDate,
    };
    if (days < 0) overdue.push({ ...item, daysOverdue: -days });
    else open.push(item);
  }
  overdue.sort((a, b) => (b.daysOverdue ?? 0) - (a.daysOverdue ?? 0));
  open.sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));

  // paid: in the last 30 days, newest first
  const since = now.getTime() - PAID_WINDOW_DAYS * 86_400_000;
  const paid: MoneyBarItem[] = invoices
    .filter((i) => {
      if (i.status !== "paid") return false;
      const t = new Date(i.paidAt ?? i.updatedAt).getTime();
      return Number.isFinite(t) && t >= since;
    })
    .map((i) => ({
      id: i.id,
      kind: "invoice" as const,
      title: nameFor(i),
      job: i.jobName,
      number: i.number ?? shortId(i.id),
      cents: Math.round(i.paidCents ?? i.amount ?? 0) ||
        Math.round(i.amount ?? 0),
      url: `/invoices?open=${i.id}`,
      paidAt: i.paidAt ?? i.updatedAt,
    }))
    .sort((a, b) => (b.paidAt ?? "").localeCompare(a.paidAt ?? ""));

  const bucket = (key: MoneyBucketKey, items: MoneyBarItem[]): MoneyBucket => ({
    key,
    items,
    count: items.length,
    cents: items.reduce((s, x) => s + x.cents, 0),
  });
  const buckets = [
    bucket("estimates", estimates),
    bucket("unbilled", unbilled),
    bucket("overdue", overdue),
    bucket("open", open),
    bucket("paid", paid),
  ];
  return {
    buckets,
    owedCents: buckets[2].cents + buckets[3].cents,
    totalCents: buckets.reduce((s, b) => s + b.cents, 0),
  };
}

/** The bucket shown before any click: the first with something in it, most urgent first. */
export function defaultBucket(buckets: MoneyBucket[]): MoneyBucketKey | null {
  for (const key of DEFAULT_ORDER) {
    const b = buckets.find((x) => x.key === key);
    if (b && b.count > 0) return key;
  }
  return null;
}
