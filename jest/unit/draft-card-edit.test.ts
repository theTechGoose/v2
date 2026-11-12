/**
 * REQ-246 — demo issue quote-invoice-money-m7: "'Edit' on the draft action
 * card does nothing visible."
 *
 * Cause (RCA, quote-m7): the draft quote card's Edit button in
 * front-end/islands/AsstChat.tsx was `onClick={() => setDraft("")}` — it only
 * cleared the composer's text (wiping anything the contractor had typed) and
 * opened, focused and prompted nothing.
 *
 * Fix: Edit seeds the composer with a localized edit prompt naming the quote
 * ("Change the quote: " / "Cambiar la cotización: "), keeps any text already
 * typed, focuses the composer and puts the caret at the end — so the next
 * thing the contractor types is the correction, sent to the assistant.
 *
 * Shared logic: shared/quote-flow/draft-edit.ts (editDraftSeed).
 */
import * as fs from "fs";
import * as path from "path";
import { editDraftSeed } from "../../shared/quote-flow/draft-edit";

const root = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const KEY = "asstChat.actionCard.editPrompt";

describe("REQ-246: Edit on the draft quote card opens the composer for a correction", () => {
  test("REQ-246: an empty composer is seeded with the edit prompt", () => {
    expect(editDraftSeed("", "Change the quote: ")).toBe("Change the quote: ");
    expect(editDraftSeed("   \n", "Change the quote: ")).toBe(
      "Change the quote: ",
    );
  });

  test("REQ-246: text the contractor already typed is kept, never wiped", () => {
    expect(editDraftSeed("make the tile $500", "Change the quote: ")).toBe(
      "make the tile $500",
    );
  });

  test("REQ-246: a second Edit click does not stack the prompt", () => {
    const once = editDraftSeed("", "Change the quote: ");
    expect(editDraftSeed(once, "Change the quote: ")).toBe(once);
  });

  test("REQ-246: both languages carry the edit prompt, ending in a space for typing", () => {
    for (const dict of [en, es]) {
      expect(typeof dict[KEY]).toBe("string");
      expect(dict[KEY].trim().length).toBeGreaterThan(0);
      expect(dict[KEY].endsWith(" ")).toBe(true);
    }
    expect(es[KEY]).not.toBe(en[KEY]);
  });

  test("REQ-246: the island's Edit button no longer just clears the composer", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    expect(src).not.toMatch(/onClick=\{\(\) => setDraft\(""\)\}/);
    expect(src).toMatch(/editDraftSeed\(/);
    expect(src).toMatch(/asstChat\.actionCard\.editPrompt/);
  });
});
