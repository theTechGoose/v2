import { Injectable } from "#danet/core";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { ContractStore } from "@paperwork/domain/data/contract-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import type { Invoice, PaymentMethod } from "@paperwork/dto/invoice.ts";

export interface ForecastEntry {
  /** ISO date when funds are *expected* to land (best-effort estimate). */
  expectedLandDate: string;
  amount: number;
  /** Display label — typically the customer's first name + method
   *  ("Hansen (ACH)"). */
  label: string;
  /** Invoice id, for linking back. */
  invoiceId: string;
  /** Where the estimate came from. Drives subtle UI variation: "claimed
   *  ACH lands in 2 days" reads differently from "sent invoice due
   *  Friday." */
  source: "claimed" | "sent_due" | "scheduled" | "paid";
}

export interface ForecastResult {
  /** Total expected to land within the 7-day forward window from `now`. */
  thisWeekCents: number;
  /** Detail entries within the 7-day window. Sorted by expectedLandDate. */
  thisWeek: ForecastEntry[];
  /** Total expected in the *next* 7-day window. Used as fallback copy
   *  when the current week is quiet. */
  nextWeekCents: number;
  /** Aggregated overdue / at-risk callout: any sent invoices whose
   *  dueDate is in the past and which haven't been claimed yet. */
  atRiskCents: number;
  atRisk: ForecastEntry[];
  /** Reference time — useful for tests and for clients that want to
   *  resolve relative phrases like "Tuesday" without timezone drift. */
  asOf: string;
}

/**
 * ComputeInvoiceForecast — pure-aggregation read-side coordinator for
 * the forecast hero on /invoices.
 *
 * Bucketing rules (roadmap §J):
 *   - status=`paid`     → expectedLandDate = paidAt (already landed; we
 *                         exclude from "this week" but it's recorded
 *                         here as a `paid` source for tests).
 *   - status=`claimed`  → expectedLandDate = claimedAt + settlement window
 *                         (ACH +2d / check +5d / Venmo/Zelle/Cash +0d /
 *                         other +3d).
 *   - status=`sent`     → expectedLandDate = dueDate (or `claimedAt+0`
 *                         when missing).
 *   - status=`scheduled`→ excluded from the forward window; surfaces
 *                         elsewhere as "upcoming pipeline."
 *   - status=`void`     → excluded.
 *
 * At-risk: status in (sent|viewed) AND dueDate < now AND no paymentIntent.
 */
@Injectable()
export class ComputeInvoiceForecast {
  constructor(
    private invoices: InvoiceStore,
    private customers: CustomerStore,
    private contracts: ContractStore,
    private quotes: QuoteStore,
  ) {}

  async run(userId: string, now: Date = new Date()): Promise<ForecastResult> {
    const all = await this.invoices.listByUser(userId);
    const thisWeekStart = now;
    const thisWeekEnd = addDays(now, 7);
    const nextWeekEnd = addDays(now, 14);

    const thisWeek: ForecastEntry[] = [];
    const nextWeek: ForecastEntry[] = [];
    const atRisk: ForecastEntry[] = [];

    const customerCache = new Map<string, string>();
    const contractCache = new Map<string, string>();

    for (const inv of all) {
      if (inv.status === "void" || inv.status === "draft") continue;

      const customer = await resolveCustomerName(this.customers, userId, inv.customerId, customerCache);
      const job = await resolveJobName(this.contracts, this.quotes, userId, inv.contractId, contractCache);
      const labelBase = customer ?? job ?? "Invoice";

      // At-risk pass: sent/viewed + past-due + no intent.
      if (
        (inv.status === "sent" || inv.status === "viewed") &&
        inv.dueDate &&
        new Date(`${inv.dueDate}T23:59:59Z`).getTime() < now.getTime() &&
        !inv.paymentIntent
      ) {
        atRisk.push({
          expectedLandDate: inv.dueDate,
          amount: inv.amount ?? 0,
          label: labelBase,
          invoiceId: inv.id,
          source: "sent_due",
        });
        // At-risk is a separate callout; don't double-count in this/next week.
        continue;
      }

      const entry = forecastEntryFor(inv, labelBase);
      if (!entry) continue;
      const ts = new Date(`${entry.expectedLandDate}T12:00:00Z`).getTime();
      if (ts >= thisWeekStart.getTime() && ts <= thisWeekEnd.getTime()) {
        thisWeek.push(entry);
      } else if (ts > thisWeekEnd.getTime() && ts <= nextWeekEnd.getTime()) {
        nextWeek.push(entry);
      }
    }

    thisWeek.sort((a, b) => a.expectedLandDate.localeCompare(b.expectedLandDate));
    nextWeek.sort((a, b) => a.expectedLandDate.localeCompare(b.expectedLandDate));
    atRisk.sort((a, b) => b.amount - a.amount);

    return {
      thisWeek,
      thisWeekCents: thisWeek.reduce((s, e) => s + e.amount, 0),
      nextWeekCents: nextWeek.reduce((s, e) => s + e.amount, 0),
      atRisk,
      atRiskCents: atRisk.reduce((s, e) => s + e.amount, 0),
      asOf: now.toISOString(),
    };
  }
}

