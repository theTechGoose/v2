/**
 * REQ-243 — the numbers a page's headline shows are derived from the same
 * fields its list shows (demo issue quote-invoice-money-m3: "1 open quote
 * across 0 clients" over Maria Lopez's card, "All clear" over a waiting
 * claim, a stale /invoices hero after "Payment received").
 */

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
  | "clear"
  | "thisWeek"
  | "nextWeek"
  | "outstanding";

/** Which headline the /invoices hero shows. A payment the customer says
 *  they made and the contractor has not confirmed is pending work — it is
 *  never "All clear", and when nothing else is owed it IS the headline. */
export function invoicesHeroMode(input: {
  totalInvoiceCount: number;
  /** overdue + out (money still owed, no claim yet) */
  outstandingCount: number;
  /** invoices in the "claimed" stage */
  claimedCount: number;
  forecast?: {
    thisWeekCents: number;
    nextWeekCents: number;
    atRiskCents: number;
  };
}): InvoicesHeroMode {
  const { totalInvoiceCount, outstandingCount, claimedCount, forecast } = input;
  if (totalInvoiceCount === 0) return "empty";
  if (outstandingCount === 0 && claimedCount > 0) return "claimed";
  const haveForecast = !!forecast &&
    (forecast.thisWeekCents > 0 || forecast.nextWeekCents > 0 ||
      forecast.atRiskCents > 0);
  if (outstandingCount === 0 && !haveForecast) return "clear";
  if (haveForecast && forecast!.thisWeekCents > 0) return "thisWeek";
  if (haveForecast && forecast!.nextWeekCents > 0) return "nextWeek";
  return "outstanding";
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
