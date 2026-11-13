/**
 * REQ-382 (demo cycle 2, M22): a plausibility floor for suggested prices.
 *
 * A master-bath gut (slab drain move, heated floor, double vanity, glass)
 * came back Competitive $1,850 / Market $2,250 / Premium $2,750 against the
 * $28k the contractor chose, and nothing in the pipeline noticed. The only
 * floor was a dollar amount the contractor typed (REQ-260). This one is read
 * off the job's SIZE and TRADE: a gut or remodel of a kitchen / bathroom /
 * other room, plus a per-item amount for every scope item past the first
 * few. It is deliberately low — a sanity floor, not an estimate — so a real
 * quote never trips it; a dropped zero or a labor-only misread always does.
 *
 * REQ-575 (demo-loop cycle 4, M13): "Quote 120 ft of 6 ft cedar privacy
 * fence with one gate" was drafted at $1,200 ($10/ft) + a $400 gate and
 * saved as it came — only a remodel had a floor. A fence, a deck and a roof
 * now have one per unit of the size the text gives (linear foot, square
 * foot, roofing square), as low as the cheapest real installs; a repair, a
 * stain or a size-less mention has none.
 */

import { isLaborOnly } from "@agents/domain/business/price-basis/mod.ts";

/** Whole-room work, English + Spanish. A single repair ("replace the
 *  faucet") is not one. */
const REMODEL =
  /\b(gut(?:ted|ting)?|demo(?:lish)?(?:ed|ition)? (?:\w+ )?(?:to|down to) (?:the )?studs|remodel\w*|renovat\w*|rebuild|remodelaci[oó]n|remodelar|renovaci[oó]n|renovar|reforma\w*|hasta los montantes)\b/i;
const KITCHEN = /\b(kitchen|cocina)\b/i;
const BATHROOM = /\b(bath(?:room)?s?|master bath|shower|ba[nñ]os?|ducha)\b/i;

/** Floors in cents — kitchen > bathroom > any other room. */
const BASE_KITCHEN = 1_200_000;
const BASE_BATHROOM = 600_000;
const BASE_OTHER = 300_000;
/** Each scope item past the first three adds this much, up to a cap. */
const PER_ITEM = 50_000;
const FREE_ITEMS = 3;
const MAX_ITEMS = 15;

/** Distinct scope items: confirmed bullets, or the message's comma / line /
 *  semicolon list — whichever names more. Parenthetical asides are part of
 *  the item they qualify, so they never count on their own. */
export function countScopeItems(raw: string, scope = ""): number {
  const items = (s: string) =>
    new Set(
      s.replace(/\([^)]*\)/g, " ")
        .split(/[\n,;:•+]+/)
        .map((x) => x.trim().toLowerCase())
        .filter((x) => /[a-zà-ÿ]{3,}/i.test(x)),
    ).size;
  return Math.max(items(raw), items(scope));
}

// ---------------------------------------------------------------------------
// REQ-575 (M13): per-trade unit floors — fence, deck, roof
// ---------------------------------------------------------------------------

/** A fence. "cerca" is also "near" ("cerca de 18 mil", "cerca de 120 pies
 *  cuadrados"), so only "la / una / nueva cerca" or "cerca de madera …". */
const FENCE =
  /\bfenc(?:e|es|ing)\b|\b(?:barda|valla|cerco)s?\b|\b(?:la|una|nueva|instalar|construir|poner)\s+cerca\b|\bcerca\s+(?:de\s+)?(?:madera|cedro|vinilo|malla|metal|hierro|alambre|privacidad|cicl[oó]n)/i;
const DECK = /\b(?:decks?|decking)\b/i;
const ROOF = /\b(?:roof(?:ing)?|re-?roof\w*|techo|tejado)\b/i;
/** Upkeep, not an install: a repair, a stain, a few boards or posts. */
const UPKEEP =
  /\b(?:repair\w*|fix\w*|patch\w*|mend\w*|leak\w*|stain\w*|seal\w*|refinish\w*|wash\w*|clean\w*|paint\w*|sand(?:ing)?|inspect\w*|repara\w*|arregl\w*|parch\w*|gotera\w*|pint\w*|sell\w*|limpi\w*|barniz\w*)\b|\b(?:replace|cambiar)\s+(?:\d+\s+|a\s+few\s+|some\s+|the\s+)?(?:posts?|boards?|pickets?|panels?|shingles?|postes?|tablas?)\b/i;