export function settlementOffsetDays(method: PaymentMethod): number {
  switch (method) {
    case "ach": return 2;
    case "check": return 5;
    case "venmo":
    case "zelle":
    case "cashapp":
    case "cash": return 0;
    case "other":
    default: return 3;
  }
}

export function forecastEntryFor(inv: Invoice, labelBase: string): ForecastEntry | undefined {
  if (inv.status === "paid") {
    return {
      expectedLandDate: (inv.paidAt ?? "").slice(0, 10),
      amount: inv.amount ?? 0,
      label: labelBase,
      invoiceId: inv.id,
      source: "paid",
    };
  }
  if (inv.status === "claimed" && inv.paymentIntent) {
    const claimedAt = new Date(inv.paymentIntent.claimedAt);
    const expected = addDays(claimedAt, settlementOffsetDays(inv.paymentIntent.method));
    return {
      expectedLandDate: expected.toISOString().slice(0, 10),
      amount: inv.amount ?? 0,
      label: `${labelBase} (${methodLabel(inv.paymentIntent.method)})`,
      invoiceId: inv.id,
      source: "claimed",
    };
  }
  if (inv.status === "sent" || inv.status === "viewed") {
    if (!inv.dueDate) return undefined;
    return {
      expectedLandDate: inv.dueDate,
      amount: inv.amount ?? 0,
      label: labelBase,
      invoiceId: inv.id,
      source: "sent_due",
    };
  }
  return undefined;
}

function methodLabel(m: PaymentMethod): string {
  switch (m) {
    case "ach": return "ACH";
    case "check": return "check";
    case "venmo": return "Venmo";
    case "zelle": return "Zelle";
    case "cashapp": return "Cash App";
    case "cash": return "cash";
    case "other": return "other";
  }
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 3600 * 1000);
}

async function resolveCustomerName(
  customers: CustomerStore,
  userId: string,
  customerId: string | undefined,
  cache: Map<string, string>,
): Promise<string | undefined> {
  if (!customerId) return undefined;
  if (cache.has(customerId)) return cache.get(customerId);
  try {
    const c = await customers.getOwned(customerId, userId);
    cache.set(customerId, c.name);
    return c.name;
  } catch { return undefined; }
}

async function resolveJobName(
  contracts: ContractStore,
  quotes: QuoteStore,
  userId: string,
  contractId: string | undefined,
  cache: Map<string, string>,
): Promise<string | undefined> {
  if (!contractId) return undefined;
  if (cache.has(contractId)) return cache.get(contractId);
  try {
    const c = await contracts.getOwned(contractId, userId);
    if (!c.quoteId) return undefined;
    const q = await quotes.getOwned(c.quoteId, userId);
    const name = q.jobName?.trim() || q.summary?.trim() || undefined;
    if (name) cache.set(contractId, name);
    return name;
  } catch { return undefined; }
}
