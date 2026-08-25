/**
 * RED (TDD) — pure-logic contracts for outbound-email i18n + identity.
 *
 * P-07 "Accented Spanish job names are mangled in the email hero …
 *       'instalación de baño y cocina' renders as 'InstalacióN De BañO Y Cocina'"
 * P-28 "English/raw dates inside Spanish documents. fmtDate is hardcoded en-US"
 * P-29 "Raw English status enum in the Spanish invoice email — 'Estado: Sent'"
 * P-44 "ES email subject uses English word order — '{businessName} Cotización
 *       para {customerName}…' instead of 'Cotización de {businessName} para…'"
 * P-51 "'3 ea · $350.00 c/u' — the unit fallback 'ea' leaks untranslated into ES emails"
 * P-06 "'Nuevo usuario' / 'New user' leaks into customer-facing email and SMS"
 *
 * EXPECTED NEW MODULES (do not exist yet — "Cannot find module" is the intended red):
 *
 * shared/quote-flow/email-format.ts
 *   export function titleCaseJobName(name: string, lang: string): string
 *     — Unicode-aware title-casing for the email hero. Replaces the broken
 *       `summaryClean.replace(/\b\w/g, c => c.toUpperCase())` at
 *       backend/src/paperwork/domain/coordinators/send-paperwork-email/mod.ts:638
 *       and :1026 (non-Unicode \b fires again AFTER accented chars). For
 *       lang "es" the stopwords de/y/en/para/la/el stay lowercase mid-title.
 *   export function fmtPaperworkDate(iso: string, lang: string, tz?: string): string
 *     — Locale-aware replacement for the en-US-hardcoded fmtDate at
 *       send-paperwork-email/mod.ts:372-387. "es" renders Spanish long dates
 *       ("20 de agosto de 2026"); never raw ISO; full timestamps render in the
 *       given (or system) LOCAL timezone, not UTC (no off-by-one). Date-only
 *       input (YYYY-MM-DD) keeps its calendar day in every tz.
 *   export function invoiceStatusLabel(status: string, lang: string): string
 *     — Localized label for the invoice email "Estado" row that currently
 *       prints the raw enum (`escapeHtml(i.status …)` at
 *       send-paperwork-email/mod.ts:1375). Grounded in the lang dicts'
 *       existing "status.*" family (lang/es.json: "status.sent": "Enviado").
 *   export function unitLabel(unit: string | undefined, lang: string): string
 *     — Localizes the per-line unit; the "ea"/each unit maps to the dicts'
 *       "quoteDoc.unitEach" ("ea" en / "c/u" es — unused today by
 *       `${qty} ${escapeHtml(li.unit ?? "ea")}` at send-paperwork-email/mod.ts:653
 *       and :1060). Unknown/custom units pass through unchanged.
 *   export function buildLocalizedQuoteEmailSubject(
 *     args: { businessName: string; customerName: string; jobName: string },
 *     lang: string,
 *   ): string
 *     — lang/businessName-aware sibling of the existing
 *       shared/quote-flow/email-subject.ts#buildQuoteEmailSubject (read; left
 *       untouched). Mirrors renderQuoteSubject at send-paperwork-email/mod.ts:513-538,
 *       whose es template today is "{businessName} Cotización para {customerName},
 *       {jobName}" (lang/es.json "paperworkEmail.quote.subject"). Desired es
 *       order: "Cotización de {businessName} para {customerName}, {jobName}".
 *       en keeps the current "{businessName} Quote for {customerName}, {jobName}".
 *
 * shared/quote-flow/outbound-identity.ts
 *   export function isPlaceholderName(name: string | null | undefined): boolean
 *     — Mirrors the ONLY existing placeholder filter,
 *       front-end/islands/WelcomeWizard.tsx:73
 *       (PLACEHOLDER_NAMES = ["New user", "Nuevo usuario"]); trim-tolerant.
 *       Every account is seeded name "Nuevo usuario" (verify-otp/mod.ts:35).
 *   export function outboundSenderName(
 *     args: { userName?: string | null; businessName?: string | null },
 *   ): string | undefined
 *     — The name customer-facing outbound copy may show for the contractor:
 *       the real user name when it is not a placeholder, else the business
 *       name, else undefined (caller must collect the name — never emit the
 *       placeholder). Wires into senderName/renderQuoteSubject/renderInvoiceSubject
 *       (send-paperwork-email/mod.ts:349-351, 523-526, 955).
 */
