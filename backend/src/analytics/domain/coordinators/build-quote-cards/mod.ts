import { Injectable } from "#danet/core";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { ContractStore } from "@paperwork/domain/data/contract-store/mod.ts";
import { ViewStore } from "@paperwork/domain/data/view-store/mod.ts";
import type { Quote, QuoteCard, QuoteStage } from "@paperwork/dto/quote.ts";
import type { View } from "@paperwork/dto/view.ts";

const MS_PER_DAY = 86_400_000;
const HOUR_MS = 3_600_000;

/**
 * BuildQuoteCards — single source of truth for /quotes row enrichment.
 *
 * Stage derivation, opens dedup (1/hour bucket), customer-name join. The
 * frontend MUST NOT re-derive stage; if a rule changes it changes here.
 *
 * No new persistence. All folds are over the per-user listByUser scans
 * already paid for by the controller.
 */
@Injectable()
export class BuildQuoteCards {
  constructor(
    private quotes:    QuoteStore,
    private contracts: ContractStore,
    private views:     ViewStore,
    private customers: CustomerStore,
  ) {}

  async run(userId: string, now: Date = new Date()): Promise<QuoteCard[]> {
    const [quotes, contracts, views, customers] = await Promise.all([
      this.quotes.listByUser(userId),
      this.contracts.listByUser(userId),
      this.views.listByType("quote"),
      this.customers.listByUser(userId),
    ]);

    const customerNames = new Map(customers.map((c) => [c.id, c.name]));
    const contractsByQuoteId = new Set(contracts.map((c) => c.quoteId).filter(Boolean));

    return quotes.map((q) => buildOne(q, views, customerNames, contractsByQuoteId, now));
  }
}

function buildOne(
  q: Quote,
  allViews: View[],
  customerNames: Map<string, string>,
  contractsByQuoteId: Set<string | undefined>,
  now: Date,
): QuoteCard {
  const myViews = allViews.filter((v) => v.paperworkId === q.id)
    .sort((a, b) => a.viewedAt.localeCompare(b.viewedAt));

  // Dedupe to ≤1 / 60-minute bucket
  const opensBuckets: number[] = [];
  for (const v of myViews) {
    const t = new Date(v.viewedAt).getTime();
    const last = opensBuckets[opensBuckets.length - 1];
    if (last == null || t - last >= HOUR_MS) opensBuckets.push(t);
  }
  const opens = opensBuckets.length;
  const lastOpenAt = myViews.at(-1)?.viewedAt ?? null;

  const stage = deriveStage({
    sentAt:    q.sentAt,
    acceptedAt:q.acceptedAt,
    lostAt:    q.lostAt,
    opens,
    lastOpenAt,
    quoteId:   q.id,
    contractsByQuoteId,
    now,
  });

  const sentDays = q.sentAt
    ? Math.floor((now.getTime() - new Date(q.sentAt).getTime()) / MS_PER_DAY)
    : null;

  const decidedDays =
    stage === "won" && q.acceptedAt
      ? Math.floor((now.getTime() - new Date(q.acceptedAt).getTime()) / MS_PER_DAY)
    : stage === "lost" && q.lostAt
      ? Math.floor((now.getTime() - new Date(q.lostAt).getTime()) / MS_PER_DAY)
    : null;

  const daysIn = computeDaysIn(stage, q, opensBuckets, now);

  const customerName = q.customerId ? (customerNames.get(q.customerId) ?? null) : null;

  return {
    ...q,
    stage,
    daysIn,
    opens,
    lastOpenAt,
    sentDays,
    decidedDays,
    customerName,
  };
}

function deriveStage(args: {
  sentAt?: string;
  acceptedAt?: string;
  lostAt?: string;
  opens: number;
  lastOpenAt: string | null;
  quoteId: string;
  contractsByQuoteId: Set<string | undefined>;
  now: Date;
}): QuoteStage {
  const { sentAt, acceptedAt, lostAt, opens, lastOpenAt, quoteId, contractsByQuoteId, now } = args;

  // won / lost win over earlier stages
  if (acceptedAt) return "won";
  if (contractsByQuoteId.has(quoteId)) return "won";
  if (lostAt) return "lost";

  if (!sentAt) return "draft";
  const sentMs = new Date(sentAt).getTime();
  const sinceSent = now.getTime() - sentMs;

  if (sinceSent > 30 * MS_PER_DAY && opens === 0) return "lost";

  if (sinceSent < 24 * 3600 * 1000 && opens === 0) return "sent";

  if (sinceSent > 7 * MS_PER_DAY && opens === 0) return "stale";

  if (opens >= 1) {
    const lastOpenMs = lastOpenAt ? new Date(lastOpenAt).getTime() : 0;
    const sinceLastOpen = now.getTime() - lastOpenMs;
    if (sinceSent > 4 * MS_PER_DAY && sinceLastOpen > 2 * MS_PER_DAY) return "cooling";
    if (sinceSent >= 24 * 3600 * 1000) return "opened";
    return "sent";
  }

  // Default: still in-flight, no opens, < 7d → sent
  return "sent";
}

function computeDaysIn(stage: QuoteStage, q: Quote, opensBuckets: number[], now: Date): number {
  // "Days since entering the current stage."
  let entryMs: number;
  switch (stage) {
    case "draft":   entryMs = new Date(q.createdAt).getTime(); break;
    case "sent":    entryMs = q.sentAt ? new Date(q.sentAt).getTime() : new Date(q.createdAt).getTime(); break;
    case "opened":  entryMs = opensBuckets[0] ?? (q.sentAt ? new Date(q.sentAt).getTime() : new Date(q.createdAt).getTime()); break;
    case "cooling": entryMs = (opensBuckets.at(-1) ?? new Date(q.sentAt ?? q.createdAt).getTime()) + 2 * MS_PER_DAY; break;
    case "stale":   entryMs = q.sentAt ? new Date(q.sentAt).getTime() + 7 * MS_PER_DAY : new Date(q.createdAt).getTime(); break;
    case "won":     entryMs = q.acceptedAt ? new Date(q.acceptedAt).getTime() : new Date(q.updatedAt).getTime(); break;
    case "lost":    entryMs = q.lostAt ? new Date(q.lostAt).getTime() : new Date(q.updatedAt).getTime(); break;
  }
  return Math.max(0, Math.floor((now.getTime() - entryMs) / MS_PER_DAY));
}
