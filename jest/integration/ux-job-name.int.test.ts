/**
 * RED (TDD) — Spanish job-name derivation over real HTTP (dev stack :5280).
 *
 * UX-05    ES version titles / derived jobName keep stopwords lowercase —
 *          "Instalación de patio", never "Instalación De Patio".
 * UX-41(c) ES titles are sentence case — "Cambiar 12 tablas", not
 *          "Cambiar 12 Tablas".
 * UX-26(c) "Pintar la sala", never "Pintar La Sala".
 * UX-29    "El patio de adoquines de María Nguyen, $3,700" must derive
 *          "Patio de adoquines" — leading article trimmed, never a stopword
 *          tail — because that STORED string headlines the customer's /q and
 *          /i pages and the outbound SMS.
 *
 * Phones used by this file (block +15125556300–6399):
 *   +15125556300 contractor (ES) · +15125556301 customer "María Nguyen"
 *
 * SERVER DERIVATION PATHS UNDER TEST (read in backend/src):
 *   1. POST /agents/job-details/polish  → PolishJobDetails
 *      (backend/src/agents/domain/coordinators/polish-job-details/mod.ts):
 *      under the dev stub LLM the "(stub) …" echo is unparseable JSON, so the
 *      DETERMINISTIC fallback at mod.ts:150-159 runs — jobName =
 *      deriveJobName/clampJobName (mod.ts:132-148), which Title-Cases every
 *      word lang-blind. Same precedent job-name.int.test.ts used to drive the
 *      P-27 jobName contract — no it.skip needed, the fallback IS the
 *      derivation under test.
 *   2. POST /agents/job-details/options → GenerateJobOptions
 *      (backend/src/agents/domain/coordinators/generate-job-options/mod.ts):
 *      stub → fallbackOptions (mod.ts:233-269); jobName via clampJobName
 *      (mod.ts:210-226), composed with versionTitle() — the version cards of
 *      UX-05/UX-41.
 *   3. POST /quotes with no jobName → QuoteStore.create
 *      (backend/src/paperwork/domain/data/quote-store/mod.ts:28-31) →
 *      summarizeJobName(summary) — shared/quote-flow/job-name.ts, EN-only
 *      stopwords + unconditional Title Case. LLM-free on EVERY stack (real
 *      key or stub). The stored jobName is served by GET /quotes/:id and the
 *      anonymous GET /quotes/:id/public that headlines /q.
 *   4. POST /invoices {quoteId} → invoice-controller
 *      (backend/src/paperwork/entrypoints/invoice-controller/mod.ts:217)
 *      inherits the quote's jobName — the /i headline.
 *   (The facturar chat flow derives its invoice jobName CLIENT-side at
 *   front-end/islands/AsstChat.tsx:3137 — that raw 3-word slice is the
 *   literal "El patio de" of UX-29; it is pinned as a wiring site in
 *   jest/unit/ux-job-name-es.test.ts since no HTTP call performs it.)
 *
 * PROBED LIVE (curl, 2026-08-19, ES contractor +15125556300 with
 * user.language=es and identity.commsLanguage=es):
 *   POST /api/agents/job-details/polish
 *     {"raw":"instalación de patio de adoquines 20x15 para la familia Nguyen"}
 *     → 200 {"jobName":"Instalación De Patio", …}          (want "Instalación de patio")
 *   POST /api/agents/job-details/polish {"raw":"pintar la sala y el comedor"}
 *     → 200 {"jobName":"Pintar La Sala", …}                 (want "Pintar la sala")
 *   POST /api/agents/job-details/options
 *     {"raw":"cambiar 12 tablas del deck y sellar todo"}
 *     → 200 langs:["es"], opt1 "Cambiar 12 Tablas",
 *       opt2 "Cambiar 12 Tablas · Versión breve"            (want "Cambiar 12 tablas…")
 *   POST /api/quotes {summary:"El patio de adoquines de María Nguyen, $3,700",
 *     no jobName} → jobName "El Patio De"; GET /quotes/:id and anonymous
 *     GET /quotes/:id/public both serve "El Patio De"        (want "Patio de adoquines")
 *   POST /api/invoices {quoteId} → jobName "El Patio De";
 *     GET /invoices/:id "El Patio De"                        (want "Patio de adoquines")
 *   (POST /quotes without `summary` → 500 "summary must be a string" —
 *   summary is required by CreateQuoteDto, so the UX-29 sentence is sent as
 *   the summary, exactly the field quote-store derives from first.)
 *
 * LLM caveat (honesty): rows 1-2-3-4 below ride the deterministic stub
 * fallback of the dev harness (TESTS-PROBLEMS.md pins this stack). With a
 * real OPENAI key the model supplies the jobName wording, but the exact-pin
 * inputs were chosen so the desired string is the sentence-cased first-3-word
 * window of the input — the contract the UX findings name verbatim. Rows
 * 5-6 (quote + invoice) involve no LLM on any stack.
 */
import { anonymous, contractor, type ApiSession } from "./helpers/api";

const CONTRACTOR_PHONE = "+15125556300";
const CUSTOMER_PHONE = "+15125556301";

const ES_STOPWORDS = new Set([
  "de", "del", "la", "el", "los", "las", "un", "una",
  "y", "o", "para", "por", "con", "en", "al",
]);
const words = (s: string) => s.trim().split(/\s+/);
const lastWord = (s: string) => words(s)[words(s).length - 1];

