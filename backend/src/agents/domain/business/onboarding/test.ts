import { assertEquals } from "#std/assert";
import { extractNameAndBusiness, isStarterChipText } from "./mod.ts";

// REQ-008 — NW-47 (p44): the screenshot's sender "I from help me price it"
// came from the first-turn extractor splitting the starter-chip sentence
// "I know the job, help me price it" into name + business. The four chip
// strings (EN + ES) must never parse as a name.

const CHIPS = [
  // lang/en.json asstChat.prompt.*
  "I know the job, help me price it.",
  "I know my price, write it up.",
  "Job done, need to invoice.",
  "Just give me a quick quote.",
  // lang/es.json asstChat.prompt.*
  "Conozco el trabajo, ayúdame a ponerle precio.",
  "Trabajo terminado, necesito facturar.",
  "Sé mi precio, redáctalo.",
  "Solo dame una cotización rápida.",
];

for (const chip of CHIPS) {
  Deno.test(`REQ-008 NW-47 extractNameAndBusiness: starter chip "${chip}" is never a name`, () => {
    assertEquals(extractNameAndBusiness(chip), undefined);
  });
}

Deno.test("REQ-008 NW-47 extractNameAndBusiness: sentences that open with a pronoun/verb are not names", () => {
  for (const s of ["I need a quote for Sam", "We do roofing, Acme Roofing", "Yo soy plomero, Plomería Pérez"]) {
    assertEquals(extractNameAndBusiness(s), undefined, s);
  }
});

Deno.test("REQ-008 NW-47 extractNameAndBusiness: positive controls still parse", () => {
  assertEquals(extractNameAndBusiness("Hans Pedersen, Hans LLC"), {
    name: "Hans Pedersen",
    businessName: "Hans LLC",
  });
  assertEquals(extractNameAndBusiness("Diego, Riley Roofing Co."), {
    name: "Diego",
    businessName: "Riley Roofing Co.",
  });
  assertEquals(extractNameAndBusiness("It's Diego, Riley Roofing Co."), {
    name: "Diego",
    businessName: "Riley Roofing Co.",
  });
  assertEquals(extractNameAndBusiness("Diego from Riley Roofing"), {
    name: "Diego",
    businessName: "Riley Roofing",
  });
  assertEquals(extractNameAndBusiness("diego"), { name: "Diego" });
});

Deno.test("REQ-008 NW-47 isStarterChipText: every chip string (EN + ES) matches, case/punctuation-insensitively", () => {
  for (const chip of CHIPS) {
    assertEquals(isStarterChipText(chip), true, chip);
    assertEquals(isStarterChipText(chip.toUpperCase().replace(/\.$/, "")), true, chip);
  }
  assertEquals(isStarterChipText("Diego, Riley Roofing Co."), false);
  assertEquals(isStarterChipText(""), false);
});
