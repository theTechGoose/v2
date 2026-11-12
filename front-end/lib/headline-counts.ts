/**
 * REQ-243 — the numbers a page's headline shows are derived from the same
 * fields its list shows (demo issue quote-invoice-money-m3: "1 open quote
 * across 0 clients" over Maria Lopez's card, "All clear" over a waiting
 * claim, a stale /invoices hero after "Payment received").
 */

import { DRAFT_TRACK_STAGES, OUT_STAGES, type Stage } from "./quotes-seed.ts";

/** A card's client line when there is none to show (QuotesPage's fallback). */
const NO_CLIENT = "—";

/** How many distinct clients the open quotes belong to — read from the same
 *  field the card shows: the linked customer when there is one, else the
 *  name the card displays. Placeholder ("—") or blank names count for
 *  nobody, so two unlinked quotes never become one phantom client (#31). */
export function countOpenClients(
  open: ReadonlyArray<
    { customerId?: string | null; client?: string | null }
  >,
): number {
  const keys = new Set<string>();
  for (const q of open) {
    if (q.customerId) {
      keys.add(`id:${q.customerId}`);
      continue;
    }
    const name = (q.client ?? "").trim().replace(/\s+/g, " ").toLowerCase();
    if (name && name !== NO_CLIENT) keys.add(`name:${name}`);
  }
  return keys.size;
}

/** A /quotes track: the real quotes it counts, and the badged onboarding
 *  sample it shows besides (UX-17 / P-15 — the sample counts in no
 *  aggregate, but the header says it is there). REQ-360 (demo-loop cycle 1,
 *  m11): every track reads this — the sample is a draft since REQ-256, and
 *  the Drafting track said "0 quotes" over its card. */
export function sampleTrackCounts(
  cards: ReadonlyArray<{ isSample?: boolean }>,
): { real: number; sample: number } {
  const sample = cards.filter((c) => c.isSample === true).length;
  return { real: cards.length - sample, sample };
}

/** "Out for response" track counts (REQ-243's name for the same rule). */
export const outTrackCounts = sampleTrackCounts;

export type InvoicesHeroMode =
  | "empty"
  | "claimed"
  | "scheduled"
  | "clear"
  | "thisWeek"
  | "nextWeek"
  | "outstanding";

/** Which headline the /invoices hero shows. A payment the customer says
 *  they made and the contractor has not confirmed is pending work — it is
 *  never "All clear", and when nothing else is owed it IS the headline.
 *
 *  REQ-317 (demo-loop cycle 1, M33): a `scheduled` installment of a signed
 *  agreement (the balance of a 50/50 job after the deposit is paid) is money
 *  still to bill. The forecast leaves it out of the forward window on
 *  purpose (roadmap §J), so it is fed here as its own input — "All clear —
 *  nothing outstanding" is only for the state with no unpaid installment. */
export function invoicesHeroMode(input: {
  totalInvoiceCount: number;
  /** overdue + out (money still owed, no claim yet) */
  outstandingCount: number;
  /** invoices in the "claimed" stage */
  claimedCount: number;
  /** invoices in the "scheduled" stage (unsent installments) */
  scheduledCount?: number;
  /** the money those scheduled installments carry */
  scheduledCents?: number;
  forecast?: {
    thisWeekCents: number;
    nextWeekCents: number;
    atRiskCents: number;
  };
}): InvoicesHeroMode {
  const { totalInvoiceCount, outstandingCount, claimedCount, forecast } = input;
  const scheduledCents = input.scheduledCents ?? 0;
  if (totalInvoiceCount === 0) return "empty";
  if (outstandingCount === 0 && claimedCount > 0) return "claimed";
  const haveForecast = !!forecast &&
    (forecast.thisWeekCents > 0 || forecast.nextWeekCents > 0 ||
      forecast.atRiskCents > 0);
  if (outstandingCount === 0 && !haveForecast && scheduledCents > 0) {
    return "scheduled";
  }
  if (outstandingCount === 0 && !haveForecast) return "clear";
  if (haveForecast && forecast!.thisWeekCents > 0) return "thisWeek";
  if (haveForecast && forecast!.nextWeekCents > 0) return "nextWeek";
  return "outstanding";
}

/** REQ-411 (demo-loop cycle 2, m34): the label before the hero's next
 *  scheduled date. The only, after-completion bill of a "Payment upon
 *  completion" job (one installment of one) is not a "Next installment" — it
 *  "Bills on completion". A split's later installment keeps the old label. */
export function scheduledHeroSubKey(
  next: { installmentTotal?: number } | undefined,
): "invoicesPage.sub.billsOnCompletion" | "invoicesPage.sub.scheduledNext" {
  return next?.installmentTotal === 1
    ? "invoicesPage.sub.billsOnCompletion"
    : "invoicesPage.sub.scheduledNext";
}

/** Re-pull everything the /invoices page derives its headline from: the
 *  list AND the forecast. Each half fails on its own (a failed half comes
 *  back `undefined` so the caller keeps what it had). */
export async function reloadInvoiceData<I, F>(load: {
  invoices: () => Promise<I>;
  forecast: () => Promise<F | undefined>;
}): Promise<{ invoices: I | undefined; forecast: F | undefined }> {
  const [invoices, forecast] = await Promise.all([
    load.invoices().catch(() => undefined),
    load.forecast().catch(() => undefined),
  ]);
  return { invoices, forecast };
}

export type QuotesHeroMode =
  | "empty"
  | "settled"
  | "draftsOnly"
  | "warm"
  | "stale";

