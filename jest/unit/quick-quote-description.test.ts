/**
 * REQ-585 (demo-loop cycle 4, M30) — "A Spanish edit dumps the whole raw
 * message into the job scope". Pair 7 took "Just give me a quick quote.",
 * typed a long Spanish bathroom job and set the price; the quote was born with
 * `description: raw.trim()` (front-end/islands/AsstChat.tsx startQuoteFromRaw)
 * — her whole message as the ONE job line — and every later chat edit of it
 * echoed the message back ("agregué <her message> ; quité <her message>").
 *
 * The quick quote is born with the message's scope lines instead:
 * shared/quote-flow/scope-from-raw.ts `scopeDescriptionFromRaw(raw, lang)` —
 * one line per sentence (intent opener and price clause stripped, as
 * scopeBulletsFromRaw does), the customer's phone / email left out, "" when
 * nothing scope-like survives. Never the message itself.
 */
type Lang = "en" | "es";
type Mod = {
  scopeDescriptionFromRaw: (raw: string, lang: Lang) => string;
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mod: Mod = require("../../shared/quote-flow/scope-from-raw");

const PAIR7 =
  "Baño principal de la señora Tran en Round Rock, 512-555-0144. Quitar la tina y poner regadera de azulejo con banca. Vanity doble nueva. Ah and the toilet stays but we reset it. Dos semanas y media. Ponle precio, no sé, como 18 mil?";

describe("REQ-585 M30 scopeDescriptionFromRaw: a quick quote's job details are the message's scope lines, never the message", () => {
  it("pair 7's Spanish message becomes one line per sentence, with no phone number", () => {
    const out = mod.scopeDescriptionFromRaw(PAIR7, "es");
    expect(out).not.toBe(PAIR7.trim());
    expect(out.split("\n")).toEqual([
      "Baño principal de la señora Tran en Round Rock",
      "Quitar la tina y poner regadera de azulejo con banca",
      "Vanity doble nueva",
      "Ah and the toilet stays but we reset it",
      "Dos semanas y media",
      "Ponle precio, no sé, como 18 mil",
    ]);
    expect(out).not.toContain("512-555-0144");
  });

  it("an English message loses its intent opener and its price clause; a line that is only a phone / email is dropped", () => {
    expect(
      mod.scopeDescriptionFromRaw(
        "I need to replace a toilet for $500. Also patch the drywall behind it. 512-555-0199. bob@test.dev",
        "en",
      ).split("\n"),
    ).toEqual(["Replace a toilet", "Also patch the drywall behind it"]);
  });

  it("nothing scope-like → empty, never the raw text", () => {
    expect(mod.scopeDescriptionFromRaw("ok", "en")).toBe("");
    expect(mod.scopeDescriptionFromRaw("   ", "es")).toBe("");
  });
});
