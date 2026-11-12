import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { asksForDeposit, describeQuoteRevision } from "./mod.ts";

// REQ-267 (demo issue ai-assistant-p1-noreply): a correction that re-drafts
// the quote must get a text reply saying what changed, built server-side
// from the old and new line items — the model often returns no prose.

const before = [
  { description: "Interior walls — 2 coats", priceCents: 180_000 },
  { description: "Paint (materials)", priceCents: 30_000 },
];

Deno.test("REQ-267 describeQuoteRevision: names removed, added and repriced lines and the new total", () => {
  const after = [
    { description: "Interior walls — 2 coats", priceCents: 190_000 },
    { description: "Paint supplied by Castro Painting", priceCents: 0 },
  ];
  const text = describeQuoteRevision("en", before, after, "fix it");
  assertStringIncludes(text, "Updated the quote");
  assertStringIncludes(text, "removed Paint (materials)");
  assertStringIncludes(text, "added Paint supplied by Castro Painting");
  assertStringIncludes(text, "Interior walls — 2 coats $1,800 → $1,900");
  assertStringIncludes(text, "Total $2,100 → $1,900");
});

Deno.test("REQ-267 describeQuoteRevision: matches lines case- and space-insensitively", () => {
  const after = [
    { description: "interior walls —  2 coats", priceCents: 180_000 },
    { description: "Paint (materials)", priceCents: 30_000 },
  ];
  const text = describeQuoteRevision("en", before, after, "tweak");
  assertEquals(text, "Updated the quote.");
});

Deno.test("REQ-267 describeQuoteRevision: a deposit request is acknowledged, not silently dropped", () => {
  const text = describeQuoteRevision(
    "en",
    before,
    before,
    "I'll supply the paint myself and I want 50% deposit",
  );
  assertStringIncludes(text, "Updated the quote.");
  assertStringIncludes(text.toLowerCase(), "deposit");
  assertStringIncludes(text, "payment step");
});

Deno.test("REQ-267 describeQuoteRevision: no deposit note when the user didn't ask for one", () => {
  const text = describeQuoteRevision("en", before, before, "make it cheaper");
  assert(!text.toLowerCase().includes("deposit"));
});

Deno.test("REQ-267 describeQuoteRevision: Spanish reply for a Spanish contractor", () => {
  const after = [{
    description: "Interior walls — 2 coats",
    priceCents: 180_000,
  }];
  const text = describeQuoteRevision(
    "es",
    before,
    after,
    "quiero un anticipo del 50%",
  );
  assertStringIncludes(text, "Actualicé la cotización");
  assertStringIncludes(text, "quité Paint (materials)");
  assertStringIncludes(text, "anticipo");
});

Deno.test("REQ-267 asksForDeposit: English and Spanish deposit wording", () => {
  for (
    const s of [
      "50% deposit",
      "half down payment",
      "half upfront",
      "half up front please",
      "un anticipo",
      "depósito del 30%",
      "deposito",
    ]
  ) assert(asksForDeposit(s), s);
  for (const s of ["supply the paint myself", "bump labor to $2,100"]) {
    assert(!asksForDeposit(s), s);
  }
});
