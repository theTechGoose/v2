/**
 * REQ-788 (+ AMENDMENT) — the overhead cost per recurring visit, as Settings defines it:
 * a flat dollar amount, or a percentage of the visit's services (its line items).
 * Shared by the Settings card, the subscription form and card, and the batch pull.
 */
export type OverheadSetting =
  | { mode: "flat"; cents: number }
  | { mode: "percent"; pct: number };

export interface OverheadFields {
  fieldOverheadMode?: string;
  fieldOverheadCents?: number;
  fieldOverheadPct?: number;
}

/** the setting on an identity — flat by default; a missing amount is 0 */
export function overheadSetting(
  identity: OverheadFields | null | undefined,
): OverheadSetting {
  if (identity?.fieldOverheadMode === "percent") {
    return { mode: "percent", pct: num(identity.fieldOverheadPct) };
  }
  return { mode: "flat", cents: Math.round(num(identity?.fieldOverheadCents)) };
}

/** what one visit's Overhead line bills, given the sum of its service lines (cents) */
export function overheadCentsFor(
  setting: OverheadSetting,
  servicesCents: number,
): number {
  if (setting.mode === "flat") return Math.max(0, setting.cents);
  return Math.max(0, Math.round(servicesCents * setting.pct / 100));
}

/** "$25.00" or "10%" — the chip's amount */
export function overheadText(setting: OverheadSetting): string {
  if (setting.mode === "percent") return `${trimPct(setting.pct)}%`;
  return `$${
    (setting.cents / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }`;
}

const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
const trimPct = (p: number) =>
  Number.isInteger(p) ? String(p) : String(Math.round(p * 100) / 100);
