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
  return tmpl.replace(
    /\{(\w+)\}/g,
    (_m, k) => (k in params ? params[k] : `{${k}}`),
  );
}

describe("P-43 one Spanish term for 'deposit' across all dict values", () => {
  // The single-word "deposit" LABEL keys (compound "depósito + saldo" and the
  // banking "depósito directo" ACH sense are excluded — different meanings).
  const DEPOSIT_LABEL_KEYS = [
    "asstChat.milestone.deposit",
    "asstChat.payment.deposit",
    "quoteDoc.milestone.deposit",
    "dashSeed.jobs.deposit",
    "dashboardPage.job.deposit",
    "publicInvoice.milestone.deposit", // "Anticipo" today — the drift
    "renderQuotePdf.milestone.deposit", // renamed from renderContractPdf.* in the merge
    "settings.deposit", // "Anticipo" today — the drift
  ];

  it("P-43 every deposit-label key uses the SAME Spanish word", () => {
    for (const k of DEPOSIT_LABEL_KEYS) {
      expect(typeof es[k]).toBe("string"); // key must exist in es
    }
    const terms = new Set(
      DEPOSIT_LABEL_KEYS.map((k) => es[k].trim().toLowerCase()),
    );
    // Red today: {"depósito","anticipo"} → size 2.
    expect(terms.size).toBe(1);
  });
});

describe("P-45 preview timeline label matches the contract-doc duration label (es)", () => {
  it("P-45 asstChat.preview.termLabel.wraps === quoteDoc.termLabel.wraps", () => {
    // "Tiempo de entrega" (preview) vs "Duración" (signed doc) — must agree.
    expect(es["asstChat.preview.termLabel.wraps"]).toBe(
      es["quoteDoc.termLabel.wraps"],
    );
  });
});

describe("P-47 one ES translation per /quotes concept", () => {
  it("P-47 'decided this month' KPI and track labels agree", () => {
    // "Resueltas este mes" (KPI) vs "Decididas este mes" (track).
    expect(es["quotesKpi.decidedLbl"]).toBe(
      es["quotesPage.track.decidedThisMonth"],
    );
  });

  it("P-47 'out for response' KPI and track labels agree", () => {
    // "En espera de respuesta" (KPI) vs "Esperando respuesta" (track).
    expect(es["quotesKpi.outLbl"]).toBe(es["quotesPage.track.outForResponse"]);
  });
});

describe("P-48 ES plural agreement for overdue days", () => {
  it("P-48 the plural overdue template says 'días vencidos', never 'días vencido'", () => {
    // Offender: dashboardPage.invoice.overdue.other = "{n} días vencido · #INV-{num}".
    expect(es["dashboardPage.invoice.overdue.other"]).not.toMatch(
      /\bdías vencido\b/,
    );
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
    const usesCustomer = SURFACE_KEYS.some((k) =>
      /\bcustomers?\b/i.test(en[k])
    );
    // Red today: nav="Customers" (customer) + page="… clients …" (client).
    expect(usesClient && usesCustomer).toBe(false);
  });

  it("P-46 the customer-picker cluster is sentence case, no 'Click here for…'", () => {
    expect(en["asstChat.customerStep.existingTrigger"]).not.toMatch(
      /click here for/i,
    );
    expect(en["asstChat.customerStep.newCustomer"]).not.toMatch(/New Customer/);
    expect(en["asstChat.customerStep.pickTitle"]).not.toMatch(
      /Pick a Customer/,
    );
  });
});

