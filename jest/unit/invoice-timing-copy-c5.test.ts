/**
 * REQ-697 (demo-loop cycle 5, issues m13 + m22) — the /invoices headline and
 * every owner surface say WHEN money moves, and what a "scheduled" invoice is.
 *
 *   m13: "CUENTAS POR COBRAR · ESTA SEMANA — $180 en camino" for a bill due
 *        19 dic (the eyebrow was one constant key in every hero mode);
 *        "Quiet week — $725 coming next week" while a $725 deposit was open
 *        (nextWeek mode won over outstanding); "Próxima cuota: 22 nov" (the
 *        SEND date) while the invoice said "VENCE 29 nov".
 *   m22: "INV-001 Scheduled · Sends Nov 12" — nothing sends a scheduled
 *        invoice by itself (ScheduleInvoiceNudges only reminds the owner),
 *        and the agreement's "Payment upon completion" never stated the
 *        days the customer has to pay.
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  invoicesHeroEyebrowKey,
  invoicesHeroMode,
} from "../../front-end/lib/headline-counts";
import { paymentTermValue } from "../../front-end/lib/term-i18n";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-697 m13: the hero never says 'Quiet week' while a bill is open", () => {
  it("REQ-697 a $725 deposit due next week (1 open invoice) → 'outstanding', not 'nextWeek'", () => {
    expect(
      invoicesHeroMode({
        totalInvoiceCount: 1,
        outstandingCount: 1,
        claimedCount: 0,
        outstandingCents: 72500,
        forecast: { thisWeekCents: 0, nextWeekCents: 72500, atRiskCents: 0 },
      }),
    ).toBe("outstanding");
  });
  it("REQ-697 money due this week still leads with 'thisWeek'", () => {
    expect(
      invoicesHeroMode({
        totalInvoiceCount: 1,
        outstandingCount: 1,
        claimedCount: 0,
        outstandingCents: 18000,
        forecast: { thisWeekCents: 18000, nextWeekCents: 0, atRiskCents: 0 },
      }),
    ).toBe("thisWeek");
  });
  it("REQ-697 nothing owed but money forecast next week → 'nextWeek' (the quiet line is for that)", () => {
    expect(
      invoicesHeroMode({
        totalInvoiceCount: 2,
        outstandingCount: 0,
        claimedCount: 0,
        outstandingCents: 0,
        forecast: { thisWeekCents: 0, nextWeekCents: 45000, atRiskCents: 0 },
      }),
    ).toBe("nextWeek");
  });
});

describe("REQ-697 m13: the eyebrow follows the hero mode", () => {
  it("REQ-697 only thisWeek says 'this week'; nextWeek says 'next week'; every other mode is plain", () => {
    expect(invoicesHeroEyebrowKey("thisWeek")).toBe(
      "invoicesPage.eyebrowThisWeek",
    );
    expect(invoicesHeroEyebrowKey("nextWeek")).toBe(
      "invoicesPage.eyebrowNextWeek",
    );
    for (
      const m of [
        "outstanding",
        "scheduled",
        "clear",
        "claimed",
        "empty",
      ] as const
    ) expect(invoicesHeroEyebrowKey(m)).toBe("invoicesPage.eyebrow");
  });
  it("REQ-697 the plain eyebrow names no week in en or es", () => {
    expect(en["invoicesPage.eyebrow"]).toBe("Receivables");
    expect(es["invoicesPage.eyebrow"]).toBe("Cuentas por cobrar");
    expect(en["invoicesPage.eyebrowThisWeek"]).toBe("Receivables · this week");
    expect(es["invoicesPage.eyebrowThisWeek"]).toBe(
      "Cuentas por cobrar · esta semana",
    );
    expect(en["invoicesPage.eyebrowNextWeek"]).toBe("Receivables · next week");
    expect(es["invoicesPage.eyebrowNextWeek"]).toBe(
      "Cuentas por cobrar · la próxima semana",
    );
  });
  it("REQ-697 InvoicesPage renders the mode's eyebrow, not the constant key", () => {
    const src = read("front-end/islands/InvoicesPage.tsx");
    expect(src).toMatch(/tFor\(lang, invoicesHeroEyebrowKey\(mode\)\)/);
    expect(src).not.toMatch(/tFor\(lang, "invoicesPage\.eyebrow"\)/);
  });
});

describe("REQ-697 m13 + m22: the scheduled hero names the reminder date AND the due date", () => {
  it("REQ-697 the headline says the money is scheduled and not sent yet", () => {
    expect(en["invoicesPage.hero.scheduled"]).toBe(
      "{amount} scheduled — not sent yet.",
    );
    expect(es["invoicesPage.hero.scheduled"]).toBe(
      "{amount} programado — aún sin enviar.",
    );
  });
  it("REQ-697 the sub-line label is a reminder to send, never a send or a due date", () => {
    for (const k of ["scheduledNext", "billsOnCompletion"]) {
      expect(en[`invoicesPage.sub.${k}`]).toMatch(
        /we'll remind you to send it/,
      );
      expect(es[`invoicesPage.sub.${k}`]).toMatch(/te recordamos enviarla/);
    }
    expect(en["invoicesPage.sub.scheduledDue"]).toBe("due {date}");
    expect(es["invoicesPage.sub.scheduledDue"]).toBe("vence el {date}");
  });
  it("REQ-697 InvoicesPage shows the next scheduled invoice's due date", () => {
    const src = read("front-end/islands/InvoicesPage.tsx");
    expect(src).toMatch(/nextScheduledDue=\{nextScheduled\?\.dueDate\}/);
    expect(src).toMatch(/"invoicesPage\.sub\.scheduledDue"/);
    expect(src).toMatch(/data-cy="hero-scheduled-due"/);
  });
});

describe("REQ-697 m22: no owner surface says a scheduled invoice 'sends' itself", () => {
  const keys = [
    "quotes.ledger.sends",
    "quotes.ledger.restScheduled",
    "invoicesPage.subline.scheduled",
    "chatCoordinator.billing.next",
    "invoicesPage.kpi.draftingSubScheduled.one",
    "invoicesPage.kpi.draftingSubScheduled.other",
  ];
  it.each(keys)(
    "REQ-697 %s reads as a reminder, not an automatic send",
    (k) => {
      expect(en[k]).not.toMatch(/\bSends\b|scheduled to send|goes out/i);
      expect(es[k]).not.toMatch(/se envía|para enviarse|para enviar|sale el/i);
    },
  );
  it("REQ-697 the date labels say we'll remind the owner", () => {
    expect(en["quotes.ledger.sends"]).toBe(
      "We'll remind you on {date} to send it",
    );
    expect(es["quotes.ledger.sends"]).toBe("Te recordamos enviarla el {date}");
    expect(en["invoicesPage.subline.scheduled"]).toBe(
      "We'll remind you on {date} to send it",
    );
    expect(es["invoicesPage.subline.scheduled"]).toBe(
      "Te recordamos enviarla el {date}",
    );
  });
  it("REQ-697 the signing line for a scheduled bill names the invoice, the reminder date and the due date", () => {
    for (const d of [en, es]) {
      const s = d["acceptQuote.signed.scheduled"];
      expect(s).toBeTruthy();
      for (
        const v of [
          "{name}",
          "{quote}",
          "{invoice}",
          "{amount}",
          "{date}",
          "{due}",
        ]
      ) {
        expect(s).toContain(v);
      }
    }
  });
});

describe("REQ-697 m22: the agreement's 'upon completion' term states the days to pay", () => {
  it("REQ-697 en + es carry the window", () => {
    expect(paymentTermValue("Payment upon completion", "en", 30)).toBe(
      "Payment upon completion — due within 30 days of the invoice",
    );
    expect(paymentTermValue("Payment upon completion", "es", 15)).toBe(
      "Pago al finalizar — vence 15 días después de la factura",
    );
  });
  it("REQ-697 0 days reads as due on receipt", () => {
    expect(paymentTermValue("Payment upon completion", "en", 0)).toBe(
      "Payment upon completion — due when the invoice arrives",
    );
    expect(paymentTermValue("Payment upon completion", "es", 0)).toBe(
      "Pago al finalizar — vence al recibir la factura",
    );
  });
  it("REQ-697 other payment terms, or no known window, are unchanged", () => {
    expect(paymentTermValue("50/50", "en", 30)).toBe("50/50");
    expect(paymentTermValue("Deposit + balance", "es", 30)).toBe(
      "Depósito + saldo",
    );
    expect(paymentTermValue("Payment upon completion", "en", undefined)).toBe(
      "Payment upon completion",
    );
  });
  it("REQ-697 the agreement passes the business's days to pay into its term grid", () => {
    const doc = read("front-end/components/quote-doc.tsx");
    expect(doc).toMatch(/paymentNetDays=\{contractor\?\.invoiceNetDays\}/);
    const parts = read("front-end/components/doc-parts.tsx");
    expect(parts).toMatch(/paymentTermValue\(/);
  });
});
