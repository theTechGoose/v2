import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { asksForDeposit, asksForOption, describeQuoteRevision } from "./mod.ts";

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
  // REQ-585 (demo-loop cycle 4, M4): an unchanged quote is never "Updated".
  assertEquals(
    text,
    "Nothing on the quote changed — its lines and total are the same.",
  );
});

Deno.test("REQ-267 describeQuoteRevision: a deposit request is acknowledged, not silently dropped", () => {
  const text = describeQuoteRevision(
    "en",
    before,
    before,
    "I'll supply the paint myself and I want 50% deposit",
  );
  // REQ-585 (M4): no line changed → said so, never "Updated the quote."
  assertStringIncludes(text, "Nothing on the quote changed");
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

// REQ-585 (demo-loop cycle 4, M4): pair 5 asked "Can you also give Derek a
// second option with a 48in double vanity for $2,900 so he can pick one?"; the
// model re-sent the same lines and the reply was "Updated the quote." over an
// identical card (fleet-4 stdout:55/121). A quote has no options.

const VANITY = [{ description: "36in vanity", priceCents: 225_000 }];
const OPTION_ASK =
  "Can you also give Derek a second option with a 48in double vanity for $2,900 so he can pick one?";

Deno.test("REQ-585 M4 describeQuoteRevision: nothing changed → 'Nothing on the quote changed', never 'Updated the quote.'", () => {
  const text = describeQuoteRevision("en", VANITY, VANITY, "looks right");
  assert(!text.includes("Updated the quote"), text);
  assertStringIncludes(text, "Nothing on the quote changed");
  const es = describeQuoteRevision("es", VANITY, VANITY, "está bien");
  assert(!es.includes("Actualicé la cotización"), es);
  assertStringIncludes(es, "No cambió nada en la cotización");
});

Deno.test("REQ-585 M4 describeQuoteRevision: the demo's option ask is told plainly that a quote can't hold options", () => {
  const text = describeQuoteRevision("en", VANITY, VANITY, OPTION_ASK);
  assertStringIncludes(text, "Nothing on the quote changed");
  assertStringIncludes(text, "can't hold options");
  assertStringIncludes(text, "second quote");
  // A model that added the option as a line: the change is said AND that
  // every line is billed.
  const added = describeQuoteRevision(
    "en",
    VANITY,
    [...VANITY, { description: "48in double vanity", priceCents: 290_000 }],
    OPTION_ASK,
  );
  assertStringIncludes(added, "added 48in double vanity ($2,900)");
  assertStringIncludes(added, "can't hold options");
  const es = describeQuoteRevision(
    "es",
    VANITY,
    VANITY,
    "dale otra opción con un vanity doble de 48 para que escoja",
  );
  assertStringIncludes(es, "no puede tener opciones");
  // No option asked → no options note.
  assert(
    !describeQuoteRevision("en", VANITY, VANITY, "make it $2,250")
      .includes("options"),
  );
});

Deno.test("REQ-585 M4 asksForOption: English and Spanish option / alternative asks; plain edits are not", () => {
  for (
    const s of [
      OPTION_ASK,
      "give them two options",
      "add an alternative with quartz",
      "another option for the tile",
      "let her choose between the two",
      "good better best please",
      "dale otra opción",
      "una segunda opción con azulejo",
      "dos opciones para que escoja",
      "una alternativa más barata",
    ]
  ) assert(asksForOption(s), s);
  for (
    const s of [
      "make the vanity $2,250",
      "add a permit line $450",
      "50% deposit",
      "agrega 1,500 por la calefacción del piso",
    ]
  ) assert(!asksForOption(s), s);
});

Deno.test("REQ-585 M4 describeQuoteRevision: the same lines with another change (a new summary, job details) still read 'Updated the quote.', never 'Nothing … changed'", () => {
  const text = describeQuoteRevision("en", VANITY, VANITY, "rename it", {
    otherChange: true,
  });
  assertEquals(text, "Updated the quote.");
  assert(!text.includes("Nothing on the quote changed"), text);
});