describe("P-34 clients headline agrees in number for one client (es)", () => {
  it("P-34 the one-client headline is not 'Las uno persona … que mantienen'", () => {
    // FE builds: titlePre + people.one(word=numberWord(1)) + titlePost.
    // Prefer a `.one` pluralization variant if the fix introduces one.
    const pre = es["clientsHero.titlePre.one"] ?? es["clientsHero.titlePre"] ??
      "";
    const ppl = render(es["clientsHero.people.one"] ?? "", {
      word: es["clientsDisplay.num.one"] ?? "",
    });
    const post = es["clientsHero.titlePost.one"] ??
      es["clientsHero.titlePost"] ?? "";
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

describe("REQ-009 NW-24 'Job completed' / 'Next month' casing (both dictionaries)", () => {
  // p23: "Change 'Job Completed' to 'Job completed' (lowercase c)."
  // p22: "Change 'Next Month' to 'Next month'."
  const JOB_COMPLETED_KEYS = [
    "quoteDoc.termValue.jobCompleted",
    "termsWizard.wraps.jobCompleted",
    "renderQuotePdf.termValue.jobCompleted",
  ];
  it.each(JOB_COMPLETED_KEYS)("REQ-009 %s is 'Job completed' / 'Trabajo terminado'", (key) => {
    expect(en[key]).toBe("Job completed");
    expect(es[key]).toBe("Trabajo terminado");
  });

  it("REQ-009 the start-date step no longer carries a jobCompleted label (option removed)", () => {
    expect(en["termsWizard.startDate.jobCompleted"]).toBeUndefined();
    expect(es["termsWizard.startDate.jobCompleted"]).toBeUndefined();
  });

  it.each(["termsWizard.startDate.nextMonth", "asstChat.terms.startDate.nextMonth"])(
    "REQ-009 %s is 'Next month' (sentence case)",
    (key) => {
      expect(en[key]).toBe("Next month");
      expect(es[key]).toBe("El próximo mes");
    },
  );

  it("REQ-009 no EN value anywhere still says 'Job Completed' or 'Next Month'", () => {
    const offenders = entries(en).filter(([, v]) => /\bJob Completed\b|\bNext Month\b/.test(v));
    expect(offenders).toEqual([]);
  });
});

describe("REQ-010 NW-17 the 'Write it myself.' pill", () => {
  // p26: the pill under the prompt bubble "needs … a period at the end of
  // 'myself'". The picker TILE keeps the period-less title.
  it("REQ-010 NW-17 has its own CTA key ending with a period, in both dictionaries", () => {
    expect(en["asstChat.jobOpts.customCta"]).toBe("Write it myself.");
    expect(es["asstChat.jobOpts.customCta"]).toBe("Escribirlo yo mismo.");
  });
  it("REQ-010 NW-17 the picker tile title stays without a period", () => {
    expect(en["asstChat.jobOpts.customTitle"]).toBe("Write it myself");
    expect(es["asstChat.jobOpts.customTitle"]).toBe("Escribirlo yo mismo");
  });
});

describe("REQ-014 NW-54 the clause list is headed 'Terms and Conditions' on web + PDF", () => {
  // p62: rename "fine print, in plain english" to "Terms and Conditions".
  it("REQ-014 NW-54 web heading key exists in both dictionaries", () => {
    expect(en["quoteDoc.termsAndConditions"]).toBe("Terms and Conditions");
    expect(es["quoteDoc.termsAndConditions"]).toBe("Términos y Condiciones");
  });
  it("REQ-014 NW-54 the PDF section heading says the same thing", () => {
    expect(en["renderQuotePdf.section.finePrint"]).toBe("Terms and Conditions");
    expect(es["renderQuotePdf.section.finePrint"]).toBe("Términos y Condiciones");
  });
});

describe("REQ-015 completed-half copy — governing-law tail, warranty labels, 'Scope of Work'", () => {
  // p80: "This agreement is governed by the laws of the state where the work
  // is performed, without regard to conflict of law rules."
  it.each(["quoteDoc.clause.governingLaw.body", "renderQuotePdf.clause.governingLaw.body"])(
    "REQ-015 %s carries the conflict-of-law tail (en + es)",
    (key) => {
      expect(en[key]).toMatch(/where the work is performed, without regard to conflict of law rules\.$/);
      expect(es[key]).toMatch(/donde se realiza el trabajo, sin importar las reglas sobre conflicto de leyes\.$/);
    },
  );

  // p76-77: Warranty — No warranty / 6 months / 1 year / 2 years / Custom.
  it.each([
    ["termsWizard.warranty.twelveMonths", "1 year", "1 año"],
    ["termsWizard.warranty.twentyFourMonths", "2 years", "2 años"],
    ["asstChat.warranty.preset.twelveMonths", "1 year", "1 año"],
    ["asstChat.warranty.preset.twentyFourMonths", "2 years", "2 años"],
  ])("REQ-015 %s reads %s / %s", (key, enValue, esValue) => {
    expect(en[key]).toBe(enValue);
    expect(es[key]).toBe(esValue);
  });

  // p83: the required notices list titles item 2 "Scope of Work".
  it("REQ-015 clause 2 is titled 'Scope of Work' on web + PDF", () => {
    expect(en["quoteDoc.clause.jobDetails.title"]).toBe("Scope of Work");
    expect(es["quoteDoc.clause.jobDetails.title"]).toBe("Alcance del trabajo");
    expect(en["renderQuotePdf.clause.jobDetails.title"]).toBe("Scope of Work.");
    expect(es["renderQuotePdf.clause.jobDetails.title"]).toBe("Alcance del trabajo.");
  });
});

describe("REQ-017 pricing tiers — Competitive / Market / Premium, labor AND materials", () => {
  // p7: "The price tiers cannot be 'Basic / Standard / Premium'…"
  it("REQ-017 the tier labels are the client's names in both dictionaries", () => {
    expect(en["suggestPrices.tier.competitive"]).toBe("Competitive");
    expect(en["suggestPrices.tier.market"]).toBe("Market");
    expect(en["suggestPrices.tier.premium"]).toBe("Premium");
    expect(es["suggestPrices.tier.competitive"]).toBe("Competitivo");
    expect(es["suggestPrices.tier.market"]).toBe("De mercado");
    expect(es["suggestPrices.tier.premium"]).toBe("Premium");
    expect(en["suggestPrices.tier.basic"]).toBeUndefined();
    expect(en["suggestPrices.tier.standard"]).toBeUndefined();
  });
  it("REQ-017 the fallback rationales are the client's definitions, never 'basic/minimal'", () => {
    expect(en["suggestPrices.fallback.competitiveRationale"]).toBe("Straightforward job, priced to win the work");
    expect(en["suggestPrices.fallback.marketRationale"]).toBe("Typical professional price in your area");
    expect(en["suggestPrices.fallback.premiumRationale"]).toBe("For urgency, difficult access, or extra complexity");
    expect(es["suggestPrices.fallback.competitiveRationale"]).toBe("Trabajo sencillo, precio para ganar la obra");
    expect(es["suggestPrices.fallback.marketRationale"]).toBe("Precio profesional típico en tu zona");
    expect(es["suggestPrices.fallback.premiumRationale"]).toBe("Para urgencia, acceso difícil o más complejidad");
  });
  it("REQ-017 the basis line exists in both dictionaries", () => {
    expect(en["suggestPrices.basis.laborAndMaterials"]).toBe("Prices include labor and materials");
    expect(es["suggestPrices.basis.laborAndMaterials"]).toBe("Los precios incluyen mano de obra y materiales");
  });
  it("REQ-017 the prompt states the basis, the tier order, the location rule — and is English in both dictionaries", () => {
    const p = en["prompts.suggestPrices"];
    expect(p).toContain("labor AND materials");
    expect(p).toContain("competitive < market < premium");
    expect(p).toMatch(/location/i);
    expect(p).not.toMatch(/\bbasic\b.*\bstandard\b/i);
    expect(es["prompts.suggestPrices"]).toBe(p);
  });
});

describe("REQ-028 NW-05 the prompts stop licensing the echo", () => {
  // p4: "The AI must never echo the user's raw input back as the suggested
  // description." The options prompt never forbade returning the sentence,
  // and the polish prompt literally said "mirror it back cleaned-up".
  it("REQ-028 generateJobOptions forbids returning the contractor's sentence verbatim — same text in both dictionaries", () => {
    const p = en["prompts.generateJobOptions"];
    expect(p).toContain("Never return the contractor's sentence verbatim");
    expect(p).toMatch(/drop prices, "I need to", and questions/);
    expect(es["prompts.generateJobOptions"]).toBe(p);
  });
  it("REQ-028 polishJobDetails no longer says 'mirror it back' — a vague sentence becomes one neutral scope sentence", () => {
    const p = en["prompts.polishJobDetails.system"];
    expect(p).not.toMatch(/mirror it back/i);
    expect(p).toContain("never the contractor's own sentence");
    expect(es["prompts.polishJobDetails.system"]).toBe(p);
  });
});

describe("REQ-035 NW-55 agreement presentation copy", () => {
  // p63: "Cancelation (either side can cancel with 7-day notice; work
  // completed will be paid for)" — the clause said only the first half.
  it("REQ-035 the termination clause ends with the paid-for-work sentence — web and PDF twins, both dictionaries", () => {
    expect(en["quoteDoc.clause.termination.body"]).toMatch(/Work completed before cancelation will be paid for\.$/);
    expect(es["quoteDoc.clause.termination.body"]).toMatch(/El trabajo realizado antes de la cancelación se pagará\.$/);
    expect(en["renderQuotePdf.clause.termination.body"]).toMatch(/Work completed before cancelation will be paid for\.$/);
    expect(es["renderQuotePdf.clause.termination.body"]).toMatch(/El trabajo realizado antes de la cancelación se pagará\.$/);
  });
  it("REQ-035 the Cancelation term row and the send dialog copy exist in both dictionaries", () => {
    expect(en["quoteDoc.termLabel.cancellation"]).toBe("Cancelation");
    expect(es["quoteDoc.termLabel.cancellation"]).toBe("Cancelación");
    expect(en["quoteDoc.termValue.cancellation"]).toBe("7 days' notice");
    expect(es["quoteDoc.termValue.cancellation"]).toBe("Aviso de 7 días");
    expect(en["asstChat.send.howTitle"]).toBe("How do you want to send to customer?");
    expect(es["asstChat.send.howTitle"]).toBe("¿Cómo quieres enviárselo al cliente?");
    expect(en["asstChat.send.keep"]).toBe("Keep");
    expect(es["asstChat.send.keep"]).toBe("Guardar");
    expect(en["asstChat.send.cancel"]).toBe("Cancel");
    expect(es["asstChat.send.cancel"]).toBe("Cancelar");
  });
});

describe("REQ-041 NW-48 the customer SMS puts the link on its own line", () => {
  // p45 template: "Your Quote + Agreement for [Job Name] is ready:" / "[LINK]" /
  // "Please let me know…" — the link is its own line, not inline after "ready:".
  it("REQ-041 paperworkSms.body.ready ends with a newline + {url} in both dictionaries", () => {
    expect(en["paperworkSms.body.ready"]).toMatch(/:\n\{url\}$/);
    expect(es["paperworkSms.body.ready"]).toMatch(/:\n\{url\}$/);
  });
});
