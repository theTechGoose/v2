/**
 * REQ-463 (demo-loop cycle 3, issue m31) — the agreement's 14 plain-English
 * clauses, with clause 7 (Warranty) stated from the quote's terms.
 *
 * The clause list used to be a fixed array in both the web agreement
 * (front-end/components/quote-doc.tsx) and the PDF (render-quote-pdf), and
 * clause 7 always read "Contractor warrants their workmanship for the period
 * stated in this agreement" — even when the agreement states no period: a
 * service trade's wizard has no warranty step (REQ-343) and "No warranty"
 * hides the warranty row. Now:
 *   - a warranty period is set  → `warranty.bodyPeriod` with the period
 *     filled in ("for 6 months" / "por 6 meses");
 *   - "Lifetime"                → `warranty.bodyLifetime`;
 *   - no warranty term, or "No warranty" → `warranty.bodyNone`.
 * The clause keeps its place (7), so the numbering never shifts.
 *
 * Pure: the caller passes its dictionary lookup, the key prefix
 * ("quoteDoc.clause" on the web, "renderQuotePdf.clause" in the PDF) and its
 * own stored-term localizer (English base → reader's language).
 */

export type Translate = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

export const AGREEMENT_CLAUSE_KEYS = [
  "governingLaw",
  "jobDetails",
  "paymentTerms",
  "changeOrders",
  "customerResponsibilities",
  "delays",
  "warranty",
  "limitationOfLiability",
  "rightToStopWork",
  "termination",
  "disputeResolution",
  "permits",
  "indemnification",
  "entireAgreement",
] as const;

export type WarrantyClauseKind =
  | { kind: "none" }
  | { kind: "lifetime" }
  | { kind: "period"; period: string };

const NO_WARRANTY = new Set([
  "",
  "no warranty",
  "none",
  "n/a",
  "no",
  "sin garantía",
  "sin garantia",
  "ninguna",
]);
const LIFETIME = new Set(["lifetime", "de por vida"]);

/** True when a stored warranty value means "no warranty". */
export function isNoWarrantyValue(value: string | undefined): boolean {
  return NO_WARRANTY.has((value ?? "").trim().toLowerCase());
}

/** What the agreement actually says about the warranty, from its terms. */
export function warrantyClauseKind(
  terms: readonly { stepId: string; value: string }[] | undefined | null,
): WarrantyClauseKind {
  const raw = terms?.find((t) => t.stepId === "warranty")?.value;
  if (raw === undefined || isNoWarrantyValue(raw)) return { kind: "none" };
  const v = raw.trim();
  if (LIFETIME.has(v.toLowerCase())) return { kind: "lifetime" };
  // The wizard's "Custom" option is `custom_months`: a bare number is months.
  if (/^\d+$/.test(v)) {
    return { kind: "period", period: `${v} ${v === "1" ? "month" : "months"}` };
  }
  return { kind: "period", period: v };
}

/** The 14 clauses as [title, body] pairs, in order, in `lang`. */
export function agreementClauses<L extends string>(input: {
  terms: readonly { stepId: string; value: string }[] | undefined | null;
  lang: L;
  prefix: string;
  t: Translate;
  localize: (value: string, lang: L) => string;
}): [string, string][] {
  const { terms, lang, prefix, t, localize } = input;
  const w = warrantyClauseKind(terms);
  return AGREEMENT_CLAUSE_KEYS.map((k) => {
    const title = t(`${prefix}.${k}.title`);
    if (k !== "warranty") return [title, t(`${prefix}.${k}.body`)];
    if (w.kind === "period") {
      return [
        title,
        t(`${prefix}.warranty.bodyPeriod`, {
          period: localize(w.period, lang),
        }),
      ];
    }
    return [
      title,
      t(`${prefix}.warranty.${
        w.kind === "lifetime" ? "bodyLifetime" : "bodyNone"
      }`),
    ];
  });
}
