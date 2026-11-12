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
    const btn = src.match(
      /isLockedOrIssued\(payload\.status\)[\s\S]{0,900}?onClick=\{\(\) => (\w+)\(/,
    );
    expect(btn?.[1]).toBe("reopenActionCard");
    expect(src).toMatch(/function reopenActionCard\(/);
    // The unlock path hits the server endpoint; the sent path seeds the composer.
    expect(src).toMatch(/assistantClient\.reopenQuote\(/);
    expect(src).toMatch(
      /reopenActionFor\(payload\.status\) === "revise"[\s\S]{0,200}openDraftEdit\(\)/,
    );
  });

  test("REQ-334 the assistant client posts to /reopen-quote", () => {
    const src = read("front-end/clients/assistant.ts");
    expect(src).toMatch(/reopenQuote:[\s\S]{0,400}\/reopen-quote/);
  });

  test("REQ-334 the terms prompt (en + es) has no 'phase 1' dead end and points at the card's Re-open button", () => {
    for (const dict of [en, es]) {
      const p = dict["prompts.systemTerms"];
      expect(p).not.toMatch(/phase 1/i);
      expect(p).not.toContain('Tap "Re-open the quote"');
      expect(p).toMatch(/Re-open/);
      expect(p).toMatch(/quote card/i);
    }
  });
});
