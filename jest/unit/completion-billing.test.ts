/**
 * REQ-411 (demo-loop cycle 2, m34 + m35) — a pay-on-completion job.
 *
 *   m34: the /invoices hero said "Próxima cuota: 26 nov" ("next installment")
 *        over the ONLY, after-completion bill; Settings said "Bloqueado —
 *        INV-001 ya fue emitido" for a number held by a scheduled invoice that
 *        was never sent.
 *   m35: "Pago al finalizar" said "15 días" while Settings "Days to pay an
 *        invoice" said 30.
 *
 * The schedule math (start term + duration term) lives in
 * shared/quote-flow/completion-schedule.ts; the hero picks its label with
 * scheduledHeroSubKey (front-end/lib/headline-counts.ts).
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  accountNetDays,
  completionFromTerms,
  DEFAULT_INVOICE_NET_DAYS,
} from "../../shared/quote-flow/completion-schedule";
import { scheduledHeroSubKey } from "../../front-end/lib/headline-counts";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

const SIGNED = new Date("2026-11-12T15:00:00Z");
const terms = (start: string, wraps: string) => [
  { stepId: "start_date", value: start },
  { stepId: "wraps", value: wraps },
];

describe("REQ-411 (m34): the completion date comes from the start + duration terms", () => {
  it("'La próxima semana' + '4 semanas' signed Nov 12 → Dec 17 (not Nov 26)", () => {
    expect(
      completionFromTerms({
        terms: terms("Next week", "4 weeks"),
        today: SIGNED,
      }),
    )
      .toBe("2026-12-17");
    expect(
      completionFromTerms({
        terms: terms("La próxima semana", "4 semanas"),
        today: SIGNED,
      }),
    )
      .toBe("2026-12-17");
  });
  it("no duration → undefined (the caller keeps its 14-day window)", () => {
    expect(
      completionFromTerms({ terms: terms("Next week", "TBD"), today: SIGNED }),
    )
      .toBeUndefined();
  });
});

describe("REQ-411 (m35): one days-to-pay for the account", () => {
  it("the account's Settings number, else the 30 the Settings field shows", () => {
    expect(DEFAULT_INVOICE_NET_DAYS).toBe(30);
    expect(accountNetDays(21)).toBe(21);
    expect(accountNetDays(0)).toBe(0);
    expect(accountNetDays(undefined)).toBe(30);
    expect(accountNetDays(null)).toBe(30);
  });
  it("Settings shows the same default when unset", () => {
    const src = read("front-end/islands/SettingsPage.tsx");
    expect(src).toMatch(/accountNetDays\(/);
    expect(src).not.toMatch(/invoiceNetDays \?\? 30/);
  });
  it("the wizard sub-lines take {n} in en + es; the Settings hint says it covers pay-on-completion too", () => {
    for (const d of [en, es]) {
      for (
        const k of [
          "termsWizard.paymentTerms.net15.sub",
          "asstChat.terms.payment.onCompletionSub",
        ]
      ) {
        expect(d[k]).toMatch(/\{n\}/);
        expect(d[k]).not.toMatch(/\b15\b/);
      }
    }
    expect(en["settings.netDaysHint"]).toMatch(/completion/i);
    expect(es["settings.netDaysHint"]).toMatch(/finalizar|terminar/i);
  });
  it("the assistant's fallback picker fills {n} from the account's days (routes pass invoiceNetDays)", () => {
    const chat = read("front-end/islands/AsstChat.tsx");
    expect(chat).toMatch(
      /tFor\(previewLang, o\.subKey, \{\s*n: accountNetDays\(invoiceNetDays\)/,
    );
    for (
      const r of [
        "front-end/routes/assistant/index.tsx",
        "front-end/routes/assistant/[threadId].tsx",
      ]
    ) {
      expect(read(r)).toMatch(
        /invoiceNetDays=\{profile\?\.identity\?\.invoiceNetDays\}/,
      );
    }
  });
});

describe("REQ-411 (m34): the /invoices hero names a pay-on-completion bill for what it is", () => {
  it("a single after-completion invoice → 'Bills on completion:'; a split's installment → 'Next installment:'", () => {
    expect(scheduledHeroSubKey({ installmentTotal: 1 })).toBe(
      "invoicesPage.sub.billsOnCompletion",
    );
    expect(scheduledHeroSubKey({ installmentTotal: 2 })).toBe(
      "invoicesPage.sub.scheduledNext",
    );
    expect(scheduledHeroSubKey(undefined)).toBe(
      "invoicesPage.sub.scheduledNext",
    );
    // REQ-697 (cycle 5, m13/m22): the date after the label is a reminder
    // to send, so the label says so
    expect(en["invoicesPage.sub.billsOnCompletion"]).toBe(
      "Bills on completion — we'll remind you to send it on",
    );
    expect(es["invoicesPage.sub.billsOnCompletion"]).toBe(
      "Se factura al terminar — te recordamos enviarla el",
    );
    const src = read("front-end/islands/InvoicesPage.tsx");
    expect(src).toMatch(/tFor\(lang, scheduledHeroSubKey\(nextScheduled\)\)/);
  });
  it("the numbering lock note no longer says a never-sent invoice 'was issued' (en + es)", () => {
    expect(en["settings.numbering.lockNote"]).toBe(
      "Locked — {number} is already in use",
    );
    expect(es["settings.numbering.lockNote"]).toBe(
      "Bloqueado — {number} ya está en uso",
    );
  });
});
