/**
 * Pipeline truth (problems.md P-14 / P-15 / P-36).
 *
 * One classifier for "where does this quote sit in the pipeline":
 *   - a SENT quote is AWAITING until somebody actually signs/accepts — a
 *     draft or merely-sent agreement attached to it changes nothing (P-14);
 *   - sample quotes (EnsureSampleQuote's "onboarding-sample-v1" summary
 *     prefix, or an explicit isSample flag) contribute to NOTHING (P-15);
 *   - money aggregates stay in INTEGER cents end to end, and display
 *     helpers never emit "$0.8k" / "$0.01" / "Vence Sin fecha…" /
 *     "1 activos" artifacts (P-36).
 */

export type PipelineClass = "awaiting" | "won" | "lost" | "draft";

export interface PipelineQuote {
  status?: string;
  sentAt?: string | null;
  acceptedAt?: string | null;
  lostAt?: string | null;
  [key: string]: unknown;
}

export interface PipelineContract {
  quoteId?: string;
  status?: string;
  signedAt?: string | null;
  [key: string]: unknown;
}

export interface AggregateQuote extends PipelineQuote {
  id: string;
  estimatedTotal?: number | null;
  summary?: string | null;
  isSample?: boolean;
}

export interface PipelineAggregate {
  /** Real (non-sample) quotes only. */
  totalQuotes: number;
  draftCount: number;
  awaitingCount: number;
  /** INTEGER cents out with customers (sum of awaiting quotes). */
  awaitingCents: number;
  /** Signed/accepted only — an unsigned agreement is not a win. */
  wonCount: number;
  lostCount: number;
  /** wonCount + lostCount. */
  decidedCount: number;
  /** Signed/accepted only — a sent quote is NOT an active job. */
  activeJobs: number;
}

/** EnsureSampleQuote tags its row via this summary prefix (no flag yet). */
const SAMPLE_SUMMARY_PREFIX = "onboarding-sample";

const WON_STATUSES = new Set(["approved", "accepted", "won"]);
const LOST_STATUSES = new Set(["lost", "declined", "rejected"]);

function contractIsSigned(contract?: PipelineContract | null): boolean {
  if (!contract) return false;
  return contract.status === "signed" || Boolean(contract.signedAt);
}

/**
 * Where a quote sits in the pipeline. Only a signature/acceptance wins;
 * an attached draft/sent agreement leaves a sent quote AWAITING (P-14).
 */
export function classifyQuoteForPipeline(
  quote: PipelineQuote,
  contract?: PipelineContract | null,
): PipelineClass {
  if (quote.acceptedAt) return "won";
  if (WON_STATUSES.has(quote.status ?? "")) return "won";
  if (contractIsSigned(contract)) return "won";
  if (quote.lostAt) return "lost";
  if (LOST_STATUSES.has(quote.status ?? "")) return "lost";
  if (quote.sentAt || quote.status === "sent" || quote.status === "viewed") {
    return "awaiting";
  }
  return "draft";
}

/** Sample quotes (P-15): explicit flag or the onboarding summary tag. */
export function isSampleQuote(
  quote: { summary?: string | null; isSample?: boolean },
): boolean {
  if (quote.isSample === true) return true;
  return (quote.summary ?? "").startsWith(SAMPLE_SUMMARY_PREFIX);
}

/**
 * Aggregate the pipeline over real quotes only. Cents are summed as
 * integers — never as floating dollars (P-36's "$0.01" artifact class).
 */
export function aggregatePipeline(
  quotes: AggregateQuote[],
  contracts: PipelineContract[] = [],
): PipelineAggregate {
  const contractByQuoteId = new Map<string, PipelineContract>();
  for (const c of contracts) {
    if (!c.quoteId) continue;
    const prev = contractByQuoteId.get(c.quoteId);
    // A signed contract wins over any other agreement rows for the quote.
    if (!prev || (!contractIsSigned(prev) && contractIsSigned(c))) {
      contractByQuoteId.set(c.quoteId, c);
    }
  }

  const agg: PipelineAggregate = {
    totalQuotes: 0,
    draftCount: 0,
    awaitingCount: 0,
    awaitingCents: 0,
    wonCount: 0,
    lostCount: 0,
    decidedCount: 0,
    activeJobs: 0,
  };

  for (const q of quotes) {
    if (isSampleQuote(q)) continue; // contributes to NOTHING
    agg.totalQuotes += 1;
    const cls = classifyQuoteForPipeline(q, contractByQuoteId.get(q.id));
    if (cls === "draft") agg.draftCount += 1;
    else if (cls === "awaiting") {
      agg.awaitingCount += 1;
      agg.awaitingCents += Math.round(q.estimatedTotal ?? 0);
    } else if (cls === "won") agg.wonCount += 1;
    else agg.lostCount += 1;
  }

  agg.decidedCount = agg.wonCount + agg.lostCount;
  agg.activeJobs = agg.wonCount; // only a signature creates a job
  return agg;
}

/**
 * Compact money display. Below $1,000 the FULL dollar amount always renders
 * ("$850", never "$0.8k"); stray sub-dollar cents round to "$0" (never
 * "$0.01"). At/above the threshold the amount may compact to a one-decimal
 * "k" figure (85_000¢ → "$850", 1_420_000 → "$1.4k" — the frozen contract).
 */
export function formatMoneyCompact(cents: number): string {
  if (cents < 100_000) return `$${Math.round(cents / 100)}`;
  const compact = (Math.round(cents / 100_000) / 10).toFixed(1);
  return `$${compact.replace(/\.0$/, "")}k`;
}

type Lang = "en" | "es";

const MONTHS: Record<Lang, string[]> = {
  en: [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ],
  es: [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
  ],
};

/** Pure YYYY-MM-DD formatter — no Date construction, no timezone drift. */
function formatDueDate(iso: string, lang: Lang): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return iso.trim();
  const month = MONTHS[lang][Number(m[2]) - 1] ?? m[2];
  const day = Number(m[3]);
  return lang === "es"
    ? `${day} de ${month} de ${m[1]}`
    : `${month} ${day}, ${m[1]}`;
}

/**
 * The invoice due line as ONE phrase. Missing due date → the bare
 * "Sin fecha de vencimiento" / "No due date" — never the
 * "Vence Sin fecha de vencimiento" run-on (P-36). With a date the line
 * leads with the due verb.
 */
export function dueDateLine(
  invoice: { dueDate?: string | null },
  lang: Lang,
): string {
  const due = invoice.dueDate;
  if (!due || !String(due).trim()) {
    return lang === "es" ? "Sin fecha de vencimiento" : "No due date";
  }
  const date = formatDueDate(String(due), lang);
  return lang === "es" ? `Vence ${date}` : `Due ${date}`;
}

/** "1 activo" / "2 activos" (never "1 activos"); en: "{n} active". */
export function activeJobsCountLabel(n: number, lang: Lang): string {
  if (lang === "es") return `${n} activo${n === 1 ? "" : "s"}`;
  return `${n} active`;
}
