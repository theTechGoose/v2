/**
 * REQ-350 — demo-loop cycle 1, issues m9 / p15-8 / p15-10: the Spanish
 * wording and punctuation the demo read ("Sé mi precio", a "!" with no "¡",
 * lowercase sentence starts, "Cada dólar registrado. y 1 esperando…",
 * "1 ganadas", "EDITORES · 1 INVITADOS", "$600 pendiente · owes.",
 * "Términos y Condiciones"), "1 quotes · 0 invoices", and "View as client"
 * vs "View as customer".
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const DICTS = { en, es } as const;
type L = keyof typeof DICTS;

const fill = (s: string, vars: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
/** Mirrors front-end/lib/i18n.ts tnFor. */
const tn = (
  lang: L,
  key: string,
  n: number,
  vars: Record<string, string | number> = {},
) => {
  const v = DICTS[lang][`${key}.${n === 1 ? "one" : "other"}`];
  expect(v).toBeTruthy();
  return fill(v, { n, ...vars });
};
/** A sentence end followed by a lowercase word: "…? llama al", ". y 1". */
const LOWER_AFTER_STOP = /[.?!]\s+\p{Ll}/u;

describe("REQ-350 (a) the known-price chip reads as Spanish", () => {
  test("es: 'Ya tengo el precio, redáctalo.' — never 'Sé mi precio'", () => {
    expect(es["asstChat.prompt.knownPrice"]).toBe(
      "Ya tengo el precio, redáctalo.",
    );
    for (const v of Object.values(es)) expect(v).not.toMatch(/Sé mi precio/);
  });
});

describe("REQ-350 (b) the quote footer's closing is a whole sentence with its own ¡…!", () => {
  test("lookForward is a full sentence in both languages", () => {
    expect(en["quoteDoc.lookForward"]).toBe(
      "I look forward to working with you!",
    );
    expect(es["quoteDoc.lookForward"]).toBe("¡Espero poder trabajar contigo!");
  });
  test("no es UI value has a '!' without an opening '¡'", () => {
    // prompts.* are LLM instructions in English, not UI copy.
    const bad = Object.entries(es).filter(([k, v]) => {
      if (k.startsWith("prompts.")) return false;
      const opens = (v.match(/¡/g) ?? []).length;
      const closes = (v.match(/!/g) ?? []).length;
      return closes > opens;
    });
    expect(bad).toEqual([]);
  });
  test("quote-doc ends the contact sentence before the closing", () => {
    const src = read("front-end/components/quote-doc.tsx");
    expect(src).toMatch(/\{"\. "\}\s*\{t\.lookForward\}/);
  });
  test("with only an email, the contact line starts with a capital", () => {
    const src = read("front-end/components/quote-doc.tsx");
    expect(src).toMatch(/emailWordStart/);
    for (const lang of ["en", "es"] as const) {
      const d = DICTS[lang];
      for (const q of [d["quoteDoc.qBefore"], d["quoteDoc.qSigned"]]) {
        expect(`${q} ${d["quoteDoc.callWord"]} 555`).not.toMatch(
          LOWER_AFTER_STOP,
        );
        expect(`${q} ${d["quoteDoc.emailWordStart"]} a@b.co`).not.toMatch(
          LOWER_AFTER_STOP,
        );
      }
    }
  });
});

describe("REQ-350 (c) no sentence starts lowercase", () => {
  for (const lang of ["en", "es"] as const) {
    test(`${lang}: the send card's sub line starts with a capital`, () => {
      const d = DICTS[lang];
      for (
        const k of [
          "asstChat.cta.notDelivered",
          "asstChat.cta.emailedTo",
          "asstChat.cta.textedTo",
          "asstChat.cta.noEmailPre",
        ]
      ) {
        expect(d[k]).toMatch(/^\p{Lu}/u);
      }
    });
    test(`${lang}: the invoice footer's lead-in flows into 'call'/'email'`, () => {
      const d = DICTS[lang];
      for (
        const lead of [
          d["publicInvoice.footer.questions"],
          d["publicInvoice.footer.questionsClaimed"],
        ]
      ) {
        expect(`${lead} ${d["publicInvoice.footer.call"]} 555`).not.toMatch(
          LOWER_AFTER_STOP,
        );
        expect(`${lead} ${d["publicInvoice.footer.email"]} a@b.co`).not
          .toMatch(LOWER_AFTER_STOP);
      }
    });
  }
});

