/**
 * Contract signature block (raw-plan p14):
 *
 *   "By signing below, <client> agrees to everything above."
 *   CONTRACTOR column: the BUSINESS name, "By: <person>", "Date: <date>"
 *   CUSTOMER column:   "Your signature" / "Sign & type name below ↓"
 *
 * REQ-032 (NW-28): ONE module speaks both languages, so the web document,
 * the PDF and the email never drift between EN and ES — the ES page used to
 * mirror this block through separate i18n strings (two code paths for one
 * block) and the EN named instruction had lost its "↓".
 */

export type SignatureLang = "en" | "es";

const MONTHS: Record<SignatureLang, readonly string[]> = {
  en: [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ],
  es: [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ],
};

function formatDate(iso: string, lang: SignatureLang): string {
  const d = new Date(iso.includes("T") ? iso : `${iso}T00:00:00Z`);
  const month = MONTHS[lang][d.getUTCMonth()];
  return lang === "es"
    ? `${d.getUTCDate()} de ${month} de ${d.getUTCFullYear()}`
    : `${month} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

const COPY: Record<SignatureLang, {
  agrees: (name: string) => string;
  by: string;
  date: string;
  yourSignature: string;
  instruction: string;
}> = {
  en: {
    agrees: (name) => `By signing below, ${name} agrees to everything above.`,
    by: "By:",
    date: "Date:",
    yourSignature: "Your signature",
    instruction: "Sign & type name below ↓",
  },
  es: {
    agrees: (name) => `Al firmar abajo, ${name} acepta todo lo anterior.`,
    by: "Por:",
    date: "Fecha:",
    yourSignature: "Tu firma",
    instruction: "Firma y escribe tu nombre abajo ↓",
  },
};

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
  /** Document language — defaults to English. */
  lang?: SignatureLang;
}): SignatureBlock {
  const { clientName, contractorName, businessName, signedDateISO } = args;
  const lang: SignatureLang = args.lang === "es" ? "es" : "en";
  const c = COPY[lang];
  return {
    agreementLine: c.agrees(clientName),
    contractor: {
      heading: businessName?.trim() ? businessName : contractorName,
      byLine: `${c.by} ${contractorName}`,
      dateLine: `${c.date} ${formatDate(signedDateISO, lang)}`,
    },
    customer: {
      heading: c.yourSignature,
      instruction: c.instruction,
    },
  };
}