import {
  buildLocalizedQuoteEmailSubject,
  fmtPaperworkDate,
  invoiceStatusLabel,
  titleCaseJobName,
  unitLabel,
} from "../../shared/quote-flow/email-format";
import {
  isPlaceholderName,
  outboundSenderName,
} from "../../shared/quote-flow/outbound-identity";

// Ground expectations in the live lang dicts (flat keys) so a fix that keeps
// using the dict values stays green without editing this file.
// lang/es.json: "quoteDoc.unitEach": "c/u", "status.sent": "Enviado", …
const enDict: Record<string, string> = require("../../lang/en.json");
const esDict: Record<string, string> = require("../../lang/es.json");

describe("P-07 titleCaseJobName — Unicode-aware hero title-casing", () => {
  it("P-07 title-cases an accented Spanish job name without mangling accents", () => {
    // Today's prod output (observed live): "InstalacióN De BañO Y Cocina"
    expect(titleCaseJobName("instalación de baño y cocina", "es"))
      .toBe("Instalación de Baño y Cocina");
  });

  it("P-07 never uppercases the letter AFTER an accented character (the \\b\\w bug)", () => {
    const out = titleCaseJobName("instalación de baño y cocina", "es");
    expect(out).not.toContain("InstalacióN");
    expect(out).not.toContain("BañO");
    // Generic signature of the non-Unicode-\b bug: an uppercase letter glued
    // directly after a lowercase letter inside a word.
    expect(/\p{Ll}\p{Lu}/u.test(out)).toBe(false);
  });

  it("P-07 keeps Spanish stopwords (de/y/en/para/la/el) lowercase mid-title", () => {
    expect(
      titleCaseJobName("remodelación de la cocina y el baño en general", "es"),
    )
      .toBe("Remodelación de la Cocina y el Baño en General");
  });

  it("P-07 keeps plain English job names fully title-cased for en", () => {
    expect(titleCaseJobName("backyard junk removal", "en"))
      .toBe("Backyard Junk Removal");
  });
});

describe("P-28 fmtPaperworkDate — locale + timezone aware document dates", () => {
  it("P-28 renders Spanish long dates for es (never the en-US format)", () => {
    // Today fmtDate (mod.ts:372-387) hardcodes en-US: "August 20, 2026".
    expect(fmtPaperworkDate("2026-08-20", "es")).toBe("20 de agosto de 2026");
  });

  it("P-28 keeps the existing en-US long format for en", () => {
    expect(fmtPaperworkDate("2026-08-20", "en")).toBe("August 20, 2026");
  });

  it("P-28 never returns a raw ISO date for a full timestamp", () => {
    const out = fmtPaperworkDate(
      "2026-09-17T12:00:00Z",
      "es",
      "America/Chicago",
    );
    expect(out).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(out).toContain("septiembre");
  });

  it("P-28 renders full timestamps in the local timezone (no off-by-one vs UTC)", () => {
    // 2026-08-19T03:00:00Z is still Aug 18 in America/Chicago; the current
    // UTC-pinned rendering would show "August 19, 2026" (tomorrow's date).
    expect(fmtPaperworkDate("2026-08-19T03:00:00Z", "en", "America/Chicago"))
      .toBe("August 18, 2026");
    expect(fmtPaperworkDate("2026-08-19T03:00:00Z", "es", "America/Chicago"))
      .toBe("18 de agosto de 2026");
  });

  it("P-28 keeps the calendar day of date-only input in every timezone", () => {
    expect(fmtPaperworkDate("2026-08-20", "es", "America/Los_Angeles"))
      .toBe("20 de agosto de 2026");
  });
});

describe("P-29 invoiceStatusLabel — localized status, never the raw enum", () => {
  it('P-29 maps "sent" to the es dict status label (status.sent = "Enviado")', () => {
    expect(invoiceStatusLabel("sent", "es")).toBe(esDict["status.sent"]);
    expect(invoiceStatusLabel("sent", "es").toLowerCase()).not.toBe("sent");
  });

  it("P-29 localizes the other lifecycle statuses from the es dict", () => {
    expect(invoiceStatusLabel("paid", "es")).toBe(esDict["status.paid"]);
    expect(invoiceStatusLabel("overdue", "es")).toBe(esDict["status.overdue"]);
    expect(invoiceStatusLabel("draft", "es")).toBe(esDict["status.draft"]);
  });

  it('P-29 keeps English labels for en (status.sent = "Sent")', () => {
    expect(invoiceStatusLabel("sent", "en")).toBe(enDict["status.sent"]);
  });

  it("P-29 still yields a non-empty label for an unknown status", () => {
    expect(invoiceStatusLabel("weird_future_status", "es").length)
      .toBeGreaterThan(0);
  });
});

