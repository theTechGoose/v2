/**
 * RED (TDD) — outbound-SMS i18n + greeting contracts.
 *
 * Problems covered (problems.md, verbatim fragments):
 *  P-27: "SMS sends the wrong-language job name. send-paperwork-sms/mod.ts:305,331
 *         use raw q.jobName while the email path correctly projects jobNameByLang[lang]"
 *  P-30: "'Hola hola,' SMS to unnamed customers. ES signedConfirm.sms.nameFallback =
 *         'hola' fills 'Hola {first}…' → 'Hola hola, tu Cotización + Acuerdo…'"
 *  P-49: "Invoice SMS begins lowercase for unnamed customers — 'tu factura está
 *         lista ($X)…'"
 *  P-50: "Accepted-alert inconsistencies: the with-job subject variant loses the ¡!
 *         and celebratory tone; uses raw jobName (no ByLang)"
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * GREEN AGENT — create `shared/quote-flow/sms-i18n.ts` (new module, sibling of
 * the existing sms-template.ts) with EXACTLY these exports:
 *
 *   export type SmsLang = "en" | "es";
 *
 *   // P-27 — localized job-name projection, mirroring the email path
 *    *  (backend/src/paperwork/domain/coordinators/send-paperwork-email/mod.ts:529):
 *    *    (jobNameByLang?.[lang] ?? jobName)?.trim()
 *    *      || (summaryByLang?.[lang] ?? summary) with the /^quote:/i prefix stripped
 *    *      || lang fallback ("your project" / "tu proyecto" — the exact
 *    *         paperworkSms.body.jobNameFallback values in lang/en.json:1636 /
 *    *         lang/es.json:1636).
 *    *  Wire into: send-paperwork-sms/mod.ts:305 (renderQuoteBody) and :331
 *    *  (renderContractBody); send-signed-confirmation/mod.ts:281; and
 *    *  send-accepted-alert/mod.ts:63 (with the CONTRACTOR's language).  //
 *   export function smsJobName(
 *     quote: {
 *       jobName?: string;
 *       jobNameByLang?: Record<string, string>;
 *       summary?: string;
 *       summaryByLang?: Record<string, string>;
 *     },
 *     lang: SmsLang,
 *   ): string;
 *
 *   // P-30 — the customer-facing signed-confirmation SMS body.
 *    *  Template today (lang/{en,es}.json "signedConfirm.sms.body"):
 *    *    en: "Hi {first}, your Quote + Agreement for {jobName} is signed — you're
 *    *         all set! A signed copy + your first invoice are on the way: {url}{fromBiz}"
 *    *    es: "Hola {first}, tu Cotización + Acuerdo para {jobName} está firmada —
 *    *         ¡todo listo! Te enviaremos una copia firmada y tu primera factura: {url}{fromBiz}"
 *    *  EN unnamed fallback "there" is fine ("Hi there, …"). The ES unnamed
 *    *  fallback must produce a NATURAL greeting (e.g. "Hola, tu Cotización…") —
 *    *  never the doubled "Hola hola". Update lang/es.json
 *    *  "signedConfirm.sms.nameFallback" (line 2405, currently "hola") and/or the
 *    *  composition accordingly, and wire into
 *    *  send-signed-confirmation/mod.ts:279-291.  //
 *   export function buildSignedConfirmSms(args: {
 *     customerFirstName?: string; // undefined/"" ⇒ unnamed customer
 *     jobName: string;            // ALREADY localized (callers pass smsJobName(...))
 *     url: string;
 *     businessName?: string;      // appended as " — {businessName}" when present
 *     lang: SmsLang;
 *   }): string;
 *
 *   // P-49 — the invoice SMS body.
 *    *  Template today (lang/{en,es}.json "paperworkSms.invoice.*"):
 *    *    body en: "{lead}your invoice is ready ({amount}). View & pay: {url}{tail}"
 *    *    body es: "{lead}tu factura está lista ({amount}). Ver y pagar: {url}{tail}"
 *    *    lead: "Hi {hi}, " / "Hola {hi}, "   tail: " — {who}"
 *    *  When the customer is unnamed, lead = "" and the SMS starts lowercase
 *    *  ("tu factura…" / "your invoice…"). Desired: the body ALWAYS starts with a
 *    *  capital letter (a real greeting or a capitalized sentence) in BOTH langs.
 *    *  `amount` arrives preformatted (e.g. "$2,500") — formatting stays with the
 *    *  caller. Wire into send-paperwork-sms/mod.ts:386-403 (renderInvoiceBody).  //
 *   export function buildInvoiceSms(args: {
 *     customerFirstName?: string;
 *     contractorFirstName?: string;
 *     amount: string; // preformatted, e.g. "$2,500"
 *     url: string;
 *     lang: SmsLang;
 *   }): string;
 *
 *   // P-50 — the contractor-facing accepted alert (quote approved), rendered in
 *    *  the CONTRACTOR's language. Both helpers must project the job name via
 *    *  jobNameByLang[lang] (P-27's smsJobName), and the with-job SUBJECT must
 *    *  keep the celebratory tone of the no-job variant
 *    *  (lang/es.json:9 "¡{name} aprobó tu cotización! 🎉" / lang/en.json:9
 *    *  "{name} approved your quote 🎉"): es keeps the ¡…!, en keeps the 🎉.
 *    *  Wire into send-accepted-alert/mod.ts:63,71-76,105-111 and keep the
 *    *  lang/{en,es}.json "acceptedAlert.email.subjectJob" /
 *    *  "acceptedAlert.sms.bodyJob" entries in sync.  //
 *   export function buildAcceptedAlertSubject(args: {
 *     customerName: string;
 *     quote: { jobName?: string; jobNameByLang?: Record<string, string> };
 *     lang: SmsLang; // CONTRACTOR's language
 *   }): string;
 *
 *   export function buildAcceptedAlertSms(args: {
 *     customerName: string;
 *     quote: { jobName?: string; jobNameByLang?: Record<string, string> };
 *     url: string;
 *     lang: SmsLang; // CONTRACTOR's language
 *   }): string;
 *
 * The module does not exist yet, so this whole file fails with
 * "Cannot find module" — that is the intended red.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import {
  buildAcceptedAlertSms,
  buildAcceptedAlertSubject,
  buildInvoiceSms,
  buildSignedConfirmSms,
  smsJobName,
} from "../../shared/quote-flow/sms-i18n";

const QUOTE = {
  jobName: "Kitchen Remodel",
  jobNameByLang: { en: "Kitchen Remodel", es: "Remodelación de cocina" },
};

/** Sentence-initial capital: an uppercase letter (incl. Spanish accents/Ñ) or ¡. */
const STARTS_CAPITAL = /^(¡|[A-ZÁÉÍÓÚÜÑ])/u;

