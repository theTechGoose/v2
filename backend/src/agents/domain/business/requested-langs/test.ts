import { assertEquals } from "#std/assert";
import { requestedLangs } from "./mod.ts";

/**
 * REQ-262 (demo M25): the contractor typed "… in Spanish and English" into
 * the job details and got English-only options, because the languages came
 * from settings alone. These pin what the typed text itself asks for.
 */

Deno.test("REQ-262 requestedLangs: 'in Spanish and English' asks for both", () => {
  assertEquals(
    requestedLangs(
      "Repaint the Garcia kitchen, 2 coats, $1,800. Write it in Spanish and English.",
    ),
    ["es", "en"],
  );
});

Deno.test("REQ-262 requestedLangs: English AND Spanish, any case, either order", () => {
  assertEquals(requestedLangs("please do it in ENGLISH AND SPANISH"), [
    "en",
    "es",
  ]);
});

Deno.test("REQ-262 requestedLangs: Spanish-language asks (en español, en inglés y español)", () => {
  assertEquals(requestedLangs("Pintar la cocina, en español"), ["es"]);
  assertEquals(requestedLangs("pintar la cocina en inglés y español"), [
    "en",
    "es",
  ]);
  assertEquals(requestedLangs("pintar la cocina en ingles y espanol"), [
    "en",
    "es",
  ]);
});

Deno.test("REQ-262 requestedLangs: 'bilingual' means English and Spanish", () => {
  assertEquals(requestedLangs("bilingual quote for the Lopez deck"), [
    "en",
    "es",
  ]);
  assertEquals(requestedLangs("cotización bilingüe"), ["en", "es"]);
});

Deno.test("REQ-262 requestedLangs: a job with no language ask asks for nothing", () => {
  assertEquals(requestedLangs("Tile the bathroom floor, 80 sqft, $1,200"), []);
  assertEquals(requestedLangs(""), []);
});

Deno.test("REQ-262 requestedLangs: a word that merely contains a language name is not an ask", () => {
  // "Spanish tile" is a material, not a language request.
  assertEquals(requestedLangs("Install Spanish tile on the patio"), []);
  assertEquals(requestedLangs("English garden cleanup"), []);
});
