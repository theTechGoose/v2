/**
 * REQ-779 — demo-loop cycle dv1, issue m7: "Assistant keeps every job detail
 * the contractor typed (address, email)".
 *
 * Verify round 6: help-me-price with "Bathroom floor for the Hendersons on
 * Shoal Creek: porcelain 12x24, recessed niche, before Thanksgiving, email
 * tom@reyes" opened the customer step with the job address EMPTY, and
 * "tom@reyes" left the Email box empty with no warning.
 *
 * Root cause (shared/quote-flow):
 *   - extractServiceAddress reads "on <Street> <type>" only with a street-type
 *     word (St / Dr / …) — "on Shoal Creek:" has none, so the quote was made
 *     with no serviceAddress and the step's address box stayed blank;
 *   - extractEmail needs a full address (a TLD) — "tom@reyes" read as no
 *     email at all, and nothing said so (the phone had REQ-575's
 *     "unusablePhone" note; the email had none).
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// deno-lint-ignore no-explicit-any
let prefill: any;
// deno-lint-ignore no-explicit-any
let facts: any;
beforeAll(() => {
  prefill = require("../../shared/quote-flow/quick-quote-prefill");
  facts = require("../../shared/quote-flow/quote-facts");
});

const TODAY = new Date(2026, 10, 13);
const DEMO =
  "Bathroom floor for the Hendersons on Shoal Creek: porcelain 12x24, recessed niche, before Thanksgiving, email tom@reyes";

describe("REQ-779 dv1 m7 the job address 'on Shoal Creek' is kept", () => {
  test("REQ-779 the demo's sentence → 'Shoal Creek'", () => {
    expect(prefill.extractServiceAddress(DEMO)).toBe("Shoal Creek");
    expect(prefill.extractQuickQuotePrefill(DEMO).serviceAddress).toBe(
      "Shoal Creek",
    );
  });
  test.each([
    ["Fence repair for Bob on Lost Creek, $900", "Lost Creek"],
    ["deck for the Nguyens on Spicewood Springs.", "Spicewood Springs"],
    ["roof for the Garcias on Shoal Creek", "Shoal Creek"],
    ["piso para los Henderson en Shoal Creek: porcelanato", "Shoal Creek"],
  ])("REQ-779 '%s' → %s", (text, want) => {
    expect(prefill.extractServiceAddress(text)).toBe(want);
  });
  test.each([
    "start on Monday, $500",
    "finish on Thanksgiving.",
    "paid on Zelle, $300",
    "work on the roof, $500",
    "on Monday 78704",
    "trabajo en Navidad, $200",
    "start on March 3",
    "on Friday",
    "paint Bob's deck on Saturday morning",
  ])("REQ-779 never a date, a holiday or an app: '%s'", (text) => {
    expect(prefill.extractServiceAddress(text)).toBeNull();
  });
  test("REQ-779 the earlier forms still win", () => {
    expect(
      prefill.extractServiceAddress(
        "Kitchen renovation and cleanup for the Hendersons on Barton Hills Dr, Austin, $14,500",
      ),
    ).toBe("Barton Hills Dr, Austin");
    expect(
      prefill.extractServiceAddress("for Maria Lopez, 412 Oak St Austin, $350"),
    ).toBe("412 Oak St Austin");
  });
  test("REQ-779 the earlier parts of the demo sentence stay right", () => {
    const f = facts.extractQuoteFacts(DEMO, TODAY);
    expect(f.customerPhone).toBeNull();
    expect(f.customerEmail).toBeNull();
    expect(prefill.extractPriceCents(DEMO)).toBeNull();
  });
});

describe("REQ-779 dv1 m7 an incomplete email is named, never dropped silently", () => {
  test.each([
    [DEMO, "tom@reyes"],
    ["email tom@reyes.", "tom@reyes"],
    ["su correo es ana@gmail", "ana@gmail"],
    ["carl@", "carl@"],
    ["write to carl@x, thanks", "carl@x"],
  ])("REQ-779 '%s' → %s", (text, bad) => {
    expect(facts.extractUnusableEmail(text)).toBe(bad);
    const f = facts.extractQuoteFacts(text, TODAY);
    expect(f.customerEmail).toBeNull();
    expect(f.unusableEmail).toBe(bad);
  });
  test.each([
    "email tom@reyes.com",
    "Tom Reyes, tom.reyes@example.co.uk, $500",
    "porcelain 12x24, niche",
    "meet @ 5pm",
  ])("REQ-779 nothing to name in '%s'", (text) => {
    expect(facts.extractUnusableEmail(text)).toBeNull();
    expect(facts.extractQuoteFacts(text, TODAY)).not.toHaveProperty(
      "unusableEmail",
    );
  });
});

describe("REQ-779 dv1 m7 the customer step uses them", () => {
  const chat = read("front-end/islands/AsstChat.tsx");
  const panel = chat.slice(chat.indexOf("function CustomerStepPanel("));
  test("REQ-779 the typed email, even incomplete, is put in the Email box", () => {
    expect(chat).toMatch(
      /initialEmail=\{quoteFacts\.customerEmail \?\?\s*quoteFacts\.unusableEmail \?\?\s*undefined\}/,
    );
  });
  test("REQ-779 the address falls back to the typed text when the quote has none", () => {
    expect(chat).toMatch(
      /initialServiceAddress=\{quote\s*\?\.serviceAddress \|\|\s*extractServiceAddress\(/,
    );
  });
  test("REQ-779 the form says the email looks incomplete, in both languages", () => {
    expect(panel).toMatch(/prefillFacts\?\.unusableEmail/);
    expect(panel).toMatch(/data-cy="cust-email-incomplete"/);
    expect(panel).toMatch(/"asstChat\.customerStep\.emailIncomplete"/);
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    const k = "asstChat.customerStep.emailIncomplete";
    expect(en[k]).toContain("{email}");
    expect(es[k]).toContain("{email}");
    expect(en[k]).toMatch(/incomplete/i);
    expect(es[k]).toMatch(/incompleto/i);
  });
});