describe("P-27 smsJobName — SMS projects jobNameByLang[lang] exactly like email", () => {
  it("P-27: returns the es projection when the contractor's language is es", () => {
    expect(smsJobName(QUOTE, "es")).toBe("Remodelación de cocina");
  });

  it("P-27: returns the en projection when the contractor's language is en", () => {
    expect(smsJobName(QUOTE, "en")).toBe("Kitchen Remodel");
  });

  it("P-27: falls back to raw jobName when the language has no projection", () => {
    expect(smsJobName({ jobName: "Deck Repair", jobNameByLang: { en: "Deck Repair" } }, "es"))
      .toBe("Deck Repair");
  });

  it("P-27: falls back to the summary (quote: prefix stripped) when there is no jobName", () => {
    expect(smsJobName({ summary: "Quote: Remodel the kitchen" }, "en"))
      .toBe("Remodel the kitchen");
  });

  it("P-27: uses the language's project fallback when the quote has neither", () => {
    // Exact paperworkSms.body.jobNameFallback values (lang/en.json:1636 / lang/es.json:1636).
    expect(smsJobName({}, "en")).toBe("your project");
    expect(smsJobName({}, "es")).toBe("tu proyecto");
  });
});

describe("P-30 buildSignedConfirmSms — natural greeting, never 'Hola hola'", () => {
  const base = {
    jobName: "Remodelación de cocina",
    url: "https://paperworkmonster.com/c/abc123",
    businessName: "MARTA LLC",
  };

  it("P-30: es + named customer greets by first name over the localized job", () => {
    const sms = buildSignedConfirmSms({ ...base, customerFirstName: "Ana", lang: "es" });
    expect(sms).toContain("Hola Ana");
    expect(sms).toContain("Cotización + Acuerdo para Remodelación de cocina");
    expect(sms).toContain(base.url);
  });

  it("P-30: es + UNNAMED customer never produces the doubled 'Hola hola'", () => {
    const sms = buildSignedConfirmSms({ ...base, customerFirstName: undefined, lang: "es" });
    expect(sms).not.toMatch(/hola[\s,]+hola/i);
  });

  it("P-30: es + UNNAMED customer still reads as a natural, capitalized greeting", () => {
    const sms = buildSignedConfirmSms({ ...base, customerFirstName: "", lang: "es" });
    expect(sms).toMatch(STARTS_CAPITAL);
    expect(sms).toContain("Cotización + Acuerdo");
    expect(sms).toContain(base.url);
  });

  it("P-30: en + UNNAMED customer keeps the fine 'Hi there' fallback", () => {
    const sms = buildSignedConfirmSms({ ...base, jobName: "Kitchen Remodel", customerFirstName: undefined, lang: "en" });
    expect(sms).toMatch(/^Hi there\b/);
    expect(sms).toContain("Quote + Agreement for Kitchen Remodel");
  });
});

