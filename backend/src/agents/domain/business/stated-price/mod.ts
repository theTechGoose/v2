/**
 * REQ-445 (demo-loop cycle 3, B2 + M20) — the price the contractor states for
 * the WHOLE job, and the checks a chat-drafted quote gets before it is saved.
 *
 * B2: on a $2,585 master-bath draft the contractor typed "…$2,585 for a whole
 * master bath?? … make it around $18,000 and add the shower bench and mold
 * remediation allowance". REQ-377's reader gives up on two dollar amounts and
 * leaves open drafts to the model anyway, so gpt-4o-mini's create_quote was
 * saved as it came: the shower line at $18,000, every other line ×10, a
 * $5,000 bench and a $30,000 mold allowance — $71,050.
 *
 * M20: the job message ended "Precio? tú dime, yo pienso como 18 mil" and was
 * drafted at $2,585. No reader knew a spoken "18 mil", and REQ-382's
 * bathroom-remodel floor only guarded the help-me-price tiers.
 *
 * So: the stated total is read here (any number of other amounts beside it)
 * and handed to the model; the model's lines are checked against it, against
 * a jump of more than 3× with prices nobody typed, and against the job's
 * plausibility floor. A miss is re-asked once; then the code fixes the lines
 * itself — or, for an unexplained jump, asks the contractor.
 */
import { type Lang, t } from "@core/i18n/mod.ts";
import {
  lineKey,
  totalOf,
} from "@agents/domain/business/quote-line-revision/mod.ts";
import { jobNameInSentence } from "#quote-flow/job-name.ts";
import {
  describeJobSize,
  plausibilityFloorCents,
} from "@agents/domain/business/price-floor/mod.ts";
import { type MoneyAmount, moneyAmounts } from "#quote-flow/money-amounts.ts";

// ---------------------------------------------------------------------------
// Money in the text
// ---------------------------------------------------------------------------

// REQ-575 (demo-loop cycle 4, M3 + M13): the reader lives in shared/quote-flow
// now, so the client's quick-quote price picker and the help-me-price cost
// floor read "18k" / "18 mil" / "18 thousand" exactly as this module does.
export { type MoneyAmount, moneyAmounts };

// ---------------------------------------------------------------------------
// The stated total
// ---------------------------------------------------------------------------

