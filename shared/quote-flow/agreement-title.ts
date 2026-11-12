/**
 * Agreement title (REQ-036 / NW-57, p82): "'New Job' → 'Godzilla's Concrete
 * Patio Agreement'". The one place the web document and the PDF name the
 * agreement after the customer and the job, in both languages.
 *
 *   en: "<Customer>'s <Job> Agreement"     · no job: "<Customer>'s Agreement"
 *   es: "Acuerdo de <job> de <Customer>"   · no job: "Acuerdo de <Customer>"
 *       REQ-394 (cycle 2, p9): the job sits mid-sentence after "Acuerdo de",
 *       so it is lowered — "Acuerdo de corte de césped semanal de Ana López".
 *   no customer: the job — or the caller's fallback when the job is unknown.
 *
 * A placeholder job name ("New job" / "Nuevo trabajo" — the fallbacks the
 * option generator and the polish pass emit when nothing better exists) is
 * treated as unknown so it never leaks into a customer-facing title.
 *
 * REQ-579 (demo-loop cycle 4, m7): the title names the customer ONCE. A word
 * of the customer's name already in the job name ("Henderson Kitchen Gut",
 * "Henderson's Deck Repair", "Patio para López") is dropped from the job —
 * "Carol Henderson's Kitchen Gut Agreement", never "Carol Henderson's
 * Henderson Kitchen Gut Agreement"; a job that was only the name reads as no
 * job. A token left in the job that is the customer's name keeps its capital.
 */

import {
  jobNameInSentence,
  nameKey,
  trimTrailingConnectors,
} from "./job-name.ts";

export type AgreementLang = "en" | "es";

const PLACEHOLDER_JOBS = new Set([
  "new job",
  "nuevo trabajo",
  "job",
  "trabajo",
]);

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
  const names = new Set(
    customer.split(/\s+/).map(nameKey).filter((k) => k.length >= 2),
  );
  const own = job && withoutCustomer(job, customerNameWords(customer));
  if (lang === "es") {
    return own
      ? `Acuerdo de ${jobNameInSentence(own, { keep: names })} de ${customer}`
      : `Acuerdo de ${customer}`;
  }
  return own ? `${customer}'s ${own} Agreement` : `${customer}'s Agreement`;
}

/** Not a person's surname: a company suffix or a household word. */
const NOT_A_SURNAME = new Set([
  "llc",
  "inc",
  "co",
  "corp",
  "ltd",
  "sa",
  "sl",
  "family",
  "familia",
  "residence",
  "residencia",
  "household",
]);

/** REQ-579: the words of a PERSON's name the job may repeat — the surname
 *  (the last word, capitalised) and the given names before it. A business
 *  ("Kitchen Pros LLC") or a household ("Smith family") gives none, so a
 *  job that shares a word with it ("Kitchen Remodel") is left alone. */
function customerNameWords(customer: string): ReadonlySet<string> {
  const words = customer.split(/\s+/).filter((w) => w.length > 0);
  const last = words[words.length - 1] ?? "";
  if (!/^\p{Lu}/u.test(last) || NOT_A_SURNAME.has(nameKey(last))) {
    return new Set();
  }
  return new Set(words.map(nameKey).filter((k) => k.length >= 2));
}

/** REQ-579: the job without the words of the customer's name (and the
 *  connector that led into them: "para López", "for Henderson"); undefined
 *  when nothing of the job is left. */
function withoutCustomer(
  job: string,
  names: ReadonlySet<string>,
): string | undefined {
  const words = job.split(/\s+/).filter((w) => w.length > 0);
  const kept = words.filter((w) => !names.has(nameKey(w)));
  if (kept.length === words.length) return job;
  const left = trimTrailingConnectors(kept.join(" "));
  const leadIn = /^(?:for|para|de|of|the|la|el|los|las)$/i;
  const rest = left.split(/\s+/).filter((w) => w.length > 0);
  while (rest.length > 0 && leadIn.test(rest[0])) rest.shift();
  return rest.length > 0 && rest.some((w) => /\p{L}{2}/u.test(w))
    ? rest.join(" ")
    : undefined;
}
