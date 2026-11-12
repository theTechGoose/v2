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

/**
 * The lowest believable price, in cents, for the job the text describes —
 * 0 when it is not a gut / remodel (no floor for small jobs). A blanket
 * "labor only" halves it; one customer-supplied item does not change it.
 */
export function plausibilityFloorCents(raw: string, scope = ""): number {
  const text = `${raw}\n${scope}`;
  if (!REMODEL.test(text)) return 0;
  const base = KITCHEN.test(text)
    ? BASE_KITCHEN
    : BATHROOM.test(text)
    ? BASE_BATHROOM
    : BASE_OTHER;
  const extra =
    Math.max(0, Math.min(countScopeItems(raw, scope), MAX_ITEMS) - FREE_ITEMS) *
    PER_ITEM;
  const floor = base + extra;
  return isLaborOnly(raw, scope) ? Math.round(floor / 2) : floor;
}

/** "a bathroom gut / remodel" — the retry names what the floor was read off. */
export function describeJobSize(raw: string, scope = ""): string {
  const text = `${raw}\n${scope}`;
  const room = KITCHEN.test(text)
    ? "kitchen"
    : BATHROOM.test(text)
    ? "bathroom"
    : "room";
  return `a ${room} gut / remodel with ${
    countScopeItems(raw, scope)
  } scope items`;
}