/** Lower-case, accents and punctuation gone — the cue grammar's input. */
function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[~≈]/g, " ~ ")
    .replace(/[^a-z0-9'~ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const alt = (xs: string[]) => `(?:${xs.join("|")})`;

/** Words with no subject of their own: conversation, a complaint about the
 *  price, "you tell me". A line's name is never one of them. */
const FILLER = alt([
  "no",
  "nah",
  "nope",
  "ok(?:ay)?",
  "k",
  "so",
  "yeah",
  "yea",
  "yes",
  "yep",
  "well",
  "but",
  "and",
  "just",
  "h?mm+",
  "um+",
  "uh+",
  "honestly",
  "actually",
  "really",
  "seriously",
  "please",
  "pls",
  "plz",
  "lol",
  "haha",
  "man",
  "dude",
  "bro",
  "look",
  "listen",
  "hey",
  "wow",
  "ugh",
  "idk",
  "i mean",
  "come on",
  "cmon",
  "oh",
  "ah",
  "then",
  "now",
  "instead",
  "rather",
  "sorry",
  "you know",
  "(?:you )?tell me",
  "right",
  "again",
  "i guess",
  "maybe",
  "probably",
  "perhaps",
  "for a whole (?:master )?(?:bath(?:room)?|kitchen|job|remodel)",
  // a complaint about the price
  "(?:(?:that|it|this)(?:'s| is|s) |thats |its )?(?:(?:way|much|far|a bit|a little|kinda|pretty|really|so|very|super) )*(?:too )?(?:low|cheap|high|expensive|much|little|off|wrong|short|crazy|insane|ridiculous|nuts)",
  "(?:(?:that|it)(?:'s| is|s) |thats |its )?not (?:enough|right|even close|close)",
  "nowhere near(?: enough| right)?",
  // Spanish
  "si",
  "pues",
  "bueno",
  "pero",
  "y",
  "e",
  "entonces",
  "mira",
  "oye",
  "oiga",
  "ya",
  "la verdad",
  "a ver",
  "vale",
  "dale",
  "eh",
  "ay",
  "uy",
  "tu dime",
  "dime",
  "(?:tu )?me dices",
  "digamos",
  "o sea",
  "osea",
  "mejor",
  "ahora",
  "por favor",
  "porfa",
  "en serio",
  "de verdad",
  "jaja+",
  "(?:eso |esto |el precio |la cotizacion |el total )?(?:esta |es |quedo |salio |sale )?(?:(?:muy|demasiado|super|bien|re|algo) )*(?:bajo|bajito|barato|poco|alto|caro|mucho|corto)",
  "no (?:alcanza|da|sale|es suficiente)",
]);

/** A phrase that sets the price of the job ("make it", "the total is",
 *  "yo pienso", "ponle", "que sea"). */
const LEAD = alt([
  "make (?:it|this|the (?:whole )?(?:thing|job|quote|price|total|project|estimate|bid))",
  "call it",
  "(?:price|quote|bill|bid) it(?: at)?",
  "do (?:it|the (?:whole )?(?:job|thing)) (?:for|at)",
  "(?:bring|bump|raise|lower|drop|take|move|get|push|knock) (?:it|the (?:total|price|quote|whole thing)) (?:up |down )?to",
  "set (?:it|the (?:total|price|quote)) (?:at|to)",
  "put (?:it|the (?:total|price|quote)) at",
  "keep (?:it|the (?:total|price|quote)) (?:at|around|near|about)",
  "(?:it|this|the (?:job|quote|total|price|whole thing)) (?:should|needs to|has to|ought to|must|would|will|could) (?:be|cost|come to|come out to|run|land at)",
  "(?:it|this)(?:'d|'ll|d|ll) (?:be|cost|run|come to)",
  "(?:it|that|this)(?:'s| is|s)",
  "its",
  "thats",
  "should (?:be|cost)",
  "(?:needs|has|ought) to be",
  "(?:it's |its |it is )?(?:gonna|going to) be",
  "(?:the |my |our |a |new |the new )?(?:total(?: price)?|price|budget|number|bid|estimate)(?: (?:should be|needs to be|has to be|is|of|will be|would be|at|to|comes to|i want|i'm thinking|im thinking|i think))?",
  "(?:i|we)(?:'d| would| will|'ll|d)? (?:charge|bill|quote|say|go with|ask for|want|need)(?: it)?(?: (?:at|for|to be))?",
  "(?:i'm|im|i am|i was|was|we're|were|we are) thinking(?: of| about| like)?",
  "thinking(?: of| about| like)?",
  "i think(?: it's| its| it should be| it's like)?",
  "i(?:'d| would|d) (?:say|guess|go with)",
  "i (?:say|figure|figured)",
  "(?:let's|lets) (?:do|say|go with)",
  "go with",
  "say",
  "charge(?: (?:him|her|them|the (?:customer|client|homeowner)))?",
  // Spanish
  "(?:yo )?(?:pienso|pensaba|pense|creo|calculo|calcule|diria|digo|estimo|estimaba|quiero|queria)(?: que)?(?: (?:es|son|seria|serian|sale|salen|cuesta|cuestan|va|vale|valdria))?",
  "(?:hazlo|hazla|ponle|ponlo|ponla|pon el total|pon|dejalo|dejala|deja|subelo|subela|sube|cobrale|cobrales|cobrarle|cobrar|cobro|le cobro|les cobro|cobraria|le cobraria|cotizalo|cotizala|cotiza)(?: (?:en|a|por|de))?",
  "que (?:sea|sean|quede|salga|cueste|cuesten)(?: en)?",
  "(?:sale|salen|seria|serian|es|son|va a ser|deberia ser|deberia costar|tiene que ser|tiene que costar|debe ser|debe costar|vale|valdria|costaria)(?: en)?",
  "(?:el |mi |un |nuevo |el nuevo )?(?:total|precio|presupuesto|monto)(?: (?:es|seria|debe ser|tiene que ser|queda en|sale en|final|total|sera))?(?: (?:de|en))?",
  "en total",
]);

/** How sure the price is: "around", "more like", "como", "unos", "~". */
const APPROX = alt([
  "around",
  "about",
  "roughly",
  "approximately",
  "approx",
  "abt",
  "like",
  "more like",
  "closer to",
  "close to",
  "somewhere (?:around|near)",
  "something like",
  "right around",
  "just about",
  "in the ballpark of",
  "ballpark",
  "~",
  "como",
  "unos",
  "unas",
  "alrededor de",
  "mas o menos",
  "aproximadamente",
  "cerca de",
  "por ahi de",
  "algo asi como",
  "algo como",
  "mas bien",
  "tipo",
]);

/** The words before the amount, in its sentence, are only these — so they
 *  name no line ("the shower should be around …" never matches). */
const CUED = new RegExp(
  `^(?:(?:${FILLER}|${LEAD}|${APPROX}) )*(?:${LEAD}|${APPROX})$`,
);
const FILLER_ONLY = new RegExp(`^(?:(?:${FILLER}) )*(?:${FILLER})?$`);
/** "$18,000 total", "18 mil en total", "$18k for everything" — the words
 *  after the amount are only these. */
const TOTAL_WORDS =
  "(?:total|in total|all in|altogether|for everything|for the whole(?: thing| job| project)?|for it all|for all of it|en total|por todo|todo incluido)";
const TOTAL_AFTER = new RegExp(
  `^${TOTAL_WORDS}(?: ${TOTAL_WORDS})*(?: (?:please|pls|por favor))?$`,
);
/** "$9,000 down", "$500 deposit", "30%" — a share, never the job. */
const SHARE_AFTER =
  /^(?:down|deposit|upfront|up front|retainer|a month|per month|monthly|a visit|per visit|de anticipo|anticipo|de enganche|enganche|al mes|por mes|por visita)\b/;
/** "$1,500 for the bench", "$40 per sq ft", "18 mil de material" — the
 *  amount is one thing's, or a rate, never the job's ("for everything",
 *  "on the quote", "por todo", "in total" are the job's). */
const SCOPED_AFTER =
  /^(?:(?:for|on|of|in|toward|towards|de|del|para|por|en)\s+(?!(?:everything|the whole|it all|all of it|all|todo|total|the job|the lot|the quote|the estimate|the bid|el trabajo|la obra|la cotizacion)\b)\S|(?:(?:a|an|per|each|ea|por|el|la)\s+)?(?:sq|square|sf|sqft|ft|foot|feet|hour|hours|hr|hrs|day|days|week|weeks|month|visit|unit|piece|linear|lf|yard|yd|metro|metros|pie|pies|hora|horas|dia|dias|mes|semana)\b)/;
/** Work added in the same message ("…add the bench. make it $1,500"). */
const ADDS_WORK =
  /(?<![\p{L}])(?:add|adding|plus|also|include|including|agrega|agregar|añade|añadir|suma|sumar|incluye|incluir)(?![\p{L}])/iu;

/** Words that say the amount is the whole job's, whatever came before. */
const WHOLE_JOB =
  /\b(?:total|whole|everything|todo|completo|budget|presupuesto|altogether|all in)\b/;

/** A sentence ends at ! ? ; a line break, an opening ¿ ¡, or a full stop
 *  before a space (never the point in "$249.99" or "18.5k"). */
function isBoundary(s: string, i: number): boolean {
  const c = s[i];
  if ("!?;\n¿¡".includes(c)) return true;
  return c === "." && (i + 1 >= s.length || /\s/.test(s[i + 1]));
}

/** Where the sentence holding `at` starts, looking back at most `max`
 *  characters — -1 when it starts further back than that. */
function sentenceStart(s: string, at: number, max = Infinity): number {
  for (let i = at - 1; i >= 0 && at - i <= max; i--) {
    if (isBoundary(s, i)) return i + 1;
  }
  return at <= max ? 0 : -1;
}

/** Where the sentence holding `at` ends, looking ahead at most `max`. */
function sentenceEnd(s: string, at: number, max = Infinity): number {
  for (let i = at; i < s.length && i - at < max; i++) {
    if (isBoundary(s, i)) return i;
  }
  return Math.min(s.length, at + max);
}

/** On a draft, "Vanity. Make it $900." or "Add a bench. Make it $1,500." —
 *  a pronoun right after a thing was named points back at that thing, not
 *  at the job. */
function pointsBack(s: string, sentenceAt: number): boolean {
  const earlier = s.slice(0, sentenceAt);
  if (ADDS_WORK.test(earlier)) return true;
  const body = earlier.replace(/[\s!?;.¿¡]+$/u, "");
  const prev = norm(body.slice(sentenceStart(body, body.length)));
  return !!prev && prev.split(" ").length <= 4 && !/\d/.test(prev) &&
    !FILLER_ONLY.test(prev);
}

/**
 * The total the contractor states for the WHOLE job, in cents — "make it
 * around $18,000", "yo pienso como 18 mil", "more like 18k", "$18,000 total",
 * a lone "$18,000." — or undefined. Conservative: the words before the amount
 * in its sentence may only be a price cue and conversation, so a line's price
 * ("the shower should be around $4,000", "add the bench $1,500"), a cost, a
 * deposit or a bound ("under $18k") is never read as the total. Other amounts
 * may sit beside it, and the current total quoted back is not a new one.
 *
 * On a draft (`currentTotalCents`), where a wrong total would rescale every
 * line: a lone amount must be the whole message; "…, $960 total" needs no
 * line named before it; a pronoun ("make it $900") right after a named thing
 * or added work points back at that thing; and a total under the current one
 * in a message that adds work is the added work's price.
 */
export function statedTotalCents(
  text: string,
  opts: { currentTotalCents?: number } = {},
): number | undefined {
  const s = (text ?? "").normalize("NFC");
  const current = opts.currentTotalCents;
  const onDraft = typeof current === "number" && current > 0;
  const all = moneyAmounts(s);
  const amounts = all.filter((a) => a.cents !== current);
  let stated: number | undefined;
  for (const a of amounts) {
    // a cue and its conversation are a few words — never a paragraph
    const from = sentenceStart(s, a.start, 240);
    const short = from >= 0;
    const before = short ? norm(s.slice(from, a.start)) : "";
    const after = norm(s.slice(a.end, sentenceEnd(s, a.end, 160)));
    if (SHARE_AFTER.test(after) || SCOPED_AFTER.test(after)) continue;
    const few = short && before.split(" ").length <= 14;
    const cued = few && CUED.test(before);
    const fillerBefore = few && FILLER_ONLY.test(before);
    let alone = !after && fillerBefore;
    if (alone && onDraft) {
      // the whole message is this amount (and the old total quoted back)
      let rest = s;
      for (const b of [...all].reverse()) {
        if (b === a || b.cents === current) {
          rest = rest.slice(0, b.start) + " " + rest.slice(b.end);
        }
      }
      alone = FILLER_ONLY.test(norm(rest));
    }
    const totalAfter = amounts.length === 1 && TOTAL_AFTER.test(after) &&
      (!onDraft || fillerBefore || cued);
    if (!cued && !alone && !totalAfter) continue;
    if (
      onDraft && !WHOLE_JOB.test(`${before} ${after}`) && pointsBack(s, from)
    ) continue;
    stated = a.cents;
  }
  if (stated === undefined) return undefined;
  if (onDraft && stated < current && ADDS_WORK.test(s)) return undefined;
  return stated;
}

/** The note the chat model gets when the contractor stated a total. */
export function statedTotalNote(targetCents: number): string {
  return `Contractor's stated price for the WHOLE job: ${
    dollars(targetCents)
  } (${targetCents} cents). If you call create_quote, its line items' amountCents must add up to about ${targetCents}: spread it over all the work, including anything added in this message. It is the job's total — never one line's price, and never a reason to multiply the other lines.`;
}

// ---------------------------------------------------------------------------
// Checking the model's lines
// ---------------------------------------------------------------------------

export interface PricedLine {
  description: string;
  /** The line's total, integer cents. */
  amountCents: number;
}

const TOLERANCE = 0.15;

function sumOf(lines: readonly PricedLine[]): number {
  return lines.reduce((s, l) => s + l.amountCents, 0);
}

function near(x: number, target: number): boolean {
  return Math.abs(x - target) <= TOLERANCE * target;
}

/** More than ±15% away from the stated total. */
export function missesTarget(totalCents: number, targetCents: number): boolean {
  return !near(totalCents, targetCents);
}

/**
 * The lines scaled so they add up to exactly `targetCents`: each in whole
 * dollars, in the same order and wording, the rounding on the largest line.
 * Lines that add up to nothing come back unchanged.
 */
export function scaleLinesToTotal<T extends PricedLine>(
  lines: readonly T[],
  targetCents: number,
): T[] {
  const total = sumOf(lines);
  if (total <= 0 || targetCents <= 0) return lines.map((l) => ({ ...l }));
  const f = targetCents / total;
  const out = lines.map((l) => ({
    ...l,
    amountCents: Math.round((l.amountCents * f) / 100) * 100,
  }));
  let largest = 0;
  out.forEach((l, i) => {
    if (l.amountCents > out[largest].amountCents) largest = i;
  });
  out[largest].amountCents += targetCents - sumOf(out);
  return out;
}

/**
 * REQ-578 (demo-loop cycle 4, m34) — the lines with no price folded into the
 * largest priced line's description: "Remove old vanity $0 / Install 36in
 * vanity $2,250 / Install faucet $0" → "Install 36in vanity (incl. remove old
 * vanity, install faucet) $2,250". Same total, same work named, no line the
 * client reads as free. Lines that are all priced, or none priced, come back
 * unchanged (a priceless quote is REQ-302's to refuse).
 */
export function foldZeroLines<T extends PricedLine>(
  lines: readonly T[],
  lang: Lang,
): T[] {
  const zero = lines.filter((l) => l.amountCents === 0);
  const priced = lines.filter((l) => l.amountCents > 0);
  if (zero.length === 0 || priced.length === 0) {
    return lines.map((l) => ({ ...l }));
  }
  const host = priced.reduce((a, b) => b.amountCents > a.amountCents ? b : a);
  const included = zero
    .map((l) => jobNameInSentence(l.description))
    .filter((d) => d.length > 0)
    .join(", ");
  return lines
    .filter((l) => l.amountCents !== 0)
    .map((l) =>
      l === host && included
        ? {
          ...l,
          description: t(lang, "chatCoordinator.priceCheck.includes", {
            line: l.description.trim(),
            included,
          }),
        }
        : { ...l }
    );
}

/**
 * REQ-666 (demo-loop cycle 5, m48) — one price the contractor typed for
 * several pieces of work, split by the model on its own ("reparar puerta … y
 * cambiar llave del fregadero, $350" → $175 + $175), kept as ONE line: the
 * largest line (the first on a tie) carries the whole price and names the
 * rest — "Reparación de puerta de cocina (incluye cambio de llave del
 * fregadero) $350". Same total, same work named, no per-line price nobody
 * gave. Applies only when exactly one amount was typed, every line is priced
 * and the lines add up to exactly that amount; anything else comes back
 * undefined.
 */
export function keepOnePrice<T extends PricedLine>(
  lines: readonly T[],
  userText: string,
  lang: Lang,
): T[] | undefined {
  if (lines.length < 2 || lines.some((l) => l.amountCents <= 0)) {
    return undefined;
  }
  const typed = [...new Set(moneyAmounts(userText).map((a) => a.cents))];
  const total = sumOf(lines);
  if (typed.length !== 1 || typed[0] !== total) return undefined;
  const host = lines.reduce((a, b) => b.amountCents > a.amountCents ? b : a);
  return foldZeroLines(
    lines.map((l) => ({ ...l, amountCents: l === host ? total : 0 })),
    lang,
  );
}

export interface RevisionJump {
  fromCents: number;
  toCents: number;
  /** New or repriced lines whose price the contractor never typed. */
  unpriced: PricedLine[];
}

/** The amounts the contractor typed for the job or a line, in cents — never
 *  a rate ("$55 a foot" is a price per foot, not an amount of the job). */
function typedPricesCents(userText: string): number[] {
  return moneyAmounts(userText).filter((a) => !a.rate).map((a) => a.cents);
}

/**
 * The sanity gate on a revision: the new total is more than 3× the old one
 * — or, REQ-651 (demo-loop cycle 5, B1), under a third of it — it is not
 * within ±15% of an amount the contractor typed (as the new total or as the
 * change), and some new or repriced line carries a price nobody typed.
 * Undefined when the revision is believable.
 */
export function revisionJump(
  before: readonly PricedLine[],
  after: readonly PricedLine[],
  userText: string,
): RevisionJump | undefined {
  const from = sumOf(before);
  const to = sumOf(after);
  if (from <= 0 || (to <= 3 * from && 3 * to >= from)) return undefined;
  const typed = typedPricesCents(userText);
  if (typed.some((a) => near(to, a) || near(Math.abs(to - from), a))) {
    return undefined;
  }
  const all = moneyAmounts(userText).map((a) => a.cents);
  const was = new Map(before.map((l) => [lineKey(l.description), l]));
  const unpriced = after.filter((l) => {
    const old = was.get(lineKey(l.description));
    if (old && old.amountCents === l.amountCents) return false;
    return !all.includes(l.amountCents);
  });
  return unpriced.length
    ? { fromCents: from, toCents: to, unpriced }
    : undefined;
}

// ---------------------------------------------------------------------------
// REQ-651 (demo-loop cycle 5, B1) — a typed rate × the job's quantity
// ---------------------------------------------------------------------------

/** The unit a rate or a quantity is in: "ft", "sqft", "hr", "day", "yd", "m". */
function unitFamily(word: string): string | undefined {
  const w = word.toLowerCase().replace(/[\s.]+/g, " ").trim();
  if (/^(?:sq|sqft|sf|square|m2)\b/.test(w)) return "sqft";
  if (/^(?:ft|foot|feet|lf|lin|linear|pie|pies)\b/.test(w)) return "ft";
  if (/^(?:h|hr|hrs|hour|hours|hora|horas)\b/.test(w)) return "hr";
  if (/^(?:day|days|d[ií]a|d[ií]as)\b/.test(w)) return "day";
  if (/^(?:yard|yd|yds)\b/.test(w)) return "yd";
  if (/^(?:metro|metros)\b/.test(w)) return "m";
  return undefined;
}

/** What follows a rate's amount: "/ft", " a foot", " per sq ft". */
const RATE_UNIT_RE =
  /^\s*(?:\/\s*|(?:a|an|per|each|por|la|el|al|the)\s+)((?:sq|square)\s*(?:ft|feet|foot)?|sqft|sf|m2|(?:lin(?:ear)?\s+)?(?:ft|foot|feet)|lf|h|hr|hrs|hour|hours|hora|horas|day|days|d[ií]as?|yard|yds?|pies?|metros?)(?![\p{L}])/iu;

/** "150 ft", "150-ft", "64 sqft", "64 sq ft", "40 hours" — never a height or
 *  a width ("6 ft high", "6 ft tall"). */
const QTY_RE =
  /(?<![\p{L}\d$.,])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*-?\s*((?:sq|square)\s*(?:ft|feet|foot)|sqft|sf|m2|(?:lin(?:ear)?\s+)?(?:ft|foot|feet)|lf|hrs?|hours?|days?|yards?|yds?|pies?\s+cuadrados|pies?|metros?(?:\s+cuadrados)?)(?![\p{L}])(?!\s*(?:high|tall|wide|deep|thick|de\s+alto|de\s+ancho)\b)/giu;

function quantitiesIn(text: string): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const m of (text ?? "").matchAll(QTY_RE)) {
    let fam = unitFamily(m[2]);
    if (/cuadrados/i.test(m[2])) fam = "sqft";
    const n = Number(m[1].replace(/,/g, ""));
    if (!fam || !(n > 0)) continue;
    out.set(fam, [...(out.get(fam) ?? []), n]);
  }
  return out;
}

