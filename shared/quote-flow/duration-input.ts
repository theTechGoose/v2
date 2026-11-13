/**
 * REQ-390 (demo-loop cycle 2, m18) — the custom duration picker's number. The
 * picker used to clamp whatever was typed into 1–99 before checking it, so
 * "-3" read "1 day" in the agreement. The typed text is checked as typed: a
 * whole number from 1 to 99, else a message. Empty is not an error yet —
 * "Lock in" just waits for a number.
 */
import type { DurationUnit } from "./terms-i18n.ts";

export type DurationNumberErrorKey = "asstChat.duration.invalidNumber";

export interface DurationNumber {
  n: number | null;
  error: DurationNumberErrorKey | null;
}

export function parseDurationNumber(
  raw: string | null | undefined,
): DurationNumber {
  const s = (raw ?? "").trim();
  if (!s) return { n: null, error: null };
  if (!/^\d{1,2}$/.test(s)) {
    return { n: null, error: "asstChat.duration.invalidNumber" };
  }
  const n = Number(s);
  if (n < 1 || n > 99) {
    return { n: null, error: "asstChat.duration.invalidNumber" };
  }
  return { n, error: null };
}

/**
 * REQ-458 (demo-loop cycle 3, M38) — an EMPTY number (REQ-343 opens the picker
 * that way) used to preview as a bare "—", which read as a dead end. Empty
 * now asks for the number instead.
 *
 * REQ-677 (demo-loop cycle 5, c4-m45) — a BAD number (0, 9999, -3, 2.5…) also
 * previewed as "—" next to a greyed "Lock it in"; it now reads "Enter 1–99".
 * A good number gets no hint (the preview shows the length itself).
 */
export function durationPreviewHint(
  raw: string | null | undefined,
):
  | "asstChat.duration.previewEmpty"
  | "asstChat.duration.previewInvalid"
  | null {
  if (!(raw ?? "").trim()) return "asstChat.duration.previewEmpty";
  return parseDurationNumber(raw).error
    ? "asstChat.duration.previewInvalid"
    : null;
}

/**
 * REQ-575 (demo-loop cycle 4, M3) — a typed duration keeps its half ("Dos
 * semanas y media" → 2.5 weeks, offered as "2.5 semanas"), but the custom
 * picker takes whole numbers only (REQ-390 above). It opens on the same
 * length in a whole unit: a half week or month in days (2.5 weeks → 18 days,
 * 1.5 months → 45 days), else the next whole number of the unit (3.5 days →
 * 4 days). A whole duration comes back as it is.
 */
export function wholeDuration(
  d: { n: number; unit: DurationUnit },
): { n: number; unit: DurationUnit } {
  if (Number.isInteger(d.n)) return { n: d.n, unit: d.unit };
  const days = d.unit === "weeks"
    ? Math.ceil(d.n * 7)
    : d.unit === "months"
    ? Math.ceil(d.n * 30)
    : 0;
  if (days > 0 && days <= 99) return { n: days, unit: "days" };
  return { n: Math.min(99, Math.ceil(d.n)), unit: d.unit };
}
