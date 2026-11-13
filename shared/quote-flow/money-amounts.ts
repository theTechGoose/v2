/**
 * Every money amount a contractor typed — ONE reader for the client and the
 * server.
 *
 * REQ-445 (demo-loop cycle 3, M20) taught the backend's stated-price module
 * to read "18k", "18 thousand", "18 grand" and a spoken Spanish "18 mil".
 * REQ-575 (demo-loop cycle 4, M3 + M13) moved that reader here: the quick-
 * quote price picker (extractPriceCents) still knew only "$N" and "N
 * dólares", so pair 7's "Ponle precio, no sé, como 18 mil?" opened the picker
 * at $0.00, and the help-me-price cost floor read "~$23k labor … $9.5k
 * cabinets" as $23 + $9.50.
 *
 * A rate ("$65/hr", "$40 a foot", "65 dólares la hora") is still an amount
 * here — flagged `rate`, because it is a price per unit, never an amount of
 * the job; each caller decides what to do with it.
 *
 * Dependency-free: imported by the backend (#quote-flow/), the front-end
 * islands and the Jest unit suite.
 */

/** One money amount in the text: integer cents and where it sits. */
export interface MoneyAmount {
  cents: number;
  start: number;
  end: number;
  /** REQ-575: "$65/hr", "$40 a foot", "$5 per sq ft", "65 dólares la hora" —
   *  a price per hour / day / length / area, not an amount of the job. */
  rate: boolean;
  /** REQ-699 (demo-loop cycle 5, M20): the period a recurring job's price is
   *  stated per — "$180 al mes" / "$180 a month" / "$180/mo" (monthly), "$45 a
   *  week" (weekly), "$90 every 2 weeks" / "quincenal" (biweekly), "$45 por
   *  visita" (visit). Absent for a one-off amount. Still an amount of the job:
   *  it is what each period (or visit) bills. */
  per?: PricePeriod;
}

/** REQ-699: what a recurring job's price is stated per. */
export type PricePeriod = "weekly" | "biweekly" | "monthly" | "visit";

const NUM = String.raw`(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?`;
const CURRENCY = String.raw`(?:d[oó]lares|dollars|usd|bucks|pesos)`;
/** "18k btu", "18 thousand sq ft" — a size or a rating, not money. */
const UNIT_AFTER = String
  .raw`(?!\s*(?:btus?|sq|sf|sqft|square|ft|feet|foot|gal|gallons?|lbs?|pounds?|w|watts?|kw|volts?|amps?|mi|miles?|rpm|gpm|cfm|psi|pies|metros?|m2|galones|libras|units?|unidades|pcs|pieces|tiles|azulejos|ladrillos|bricks)(?![\p{L}]))`;
/** What may follow a bare Spanish "18 mil" for it to be money: the end, a
 *  pause, a currency or a joining word — never "6 mil vapor barrier". */
const MIL_FOLLOW = String
  .raw`(?=\s*(?:$|[.,;:!?)\]…"'”]|(?:${CURRENCY}|y|e|o|u|and|or|por|para|en|total|todo|aprox\w*|m[aá]s|menos|max|m[aá]ximo|tops|plus|but|pero|con|with)(?![\p{L}])))`;

const SCALE: Record<string, number> = {
  k: 1_000,
  mil: 1_000,
  thousand: 1_000,
  grand: 1_000,
  million: 1_000_000,
  millones: 1_000_000,
  "millón": 1_000_000,
  millon: 1_000_000,
};

const MONEY_PATTERNS: RegExp[] = [
  // "$2,585", "$18k", "$18 mil", "$18.5k", "$18,000 dollars"
  new RegExp(
    String
      .raw`\$\s?${NUM}(?:\s?(k|mil|thousand|grand|million|millones|mill[oó]n)(?![\p{L}\d]))?(?:\s+${CURRENCY}(?![\p{L}]))?`,
    "giu",
  ),
  // "18k", "18 thousand", "18 grand" — not "12k btu"
  new RegExp(
    String
      .raw`(?<![\p{L}\d$.,])${NUM}\s?(k|thousand|grand|million|millones|mill[oó]n)(?![\p{L}\d])${UNIT_AFTER}(?:\s+${CURRENCY}(?![\p{L}]))?`,
    "giu",
  ),
  // "18 mil", "18 mil dólares" — Spanish thousands, as money only
  new RegExp(
    String
      .raw`(?<![\p{L}\d$.,])${NUM}\s?(mil)(?![\p{L}])${MIL_FOLLOW}(?:\s+${CURRENCY}(?![\p{L}]))?`,
    "giu",
  ),
  // "4500 dollars", "4,500 dólares"
  new RegExp(
    String.raw`(?<![\p{L}\d$.,])${NUM}\s*${CURRENCY}(?![\p{L}])`,
    "giu",
  ),
];

