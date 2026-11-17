import { Injectable } from "#danet/core";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import type { Invoice, PaymentMethod } from "@paperwork/dto/invoice.ts";
import { docNumberOf } from "#documents/numbering.ts";

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
  /** Total expected to land this calendar week: today through Sunday
   *  (REQ-484). */
  thisWeekCents: number;
  /** Detail entries within this week. Sorted by expectedLandDate. */
  thisWeek: ForecastEntry[];
  /** Total expected next week — the Monday–Sunday after this one. Used as
   *  fallback copy when the current week is quiet. */
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
 *   - status=`paid`     → expectedLandDate = paidAt (already landed:
 *                         `forecastEntryFor` records it as a `paid` source,
 *                         but `run` never counts it as money to come).
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
    private quotes: QuoteStore,
  ) {}

  async run(userId: string, now: Date = new Date()): Promise<ForecastResult> {
    const all = await this.invoices.listByUser(userId);
    // REQ-243: windows are whole days (land dates are days). Comparing the
    // land day's noon against the current instant dropped a same-day claim
    // made in the afternoon out of "this week" — and the hero read "All
    // clear" over it.
    // REQ-484 (demo m12): "this week" is the calendar week — today through
    // Sunday — and "next week" is the Monday–Sunday after it. The old rolling
    // today..today+7 window was 8 days and called next Thursday "this week".
    const today = isoDay(now);
    const thisWeekEnd = isoDay(addDays(now, daysUntilSunday(now)));
    const nextWeekEnd = isoDay(addDays(now, daysUntilSunday(now) + 7));

    const thisWeek: ForecastEntry[] = [];
    const nextWeek: ForecastEntry[] = [];
    const atRisk: ForecastEntry[] = [];

    const customerCache = new Map<string, string>();
    const jobNameCache = new Map<string, string>();

    for (const inv of all) {
      if (inv.status === "void" || inv.status === "draft") continue;

      const customer = await resolveCustomerName(
        this.customers,
        userId,
        inv.customerId,
        customerCache,
      );
      const job = await resolveJobName(
        this.quotes,
        userId,
        inv.quoteId,
        jobNameCache,
      );
      const labelBase = forecastLabelBase(customer, inv, job);

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
      // REQ-243: a paid invoice has landed — it is not money still expected.
      if (!entry || entry.source === "paid") continue;
      const day = entry.expectedLandDate;
      if (day >= today && day <= thisWeekEnd) {
        thisWeek.push(entry);
      } else if (day > thisWeekEnd && day <= nextWeekEnd) {
        nextWeek.push(entry);
      }
    }

    thisWeek.sort((a, b) =>
      a.expectedLandDate.localeCompare(b.expectedLandDate)
    );
    nextWeek.sort((a, b) =>
      a.expectedLandDate.localeCompare(b.expectedLandDate)
    );
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
    case "ach":
      return 2;
    case "check":
      return 5;
    case "venmo":
    case "zelle":
    case "cashapp":
    case "cash":
      return 0;
    case "other":
    default:
      return 3;
  }
}

/**
 * REQ-696 (demo-loop cycle 5, M22) — the name an entry is shown under: the
 * customer, else the typed bill-to (its name, then business), else the job
 * (the quote's, the invoice's own, or its name in any language), else the
 * invoice's own number. Never an English literal: the old `"Invoice"`
 * fallback read "jue: Invoice $200" on the Spanish hero.
 */
export function forecastLabelBase(
  customer: string | undefined,
  inv: Pick<Invoice, "billTo" | "jobName" | "number" | "id"> & {
    jobNameByLang?: Record<string, string>;
  },
  job: string | undefined,
): string {
  const pick = (...xs: Array<string | undefined>) =>
    xs.map((x) => x?.trim()).find((x) => !!x);
  return pick(
    customer,
    inv.billTo?.name,
    inv.billTo?.businessName,
    job,
    inv.jobName,
    ...Object.values(inv.jobNameByLang ?? {}),
  ) ?? docNumberOf(inv);
}

export function forecastEntryFor(
  inv: Invoice,
  labelBase: string,
): ForecastEntry | undefined {
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
    const expected = addDays(
      claimedAt,
      settlementOffsetDays(inv.paymentIntent.method),
    );
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
    case "ach":
      return "ACH";
    case "check":
      return "check";
    case "venmo":
      return "Venmo";
    case "zelle":
      return "Zelle";
    case "cashapp":
      return "Cash App";
    case "paypal":
      return "PayPal";
    case "cash":
      return "cash";
    case "card":
      return "card";
    case "other":
      return "other";
  }
}

/** YYYY-MM-DD (UTC) — the same form as every expectedLandDate. */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Days from `d` to the Sunday that closes its (Monday–Sunday) week; 0 on
 *  a Sunday. UTC, like isoDay. */
function daysUntilSunday(d: Date): number {
  return (7 - d.getUTCDay()) % 7;
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
  } catch {
    return undefined;
  }
}

async function resolveJobName(
  quotes: QuoteStore,
  userId: string,
  quoteId: string | undefined,
  cache: Map<string, string>,
): Promise<string | undefined> {
  if (!quoteId) return undefined;
  if (cache.has(quoteId)) return cache.get(quoteId);
  try {
    const q = await quotes.getOwned(quoteId, userId);
    const name = q.jobName?.trim() || q.summary?.trim() || undefined;
    if (name) cache.set(quoteId, name);
    return name;
  } catch {
    return undefined;
  }
}
