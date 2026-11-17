/**
 * REQ-771 (demo-loop cycle 5v5, M7) — a deadline the contractor typed is a
 * TERM on the quote, never only a chat line.
 *
 * The verifier typed "… Has to be done before Thanksgiving." in the
 * help-me-price flow; the finished quote named Thanksgiving nowhere — not in
 * the job details (REQ-653 keeps a deadline out of the scope bullets) and not
 * in the Terms rows (REQ-653 / REQ-763 only SAID it in the chat). The terms
 * wizard now stores it as the `deadline` row, after the time to complete.
 *
 * Stored in the English base like every other term ("Before 2026-11-26
 * (Thanksgiving)", "By 2026-12-05") and read in each reader's language
 * ("Before Thanksgiving (Nov 26, 2026)", "Antes de Acción de Gracias (26 nov
 * 2026)"). Dependency-free apart from the date formatter; translation is
 * injected.
 */
import { formatTermDate } from "./format-helpers.ts";

export const DEADLINE_STEP_ID = "deadline";
/** The stored (English base) label; readers label the row by stepId. */
export const DEADLINE_TERM_LABEL = "Deadline";

export type DeadlineHoliday =
  | "thanksgiving"
  | "christmasEve"
  | "christmas"
  | "newYearsEve"
  | "newYear"
  | "endOfYear";

/** The English base name of each holiday, as stored. */
const HOLIDAY_NAMES: Record<DeadlineHoliday, string> = {
  thanksgiving: "Thanksgiving",
  christmasEve: "Christmas Eve",
  christmas: "Christmas",
  newYearsEve: "New Year's Eve",
  newYear: "New Year's Day",
  endOfYear: "End of year",
};

export interface DeadlineTerm {
  iso: string;
  before: boolean;
  holiday?: DeadlineHoliday;
}

type Lang = "en" | "es";
type Translate = (
  lang: Lang,
  key: string,
  vars?: Record<string, string | number>,
) => string;

/** "Before 2026-11-26 (Thanksgiving)" / "By 2026-12-05". */
export function deadlineTermValue(d: DeadlineTerm): string {
  const name = d.holiday ? HOLIDAY_NAMES[d.holiday] : undefined;
  return `${d.before ? "Before" : "By"} ${d.iso}${name ? ` (${name})` : ""}`;
}

const STORED = /^(Before|By) (\d{4}-\d{2}-\d{2})(?: \(([^)]+)\))?$/;

/** The stored value read back; null for anything that is not one. */
export function parseDeadlineTerm(
  value: string | null | undefined,
): DeadlineTerm | null {
  const m = STORED.exec((value ?? "").trim());
  if (!m) return null;
  const holiday = m[3]
    ? (Object.keys(HOLIDAY_NAMES) as DeadlineHoliday[]).find((h) =>
      HOLIDAY_NAMES[h] === m[3]
    )
    : undefined;
  if (m[3] && !holiday) return null;
  return {
    iso: m[2],
    before: m[1] === "Before",
    ...(holiday ? { holiday } : {}),
  };
}

/** The stored value in `lang` — null when it is not a deadline value. */
export function localizeDeadlineTerm(
  value: string,
  lang: Lang,
  t: Translate,
): string | null {
  const d = parseDeadlineTerm(value);
  if (!d) return null;
  const date = formatTermDate(d.iso, lang);
  if (d.holiday) {
    return t(
      lang,
      d.before ? "deadlineTerm.beforeNamed" : "deadlineTerm.byNamed",
      {
        holiday: t(lang, `deadlineTerm.holiday.${d.holiday}`),
        date,
      },
    );
  }
  return t(lang, d.before ? "deadlineTerm.before" : "deadlineTerm.by", {
    date,
  });
}

/**
 * The terms with the deadline row in place: after the time to complete (else
 * the start, else last), replacing an older one. Unchanged without a
 * deadline, or with no terms yet (a lone deadline row would hide the
 * wizard's picks from the preview, which reads the transcript until the
 * quote holds terms).
 */
export function withDeadlineTerm<
  T extends { stepId: string; label: string; value: string },
>(terms: readonly T[], deadline: DeadlineTerm | null | undefined): T[] {
  const rest = terms.filter((x) => x.stepId !== DEADLINE_STEP_ID);
  if (!deadline || rest.length === 0) return [...terms];
  const row = {
    stepId: DEADLINE_STEP_ID,
    label: DEADLINE_TERM_LABEL,
    value: deadlineTermValue(deadline),
  } as T;
  const after = (ids: string[]) =>
    rest.reduce((at, x, i) => ids.includes(x.stepId) ? i : at, -1);
  let at = after(["wraps", "time_to_complete"]);
  if (at === -1) at = after(["start_date"]);
  const i = at === -1 ? rest.length : at + 1;
  return [...rest.slice(0, i), row, ...rest.slice(i)];
}