describe("P-44 buildLocalizedQuoteEmailSubject — Spanish word order", () => {
  const args = {
    businessName: "JEST LLC",
    customerName: "Green Goblin",
    jobName: "Instalación de baño y cocina",
  };

  it('P-44 es subject leads with "Cotización de {biz} para {customer}"', () => {
    const subject = buildLocalizedQuoteEmailSubject(args, "es");
    expect(subject.startsWith("Cotización de JEST LLC para Green Goblin")).toBe(
      true,
    );
    expect(subject).toContain("Instalación de baño y cocina");
  });

  it("P-44 es subject never uses the English word order ('{biz} Cotización para …')", () => {
    const subject = buildLocalizedQuoteEmailSubject(args, "es");
    expect(subject).not.toMatch(/^JEST LLC\s+Cotización/);
  });

  it("P-44 en subject keeps the current en dict shape", () => {
    // lang/en.json "paperworkEmail.quote.subject":
    //   "{businessName} Quote for {customerName}, {jobName}"
    const expected = enDict["paperworkEmail.quote.subject"]
      .replace("{businessName}", args.businessName)
      .replace("{customerName}", args.customerName)
      .replace("{jobName}", args.jobName);
    expect(buildLocalizedQuoteEmailSubject(args, "en")).toBe(expected);
  });
});

describe("P-51 unitLabel — localized line-item unit", () => {
  it('P-51 maps "ea" to the es dict quoteDoc.unitEach ("c/u")', () => {
    expect(unitLabel("ea", "es")).toBe(esDict["quoteDoc.unitEach"]);
  });

  it('P-51 maps a missing unit (the `li.unit ?? "ea"` fallback) to the localized each-label', () => {
    expect(unitLabel(undefined, "es")).toBe(esDict["quoteDoc.unitEach"]);
  });

  it('P-51 keeps "ea" for en (quoteDoc.unitEach = "ea")', () => {
    expect(unitLabel("ea", "en")).toBe(enDict["quoteDoc.unitEach"]);
  });

  it("P-51 passes custom units through unchanged", () => {
    expect(unitLabel("hora", "es")).toBe("hora");
    expect(unitLabel("job", "en")).toBe("job");
  });
});

describe("P-06 outbound identity — placeholder names never reach customers", () => {
  it("P-06 isPlaceholderName flags both seeded placeholders (WelcomeWizard.tsx:73)", () => {
    expect(isPlaceholderName("Nuevo usuario")).toBe(true);
    expect(isPlaceholderName("New user")).toBe(true);
    expect(isPlaceholderName("  Nuevo usuario  ")).toBe(true);
  });

  it("P-06 isPlaceholderName lets real names through", () => {
    expect(isPlaceholderName("Hans Pedersen")).toBe(false);
    expect(isPlaceholderName("Nueva Era Construction")).toBe(false);
  });

  it("P-06 outboundSenderName prefers the real user name", () => {
    expect(
      outboundSenderName({
        userName: "Hans Pedersen",
        businessName: "ACME LLC",
      }),
    )
      .toBe("Hans Pedersen");
  });

  it("P-06 outboundSenderName falls back to the business name for placeholder users", () => {
    expect(
      outboundSenderName({
        userName: "Nuevo usuario",
        businessName: "ACME LLC",
      }),
    )
      .toBe("ACME LLC");
    expect(
      outboundSenderName({ userName: "New user", businessName: "ACME LLC" }),
    )
      .toBe("ACME LLC");
  });

  it("P-06 outboundSenderName returns undefined when nothing safe exists (collect the name)", () => {
    expect(outboundSenderName({ userName: "Nuevo usuario" })).toBeUndefined();
    expect(outboundSenderName({ userName: "New user", businessName: "  " }))
      .toBeUndefined();
  });

  it("P-06 outboundSenderName NEVER returns a placeholder, whatever the inputs", () => {
    const grid = [
      { userName: "Nuevo usuario", businessName: undefined },
      { userName: "New user", businessName: "" },
      { userName: undefined, businessName: undefined },
      { userName: "Nuevo usuario", businessName: "Nuevo usuario" },
    ];
    for (const args of grid) {
      const out = outboundSenderName(args);
      if (out !== undefined) {
        expect(out).not.toMatch(/Nuevo usuario|New user/);
      }
    }
  });
});
