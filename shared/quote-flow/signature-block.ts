/**
 * Contract signature block (raw-plan p14):
 *
 *   "By signing below, <client> agrees to everything above."
 *   CONTRACTOR column: the BUSINESS name, "By: <person>", "Date: <date>"
 *   CUSTOMER column:   "YOUR Signature" / "Sign & type name below"
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatDate(iso: string): string {
  const d = new Date(iso.includes("T") ? iso : `${iso}T00:00:00Z`);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export interface SignatureBlock {
  agreementLine: string;
  contractor: { heading: string; byLine: string; dateLine: string };
  customer: { heading: string; instruction: string };
}

export function buildSignatureBlock(args: {
  clientName: string;
  contractorName: string;
  businessName?: string;
  signedDateISO: string;
}): SignatureBlock {
  const { clientName, contractorName, businessName, signedDateISO } = args;
  return {
    agreementLine: `By signing below, ${clientName} agrees to everything above.`,
    contractor: {
      heading: businessName?.trim() ? businessName : contractorName,
      byLine: `By: ${contractorName}`,
      dateLine: `Date: ${formatDate(signedDateISO)}`,
    },
    customer: {
      heading: "YOUR Signature",
      instruction: "Sign & type name below",
    },
  };
}
