import { assertEquals } from "#std/assert";
import { parseOcr, parseTranscript } from "./mod.ts";

Deno.test("parseTranscript: '$1,200' format with comma", () => {
  const p = parseTranscript("Got $1,200 cash from the Hansens for the deck job");
  assertEquals(p.amount, 120_000);
  assertEquals(p.method, "cash");
  assertEquals(p.payerHint, "Hansen"); // "the Hansens" → "Hansen"
});

Deno.test("parseTranscript: 'X dollars' format", () => {
  const p = parseTranscript("Got 500 dollars cash from Hans Pedersen");
  assertEquals(p.amount, 50_000);
  assertEquals(p.method, "cash");
  assertEquals(p.payerHint, "Hans Pedersen");
});

Deno.test("parseTranscript: word-form 'eighteen hundred'", () => {
  const p = parseTranscript("Got paid eighteen hundred cash from the Hansens");
  assertEquals(p.amount, 1800_00);
  assertEquals(p.method, "cash");
  assertEquals(p.payerHint, "Hansen");
});

Deno.test("parseTranscript: word-form 'five thousand'", () => {
  const p = parseTranscript("Five thousand by Zelle from Acme Corp");
  assertEquals(p.amount, 5000_00);
  assertEquals(p.method, "zelle");
});

Deno.test("parseTranscript: extracts check reference", () => {
  const p = parseTranscript("$1,800 check #1234 from Hans");
  assertEquals(p.amount, 180_000);
  assertEquals(p.method, "check");
  assertEquals(p.reference, "1234");
});

Deno.test("parseTranscript: 'venmo' method", () => {
  const p = parseTranscript("$50 via Venmo");
  assertEquals(p.amount, 5_000);
  assertEquals(p.method, "venmo");
});

Deno.test("parseTranscript: 'cash app' (two words) method", () => {
  const p = parseTranscript("Got 25 dollars cash app");
  assertEquals(p.method, "cashapp");
});

Deno.test("parseTranscript: 'bank transfer' → ACH", () => {
  const p = parseTranscript("$1,500 bank transfer from Hans");
  assertEquals(p.method, "ach");
});

Deno.test("parseTranscript: empty input returns empty parse", () => {
  assertEquals(parseTranscript(""), {});
  assertEquals(parseTranscript("   "), {});
});

Deno.test("parseTranscript: doesn't trip on 'a hundred bucks' (no method)", () => {
  // We don't try to do natural-language number understanding beyond the
  // explicit "<word> hundred" / "<word> thousand" forms. "a hundred"
  // isn't recognized, by design.
  const p = parseTranscript("a hundred bucks from Hans");
  assertEquals(p.amount, undefined);
});

Deno.test("parseOcr: passes through valid fields", () => {
  const p = parseOcr({ amount: 100_00, payerHint: "Hans", method: "check", reference: "1234" });
  assertEquals(p.amount, 100_00);
  assertEquals(p.payerHint, "Hans");
  assertEquals(p.method, "check");
  assertEquals(p.reference, "1234");
});

Deno.test("parseOcr: drops invalid method", () => {
  const p = parseOcr({ amount: 100, method: "bitcoin" });
  assertEquals(p.method, undefined);
  assertEquals(p.amount, 100);
});

Deno.test("parseOcr: drops non-finite amount", () => {
  const p = parseOcr({ amount: NaN });
  assertEquals(p.amount, undefined);
});
