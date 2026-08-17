/**
 * Quote email subject (raw-plan p13): the job name appears bare — never
 * wrapped in quotation marks. Apostrophes inside names stay legal.
 */

export function buildQuoteEmailSubject(
  { jobName, contractorName }: { jobName: string; contractorName: string },
): string {
  const bareJobName = jobName.replace(/["“”]/g, "").trim();
  return `Your quote for ${bareJobName} is ready — from ${contractorName}`;
}
