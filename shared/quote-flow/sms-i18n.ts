/**
 * Outbound-SMS i18n (P-27 / P-30 / P-49 / P-50) — sibling of sms-template.ts.
 *
 * Pure logic, shared between the Deno backend and the jest unit suite — no
 * side effects, no runtime JSON loading. The literal templates below are
 * copies of lang/en.json + lang/es.json values (key named at each map) and
 * MUST be kept in sync with the dictionaries; where a template FIXES a
 * problem (P-30/P-49/P-50) the dict entry must be updated to match.
 *
 * Wire-in targets (backend agent):
 *  - smsJobName → send-paperwork-sms/mod.ts:305 (renderQuoteBody) and :331
 *    (renderContractBody); send-signed-confirmation/mod.ts:281;
 *    send-accepted-alert/mod.ts:63 (with the CONTRACTOR's language).
 *  - buildSignedConfirmSms → send-signed-confirmation/mod.ts:279-291.
 *  - buildInvoiceSms → send-paperwork-sms/mod.ts:386-403 (renderInvoiceBody).
 *  - buildAcceptedAlertSubject / buildAcceptedAlertSms →
 *    send-accepted-alert/mod.ts:63, 71-76, 105-111.
 */

export type SmsLang = "en" | "es";

/** Keep in sync with lang/{en,es}.json "paperworkSms.body.jobNameFallback". */
const JOB_NAME_FALLBACK: Record<SmsLang, string> = {
  en: "your project",
  es: "tu proyecto",
};

/**
 * P-27 — localized job-name projection, mirroring the email path
 * (send-paperwork-email/mod.ts:529): jobNameByLang[lang] → jobName →
 * summaryByLang[lang]/summary with the leading "quote:" stripped → the
 * language's project fallback.
 */
export function smsJobName(
  quote: {
    jobName?: string;
    jobNameByLang?: Record<string, string>;
    summary?: string;
    summaryByLang?: Record<string, string>;
  },
  lang: SmsLang,
): string {
  return (quote.jobNameByLang?.[lang] ?? quote.jobName)?.trim() ||
    (quote.summaryByLang?.[lang] ?? quote.summary)
      ?.replace(/^\s*quote\s*:\s*/i, "").trim() ||
    JOB_NAME_FALLBACK[lang];
}

/**
 * Signed-confirmation SMS templates.
 * Keep in sync with lang/{en,es}.json "signedConfirm.sms.body".
 */
const SIGNED_CONFIRM_BODY: Record<SmsLang, string> = {
  en: "Hi {first}, your Quote + Agreement for {jobName} is signed — " +
    "you're all set! A signed copy + your first invoice are on the way: " +
    "{url}{fromBiz}",
  es: "Hola {first}, tu Cotización + Acuerdo para {jobName} está firmada — " +
    "¡todo listo! Te enviaremos una copia firmada y tu primera factura: " +
    "{url}{fromBiz}",
};

/**
 * P-30 — customer-facing signed-confirmation SMS. Unnamed EN customers keep
 * the "Hi there, …" fallback (lang/en.json "signedConfirm.sms.nameFallback");
 * unnamed ES customers get the natural "Hola, …" — NEVER the doubled
 * "Hola hola" that the old es nameFallback ("hola") produced.
 */
export function buildSignedConfirmSms(args: {
  customerFirstName?: string;
  /** ALREADY localized (callers pass smsJobName(...)). */
  jobName: string;
  url: string;
  /** Appended as " — {businessName}" when present. */
  businessName?: string;
  lang: SmsLang;
}): string {
  const first = args.customerFirstName?.trim();
  const fromBiz = args.businessName?.trim()
    ? ` — ${args.businessName.trim()}`
    : "";
  const template = SIGNED_CONFIRM_BODY[args.lang];
  const greeted = first
    ? template.replace("{first}", first)
    : args.lang === "en"
    // lang/en.json "signedConfirm.sms.nameFallback": "there"
    ? template.replace("{first}", "there")
    // Natural unnamed es greeting: "Hola, tu Cotización …"
    : template.replace(" {first},", ",");
  return greeted.replace("{jobName}", args.jobName)
    .replace("{url}", args.url)
    .replace("{fromBiz}", fromBiz);
}

/**
 * Invoice SMS templates.
 * Keep in sync with lang/{en,es}.json "paperworkSms.invoice.body" /
 * ".lead" / ".tail".
 */
const INVOICE_BODY: Record<SmsLang, string> = {
  en: "{lead}your invoice is ready ({amount}). View & pay: {url}{tail}",
  es: "{lead}tu factura está lista ({amount}). Ver y pagar: {url}{tail}",
};
const INVOICE_LEAD: Record<SmsLang, string> = {
  en: "Hi {hi}, ",
  es: "Hola {hi}, ",
};
const INVOICE_TAIL: Record<SmsLang, string> = {
  en: " — {who}",
  es: " — {who}",
};