/** Within 1% — a slip moves the decimal point, nothing else. */
function same(a: number, b: number): boolean {
  return Math.abs(a - b) <= 0.01 * b;
}

/**
 * Pair 8 typed "I get $55 a foot" on a 150 ft fence and the model priced the
 * line at 8250 cents — 55 × 150 as dollars passed as cents. A line with a
 * quantity in the unit of a typed rate (in its own description, or typed in
 * the message) whose price is rate × quantity off by ×10 or ×100 either way
 * is that slip: it is set to rate × quantity. A line already at rate ×
 * quantity, or off by anything else (the contractor's extras), is left as
 * it is. Undefined when no line changes.
 */
export function fixRateSlips<T extends PricedLine>(
  lines: readonly T[],
  userText: string,
): T[] | undefined {
  const s = userText ?? "";
  const rates = moneyAmounts(s).filter((a) => a.rate).flatMap((a) => {
    const m = s.slice(a.end).match(RATE_UNIT_RE);
    const fam = m ? unitFamily(m[1]) : undefined;
    return fam ? [{ cents: a.cents, fam }] : [];
  });
  if (rates.length === 0) return undefined;
  const typedQty = quantitiesIn(
    moneyAmounts(s).reduceRight(
      (t, a) => t.slice(0, a.start) + " " + t.slice(a.end),
      s,
    ),
  );
  let changed = false;
  const out = lines.map((l) => {
    if (l.amountCents <= 0) return { ...l };
    const own = quantitiesIn(l.description);
    for (const r of rates) {
      const qtys = own.get(r.fam) ?? typedQty.get(r.fam) ?? [];
      for (const q of qtys) {
        const want = Math.round(r.cents * q);
        if (same(l.amountCents, want)) return { ...l };
        const slip = [10, 100].some((k) =>
          same(l.amountCents * k, want) || same(l.amountCents, want * k)
        );
        if (slip) {
          changed = true;
          return { ...l, amountCents: want };
        }
      }
    }
    return { ...l };
  });
  return changed ? out : undefined;
}

