/**
 * Quote-ready SMS (raw-plan p15) — the exact template:
 *
 *   Hi [Customer Name], this is [Contractor Name] from [Business Name].
 *   Your Quote + Agreement for [Job Name] is ready:
 *   [LINK]
 *   Please let me know if you have any questions. I look forward to working with you!
 */

export function buildQuoteReadySms(args: {
  customerName: string;
  contractorName: string;
  businessName: string;
  jobName: string;
  link: string;
}): string {
  const { customerName, contractorName, businessName, jobName, link } = args;
  return [
    `Hi ${customerName}, this is ${contractorName} from ${businessName}.`,
    `Your Quote + Agreement for ${jobName} is ready:`,
    link,
    "Please let me know if you have any questions. I look forward to working with you!",
  ].join("\n");
}
