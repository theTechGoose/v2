/**
 * REQ-263 — demo issue ai-assistant-m2: "Job address dropped from the quote
 * ('412 Oak St Austin')". A quote had no job-site field, nothing pulled the
 * address out of the typed sentence, the customer step could not take one,
 * and the agreement never showed one.
 *
 * Here: the deterministic extraction (shared/quote-flow/quick-quote-prefill.ts)
 * and the front-end wiring — the starter-chip flow writes it on the quote,
 * the customer step shows it (pre-filled) and sends it, the contractor's
 * preview and the customer's agreement (/q, quote-doc.tsx) render it, and
 * both languages carry the labels.
 */
import * as fs from "fs";
import * as path from "path";

/* eslint-disable @typescript-eslint/no-explicit-any */
const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-263 extractServiceAddress — the job address in the typed sentence", () => {
  let mod: any;
  beforeAll(() => {
    mod = require("../../shared/quote-flow/quick-quote-prefill");
  });

  it("REQ-263 the demo's free-chat sentence (pair 3): '…for Maria Lopez, 412 Oak St Austin, $350' → '412 Oak St Austin'", () => {
    expect(
      mod.extractServiceAddress(
        "Deep clean for Maria Lopez, 412 Oak St Austin, $350",
      ),
    ).toBe("412 Oak St Austin");
  });

  it("REQ-263 the demo's starter-chip sentence (pair 5): phone and prices around it are not part of it", () => {
    expect(
      mod.extractServiceAddress(
        "Kitchen remodel for Maria Lopez, 512-555-0199, 12 Oak St Austin: demo $2,500, cabinets $8,000, quartz countertops $4,200",
      ),
    ).toBe("12 Oak St Austin");
  });

  it("REQ-263 city, state and ZIP after the street are kept", () => {
    expect(
      mod.extractServiceAddress(
        "Paver patio at 1800 Barton Hills Dr, Austin, TX 78704 for the Hendersons, $3,700",
      ),
    ).toBe("1800 Barton Hills Dr, Austin, TX 78704");
  });

  it("REQ-263 a spelled-out suffix and a trailing period work ('Avenue.', 'Road')", () => {
    expect(
      mod.extractServiceAddress(
        "Fence repair, 77 West Lake Avenue. Total $900",
      ),
    ).toBe("77 West Lake Avenue");
    expect(mod.extractServiceAddress("Roof at 5 Mill Road")).toBe(
      "5 Mill Road",
    );
  });

  it("REQ-263 Spanish sentence: 'Cotización para Maria Lopez: limpieza en 412 Oak St Austin, $350'", () => {
    expect(
      mod.extractServiceAddress(
        "Cotización para Maria Lopez: limpieza en 412 Oak St Austin, $350",
      ),
    ).toBe("412 Oak St Austin");
  });

  it("REQ-263 no street → null (never a made-up address)", () => {
    for (
      const s of [
        "Instalación de patio de adoquines 20x15, 6 paneles, $3,700",
        "3 bedrooms 2 baths deep clean $350",
        "Call me at 512-555-0199, $2,500 deposit",
        "Install 2 doors and 12 windows",
        "",
      ]
    ) {
      expect(mod.extractServiceAddress(s)).toBeNull();
    }
  });

  it("REQ-263 extractQuickQuotePrefill carries it as serviceAddress", () => {
    const p = mod.extractQuickQuotePrefill(
      "Deep clean for Maria Lopez, 412 Oak St Austin, $350",
    );
    expect(p.serviceAddress).toBe("412 Oak St Austin");
    expect(p.customerName).toBe("Maria Lopez");
    expect(p.priceCents).toBe(35000);
  });
});

describe("REQ-263 the job address — front-end wiring", () => {
  const chat = read("front-end/islands/AsstChat.tsx");
  const doc = read("front-end/components/quote-doc.tsx");
  const en = JSON.parse(read("lang/en.json"));
  const es = JSON.parse(read("lang/es.json"));

  it("REQ-263 the starter-chip flow keeps the extracted address and writes it on the quote", () => {
    expect(chat).toMatch(/setPrefillServiceAddress\(prefill\.serviceAddress\)/);
    const start = chat.slice(chat.indexOf("async function startQuoteFromRaw"));
    const fields = start.slice(0, start.indexOf("let convId"));
    expect(fields).toMatch(/serviceAddress/);
  });

  it("REQ-263 the customer step has an address field, pre-filled, and sends it with the answer", () => {
    expect(chat).toMatch(/data-cy="wizard-service-address"/);
    expect(chat).toMatch(/initialServiceAddress=\{/);
    const panel = chat.slice(chat.indexOf("function CustomerStepPanel"));
    expect(panel).toMatch(/serviceAddress:/);
    const post = chat.slice(chat.indexOf("async function postWizardAnswer"));
    expect(post.slice(0, 800)).toMatch(/serviceAddress\?: string/);
  });

  it("REQ-263 the contractor's preview shows the job address", () => {
    expect(chat).toMatch(/data-cy="quote-review-service-address"/);
  });

  it("REQ-263 the customer's agreement (/q) renders quote.serviceAddress", () => {
    expect(doc).toMatch(/serviceAddress\?: string/);
    expect(doc).toMatch(/data-cy="quote-doc-service-address"/);
    expect(doc).toMatch(/quote\.serviceAddress/);
  });

  it("REQ-263 both languages carry the labels", () => {
    for (
      const key of [
        "quoteDoc.serviceAddress",
        "asstChat.customerStep.serviceAddressPlaceholder",
        "asstChat.preview.serviceAddress",
        "prompts.tools.createQuote.serviceAddress",
      ]
    ) {
      expect(typeof en[key]).toBe("string");
      expect(typeof es[key]).toBe("string");
      expect(en[key].length).toBeGreaterThan(0);
      expect(es[key].length).toBeGreaterThan(0);
    }
  });
});
