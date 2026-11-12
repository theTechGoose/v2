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
  /** REQ-680 (demo-loop cycle 5, M25): "-500 dollars", "-$500", "$-500",
   *  "minus $500" — the contractor typed a negative amount. NUM has no sign,
   *  so the amount is still read as 500; this flag says it was negative. */
  negative: boolean;
}

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

/** REQ-680: a sign glued to the amount — "-500", "-$500", "$-500" — not a
 *  range's dash ("$3,000-$4,000", "$3,000 - $4,000") or a hyphenated word
 *  ("all-in $18,500"); or "minus" / "negative" / "negativo" right before it. */
const NEGATIVE_BEFORE =
  /(?:(?:^|[^\p{L}\d.,])[-\u2212]\$?|(?:^|[^\p{L}])(?:minus|negative|negativo)\s+\$?\s?)$/iu;

function centsOf(whole: string, frac: string | undefined, scale?: string) {
  const n = Number(`${whole.replace(/,/g, "")}${frac ? `.${frac}` : ""}`);
  const k = scale ? SCALE[scale.toLowerCase()] ?? 1 : 1;
  return Number.isFinite(n) ? Math.round(n * k * 100) : 0;
}

/** Every money amount typed — "$2,585", "$18,000", "$18k", "$18 mil", "18k",
 *  "18 thousand", "18 grand", "4500 dollars", "18 mil dólares" and a spoken
 *  Spanish "18 mil" — each once, in order. Never "6 mil vapor barrier" or a
 *  "12k btu" unit. A rate is flagged (REQ-575), and so is a negative amount
 *  (REQ-680). */
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
        found.push({
          cents,
          start,
          end,
          rate: RATE_AFTER.test(s.slice(end)),
          negative: NEGATIVE_BEFORE.test(
            s.slice(Math.max(0, start - 16), start),
          ),
        });
      }
    }
  }
  return found.sort((a, b) => a.start - b.start);
}