/** Is the model's create_quote a revision of the draft on file (its summary,
 *  or any of its lines), not a fresh job for someone else? */
export function revisesSameJob(
  draft: { summary?: string; lines: readonly PricedLine[] },
  next: { summary?: string; lines: readonly PricedLine[] },
): boolean {
  const a = lineKey(draft.summary ?? "");
  if (a && a === lineKey(next.summary ?? "")) return true;
  const kept = new Set(draft.lines.map((l) => lineKey(l.description)));
  return next.lines.some((l) => kept.has(lineKey(l.description)));
}

export type PriceSettlement =
  /** nothing to change */
  | { kind: "keep" }
  /** save these lines instead of the model's first ones */
  | {
    kind: "lines";
    lineItems: PricedLine[];
    how: "reasked" | "scaled" | "lifted" | "rate";
  }
  /** save nothing — ask the contractor */
  | { kind: "ask"; jump: RevisionJump };

/**
 * Check the model's create_quote before it is saved.
 *
 * - A stated total: lines more than ±15% off are re-asked once, naming both
 *   totals; still off (or no answer), the lines are scaled to it in code.
 * - A revision of the draft on file with no stated total: a jump of more
 *   than 3× — or a drop under a third (REQ-651) — with prices nobody typed
 *   is asked about; nothing is saved.
 * - First (REQ-651, B1): a line priced at a typed rate × its quantity off by
 *   ×10 / ×100 is set to rate × quantity (`fixRateSlips`).
 * - A first draft: under the job's plausibility floor (REQ-382) it is
 *   re-asked once with the job size; still under, it is lifted to the floor.
 *   A total the contractor typed (or the sum of the prices they typed) is
 *   theirs, and is never re-asked or lifted; a typed rate is not a price.
 *
 * Lines that add up to nothing are REQ-302's to refuse, not this check's.
 */
