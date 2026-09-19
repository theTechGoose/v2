/**
 * Agreement title (REQ-036 / NW-57, p82): "'New Job' → 'Godzilla's Concrete
 * Patio Agreement'". The one place the web document and the PDF name the
 * agreement after the customer and the job, in both languages.
 *
 *   en: "<Customer>'s <Job> Agreement"     · no job: "<Customer>'s Agreement"
 *   es: "Acuerdo de <Job> de <Customer>"   · no job: "Acuerdo de <Customer>"
 *   no customer: the job — or the caller's fallback when the job is unknown.
 *
 * A placeholder job name ("New job" / "Nuevo trabajo" — the fallbacks the
 * option generator and the polish pass emit when nothing better exists) is
 * treated as unknown so it never leaks into a customer-facing title.
 */

export type AgreementLang = "en" | "es";

const PLACEHOLDER_JOBS = new Set(["new job", "nuevo trabajo", "job", "trabajo"]);

function realJob(job: string | undefined): string | undefined {
  const s = job?.trim();
  if (!s) return undefined;
  return PLACEHOLDER_JOBS.has(s.toLowerCase()) ? undefined : s;
}

export function agreementTitle(args: {
  customer?: string;
  job?: string;
  lang: AgreementLang;
  /** Used when neither a customer nor a real job name is known. */
  fallback?: string;
}): string {
  const customer = args.customer?.trim() || undefined;
  const job = realJob(args.job);
  const lang: AgreementLang = args.lang === "es" ? "es" : "en";
  if (!customer) return job ?? args.fallback ?? "";
  if (lang === "es") {
    return job ? `Acuerdo de ${job} de ${customer}` : `Acuerdo de ${customer}`;
  }
  return job ? `${customer}'s ${job} Agreement` : `${customer}'s Agreement`;
}
