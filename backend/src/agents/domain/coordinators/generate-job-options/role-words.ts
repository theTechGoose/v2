/**
 * REQ-667 (demo-loop cycle 5, m49): the job-options prompt names the three
 * roles (CONCISE / STANDARD / DETAILED), and the model echoed them back as
 * the option's summary — "Concise scope of work" / "Alcance de trabajo
 * conciso" — which became the line description on the customer's agreement.
 * A summary or jobName that names an option role (or is just "scope of
 * work") describes the option, not the job, and must never reach the client.
 */
const ROLE_WORD =
  /(?<!\p{L})(?:concise|standard|detailed|concis[oa]s?|est[aá]ndar(?:es)?|detallad[oa]s?)(?!\p{L})|scope of work|alcance de(?:l)? trabajo/iu;

export function namesOptionRole(text: string): boolean {
  return ROLE_WORD.test(text);
}