describe("REQ-350 (d) the payments hero never joins 'logged.' + 'and'", () => {
  test("one counted sentence for 'every dollar logged, N waiting'", () => {
    expect(tn("es", "paymentsPage.hero.everyDollarWaiting", 1)).toBe(
      "Cada dólar registrado; 1 pago espera que lo confirmes.",
    );
    expect(tn("es", "paymentsPage.hero.everyDollarWaiting", 3)).toBe(
      "Cada dólar registrado; 3 pagos esperan que los confirmes.",
    );
    expect(tn("en", "paymentsPage.hero.everyDollarWaiting", 1)).toBe(
      "Every dollar logged — 1 payment is waiting for you to confirm.",
    );
    expect(tn("en", "paymentsPage.hero.everyDollarWaiting", 2)).toBe(
      "Every dollar logged — 2 payments are waiting for you to confirm.",
    );
  });
  test("PaymentsPage renders it through tnFor; 'and' follows only 'on the way'", () => {
    const src = read("front-end/islands/PaymentsPage.tsx");
    expect(src).toMatch(
      /tnFor\(\s*lang,\s*"paymentsPage\.hero\.everyDollarWaiting",\s*attentionCount/,
    );
    expect(src).toMatch(/transitTotal > 0 && attentionCount > 0/);
  });
});

describe("REQ-350 (e) counts agree with their noun (one/other)", () => {
  test("won / lost / need-more on /quotes", () => {
    expect(tn("es", "quotesKpi.won", 1)).toBe("1 ganada");
    expect(tn("es", "quotesKpi.won", 2)).toBe("2 ganadas");
    expect(tn("es", "quotesKpi.lost", 1)).toBe("1 perdida");
    expect(tn("es", "quotesKpi.lost", 0)).toBe("0 perdidas");
    expect(tn("en", "quotesKpi.won", 1)).toBe("1 won");
    expect(tn("es", "quotesKpi.needMore", 1)).toBe("falta 1 más");
    expect(tn("es", "quotesKpi.needMore", 4)).toBe("faltan 4 más");
    expect(tn("es", "quotesRate.needMore", 1)).toBe(
      "falta 1 más para definirlo",
    );
    expect(tn("en", "quotesRate.needMore", 2)).toBe("need 2 more to call it");
    for (const d of [en, es]) {
      for (
        const k of [
          "quotesKpi.wonLost",
          "quotesKpi.needMore",
          "quotesRate.wonLost",
          "quotesRate.needMore",
        ]
      ) expect(d[k]).toBeUndefined();
    }
  });
  test("QuotesSections picks each form by count", () => {
    const src = read("front-end/components/QuotesSections.tsx");
    expect(src).toMatch(/tnFor\(lang, "quotesKpi\.won", won\)/);
    expect(src).toMatch(/tnFor\(lang, "quotesKpi\.lost", lost\)/);
    expect(src).toMatch(
      /"quotesKpi\.needMore",\s*WIN_RATE_MIN_N - decidedCount/,
    );
    expect(src).toMatch(/"quotesRate\.needMore",\s*WIN_RATE_MIN_N - decided/);
    expect(src).not.toMatch(/"quotes(Kpi|Rate)\.wonLost"/);
  });
  test("admins eyebrow: 'Editores · 1 invitado'", () => {
    expect(tn("es", "admins.eyebrow", 1)).toBe("Editores · 1 invitado");
    expect(tn("es", "admins.eyebrow", 2)).toBe("Editores · 2 invitados");
    expect(es["admins.eyebrow"]).toBeUndefined();
    expect(read("front-end/islands/AdminsPage.tsx")).toMatch(
      /tn\("admins\.eyebrow", list\.length\)/,
    );
  });
  test("global search: '1 quote · 0 invoices'", () => {
    expect(tn("en", "search.counts.quotes", 1)).toBe("1 quote");
    expect(tn("en", "search.counts.invoices", 0)).toBe("0 invoices");
    expect(tn("es", "search.counts.quotes", 1)).toBe("1 cotización");
    expect(tn("es", "search.counts.invoices", 1)).toBe("1 factura");
    for (const d of [en, es]) expect(d["search.counts"]).toBeUndefined();
    const src = read("front-end/islands/GlobalSearch.tsx");
    expect(src).toMatch(
      /tnFor\(\s*lang,\s*"search\.counts\.quotes",\s*h\.counts\.quotes,?\s*\)/,
    );
    expect(src).toMatch(
      /tnFor\(\s*lang,\s*"search\.counts\.invoices",\s*h\.counts\.invoices,?\s*\)/,
    );
  });
});

describe("REQ-350 (f) the customer balance sub-line is a dictionary string, not an English literal", () => {
  test("every balance-sub kind has an en and es string", () => {
    for (const d of [en, es]) {
      for (
        const k of [
          "clientsDisplay.balanceSub.overdue",
          "clientsDisplay.balanceSub.dueToday",
          "clientsDisplay.balanceSub.dueIn.one",
          "clientsDisplay.balanceSub.dueIn.other",
          "clientsDisplay.balanceSub.owes",
          "clientsDisplay.balanceSub.onFile",
          "clientsDisplay.balanceSub.quoteOut",
          "clientsDisplay.balanceSub.settled",
        ]
      ) expect(d[k]).toBeTruthy();
    }
    const story = fill(es["clientsDisplay.story.balance"], {
      amount: "$600",
      sub: es["clientsDisplay.balanceSub.owes"],
    });
    expect(story).not.toMatch(/owes/);
  });
  test("build-customer-cards returns no English literals", () => {
    const src = read(
      "backend/src/analytics/domain/coordinators/build-customer-cards/mod.ts",
    );
    // The status enum "owes" is fine; the sub-line builder must hold no copy.
    // Reconciled with REQ-367 on demo-fixes: the builder returns the line as
    // DATA (a kind + its values); shared balanceSubLabel words it.
    const body = src.slice(
      src.indexOf("function buildBalanceSub("),
      src.indexOf("function clamp("),
    );
    expect(body.length).toBeGreaterThan(0);
    expect(body).not.toMatch(/return "owes"|return "settled"/);
    expect(body).not.toMatch(
      /· overdue`|due in \$\{|on file`|settled · quote out/,
    );
    expect(body).toMatch(/kind: "owes"/);
    const shared = read("shared/quote-flow/balance-sub.ts");
    expect(shared).toMatch(/`clientsDisplay\.balanceSub\.\$\{parts\.kind\}`/);
  });
  test("REQ-367: the /clients card words its balance line in the live language (clients-display balanceSubFor)", () => {
    const tr = (lang: "en" | "es", key: string, vars?: Record<string, string | number>) =>
      fill((lang === "es" ? es : en)[key] ?? en[key] ?? key, vars ?? {});
    // deno-lint-ignore no-explicit-any
    const { balanceSubLabel } = require("../../shared/quote-flow/balance-sub") as any;
    expect(balanceSubLabel({ kind: "overdue", ref: "INV-001" }, "es", tr)).toBe("INV-001 · vencida");
    expect(balanceSubLabel({ kind: "owes" }, "es", tr)).toBe("esperando el pago");
    expect(balanceSubLabel({ kind: "owes" }, "en", tr)).toBe("awaiting payment");
    expect(balanceSubLabel({ kind: "dueIn", ref: "INV-001", days: 1 }, "es", tr)).toBe("INV-001 · vence en 1 día");
    expect(balanceSubLabel({ kind: "dueIn", ref: "INV-001", days: 3 }, "en", tr)).toBe("INV-001 · due in 3 days");
    expect(balanceSubLabel({ kind: "onFile", amountCents: 500_00 }, "es", tr)).toBe("$500 a favor");
    const display = read("front-end/lib/clients-display.ts");
    expect(display).toMatch(/sub: balanceSubFor\(c, lang\)/);
  });
});

describe("REQ-350 (g) 'Términos y condiciones' is sentence case", () => {
  test("web heading and PDF heading", () => {
    expect(es["quoteDoc.termsAndConditions"]).toBe("Términos y condiciones");
    expect(es["renderQuotePdf.section.finePrint"]).toBe(
      "Términos y condiciones",
    );
  });
});

describe("REQ-350 (i) one noun for 'View as customer'", () => {
  test("the card back and the open panel say the same thing", () => {
    expect(en["quotesPage.open.viewAsClient"]).toBe("View as customer");
    expect(en["quoteCard.back.viewAsClient"]).toBe("View as customer");
    expect(es["quotesPage.open.viewAsClient"]).toBe(
      es["quoteCard.back.viewAsClient"],
    );
  });
});
