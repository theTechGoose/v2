/**
 * REQ-334 (demo-loop cycle 1, M25) — "Re-open" on the locked quote card must
 * re-open the quote, not post the chat text "Re-open the quote." that no
 * server code handles (the terms prompt then answered it with "Tap
 * \"Re-open the quote\" to go back to phase 1" — a dead loop in jargon).
 *
 * Shared rule: shared/quote-flow/quote-lock.ts (reopenActionFor).
 */
import * as fs from "fs";
import * as path from "path";
import { reopenActionFor } from "../../shared/quote-flow/quote-lock";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-334 Re-open on the locked quote card", () => {
  test("REQ-334 reopenActionFor: a locked quote unlocks, a sent one goes to revision, a draft has nothing to re-open", () => {
    expect(reopenActionFor("locked")).toBe("unlock");
    expect(reopenActionFor("sent")).toBe("revise");
    expect(reopenActionFor("viewed")).toBe("revise");
    expect(reopenActionFor("accepted")).toBe("revise");
    expect(reopenActionFor("draft")).toBe("none");
    expect(reopenActionFor(undefined)).toBe("none");
  });

  test("REQ-334 the island's Re-open button calls the reopen handler, never a chat message", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    expect(src).not.toContain('sendText("Re-open the quote.")');
    // REQ-563 AMENDMENT: the button is gated on the live quote
    // (cardReopenAction), no longer on the card's isLockedOrIssued snapshot.
    const btn = src.match(
      /cardReopenAction\(\s*payload\.status,[\s\S]{0,900}?onClick=\{\(\) => (\w+)\(/,
    );
    expect(btn?.[1]).toBe("reopenActionCard");
    expect(src).toMatch(/function reopenActionCard\(/);
    // The unlock path hits the server endpoint; the sent path seeds the composer.
    expect(src).toMatch(/assistantClient\.reopenQuote\(/);
    expect(src).toMatch(
      /action === "revise"[\s\S]{0,200}openDraftEdit\(\)/,
    );
  });

  test("REQ-334 the assistant client posts to /reopen-quote", () => {
    const src = read("front-end/clients/assistant.ts");
    expect(src).toMatch(/reopenQuote:[\s\S]{0,400}\/reopen-quote/);
  });

  // REQ-375 AMENDMENT (demo-loop cycle 2, M11): the Re-open pointer moved out
  // of the always-on systemTerms into the locked-unsent-with-card section —
  // a sent quote has no Re-open button to point at.
  test("REQ-334 / REQ-375 the terms prompt (en + es) has no 'phase 1' dead end; only the locked-with-card section points at the card's Re-open button", () => {
    for (const dict of [en, es]) {
      const p = dict["prompts.systemTerms"];
      expect(p).not.toMatch(/phase 1/i);
      expect(p).not.toContain('Tap "Re-open the quote"');
      expect(p).not.toMatch(/tap Re-open/i);
      const locked = dict["prompts.termsPriceChange.lockedCard"];
      expect(locked).toMatch(/tap Re-open on the quote card/);
      for (const k of ["issued", "signed", "open"]) {
        expect(dict[`prompts.termsPriceChange.${k}`]).not.toMatch(
          /tap Re-open on the quote card/,
        );
      }
    }
  });
});
