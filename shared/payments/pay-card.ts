/**
 * REQ-216 — the pay card's pure rules, ported from the CRM's charge island (ppwk-crm
 * `ui/src/pages/charge/logic.ts` + `branding.ts`): the cells the card prints (one character
 * each, so each can animate on its own), the mask, which cells changed, the issuer mark's
 * placement data and the focus ring's transform. No DOM here — the island measures and applies.
 */
import type { CardBrand, CardField } from "./card-entry.ts";

/** The card's digit groups, per brand. A space is a cell too, so every cell has a fixed index. */
const LAYOUT: Record<"amex" | "other", number[]> = {
  amex: [4, 6, 5],
  other: [4, 4, 4, 4],
};

/**
 * The number row, cell by cell: a digit, `#` for a digit not typed yet, `*` for a middle
 * digit while the row is masked, or `" "` between groups. The first four and the last four
 * are never masked (what a printed receipt shows).
 */
export function numberCells(
  digits: string,
  brand: CardBrand,
  masked: boolean,
): string[] {
  const groups = LAYOUT[brand === "amex" ? "amex" : "other"];
  const total = groups.reduce((a, b) => a + b, 0);
  const d = digits.replace(/\D/g, "").slice(0, total);
  const cells: string[] = [];
  let i = 0;
  groups.forEach((len, g) => {
    if (g > 0) cells.push(" ");
    for (let k = 0; k < len; k++, i++) {
      const ch = d[i];
      if (ch === undefined) cells.push("#");
      else if (masked && i >= 4 && i < total - 4) cells.push("*");
      else cells.push(ch);
    }
  });
  return cells;
}

/** The holder, one uppercase character per cell, 30 cells (the CRM's card draws 30). */
export const HOLDER_CELLS = 30;
export function holderCells(holder: string): string[] {
  const s = holder.toUpperCase();
  return Array.from({ length: HOLDER_CELLS }, (_, i) => s[i] ?? "");
}

/** "12/34" → the two halves the card prints; the placeholders while they are not typed. */
export function expiryParts(expiry: string): { month: string; year: string } {
  const [m = "", y = ""] = expiry.split("/");
  return { month: m || "MM", year: y || "YY" };
}

/**
 * Which cells changed since the last render and are not blank: those get the entry
 * animation. The first render (no previous cells) animates nothing — the card is already
 * on screen as it is.
 */
export function changedCells(
  prev: string[] | undefined,
  now: string[],
): number[] {
  if (!prev) return [];
  const out: number[] = [];
  now.forEach((cell, i) => {
    if (cell === (prev[i] ?? "") || cell.trim() === "") return;
    out.push(i);
  });
  return out;
}

// ---- the issuer mark (CRM REQ-033: where it sits, how big, how faint — data) ----------
export const MARK_ANCHORS = [
  "top-left",
  "top",
  "top-right",
  "left",
  "center",
  "right",
  "bottom-left",
  "bottom",
  "bottom-right",
] as const;
export type MarkAnchor = typeof MARK_ANCHORS[number];
const MARK_DEFAULTS = { anchor: "right" as MarkAnchor, size: 92, opacity: 42 };
const MARK_MAX_SIZE = 140;
const MARK_MIN_SIZE = 20;

/** An anchor the card cannot draw is not a placement — fall back, never render nowhere. */
export function markAnchorOf(anchor: string | undefined): MarkAnchor {
  return (MARK_ANCHORS as readonly string[]).includes(anchor ?? "")
    ? anchor as MarkAnchor
    : MARK_DEFAULTS.anchor;
}

/**
 * The mark's size (percent of the card's height) and opacity (0-100) as the two custom
 * properties the card reads. A value that would erase the mark falls back to the card's own;
 * a value that is merely too big is clamped.
 */
export function markStyle(
  size: number | undefined,
  opacity: number | undefined,
): string {
  const s = typeof size === "number" && Number.isFinite(size) && size > 0
    ? Math.min(Math.max(size, MARK_MIN_SIZE), MARK_MAX_SIZE)
    : MARK_DEFAULTS.size;
  const o = typeof opacity === "number" && Number.isFinite(opacity) &&
      opacity >= 0
    ? Math.min(opacity, 100)
    : MARK_DEFAULTS.opacity;
  return `--pc-mark-size: ${s}; --pc-mark-opacity: ${o};`;
}

// ---- the focus ring --------------------------------------------------------------------
export type FocusZone = "none" | "number" | "name" | "date";
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Each field lights its zone on the card; the CVC lights the expiry (the card is flipped anyway). */
export function focusZoneFor(field: CardField | undefined): FocusZone {
  switch (field) {
    case "number":
      return "number";
    case "holder":
      return "name";
    case "expiry":
    case "cvc":
      return "date";
    default:
      return "none";
  }
}

/**
 * The ring is the card-sized host box moved and scaled onto the zone — transform only, never
 * width/height (the CRM's jank fix #1). The very first placement does not travel: with a
 * transition from the whole card down onto a field, the ring reads as "expanding out".
 */
export function focusOutlineStyle(
  card: Box,
  zone: Box,
  first: boolean,
): string {
  const sx = round(zone.width / card.width);
  const sy = round(zone.height / card.height);
  const tx = round(zone.left - card.left);
  const ty = round(zone.top - card.top);
  const settle = first ? "transition: none; " : "";
  return `${settle}transform: translate(${tx}px, ${ty}px) scale(${sx}, ${sy}); transform-origin: top left;`;
}
function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
