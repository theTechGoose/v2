/**
 * Dictionary-content consistency tests. These require the LIVE flat
 * dot-notation dictionaries and assert on their VALUES — red today because
 * the copy is wrong / inconsistent, green once the strings are fixed by key.
 *
 * P-43 "Deposit" is Depósito on contract/wizard/dashboard but Anticipo on
 *      invoice/settings — ONE Spanish word must be used for "deposit".
 * P-45 Preview "Tiempo de entrega" becomes "Duración" on the signed doc —
 *      same label on both surfaces.
 * P-47 /quotes same-page drift: "Resueltas este mes" vs "Decididas este mes";
 *      "En espera de respuesta" vs "Esperando respuesta" — one term per concept.
 * P-48 "{n} días vencido" must pluralize ("días vencidos").
 * P-61 Win-rate run-on "0 perdidasfaltan…" / "0 lostneed…" — separator between
 *      the lost-count fragment and the need-more fragment (both languages).
 * P-46 EN naming/case drift: no client/customer mixing on the customers surface;
 *      Title-Case cluster ("Click Here For…", "Pick a Customer", "+ New Customer")
 *      → sentence case.
 * P-34 Clients headline must not render "Las uno persona … que mantienen" for
 *      one client (number/verb agreement).
 * P-65 ES danger-zone confirm keyword must be localized (not "DELETE"); the
 *      professionalize error must not be the calque "No se pudo hacer profesional".
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const en: Record<string, string> = require("../../lang/en.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const es: Record<string, string> = require("../../lang/es.json");

/** All string values of a flat dictionary. */
function values(dict: Record<string, string>): string[] {
  return Object.values(dict);
}
/** All [key, value] pairs of a flat dictionary. */
function entries(dict: Record<string, string>): Array<[string, string]> {
  return Object.entries(dict);
}
/** Minimal {token} interpolation, mirroring the app's tFor substitution. */
function render(tmpl: string, params: Record<string, string>): string {
  return tmpl.replace(/\{(\w+)\}/g, (_m, k) => (k in params ? params[k] : `{${k}}`));
}

describe("P-43 one Spanish term for 'deposit' across all dict values", () => {
  // The single-word "deposit" LABEL keys (compound "depósito + saldo" and the
  // banking "depósito directo" ACH sense are excluded — different meanings).
  const DEPOSIT_LABEL_KEYS = [
    "asstChat.milestone.deposit",
    "asstChat.payment.deposit",
    "contractDoc.milestone.deposit",
    "dashSeed.jobs.deposit",
    "dashboardPage.job.deposit",
    "publicInvoice.milestone.deposit", // "Anticipo" today — the drift
    "renderContractPdf.milestone.deposit",
    "settings.deposit", // "Anticipo" today — the drift
  ];

  it("P-43 every deposit-label key uses the SAME Spanish word", () => {
    for (const k of DEPOSIT_LABEL_KEYS) {
      expect(typeof es[k]).toBe("string"); // key must exist in es
    }
    const terms = new Set(DEPOSIT_LABEL_KEYS.map((k) => es[k].trim().toLowerCase()));
    // Red today: {"depósito","anticipo"} → size 2.
    expect(terms.size).toBe(1);
  });
});

describe("P-45 preview timeline label matches the contract-doc duration label (es)", () => {
  it("P-45 asstChat.preview.termLabel.wraps === contractDoc.termLabel.wraps", () => {
    // "Tiempo de entrega" (preview) vs "Duración" (signed doc) — must agree.
    expect(es["asstChat.preview.termLabel.wraps"]).toBe(es["contractDoc.termLabel.wraps"]);
  });
});

describe("P-47 one ES translation per /quotes concept", () => {
  it("P-47 'decided this month' KPI and track labels agree", () => {
    // "Resueltas este mes" (KPI) vs "Decididas este mes" (track).
    expect(es["quotesKpi.decidedLbl"]).toBe(es["quotesPage.track.decidedThisMonth"]);
  });

  it("P-47 'out for response' KPI and track labels agree", () => {
    // "En espera de respuesta" (KPI) vs "Esperando respuesta" (track).
    expect(es["quotesKpi.outLbl"]).toBe(es["quotesPage.track.outForResponse"]);
  });
});