/** REQ-481 (demo-loop cycle 3, m10): which headline the /quotes hero shows.
 *  "Nothing sent yet — N drafts ready" is only for an account with NO
 *  history: once a quote was signed or lost, drafts beside it are a note
 *  under the settled headline, never "nothing sent". One rule for
 *  quotesHeroNumbers and the QuotesHero component. */
export function quotesHeroMode(
  { total, out, stale, drafts, decided }: {
    total: number;
    out: number;
    stale: number;
    drafts: number;
    decided: number;
  },
): QuotesHeroMode {
  if (total === 0) return "empty";
  if (out > 0) return stale > 0 ? "stale" : "warm";
  if (drafts > 0 && decided === 0) return "draftsOnly";
  return "settled";
}

/** REQ-404 (demo-loop cycle 2, m13): the /quotes hero's numbers. The money
 *  "sitting with clients" and the "N open quotes across M clients" line count
 *  only quotes that actually went out (OUT_STAGES); unsent drafts are
 *  reported apart ("$X drafting"), and when drafts are all there is the
 *  headline says nothing has been sent yet. Pass REAL quotes only (P-15).
 *  REQ-481: `decidedCount` (won + lost) keeps a signed quote from reading
 *  "Nothing sent yet"; `undeliveredCount` is the part of the drafts whose
 *  send reached nobody — the hero says "Not delivered", not "draft". */
export function quotesHeroNumbers(
  real: ReadonlyArray<
    {
      stage: string;
      value: number;
      customerId?: string | null;
      client?: string | null;
    }
  >,
): {
  mode: QuotesHeroMode;
  outCount: number;
  outTotal: number;
  outClients: number;
  staleCount: number;
  draftCount: number;
  draftTotal: number;
  decidedCount: number;
  undeliveredCount: number;
  undeliveredTotal: number;
} {
  const out = real.filter((q) => OUT_STAGES.includes(q.stage as Stage));
  const drafts = real.filter((q) =>
    DRAFT_TRACK_STAGES.includes(q.stage as Stage)
  );
  const sum = (xs: typeof real) => xs.reduce((a, q) => a + (q.value || 0), 0);
  const staleCount = out.filter((q) => q.stage === "stale").length;
  const undelivered = drafts.filter((q) => q.stage === "undelivered");
  const decidedCount =
    real.filter((q) => q.stage === "won" || q.stage === "lost").length;
  const mode = quotesHeroMode({
    total: real.length,
    out: out.length,
    stale: staleCount,
    drafts: drafts.length,
    decided: decidedCount,
  });
  return {
    mode,
    outCount: out.length,
    outTotal: sum(out),
    outClients: countOpenClients(out),
    staleCount,
    draftCount: drafts.length,
    draftTotal: sum(drafts),
    decidedCount,
    undeliveredCount: undelivered.length,
    undeliveredTotal: sum(undelivered),
  };
}

/** REQ-481 (demo-loop cycle 3, m10): the hero's change-order line. A
 *  change order waiting on the customer is something waiting on a client —
 *  "CO-001 is waiting on Karen." — so "Nothing is waiting" is never shown
 *  over one. Null when none is pending. */
export function heroCoWaiting(
  pending: ReadonlyArray<{ number: string; client: string }>,
): {
  key: "quotesHero.coWaiting.one" | "quotesHero.coWaiting.other";
  vars: { number: string; client: string; n: number };
} | null {
  if (pending.length === 0) return null;
  const first = pending[0];
  return {
    key: pending.length === 1
      ? "quotesHero.coWaiting.one"
      : "quotesHero.coWaiting.other",
    vars: { number: first.number, client: first.client, n: pending.length },
  };
}

/** REQ-481 (demo-loop cycle 3, M28): a /quotes card's money is the
 *  agreement — the quote plus its approved change orders (what the quote
 *  ledger calls the agreement total), not the bare quote. */
export function quoteCardValue(
  c: { estimatedTotal?: number; approvedChangeOrdersCents?: number },
): number {
  return Math.max(
    0,
    (c.estimatedTotal ?? 0) + (c.approvedChangeOrdersCents ?? 0),
  );
}

/** REQ-481 (demo-loop cycle 3, m10): the /invoices Drafting KPI's sub-line.
 *  With no draft open but an installment scheduled, it names the scheduled
 *  one instead of "no drafts open" beside a row that reads Scheduled. */
export function draftingKpiSub(
  draftingCount: number,
  scheduledCount: number,
): { key: string; n: number } {
  if (draftingCount > 0) {
    return { key: "invoicesPage.kpi.draftingSub", n: draftingCount };
  }
  if (scheduledCount > 0) {
    return {
      key: `invoicesPage.kpi.draftingSubScheduled.${
        scheduledCount === 1 ? "one" : "other"
      }`,
      n: scheduledCount,
    };
  }
  return { key: "invoicesPage.kpi.draftingSubEmpty", n: 0 };
}

/** REQ-404 (m13): the dashboard's "Quotes awaiting signature" empty line.
 *  The count stays sent-only (REQ-320 — an undelivered quote is not
 *  pending), but a ready-to-send draft is named instead of "No quotes out
 *  yet. Draft one". */
export function dashQuotesEmpty(
  { draftCount, hasDecidedHistory }: {
    draftCount: number;
    hasDecidedHistory: boolean;
  },
): { key: string; n: number } {
  if (draftCount > 0) {
    return {
      key: `quotesAwaiting.emptyDrafts.${draftCount === 1 ? "one" : "other"}`,
      n: draftCount,
    };
  }
  return {
    key: hasDecidedHistory
      ? "quotesAwaiting.emptyDecided"
      : "quotesAwaiting.empty",
    n: 0,
  };
}
