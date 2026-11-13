/**
 * REQ-579 — "fix every issue the demo found, loop until there are none"
 * (demo-loop cycle 4, run r857a9d67, issues M14 + m7).
 *
 * RCA (analyst + skeptic UPHELD at ad104a19):
 *   M14 — the price-first quick quote (AsstChat startQuoteFromRaw) took the
 *     first 8 raw words as the summary and named the job with
 *     summarizeJobName(summary, <UI language>). Pair 7 wrote Spanish with the
 *     app in English: "Baño Principal De", and the 8-word slice ("Baño
 *     principal de la señora Tran en Round") became the quote's only line.
 *   m7 — one job, several names: agreementTitle always prefixed the customer
 *     even when the option generator had put the surname in the job name
 *     ("Carol Henderson's Henderson Kitchen Gut Agreement", "Acuerdo de
 *     henderson kitchen gut de Carol Henderson"); the option prompt let the
 *     jobName name the customer or cover part of the scope.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const qp = (): any => require("../../shared/quote-flow/quick-quote-prefill");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const at = (): any => require("../../shared/quote-flow/agreement-title");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ml = (): any => require("../../shared/quote-flow/message-language");

const PAIR7 =
  "Baño principal de la señora Tran en Round Rock: quitar la tina y poner ducha, $18,000";

describe("REQ-579 (M14) the quick quote names the job in the language it was typed", () => {
  test("REQ-579 pair 7: Spanish text in the English app → 'Baño principal', never 'Baño Principal De'", () => {
    const n = qp().quickQuoteNames({ raw: PAIR7, lang: "en", fallback: "New job" });
    expect(n.jobName).toBe("Baño principal");
  });

  test("REQ-579 English text in the Spanish app is named the English way", () => {
    const n = qp().quickQuoteNames({
      raw: "Interior paint for the 3 bedrooms and the hallway, $4,200",
      lang: "es",
      fallback: "Nuevo trabajo",
    });
    expect(n.jobName).toBe(
      qp().quickQuoteNames({
        raw: "Interior paint for the 3 bedrooms and the hallway, $4,200",
        lang: "en",
        fallback: "New job",
      }).jobName,
    );
    expect(n.jobName).toMatch(/^[A-Z0-9]/);
  });

  test("REQ-579 the raw 8-word slice never becomes the line item — the line is the job name", () => {
    const n = qp().quickQuoteNames({ raw: PAIR7, lang: "en", fallback: "New job" });
    expect(n.line).toBe("Baño principal");
    const items = qp().quoteLineItemsFromPrefill([], 1_800_000, n.line);
    expect(items).toEqual([
      { description: "Baño principal", quantity: 1, unit: "ea", price: 1_800_000 },
    ]);
    expect(items[0].description).not.toContain("señora Tran en Round");
  });

  test("REQ-579 a confirmed option names the job and its summary is the line", () => {
    const n = qp().quickQuoteNames({
      raw: PAIR7,
      lang: "es",
      fallback: "Nuevo trabajo",
      confirmed: { jobName: "Remodelación Del Baño", summary: "Remodelación del baño principal" },
    });
    expect(n.summary).toBe("Remodelación del baño principal");
    expect(n.line).toBe("Remodelación del baño principal");
    expect(n.jobName).toBe("Remodelación del baño");
  });

  test("REQ-579 an empty message falls back to the localized 'new job'", () => {
    const n = qp().quickQuoteNames({ raw: "  ", lang: "es", fallback: "Nuevo trabajo" });
    expect(n.summary).toBe("Nuevo trabajo");
    expect(n.line.length).toBeGreaterThan(0);
  });

  test("REQ-579 the message-language detector is shared (front-end and backend read one rule)", () => {
    expect(ml().messageLang(PAIR7)).toBe("es");
    expect(ml().messageLang("Interior paint for the 3 bedrooms and the hallway")).toBe("en");
    const backend = read("backend/src/agents/domain/business/message-language/mod.ts");
    expect(backend).toMatch(/#quote-flow\/message-language\.ts/);
  });

  test("REQ-579 AsstChat's quick quote uses quickQuoteNames for the name and the line", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    expect(src).toMatch(/quickQuoteNames\(/);
    expect(src).toMatch(/quoteLineItemsFromPrefill\(prefillLines, cents, names\.line\)/);
  });
});

describe("REQ-579 (m7) the agreement title says the customer once", () => {
  test("REQ-579 en: a surname already in the job name is dropped from the job", () => {
    expect(
      at().agreementTitle({ customer: "Carol Henderson", job: "Henderson Kitchen Gut", lang: "en" }),
    ).toBe("Carol Henderson's Kitchen Gut Agreement");
  });

  test("REQ-579 es: 'Acuerdo de kitchen gut para Carol Henderson', never 'henderson kitchen gut'", () => {
    expect(
      at().agreementTitle({ customer: "Carol Henderson", job: "Henderson Kitchen Gut", lang: "es" }),
    ).toBe("Acuerdo de kitchen gut para Carol Henderson");
  });

  test("REQ-579 a possessive or a trailing 'for <surname>' goes too", () => {
    expect(
      at().agreementTitle({ customer: "Carol Henderson", job: "Henderson's Deck Repair", lang: "en" }),
    ).toBe("Carol Henderson's Deck Repair Agreement");
    expect(
      at().agreementTitle({ customer: "Ana López", job: "Patio para López", lang: "es" }),
    ).toBe("Acuerdo de patio para Ana López");
  });

  test("REQ-579 a job that is only the customer's name reads as no job", () => {
    expect(
      at().agreementTitle({ customer: "Carol Henderson", job: "Henderson", lang: "en" }),
    ).toBe("Carol Henderson's Agreement");
  });

  test("REQ-579 es keeps proper tokens: an abbreviation and the name after it stay capitalised", () => {
    expect(
      at().agreementTitle({ customer: "Ana", job: "Césped St. Augustine Nuevo", lang: "es" }),
    ).toBe("Acuerdo de césped St. Augustine nuevo para Ana");
  });

  test("REQ-579 a business or household customer never strips the job's own words", () => {
    expect(
      at().agreementTitle({ customer: "Kitchen Pros LLC", job: "Kitchen Remodel", lang: "en" }),
    ).toBe("Kitchen Pros LLC's Kitchen Remodel Agreement");
    expect(
      at().agreementTitle({ customer: "the Patio family", job: "Patio Pavers", lang: "en" }),
    ).toBe("the Patio family's Patio Pavers Agreement");
  });

  test("REQ-579 a job that shares no word with the customer is untouched (REQ-036/394 shapes)", () => {
    expect(
      at().agreementTitle({ customer: "Godzilla", job: "Concrete Patio", lang: "en" }),
    ).toBe("Godzilla's Concrete Patio Agreement");
    expect(
      at().agreementTitle({ customer: "Ana López", job: "Corte De Césped", lang: "es" }),
    ).toBe("Acuerdo de corte de césped para Ana López");
  });
});

describe("REQ-579 (m7) the option prompt: jobName never names the customer and covers the whole scope", () => {
  for (const file of ["lang/en.json", "lang/es.json"]) {
    test(`REQ-579 ${file}`, () => {
      const p = JSON.parse(read(file))["prompts.generateJobOptions"] as string;
      expect(p).toMatch(/jobName never names the customer/);
      expect(p).toMatch(/covers every scope item/);
    });
  }
});

describe("REQ-579 (m7) the option pick renames the header and the thread at once", () => {
  test("REQ-579 the picked jobName lands in the local quote and the server re-titles the thread", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    const pick = src.slice(src.indexOf("const saved = await quotesClient.update(quoteId, {"));
    const block = pick.slice(0, pick.indexOf("setNeedsJobPolish(false)"));
    expect(block).toMatch(/\bjobName,\s*\n/);
    expect(block).toMatch(/setQuote\(\(q\)[\s\S]*jobName[\s\S]*\)/);
    expect(block).toMatch(/\/agents\/conversations\/\$\{convoId\}\/draft`/);
  });
});