export async function settleQuotePrice(input: {
  lines: readonly PricedLine[];
  userText: string;
  /** The draft's lines when this create_quote revises the same job. */
  before?: readonly PricedLine[];
  targetCents?: number;
  /** First draft: the job's floor and the size it was read off. */
  floor?: { cents: number; jobSize: string };
  /** One more model call with the note; its create_quote lines, if any. */
  reask: (note: string) => Promise<readonly PricedLine[] | undefined>;
}): Promise<PriceSettlement> {
  // REQ-651 (B1): a typed rate × the job's quantity, off by ×10 / ×100, is
  // the model's cents slip — fixed before any other check reads the lines.
  const rated = fixRateSlips(input.lines, input.userText);
  const settled = await settleLines({ ...input, lines: rated ?? input.lines });
  if (rated && settled.kind === "keep") {
    return { kind: "lines", how: "rate", lineItems: rated };
  }
  return settled;
}

async function settleLines(input: {
  lines: readonly PricedLine[];
  userText: string;
  before?: readonly PricedLine[];
  targetCents?: number;
  floor?: { cents: number; jobSize: string };
  reask: (note: string) => Promise<readonly PricedLine[] | undefined>;
}): Promise<PriceSettlement> {
  const total = sumOf(input.lines);
  if (total <= 0) return { kind: "keep" };
  const again = async (note: string) => {
    const lines = await input.reask(note).catch(() => undefined);
    return lines && lines.length > 0 && sumOf(lines) > 0
      ? lines.map((l) => ({ ...l }))
      : undefined;
  };

  const target = input.targetCents;
  if (target && target > 0) {
    if (!missesTarget(total, target)) return { kind: "keep" };
    const re = await again(offTargetNote(total, target));
    if (re && !missesTarget(sumOf(re), target)) {
      return { kind: "lines", how: "reasked", lineItems: re };
    }
    return {
      kind: "lines",
      how: "scaled",
      lineItems: scaleLinesToTotal(re ?? input.lines, target),
    };
  }

  if (input.before) {
    const jump = revisionJump(input.before, input.lines, input.userText);
    return jump ? { kind: "ask", jump } : { kind: "keep" };
  }

  // The floor judges prices the model made up — never the contractor's own:
  // a total they typed, or the sum of the line prices they typed. A rate
  // ("$55 a foot") is neither (REQ-651, B1).
  const typed = typedPricesCents(input.userText);
  const typedSum = typed.reduce((a, b) => a + b, 0);
  const theirs = typed.some((a) => near(total, a)) ||
    (typedSum > 0 && near(total, typedSum));
  const floor = input.floor;
  if (floor && floor.cents > 0 && total < floor.cents && !theirs) {
    const re = await again(belowFloorNote(total, floor.cents, floor.jobSize));
    if (re && sumOf(re) >= floor.cents) {
      return { kind: "lines", how: "reasked", lineItems: re };
    }
    const low = re ?? input.lines.map((l) => ({ ...l }));
    return {
      kind: "lines",
      how: "lifted",
      lineItems: scaleLinesToTotal(low, floor.cents),
    };
  }
  return { kind: "keep" };
}