describe("UX-05/UX-26(c)/UX-29/UX-41: Spanish job-name derivation over HTTP", () => {
  let s: ApiSession;

  beforeAll(async () => {
    s = await contractor(CONTRACTOR_PHONE);
    // ES persona: app language AND outgoing-comms language are Spanish
    // (job-details-controller/mod.ts:22-28 reads identity.commsLanguage;
    // the quote/invoice jobName is customer-facing, so es governs it).
    await s.put("/me", { language: "es" });
    await s.put("/profile/identity", {
      businessName: "Techos Morales",
      commsLanguage: "es",
      commsLanguages: ["es"],
    });
  });

  /** Seed the UX-29 quote: Spanish summary, NO jobName — the server derives it. */
  async function seedSpanishQuote(): Promise<{ quoteId: string; created: any }> {
    const cust = await s.post("/customers", {
      name: "María Nguyen",
      phoneNumber: CUSTOMER_PHONE,
    });
    expect(cust.status).toBeLessThan(400);
    const q = await s.post("/quotes", {
      customerId: cust.body.id,
      summary: "El patio de adoquines de María Nguyen, $3,700",
      description: "El patio de adoquines de María Nguyen, $3,700 todo incluido",
      lineItems: [
        { description: "Patio de adoquines 20x15", quantity: 1, unit: "job", price: 370000 },
      ],
      estimatedTotal: 370000,
    });
    expect(q.status).toBeLessThan(400);
    expect(q.body?.id).toBeTruthy();
    return { quoteId: q.body.id as string, created: q.body };
  }

  it("UX-05: the polish step derives an ES jobName with lowercase stopwords ('Instalación de patio')", async () => {
    const { status, body } = await s.post("/agents/job-details/polish", {
      raw: "instalación de patio de adoquines 20x15 para la familia Nguyen",
    });
    expect(status).toBe(200);
    // Probed today: "Instalación De Patio".
    expect(body.jobName).toBe("Instalación de patio");
    // accent-safe fix only (no \b\w-class recasing):
    expect(/\p{Ll}\p{Lu}/u.test(body.jobName)).toBe(false);
  });

  it("UX-26(c): the polish step never yields 'Pintar La Sala' — the SMS job name source", async () => {
    const { status, body } = await s.post("/agents/job-details/polish", {
      raw: "pintar la sala y el comedor",
    });
    expect(status).toBe(200);
    // Probed today: "Pintar La Sala" — the exact string the UX-26 customer
    // received inside "Your Quote + Agreement for Pintar La Sala is ready".
    expect(body.jobName).toBe("Pintar la sala");
  });

  it("UX-41: the version-option cards carry sentence-case ES titles ('Cambiar 12 tablas')", async () => {
    const { status, body } = await s.post("/agents/job-details/options", {
      raw: "cambiar 12 tablas del deck y sellar todo",
    });
    expect(status).toBe(200);
    // sanity (green precondition): the es persona gets es cards
    expect(body.langs).toContain("es");
    const opts = body.options as Array<{ byLang: Record<string, { jobName: string }> }>;
    expect(opts.length).toBeGreaterThanOrEqual(3);
    // Probed today: "Cambiar 12 Tablas" / "Cambiar 12 Tablas · Versión breve".
    expect(opts[0].byLang.es.jobName).toBe("Cambiar 12 tablas");
    expect(opts[1].byLang.es.jobName.startsWith("Cambiar 12 tablas · ")).toBe(true);
  });

  it("UX-05: the version-option cards keep ES stopwords lowercase mid-title", async () => {
    const { status, body } = await s.post("/agents/job-details/options", {
      raw: "instalación de patio de adoquines nuevos",
    });
    expect(status).toBe(200);
    const opts = body.options as Array<{ byLang: Record<string, { jobName: string }> }>;
    // Probed today: opt1 "Instalación De Patio".
    expect(opts[0].byLang.es.jobName).toBe("Instalación de patio");
    // No card may Title-Case a Spanish stopword anywhere in its es title
    // (the base-name half before any "·" qualifier is the derived jobName).
    for (const o of opts) {
      const base = o.byLang.es.jobName.split(" · ")[0];
      for (const w of words(base).slice(1)) {
        if (ES_STOPWORDS.has(w.toLowerCase())) expect(w).toBe(w.toLowerCase());
      }
    }
  });

  it("UX-29: a quote created from a Spanish summary stores 'Patio de adoquines' — never 'El Patio De' — on both private and public (/q headline) reads", async () => {
    const { quoteId, created } = await seedSpanishQuote();
    // Probed today: created/private/public all serve "El Patio De".
    expect(created.jobName).toBe("Patio de adoquines");

    const priv = await s.get(`/quotes/${quoteId}`);
    expect(priv.status).toBe(200);
    expect(priv.body.jobName).toBe("Patio de adoquines");

    // The anonymous public read is the string that headlines María's /q page.
    const pub = await anonymous().get(`/quotes/${quoteId}/public`);
    expect(pub.status).toBe(200);
    expect(pub.body.jobName).toBe("Patio de adoquines");
    // Structural halves of the finding, for diagnosis when the exact pin fails:
    expect(words(pub.body.jobName)[0].toLowerCase()).not.toBe("el");
    expect(ES_STOPWORDS.has(lastWord(pub.body.jobName).toLowerCase())).toBe(false);
  });

  it("UX-29: the invoice raised from that quote inherits the corrected jobName (the /i headline)", async () => {
    const { quoteId } = await seedSpanishQuote();
    const inv = await s.post("/invoices", { quoteId });
    expect(inv.status).toBeLessThan(400);
    expect(inv.body?.id).toBeTruthy();
    // Probed today: "El Patio De" (inherited verbatim at
    // invoice-controller/mod.ts:217).
    expect(inv.body.jobName).toBe("Patio de adoquines");

    const read = await s.get(`/invoices/${inv.body.id}`);
    expect(read.status).toBe(200);
    expect(read.body.jobName).toBe("Patio de adoquines");
    expect(ES_STOPWORDS.has(lastWord(read.body.jobName).toLowerCase())).toBe(false);
  });
});
