/**
 * REQ-783 (demo-loop cycle dv1, issue d4) — the agreement's cancellation
 * notice is a term the owner sees and can change before the quote goes out.
 * Raphael: "Yes, default terms." — the default stays 7 days' notice.
 *
 * Every agreement has stated "Cancellation: 7 days' notice" (REQ-035) and
 * clause 10 "… by providing 7 days' written notice", but the quote review
 * never listed it. Now:
 *   - no `cancellation` term on the quote → the 7-day default (old quotes
 *     and every new quote until the owner touches the row);
 *   - the review's Cancellation row stores `{ stepId: "cancellation" }`
 *     with the option it shows ("14 days' notice" / "Aviso de 14 días"),
 *     "No notice period" to remove the notice, or the owner's own text;
 *   - the review, the customer's agreement (/q) and the PDF read the notice
 *     through these helpers, so they always say the same thing.
 *
 * Pure and dependency-free: the backend (#quote-flow/), the front-end and
 * Jest import it. Translation is injected.
 */

export const CANCELLATION_STEP_ID = "cancellation";
/** The stored (English-base) label of the row. */
export const CANCELLATION_LABEL = "Cancellation";
/** Raphael: "Yes, default terms." — the notice every agreement keeps. */
export const DEFAULT_CANCELLATION_DAYS = 7;

export type CancellationNotice =
  | { kind: "days"; days: number }
  | { kind: "none" }
  | { kind: "text"; text: string };

const fold = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").replace(/[’`]/g, "'")
    .replace(/\s+/g, " ").trim().toLowerCase();

const NONE =
  /^(?:none|no|n\/a|no notice(?: period| required)?|ninguno|ninguna|sin (?:plazo de )?aviso)$/;
const DAYS = /(\d+)\s*(?:days?|dias?)\b/;

/** The cancellation notice the agreement states, from its terms. */
export function cancellationNotice(
  terms: readonly { stepId?: string; value?: string }[] | null | undefined,
): CancellationNotice {
  const raw = (terms ?? []).find((t) => t?.stepId === CANCELLATION_STEP_ID)
    ?.value;
  if (raw === undefined || raw === null) {
    return { kind: "days", days: DEFAULT_CANCELLATION_DAYS };
  }
  const v = fold(raw);
  if (!v || NONE.test(v)) return { kind: "none" };
  const m = v.match(DAYS);
  const days = m ? Number(m[1]) : NaN;
  if (Number.isInteger(days) && days > 1) return { kind: "days", days };
  return { kind: "text", text: raw.trim() };
}

/** `t(key, vars)` already bound to the reader's language. */
export type BoundTranslate = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

export interface NoticeReader {
  /** "quoteDoc" (web, review) or "renderQuotePdf" (PDF). */
  prefix: string;
  t: BoundTranslate;
  /** The stored-term localizer for the owner's own text. */
  localize: (value: string) => string;
}

/** The Cancellation row's value in the reader's language. */
export function cancellationValueText(
  terms: readonly { stepId?: string; value?: string }[] | null | undefined,
  { prefix, t, localize }: NoticeReader,
): string {
  const n = cancellationNotice(terms);
  if (n.kind === "days") {
    return t(`${prefix}.termValue.cancellationDays`, { n: n.days });
  }
  if (n.kind === "none") return t(`${prefix}.termValue.cancellationNone`);
  return localize(n.text);
}

/** Clause 10 (Termination) stating the same notice. `prefix` is the clause
 *  prefix ("quoteDoc.clause" / "renderQuotePdf.clause"). The default reads
 *  exactly as the clause always did. */
export function terminationClauseBody(
  terms: readonly { stepId?: string; value?: string }[] | null | undefined,
  { prefix, t, localize }: NoticeReader,
): string {
  const n = cancellationNotice(terms);
  if (n.kind === "days") {
    return t(`${prefix}.termination.bodyDays`, { n: n.days });
  }
  if (n.kind === "none") return t(`${prefix}.termination.bodyNone`);
  return t(`${prefix}.termination.bodyText`, { notice: localize(n.text) });
}

/**
 * The quote review's Terms rows with the Cancellation row last: the stored
 * one when the owner set it, else the 7-day default — in `lang`, the value
 * read exactly as the customer's agreement reads it.
 */
export function withCancellationRow<
  R extends { stepId: string; label: string; value: string },
>(
  rows: readonly R[],
  input: {
    quoteTerms:
      | readonly { stepId?: string; value?: string }[]
      | null
      | undefined;
    lang: "en" | "es";
    t: (
      lang: "en" | "es",
      key: string,
      vars?: Record<string, string | number>,
    ) => string;
    localize: (value: string, lang: "en" | "es") => string;
  },
): Array<R | { stepId: string; label: string; value: string }> {
  const { quoteTerms, lang, t, localize } = input;
  return [
    ...rows.filter((r) => r.stepId !== CANCELLATION_STEP_ID),
    {
      stepId: CANCELLATION_STEP_ID,
      label: CANCELLATION_LABEL,
      value: cancellationValueText(quoteTerms, {
        prefix: "quoteDoc",
        t: (key, vars) => t(lang, key, vars),
        localize: (v) => localize(v, lang),
      }),
    },
  ];
}