/** "$18,000" — the notes the model reads round to whole dollars. */
function dollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

/** "$2,585" / "$249.99" — as the chat's revision reply writes money. */
function money(cents: number): string {
  const d = cents / 100;
  return "$" + d.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(d) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function offTargetNote(totalCents: number, targetCents: number): string {
  return `Those line items add up to ${
    dollars(totalCents)
  }, but the contractor's price for the WHOLE job is ${
    dollars(targetCents)
  }. Call create_quote again with the same work — every line, including any added in this message — priced so the amountCents add up to ${targetCents} (${
    dollars(targetCents)
  }). It is the job's total: never put it on one line, and never multiply the other lines.`;
}

function belowFloorNote(
  totalCents: number,
  floorCents: number,
  jobSize: string,
): string {
  return `Those line items add up to ${dollars(totalCents)}, under ${
    dollars(floorCents)
  } — below what ${jobSize} costs anywhere. Call create_quote again pricing every item in the contractor's message, labor and materials, at real US contractor prices. amountCents is in CENTS: dollars × 100.`;
}

/** The question for an unexplained jump: both totals and the lines nobody
 *  priced (largest first, at most three, then "and N more"). */
export function priceJumpAsk(lang: Lang, jump: RevisionJump): string {
  const top = [...jump.unpriced].sort((a, b) => b.amountCents - a.amountCents);
  const named = top.slice(0, 3).map((l) =>
    `${l.description.trim()} (${money(l.amountCents)})`
  );
  if (top.length > 3) {
    named.push(
      t(lang, "chatCoordinator.priceCheck.more", { n: top.length - 3 }),
    );
  }
  const key = jump.toCents < jump.fromCents
    ? "chatCoordinator.priceCheck.drop"
    : "chatCoordinator.priceCheck.jump";
  return t(lang, key, {
    from: money(jump.fromCents),
    to: money(jump.toCents),
    lines: named.join(", "),
  });
}

// ---------------------------------------------------------------------------
// The chat model's create_quote
// ---------------------------------------------------------------------------

/** The draft bound to the conversation, as the quote store has it. */
export interface DraftOnFile {
  summary?: string;
  lineItems: readonly {
    description: string;
    /** per-unit, integer cents */
    price?: number;
    quantity?: number;
  }[];
}

/** The draft's total as the chat measures it (price × quantity). */
export function draftTotalCents(draft: DraftOnFile): number {
  return totalOf(draft.lineItems);
}

/** The model's own draft, as the next turn reads it back. */
function draftTurn(p: { summary: string; lineItems: PricedLine[] }): string {
  const lines = p.lineItems
    .map((l) => `  - ${l.description}: ${money(l.amountCents)}`)
    .join("\n");
  return `[Quote draft: ${p.summary}\n${lines}\nTotal: ${
    money(sumOf(p.lineItems))
  }]`;
}

/**
 * The chat model's create_quote, settled before anything is saved
 * (`settleQuotePrice`). A revision is measured against the draft on file
 * when it is the same job; a first draft — or a fresh job in the same chat —
 * against the plausibility floor of the job the message and the model's own
 * lines describe. `save` carries the lines to save in place of the model's;
 * `ask` is the question that replaces the model's reply, with nothing saved.
 */
export async function settleCreateQuote<
  P extends { summary: string; lineItems: PricedLine[] },
>(input: {
  payload: P;
  userText: string;
  statedCents?: number;
  draft?: DraftOnFile;
  lang: Lang;
  /** One more model call with these turns after the conversation; the
   *  lines of the create_quote it answers with, if any. */
  reask: (
    turns: { role: "assistant" | "user"; content: string }[],
  ) => Promise<readonly PricedLine[] | undefined>;
}): Promise<
  { kind: "keep" } | { kind: "save"; payload: P } | {
    kind: "ask";
    text: string;
  }
> {
  const { payload, draft } = input;
  const before = draft?.lineItems.map((l) => ({
    description: l.description,
    amountCents: (l.price ?? 0) * (l.quantity ?? 1),
  }));
  const sameJob = !!draft && !!before &&
    revisesSameJob(
      { summary: draft.summary, lines: before },
      { summary: payload.summary, lines: payload.lineItems },
    );
  const scope = [
    payload.summary,
    ...payload.lineItems.map((l) => l.description),
  ]
    .join("\n");
  const settled = await settleQuotePrice({
    lines: payload.lineItems,
    userText: input.userText,
    ...(sameJob ? { before } : {
      floor: {
        cents: plausibilityFloorCents(input.userText, scope),
        jobSize: describeJobSize(input.userText, scope),
      },
    }),
    ...(input.statedCents ? { targetCents: input.statedCents } : {}),
    reask: (note) =>
      input.reask([
        { role: "assistant", content: draftTurn(payload) },
        { role: "user", content: note },
      ]),
  });
  if (settled.kind === "ask") {
    return { kind: "ask", text: priceJumpAsk(input.lang, settled.jump) };
  }
  const lines = settled.kind === "lines" ? settled.lineItems : undefined;
  // REQ-578 (m34): the contractor gave the whole job's price — a stated
  // total, or an amount typed in this message that the lines add up to
  // ("$2,400 — actually make it $2,250") — and the model put all of it on
  // one step and 0 on the rest: the 0 lines fold into the priced one. With
  // no price from the contractor a $0 line stays an included item (REQ-267:
  // "Paint supplied by Castro Painting").
  const all = lines ?? payload.lineItems;
  const typed = moneyAmounts(input.userText).map((a) => a.cents);
  if (input.statedCents || typed.includes(sumOf(all))) {
    const folded = foldZeroLines(all, input.lang);
    if (folded.length !== all.length) {
      return { kind: "save", payload: { ...payload, lineItems: folded } };
    }
  }
  // REQ-666 (m48): on a new quote, one typed price for several jobs stays
  // one line — never spread over the jobs by the model ($350 → $175 + $175).
  // A revision of the draft on file spreads a stated total over its lines
  // (REQ-445), so it is left alone.
  const single = sameJob
    ? undefined
    : keepOnePrice(all, input.userText, input.lang);
  if (single) {
    return { kind: "save", payload: { ...payload, lineItems: single } };
  }
  if (!lines) return { kind: "keep" };
  return { kind: "save", payload: { ...payload, lineItems: lines } };
}
