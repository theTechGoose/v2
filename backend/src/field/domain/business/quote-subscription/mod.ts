/**
 * REQ-699 (demo-loop cycle 5, M20) — a signed quote with a recurring payment
 * term ("Monthly · $180/mo", shared/quote-flow/recurring-billing.ts) becomes
 * ONE Field subscription that bills each period: the quote's customer, its
 * job address (else the customer's), one task type named after the job at the
 * period's amount, the cadence, the start day the terms name (never before
 * the signing day) and the optional last day. Pure — FieldQuoteSubscriptions
 * writes it.
 *
 * `subscriptionBilling` reads a quote's subscription back the way the quote
 * said it — "Monthly · $180/mo" / "Mensual · $180/mes" — for Field →
 * Subscriptions and the customer card.
 */
import {
  type RecurringCadence,
  recurringFromTerms,
  type RecurringTerm,
  recurringTermText,
} from "#quote-flow/recurring-billing.ts";
import { startDayFromTerms } from "#quote-flow/completion-schedule.ts";
import {
  daysOf,
  intervalOf,
  monthDaysOf,
} from "@field/domain/business/schedule/mod.ts";
import type { Cadence, Subscription } from "@field/dto/field.ts";

/** what of a quote the subscription is made from */
export interface QuoteForSubscription {
  id: string;
  number?: string;
  customerId?: string;
  terms?: { stepId: string; label?: string; value: string }[];
  startDate?: string;
  serviceAddress?: string;
  jobName?: string;
  summary?: string;
}

export interface SubscriptionPlan {
  quoteId: string;
  quoteNumber?: string;
  customerId: string;
  /** the job address, else the customer's; "" when neither is known */
  address: string;
  /** the job, as the contractor named it — the subscription's one task type */
  taskTypeName: string;
  /** what each period bills */
  priceCents: number;
  cadence: Cadence;
  /** weekly = 1, every 2 weeks = 2; unset for monthly */
  intervalWeeks?: number;
  startDate: string;
  endDate?: string;
  recurring: RecurringTerm;
}

const said = (s: string | undefined) => s?.trim() || undefined;

/** The subscription a signed quote stands for; null when its payment term is
 *  not recurring or it has no customer to bill. `today` is the field's day. */
export function subscriptionPlan(
  quote: QuoteForSubscription,
  opts: { today: string; customerAddress?: string },
): SubscriptionPlan | null {
  const recurring = recurringFromTerms(quote.terms);
  if (!recurring || !quote.customerId) return null;
  const startDate = startDayFromTerms({
    terms: quote.terms,
    startDate: quote.startDate,
    today: new Date(`${opts.today}T00:00:00Z`),
  });
  return {
    quoteId: quote.id,
    ...(quote.number ? { quoteNumber: quote.number } : {}),
    customerId: quote.customerId,
    address: said(quote.serviceAddress) ?? said(opts.customerAddress) ?? "",
    taskTypeName: said(quote.jobName) ?? said(quote.summary) ?? "Service",
    priceCents: recurring.amountCents,
    cadence: recurring.cadence,
    ...(recurring.cadence === "monthly"
      ? {}
      : { intervalWeeks: recurring.cadence === "biweekly" ? 2 : 1 }),
    startDate,
    ...(recurring.endDate ? { endDate: recurring.endDate } : {}),
    recurring,
  };
}

/** the cadence a subscription's schedule still is, if a recurring term can say it */
function cadenceOf(s: Subscription): RecurringCadence | null {
  if (s.cadence === "monthly") return "monthly";
  const n = intervalOf(s);
  return n === 1 ? "weekly" : n === 2 ? "biweekly" : null;
}

/** A quote's subscription in the quote's words, en + es — every visit of a
 *  period at its items' prices. Undefined for a subscription made by hand
 *  (its schedule text says it) or one whose schedule no cadence can say. */
export function subscriptionBilling(
  s: Subscription,
): { en: string; es: string } | undefined {
  if (!s.quoteId || !s.items.length) return undefined;
  const cadence = cadenceOf(s);
  if (!cadence) return undefined;
  const visits = cadence === "monthly"
    ? monthDaysOf(s).length
    : daysOf(s).length;
  const perVisit = s.items.reduce((sum, i) => sum + i.priceCents, 0);
  const term: RecurringTerm = {
    cadence,
    amountCents: perVisit * visits,
    ...(s.endDate ? { endDate: s.endDate } : {}),
  };
  return {
    en: recurringTermText(term, "en"),
    es: recurringTermText(term, "es"),
  };
}
