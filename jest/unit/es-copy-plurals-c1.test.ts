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
    expect(src).toMatch(/\{"\. "\}\s*(?:<span[^>]*data-cy="quote-contact-close"[^>]*>\s*)?\{t\.lookForward\}/);
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

/**
 * REQ-413 — demo-loop cycle 2, issues p5 / p7 / m49 (run r561db6d4): wording
 * slips REQ-350's sweep missed, English aria-labels on the landing, es money
 * grouping in the landing's chat mock, idioms ("let's start the river",
 * "keep the lights on"), and the English landing lead that told an English
 * reader "You communicate with us in Spanish."
 */
describe("REQ-413 (p5) wording slips", () => {
  test("es: the send card's failure reads 'No entregada —', agreeing with the header's 'No entregada'", () => {
    expect(es["asstChat.header.notDelivered"]).toBe("No entregada");
    expect(es["asstChat.cta.notDelivered"]).toBe("No entregada —");
  });
  test("es landing: 'Mándanos' carries its accent", () => {
    // deno-lint-ignore no-explicit-any
    const { LANDING_DICT } = require("../../front-end/lib/landing-dict") as any;
    for (const v of Object.values(LANDING_DICT.es) as string[]) {
      expect(v).not.toMatch(/\bMandanos\b/);
    }
    expect(LANDING_DICT.es["docs.lead"]).toMatch(/^Mándanos un mensaje\./);
  });
  test("en: a failed logo upload is a whole sentence", () => {
    expect(en["settings.logoUploadFailed"]).toBe(
      "Couldn't upload the logo. Try again.",
    );
    expect(es["settings.logoUploadFailed"]).toBe(
      "No se pudo subir el logo. Inténtalo de nuevo.",
    );
  });
  test("the quote card back's eyebrow is 'Opens' / 'Aperturas', not a calque", () => {
    expect(en["quoteCard.back.eyebrow"]).toBe("Opens");
    expect(es["quoteCard.back.eyebrow"]).toBe("Aperturas");
  });
  test("payments: the hero and the tip agree on how long a check takes", () => {
    for (const d of [en, es]) {
      expect(d["paymentsPage.hero.freshSub"]).toContain(
        d["paymentsPage.tip.upTo5"],
      );
      expect(d["paymentsPage.note.transitCheck"]).toContain(
        d["paymentsPage.tip.upTo5"].replace(/^(up to|hasta) /, ""),
      );
    }
    expect(en["paymentsPage.tip.upTo5"]).toBe("up to 5 business days");
    expect(es["paymentsPage.tip.upTo5"]).toBe("hasta 5 días hábiles");
    for (const d of [en, es]) {
      expect(d["paymentsPage.hero.freshSub"]).not.toMatch(
        /in a week|en una semana/,
      );
    }
  });
});