/** A new install, even beside upkeep ("tear out the old one, new fence"). */
const NEW_BUILD =
  /\b(?:new|install\w*|build\w*|built|construct\w*|re-?roof\w*|tear[\s-]?off|nuev[oa]s?|instal\w*|constru\w*)\b/i;

/** Lengths — "120 ft", "120-foot", "120 linear feet", "120'", "150 pies
 *  (lineales)", "40 metros"; never "1,500 sq ft" or "pies cuadrados". */
const LENGTH =
  /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*-?\s*(?:linear\s+|lin\.?\s+)?(ft|feet|foot|'|lf|pies|metros?)(?![\p{L}\d²])(?!\s*(?:cuadrad|squared))/giu;
/** Areas — "300 sq ft", "300 sqft", "300 square feet", "300 pies cuadrados". */
const AREA =
  /(\d{1,3}(?:,\d{3})+|\d+)\s*(?:sq\.?\s*(?:ft|feet|foot)|sqft|sf|square\s+(?:feet|foot|ft)|pies\s+cuadrados|ft²)(?![\p{L}\d])/iu;
/** Dimensions — "12x16", "12' x 16'", "12 by 16". */
const DIMENSIONS =
  /(\d{1,3}(?:\.\d+)?)\s*(?:'|ft|feet)?\s*(?:x|×|by|por)\s*(\d{1,3}(?:\.\d+)?)\s*(?:'|ft|feet)?(?![\p{L}\d])/iu;
/** Roofing squares — "25 squares". */
const SQUARES = /(\d{1,3}(?:\.\d+)?)\s*(?:roofing\s+)?squares?\b/i;
/** Gates — "one gate", "2 gates", "a double gate", "un portón". */
const GATE_COUNT =
  /\b(\d+|one|two|three|four|a|an|un|una|dos|tres|cuatro)\s+(?:[\p{L}-]+\s+){0,2}?(?:gates?|port[oó]n(?:es)?)\b/giu;
const GATE = /\b(?:gates?|port[oó]n(?:es)?)\b/i;
const COUNT_WORDS: Record<string, number> = {
  one: 1,
  a: 1,
  an: 1,
  un: 1,
  una: 1,
  two: 2,
  dos: 2,
  three: 3,
  tres: 3,
  four: 4,
  cuatro: 4,
};

/** Fence floors per linear foot, cents: wire / chain link, a plain wood or
 *  picket fence, a privacy / cedar / vinyl / metal / masonry one. */
const FENCE_PER_FT_WIRE = 800;
const FENCE_PER_FT = 1_500;
const FENCE_PER_FT_PRIVACY = 2_000;
const FENCE_PER_GATE = 25_000;
const WIRE =
  /chain[\s-]?link|cicl[oó]n|malla|\bwire\b|barbed|alambre|split[\s-]?rail|ranch\s+rail/i;
const PRIVACY =
  /privacy|privacidad|cedar|cedro|redwood|vinyl|vinilo|\bpvc\b|composite|wrought|\biron\b|hierro|alumin|ornamental|steel|acero|board[\s-]?on[\s-]?board|shadow[\s-]?box|masonry|brick|ladrillo|stone|piedra|block|bloque/i;
/** Deck floors per square foot, cents: wood, composite / PVC. */
const DECK_PER_SQFT = 1_500;
const DECK_PER_SQFT_COMPOSITE = 2_500;
const COMPOSITE = /composite|trex|azek|timbertech|\bpvc\b|compuesto/i;
/** Roof floors per square (100 sq ft), cents: shingles, metal / tile / slate. */
const ROOF_PER_SQUARE = 30_000;
const ROOF_PER_SQUARE_PREMIUM = 60_000;
const PREMIUM_ROOF =
  /metal|standing[\s-]?seam|tile|slate|l[aá]mina|teja|pizarra/i;

const num = (s: string) => Number(s.replace(/,/g, ""));

/** The longest length typed, in feet (a fence's height is shorter). */
function longestFeet(text: string): number {
  let best = 0;
  for (const m of text.matchAll(LENGTH)) {
    const n = num(m[1]);
    const feet = /^metro/i.test(m[2]) ? n * 3.28 : n;
    if (feet > best) best = feet;
  }
  return Math.round(best);
}

function areaSqFt(text: string): number {
  const a = AREA.exec(text);
  if (a) return num(a[1]);
  const d = DIMENSIONS.exec(text);
  return d ? Math.round(num(d[1]) * num(d[2])) : 0;
}

function gateCount(text: string): number {
  let n = 0;
  for (const m of text.matchAll(GATE_COUNT)) {
    const tok = m[1].toLowerCase();
    n += /^\d/.test(tok) ? Number(tok) : COUNT_WORDS[tok] ?? 1;
  }
  return n > 0 ? Math.min(n, 6) : GATE.test(text) ? 1 : 0;
}

/** The floor of the fence, deck and roof the text sizes (summed), and the
 *  words the re-ask names them with; 0 / "" when none is sized, or when the
 *  text is upkeep with no new install. */
function unitFloor(text: string): { cents: number; size: string } {
  if (UPKEEP.test(text) && !NEW_BUILD.test(text)) return { cents: 0, size: "" };
  let cents = 0;
  const sizes: string[] = [];
  if (FENCE.test(text)) {
    const feet = longestFeet(text);
    if (feet >= 10) {
      const perFt = WIRE.test(text)
        ? FENCE_PER_FT_WIRE
        : PRIVACY.test(text)
        ? FENCE_PER_FT_PRIVACY
        : FENCE_PER_FT;
      const gates = gateCount(text);
      cents += feet * perFt + gates * FENCE_PER_GATE;
      sizes.push(
        `${feet} linear ft of fence${
          gates ? ` with ${gates} gate${gates === 1 ? "" : "s"}` : ""
        }`,
      );
    }
  }
  if (DECK.test(text)) {
    const sqft = areaSqFt(text);
    if (sqft >= 20) {
      const composite = COMPOSITE.test(text);
      cents += sqft *
        (composite ? DECK_PER_SQFT_COMPOSITE : DECK_PER_SQFT);
      sizes.push(`a ${sqft} sq ft${composite ? " composite" : ""} deck`);
    }
  }
  if (ROOF.test(text)) {
    const sq = SQUARES.exec(text);
    const area = AREA.exec(text);
    const squares = sq
      ? num(sq[1])
      : Math.round((area ? num(area[1]) : 0) / 100);
    if (squares >= 1) {
      cents += squares *
        (PREMIUM_ROOF.test(text) ? ROOF_PER_SQUARE_PREMIUM : ROOF_PER_SQUARE);
      sizes.push(`a ${squares}-square roof replacement`);
    }
  }
  return { cents: Math.round(cents), size: sizes.join(" and ") };
}

/** REQ-382: a gut / remodel's floor by its room and scope items; 0 when
 *  the text is no gut / remodel. */
function remodelFloor(raw: string, scope: string, text: string): number {
  if (!REMODEL.test(text)) return 0;
  const base = KITCHEN.test(text)
    ? BASE_KITCHEN
    : BATHROOM.test(text)
    ? BASE_BATHROOM
    : BASE_OTHER;
  const extra =
    Math.max(0, Math.min(countScopeItems(raw, scope), MAX_ITEMS) - FREE_ITEMS) *
    PER_ITEM;
  return base + extra;
}

/**
 * The lowest believable price, in cents, for the job the text describes —
 * a gut / remodel by its room and scope items; REQ-575 (M13) a fence, deck
 * or roof by its size (the higher of the two when both are there); else 0
 * (no floor for small jobs). A blanket "labor only" halves it; one
 * customer-supplied item does not change it.
 */
export function plausibilityFloorCents(raw: string, scope = ""): number {
  const text = `${raw}\n${scope}`;
  const floor = Math.max(remodelFloor(raw, scope, text), unitFloor(text).cents);
  if (floor <= 0) return 0;
  return isLaborOnly(raw, scope) ? Math.round(floor / 2) : floor;
}

/** "a bathroom gut / remodel" — the retry names what the floor was read off.
 *  REQ-575 (M13): "120 linear ft of fence with 1 gate", "a 192 sq ft deck". */
export function describeJobSize(raw: string, scope = ""): string {
  const text = `${raw}\n${scope}`;
  const unit = unitFloor(text);
  if (unit.cents > remodelFloor(raw, scope, text)) return unit.size;
  const room = KITCHEN.test(text)
    ? "kitchen"
    : BATHROOM.test(text)
    ? "bathroom"
    : "room";
  return `a ${room} gut / remodel with ${
    countScopeItems(raw, scope)
  } scope items`;
}