/**
 * P-49 — the invoice SMS body ALWAYS starts with a capital letter: the
 * personal greeting when the customer is named, else the sentence itself
 * capitalized ("Your invoice…" / "Tu factura…" — never a lowercase start).
 * `amount` arrives preformatted (e.g. "$2,500") — formatting stays with the
 * caller.
 */
export function buildInvoiceSms(args: {
  customerFirstName?: string;
  contractorFirstName?: string;
  amount: string;
  url: string;
  lang: SmsLang;
}): string {
  const { lang } = args;
  const hi = args.customerFirstName?.trim();
  const who = args.contractorFirstName?.trim();
  const lead = hi ? INVOICE_LEAD[lang].replace("{hi}", hi) : "";
  const tail = who ? INVOICE_TAIL[lang].replace("{who}", who) : "";
  const body = INVOICE_BODY[lang]
    .replace("{lead}", lead)
    .replace("{amount}", args.amount)
    .replace("{url}", args.url)
    .replace("{tail}", tail);
  return lead
    ? body
    : body.charAt(0).toLocaleUpperCase(lang === "es" ? "es" : "en-US") +
      body.slice(1);
}

/**
 * Accepted-alert (quote approved) templates, contractor-facing.
 * No-job variants: keep in sync with lang/{en,es}.json
 * "acceptedAlert.email.subject" / "acceptedAlert.sms.body".
 * With-job variants FIX P-50 (tone parity: es keeps ¡…!, en keeps 🎉) —
 * lang/{en,es}.json "acceptedAlert.email.subjectJob" /
 * "acceptedAlert.sms.bodyJob" must be updated to match.
 */
const ACCEPTED_SUBJECT: Record<SmsLang, string> = {
  en: "{name} approved your quote 🎉",
  es: "¡{name} aprobó tu cotización! 🎉",
};
const ACCEPTED_SUBJECT_JOB: Record<SmsLang, string> = {
  en: "{name} approved your quote for {job} 🎉",
  es: "¡{name} aprobó tu cotización de {job}! 🎉",
};
const ACCEPTED_SMS: Record<SmsLang, string> = {
  en: "{name} just approved your quote. Next step: send the agreement or " +
    "invoice → {url}",
  es: "{name} acaba de aprobar tu cotización. Siguiente paso: envía el " +
    "contrato o la factura → {url}",
};
const ACCEPTED_SMS_JOB: Record<SmsLang, string> = {
  en: "{name} just approved your quote for {job}. Next step: send the " +
    "agreement or invoice → {url}",
  es: "{name} acaba de aprobar tu cotización de {job}. Siguiente paso: " +
    "envía el contrato o la factura → {url}",
};

/** P-50/P-27 — the job name in the CONTRACTOR's language, or undefined. */
function acceptedJobName(
  quote: { jobName?: string; jobNameByLang?: Record<string, string> },
  lang: SmsLang,
): string | undefined {
  return (quote.jobNameByLang?.[lang] ?? quote.jobName)?.trim() || undefined;
}

/**
 * P-50 — accepted-alert email subject in the CONTRACTOR's language. The
 * with-job variant keeps the celebratory tone of the no-job anchor
 * (es: ¡…! + 🎉, en: 🎉) and projects the job via jobNameByLang[lang].
 */
export function buildAcceptedAlertSubject(args: {
  customerName: string;
  quote: { jobName?: string; jobNameByLang?: Record<string, string> };
  /** CONTRACTOR's language. */
  lang: SmsLang;
}): string {
  const job = acceptedJobName(args.quote, args.lang);
  const template = job
    ? ACCEPTED_SUBJECT_JOB[args.lang]
    : ACCEPTED_SUBJECT[args.lang];
  return template.replace("{name}", args.customerName)
    .replace("{job}", job ?? "");
}

/**
 * P-50 — accepted-alert SMS body in the CONTRACTOR's language; the job name
 * is projected via jobNameByLang[lang], never the raw wrong-language one.
 */
export function buildAcceptedAlertSms(args: {
  customerName: string;
  quote: { jobName?: string; jobNameByLang?: Record<string, string> };
  url: string;
  /** CONTRACTOR's language. */
  lang: SmsLang;
}): string {
  const job = acceptedJobName(args.quote, args.lang);
  const template = job ? ACCEPTED_SMS_JOB[args.lang] : ACCEPTED_SMS[args.lang];
  return template.replace("{name}", args.customerName)
    .replace("{job}", job ?? "")
    .replace("{url}", args.url);
}