describe("REQ-413 (p5) no <h1> opens on a lowercase dictionary string", () => {
  // Every `<h1 …>{tFor(lang, "key")…` (optionally inside <em>/<span>) whose
  // key is in lang/*.json: that string is the headline's first word.
  const H1_KEY =
    /<h1\b[^>]*>\s*(?:<\w+[^>]*>\s*)*\{\s*t(?:For|n|nFor)?\(\s*(?:lang,\s*)?"([\w.]+)"/g;
  const walk = (d: string): string[] =>
    fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walk(path.join(d, e.name))
        : e.name.endsWith(".tsx")
        ? [path.join(d, e.name)]
        : []
    );
  test("every h1-leading key starts with a capital in en and es", () => {
    const keys = new Set<string>();
    for (
      const f of [
        ...walk("front-end/components"),
        ...walk("front-end/islands"),
        ...walk("front-end/routes"),
      ]
    ) {
      for (const m of read(f).matchAll(H1_KEY)) keys.add(m[1]);
    }
    expect(keys.has("quotesHero.settledTitle")).toBe(true);
    const bad: string[] = [];
    for (const k of keys) {
      for (const lang of ["en", "es"] as const) {
        const v = DICTS[lang][k];
        if (v != null && !/^[\p{Lu}\d¡¿$]/u.test(v)) {
          bad.push(`${lang} ${k}: ${v}`);
        }
      }
    }
    expect(bad).toEqual([]);
    expect(en["quotesHero.settledTitle"]).toBe(
      "Nothing is waiting on a client right now.",
    );
    expect(es["quotesHero.settledTitle"]).toBe(
      "Nada está esperando a un cliente ahora mismo.",
    );
  });
});

describe("REQ-413 (p5) money on the landing stays US-grouped in Spanish too", () => {
  /** "$10.800" — a dollar amount grouped with a dot (es-ES), which a US
   *  customer reads as ten dollars. */
  const ES_MONEY = /\$\s?\d{1,3}(?:\.\d{3})+(?!\d)/;
  test("routes/index.tsx, static/landing-scripts.js and the landing dict carry no '$10.800'", () => {
    for (
      const f of [
        "front-end/routes/index.tsx",
        "front-end/static/landing-scripts.js",
        "front-end/lib/landing-dict.ts",
        "front-end/__stories__/DemoPhoneChat.stories.tsx",
      ]
    ) {
      // Comments may quote the wrong form to explain the rule.
      const hits = read(f).split("\n").filter((l) =>
        ES_MONEY.test(l) && !/^\s*(\*|\/\/|\/\*)/.test(l)
      );
      expect({ f, hits }).toEqual({ f, hits: [] });
    }
    expect(read("front-end/routes/index.tsx")).toContain(
      "rango típico $10,800–$12,400.",
    );
  });
});

describe("REQ-413 (p5) the landing's aria-labels follow the page language", () => {
  // deno-lint-ignore no-explicit-any
  const { LANDING_DICT } = require("../../front-end/lib/landing-dict") as any;
  const src = read("front-end/routes/index.tsx");
  test("no hard-coded English aria-label on the tablist or the sign-in steps", () => {
    expect(src).not.toMatch(/aria-label="Language"/);
    expect(src).not.toMatch(/aria-label="Sign-in steps"/);
    expect(src).toMatch(
      /class="lang-toggle"[^>]*data-i18n-aria="aria\.language"[^>]*aria-label=\{t\("aria\.language"\)\}|class="lang-toggle"[^>]*aria-label=\{t\("aria\.language"\)\}[^>]*data-i18n-aria="aria\.language"/,
    );
    expect(src).toMatch(
      /class="pm-steps"[^>]*aria-label=\{t\("aria\.signInSteps"\)\}[^>]*data-i18n-aria="aria\.signInSteps"|class="pm-steps"[^>]*data-i18n-aria="aria\.signInSteps"[^>]*aria-label=\{t\("aria\.signInSteps"\)\}/,
    );
  });
  test("both labels exist in en and es", () => {
    expect(LANDING_DICT.en["aria.language"]).toBe("Language");
    expect(LANDING_DICT.es["aria.language"]).toBe("Idioma");
    expect(LANDING_DICT.en["aria.signInSteps"]).toBe("Sign-in steps");
    expect(LANDING_DICT.es["aria.signInSteps"]).toBe("Pasos para entrar");
  });
  test("the client-side toggle repaints [data-i18n-aria] too", () => {
    const js = read("front-end/static/landing-scripts.js");
    expect(js).toMatch(/querySelectorAll\("\[data-i18n-aria\]"\)/);
    expect(js).toMatch(/setAttribute\("aria-label"/);
  });
});

describe("REQ-413 (p7) plain copy instead of idioms", () => {
  test("invoices empty hero: 'No invoices yet — send your first one.'", () => {
    expect(en["invoicesPage.hero.emptyEm"]).toBe("send your first one");
    expect(es["invoicesPage.hero.emptyEm"]).toBe("envía la primera");
    for (const d of [en, es]) {
      expect(Object.values(d).join("\n")).not.toMatch(
        /start the river|comencemos el flujo/,
      );
    }
  });
  test("clients hero: no 'keep the lights on' / 'te dan de comer'", () => {
    for (const d of [en, es]) {
      expect(Object.values(d).join("\n")).not.toMatch(
        /lights on|dan de comer|da de comer/,
      );
      expect(d["clientsHero.emptyTitlePost"]).toBeUndefined();
    }
    expect(
      `${en["clientsHero.titlePre"]} ${
        tn("en", "clientsHero.people", 5, { word: "five" })
      } ${en["clientsHero.titlePost"]}`,
    )
      .toBe("The five people you work for.");
    expect(
      `${es["clientsHero.titlePre.one"]} ${es["clientsHero.people.one"]} ${
        es["clientsHero.titlePost.one"]
      }`,
    )
      // REQ-530 (cycle 3, p7): the singular names a customer, not a boss.
      .toBe("Tu primer cliente ya está en tu lista.");
    expect(read("front-end/components/ClientsSections.tsx")).not.toMatch(
      /emptyTitlePost/,
    );
  });
});

describe("REQ-413 (m49) the English landing lead is written for an English reader", () => {
  // deno-lint-ignore no-explicit-any
  const { LANDING_DICT } = require("../../front-end/lib/landing-dict") as any;
  test("en hero.lead no longer says 'You communicate with us in Spanish'", () => {
    const lead =
      "Talk to us in English or Spanish. Everything goes out to your clients in their language, ready to sign. No apps to learn — just chat.";
    expect(LANDING_DICT.en["hero.lead"]).toBe(lead);
    expect(en["landing.hero.lead"]).toBe(lead);
    // The Spanish pitch is unchanged.
    expect(LANDING_DICT.es["hero.lead"]).toBe(es["landing.hero.lead"]);
  });
});