describe("P-48 ES plural agreement for overdue days", () => {
  it("P-48 the plural overdue template says 'días vencidos', never 'días vencido'", () => {
    // Offender: dashboardPage.invoice.overdue.other = "{n} días vencido · #INV-{num}".
    expect(es["dashboardPage.invoice.overdue.other"]).not.toMatch(/\bdías vencido\b/);
  });

  it("P-48 no es value has the ungrammatical plural 'días vencido' (missing final s)", () => {
    for (const v of values(es)) {
      expect(v).not.toMatch(/\bdías vencido\b/);
    }
  });
  // DROPPED (already green vs live es dict): the literal "lista/firmada" does
  // not appear in any es value; and no es value matches /porque Tu/
  // (paperworkEmail.quote.sentBecause reads "Enviado porque {name} preparó
  // esto para ti"). Both would pass today, so they are not written.
});

describe("P-61 win-rate template has a separator between the two fragments", () => {
  it("P-61 es 'wonLost' + 'needMore' does not butt 'perdidas' against 'faltan'", () => {
    // The FE concatenates quotesRate.wonLost ("… {lost} perdidas") with
    // quotesRate.needMore ("faltan {n} más …"); today that renders
    // "…0 perdidasfaltan 4 más…". A separator must sit between them.
    const run = es["quotesRate.wonLost"] + es["quotesRate.needMore"];
    expect(run).not.toMatch(/perdidasfaltan/i);
  });

  it("P-61 en 'wonLost' + 'needMore' does not butt 'lost' against 'need'", () => {
    const run = en["quotesRate.wonLost"] + en["quotesRate.needMore"];
    expect(run).not.toMatch(/lostneed/i);
  });
});

describe("P-46 EN customers-surface: one term, sentence case", () => {
  // The customers page + its nav entry + the assistant customer-picker.
  const SURFACE_KEYS = [
    "appNav.customers", // sidebar label → "Customers"
    "clientsBoard.empty.noClients", // "No clients yet …"
    "clientsBoard.empty.noMatches",
    "clientsSegments.empty",
    "clientsHero.addClient", // "New client"
    "clientsHero.emptyTitleEm", // "first client"
    "asstChat.customerStep.pickTitle",
    "asstChat.customerStep.newCustomer",
    "quoteCard.back.viewAsClient", // "View as client"
  ];

  it("P-46 the customers surface does not mix 'client' and 'customer'", () => {
    const usesClient = SURFACE_KEYS.some((k) => /\bclients?\b/i.test(en[k]));
    const usesCustomer = SURFACE_KEYS.some((k) => /\bcustomers?\b/i.test(en[k]));
    // Red today: nav="Customers" (customer) + page="… clients …" (client).
    expect(usesClient && usesCustomer).toBe(false);
  });

  it("P-46 the customer-picker cluster is sentence case, no 'Click here for…'", () => {
    expect(en["asstChat.customerStep.existingTrigger"]).not.toMatch(/click here for/i);
    expect(en["asstChat.customerStep.newCustomer"]).not.toMatch(/New Customer/);
    expect(en["asstChat.customerStep.pickTitle"]).not.toMatch(/Pick a Customer/);
  });
});

describe("P-34 clients headline agrees in number for one client (es)", () => {
  it("P-34 the one-client headline is not 'Las uno persona … que mantienen'", () => {
    // FE builds: titlePre + people.one(word=numberWord(1)) + titlePost.
    // Prefer a `.one` pluralization variant if the fix introduces one.
    const pre = es["clientsHero.titlePre.one"] ?? es["clientsHero.titlePre"] ?? "";
    const ppl = render(es["clientsHero.people.one"] ?? "", {
      word: es["clientsDisplay.num.one"] ?? "",
    });
    const post = es["clientsHero.titlePost.one"] ?? es["clientsHero.titlePost"] ?? "";
    const headlineOne = `${pre} ${ppl} ${post}`.replace(/\s+/g, " ").trim();

    // Red today: "Las uno persona que mantienen las luces encendidas."
    expect(headlineOne).not.toMatch(/\bLas\b/); // plural article on a 1-client headline
    expect(headlineOne).not.toMatch(/uno persona|una persona/i); // numeral glued to noun
    expect(headlineOne).not.toMatch(/\bmantienen\b/); // plural verb for one client
  });
});

describe("P-65 ES danger-zone keyword + professionalize error", () => {
  it("P-65 the ES account-wipe confirm keyword is localized (not English 'DELETE')", () => {
    expect(es["settings.wipeConfirmLabel"]).not.toContain("DELETE");
    expect(es["settings.aria.wipeConfirm"]).not.toContain("DELETE");
  });

  it("P-65 the ES professionalize error is not the calque 'hacer profesional'", () => {
    // Today: "No se pudo hacer profesional. Intenta de nuevo." → suggest "pulir".
    expect(es["asstChat.writeSelf.error"]).not.toMatch(/hacer profesional/i);
  });
});