/** REQ-575: what follows a rate's amount — "/hr", "/sq ft", " an hour",
 *  " a foot", " per linear foot", " por hora", " la hora", " el pie". A
 *  week or a month is not one: "$120 a month" is a recurring job's price. */
const RATE_AFTER =
  /^\s*(?:\/\s*|(?:a|an|per|each|por|la|el|al|the)\s+)(?:h|hr|hrs|hour|hours|day|days|d[ií]a|d[ií]as|hora|horas|ft|foot|feet|sq|sqft|sf|square|lf|lin(?:ear)?|yard|yd|yds|pie|pies|metro|metros|m2)(?![\p{L}])/iu;

/** REQ-699 (demo-loop cycle 5, M20): what follows a recurring job's price —
 *  pair 2's "$180 al mes", "$180 a month", "$180/mo", "$45 a week", "$90
 *  every 2 weeks", "$90 quincenal", "$45 por visita". Checked in order: every
 *  2 weeks before every week. */
const PER_AFTER: [RegExp, PricePeriod][] = [
  [
    /^\s*(?:\/\s*2\s*(?:wks?|weeks?|semanas)|(?:every|each|per)\s+(?:2|two|other)\s+weeks?|cada\s+(?:2|dos)\s+semanas|cada\s+(?:15|quince)\s+d[ií]as|bi-?weekly|quincenal(?:es)?|quincenalmente)(?![\p{L}])/iu,
    "biweekly",
  ],
  [
    /^\s*(?:\/\s*(?:wk|wks|week|semana)|(?:a|an|per|each|every|por|cada|a\s+la|la)\s+(?:week|semana)|weekly|semanal(?:es)?|semanalmente)(?![\p{L}])/iu,
    "weekly",
  ],
  [
    /^\s*(?:\/\s*(?:mo|mos|mth|month|mes)|(?:a|an|per|each|every|por|cada|al|el)\s+(?:month|mo|mes)|monthly|mensual(?:es)?|mensualmente)(?![\p{L}])/iu,
    "monthly",
  ],
  [
    /^\s*(?:\/\s*visit[a]?|(?:a|per|each|every|por|cada|la)\s+(?:visit|visita))(?![\p{L}])/iu,
    "visit",
  ],
];

/** REQ-699: the period the words right after an amount state, if any. */
function perAfter(after: string): PricePeriod | undefined {
  return PER_AFTER.find(([re]) => re.test(after))?.[1];
}

function centsOf(whole: string, frac: string | undefined, scale?: string) {
  const n = Number(`${whole.replace(/,/g, "")}${frac ? `.${frac}` : ""}`);
  const k = scale ? SCALE[scale.toLowerCase()] ?? 1 : 1;
  return Number.isFinite(n) ? Math.round(n * k * 100) : 0;
}

/** Every money amount typed — "$2,585", "$18,000", "$18k", "$18 mil", "18k",
 *  "18 thousand", "18 grand", "4500 dollars", "18 mil dólares" and a spoken
 *  Spanish "18 mil" — each once, in order. Never "6 mil vapor barrier" or a
 *  "12k btu" unit. A rate is flagged (REQ-575); a recurring price carries
 *  the period it is stated per (REQ-699). */
export function moneyAmounts(text: string): MoneyAmount[] {
  const s = text ?? "";
  const found: MoneyAmount[] = [];
  for (const re of MONEY_PATTERNS) {
    for (const m of s.matchAll(re)) {
      const start = m.index!;
      const end = start + m[0].length;
      if (found.some((f) => start < f.end && end > f.start)) continue;
      const cents = centsOf(m[1], m[2], m[3]);
      if (cents > 0) {
        const after = s.slice(end);
        const rate = RATE_AFTER.test(after);
        const per = rate ? undefined : perAfter(after); // REQ-699
        found.push({ cents, start, end, rate, ...(per ? { per } : {}) });
      }
    }
  }
  return found.sort((a, b) => a.start - b.start);
}
