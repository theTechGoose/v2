/**
 * REQ-1104 (LOOP-007 cycle 3, q3-27) — a relative start term names its day.
 *
 * The terms wizard stores the start the way the contractor picked it —
 * "Right away", "Next week", "Next month" (or the ES words typed in chat).
 * Printed bare, a signed agreement's "Start date: Next week" names a
 * different week every time it is read. Every customer surface (the /q
 * agreement and its PDF, the /i term grid and the invoice PDF) states the
 * concrete day beside the contractor's words, anchored to the day the quote
 * went out (`sentAt ?? createdAt`) — the same day the invoice schedule works
 * from (completion-schedule `startFromTerm`, REQ-411/659):
 * "Next week (Nov 26, 2026)" / "La próxima semana (26 nov 2026)".
 *
 * A picked date, TBD, or any free text that is not a relative preset is left
 * as it is. Pure; imported by the backend renderers and the front-end.
 */
import { startFromTerm } from "./completion-schedule.ts";
import { formatTermDate, termDateIso } from "./format-helpers.ts";

/** The ISO day a RELATIVE start term means, counted from `anchorAt` (an ISO
 *  timestamp or day). Undefined for a picked date, TBD, free text, or no
 *  usable anchor. */
export function relativeStartIso(
  value: string | undefined,
  anchorAt: string | undefined,
): string | undefined {
  const v = (value ?? "").trim();
  if (!v || !anchorAt || termDateIso(v)) return undefined;
  const anchor = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(anchorAt) ? `${anchorAt}T00:00:00Z` : anchorAt,
  );
  if (!Number.isFinite(anchor.getTime())) return undefined;
  const day = startFromTerm(v, anchor);
  return day ? day.toISOString().slice(0, 10) : undefined;
}

/** The start row's text: the contractor's (already localized) words, plus
 *  the concrete day when the stored term is relative — "Next week
 *  (Nov 26, 2026)". Anything else returns `localized` unchanged. */
export function anchoredStartTerm(
  value: string | undefined,
  anchorAt: string | undefined,
  localized: string,
  lang: "en" | "es" | string,
): string {
  const iso = relativeStartIso(value, anchorAt);
  if (!iso) return localized;
  return `${localized} (${formatTermDate(iso, lang === "es" ? "es" : "en")})`;
}