describe("P-49 buildInvoiceSms — always starts with a capital letter", () => {
  const base = { amount: "$2,500", url: "https://paperworkmonster.com/i/inv123" };

  it("P-49: es + UNNAMED customer starts with a capital (greeting or capitalized sentence)", () => {
    const sms = buildInvoiceSms({ ...base, contractorFirstName: "Marta", lang: "es" });
    expect(sms).toMatch(STARTS_CAPITAL);
    expect(sms).toMatch(/factura/i);
    expect(sms).toContain("($2,500)");
    expect(sms).toContain(base.url);
    expect(sms).not.toMatch(/hola[\s,]+hola/i);
  });

  it("P-49: en + UNNAMED customer starts with a capital too", () => {
    const sms = buildInvoiceSms({ ...base, contractorFirstName: "Marta", lang: "en" });
    expect(sms).toMatch(/^[A-Z]/);
    expect(sms).toMatch(/invoice/i);
    expect(sms).toContain("($2,500)");
  });

  it("P-49: named customers keep the personal lead ('Hola {first}, ' / 'Hi {first}, ')", () => {
    const es = buildInvoiceSms({ ...base, customerFirstName: "Ana", contractorFirstName: "Marta", lang: "es" });
    expect(es).toContain("Hola Ana");
    expect(es).toMatch(/factura/i);
    const en = buildInvoiceSms({ ...base, customerFirstName: "Ana", contractorFirstName: "Marta", lang: "en" });
    expect(en).toContain("Hi Ana");
    expect(en).toMatch(/invoice/i);
  });
});

describe("P-50 buildAcceptedAlert — with-job variant keeps the celebration and projects jobNameByLang", () => {
  const args = { customerName: "Ana", quote: QUOTE };

  it("P-50: es no-job subject is the celebratory anchor (¡…!)", () => {
    const subject = buildAcceptedAlertSubject({ customerName: "Ana", quote: {}, lang: "es" });
    expect(subject).toMatch(/^¡/);
    expect(subject).toContain("!");
    expect(subject).toContain("Ana");
  });

  it("P-50: es WITH-JOB subject keeps the ¡…! tone parity with the no-job variant", () => {
    const subject = buildAcceptedAlertSubject({ ...args, lang: "es" });
    expect(subject).toMatch(/^¡/);
    expect(subject).toContain("!");
  });

  it("P-50: es WITH-JOB subject carries the ES job name, never the raw EN one", () => {
    const subject = buildAcceptedAlertSubject({ ...args, lang: "es" });
    expect(subject).toContain("Remodelación de cocina");
    expect(subject).not.toContain("Kitchen Remodel");
  });

  it("P-50: en WITH-JOB subject keeps the 🎉 celebration of the en no-job variant", () => {
    const subject = buildAcceptedAlertSubject({ ...args, lang: "en" });
    expect(subject).toContain("Kitchen Remodel");
    expect(subject).toContain("🎉");
  });

  it("P-50: the accepted-alert SMS body projects jobNameByLang for the contractor's language", () => {
    const sms = buildAcceptedAlertSms({ ...args, url: "https://paperworkmonster.com/quotes", lang: "es" });
    expect(sms).toContain("Remodelación de cocina");
    expect(sms).not.toContain("Kitchen Remodel");
    expect(sms).toContain("https://paperworkmonster.com/quotes");
  });
});
