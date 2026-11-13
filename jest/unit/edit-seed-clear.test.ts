/**
 * REQ-464 — demo-loop cycle 3, demo issue m33: "'Edit' on the quote card only
 * types 'Change the quote:', which stays after 'Lock it in'."
 *
 * Cause (RCA m33, at cc5d4b0e): openDraftEdit (front-end/islands/AsstChat.tsx)
 * seeds the composer with the edit prompt (REQ-246), but nothing remembers the
 * seed — lockActionCard never clears it, so after Lock it in the composer
 * still holds "Change the quote: ", and sending it would ask the assistant to
 * change a quote that is now locked. Edit also showed nothing beyond the
 * prefix to say what to type.
 *
 * Fix: the island remembers the seed it put in the composer. When the card it
 * targets leaves the draft state (Lock it in, Re-open) or the bare seed is
 * sent, a composer still holding only the seed is cleared; anything the
 * contractor typed after it is kept. While the seed is there, a hint under
 * the composer says what to type ("Type the change, e.g. tile $3,600").
 *
 * Shared logic: shared/quote-flow/draft-edit.ts.
 */
import * as fs from "fs";
import * as path from "path";
import {
  dropBareEditSeed,
  isBareEditSeed,
  showEditHint,
} from "../../shared/quote-flow/draft-edit";

const root = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const SEED = "Change the quote: ";
const HINT = "asstChat.actionCard.editHint";

/** The body of one `function name(...) { ... }` in the island source. */
function fnBody(src: string, name: string): string {
  const start = src.search(new RegExp(`function ${name}\\(`));
  expect(start).toBeGreaterThanOrEqual(0);
  const open = src.indexOf("{", src.indexOf(")", start));
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error(`unterminated ${name}`);
}

describe("REQ-464: the Edit seed does not outlive the draft it targets", () => {
  test("REQ-464: a composer holding only the seed is a bare seed", () => {
    expect(isBareEditSeed(SEED, SEED)).toBe(true);
    expect(isBareEditSeed("Change the quote:", SEED)).toBe(true);
    expect(isBareEditSeed("Change the quote:   \n", SEED)).toBe(true);
  });

  test("REQ-464: a seed with a change typed after it is not bare", () => {
    expect(isBareEditSeed(SEED + "tile $3,600", SEED)).toBe(false);
    expect(isBareEditSeed("make the tile $500", SEED)).toBe(false);
  });

  test("REQ-464: no remembered seed means nothing is a bare seed", () => {
    expect(isBareEditSeed(SEED, null)).toBe(false);
    expect(isBareEditSeed("", null)).toBe(false);
    expect(isBareEditSeed("", "")).toBe(false);
  });

  test("REQ-464: dropping the seed clears a bare seed and keeps typed text", () => {
    expect(dropBareEditSeed(SEED, SEED)).toBe("");
    expect(dropBareEditSeed(SEED + "tile $3,600", SEED)).toBe(
      SEED + "tile $3,600",
    );
    expect(dropBareEditSeed("hello", SEED)).toBe("hello");
    expect(dropBareEditSeed(SEED, null)).toBe(SEED);
  });

  test("REQ-464: the hint shows only while the seed is still in the composer", () => {
    expect(showEditHint(SEED, SEED)).toBe(true);
    expect(showEditHint(SEED + "tile", SEED)).toBe(true);
    expect(showEditHint("", SEED)).toBe(false);
    expect(showEditHint("something else", SEED)).toBe(false);
    expect(showEditHint(SEED, null)).toBe(false);
  });

  test("REQ-464: both languages carry the edit hint", () => {
    // REQ-581 (cycle 4 p3): the generic hint is trade-free; trades get
    // their own (composer-placeholder-flow.test.ts).
    expect(en[HINT]).toBe("Type the change, e.g. add cleanup $150");
    expect(typeof es[HINT]).toBe("string");
    expect(es[HINT].trim().length).toBeGreaterThan(0);
    expect(es[HINT]).not.toBe(en[HINT]);
  });

  test("REQ-464: the island remembers the seed and drops it on Lock it in, Re-open and send", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    expect(fnBody(src, "openDraftEdit")).toMatch(/setEditSeed\(/);
    expect(fnBody(src, "lockActionCard")).toMatch(/dropBareEditSeed\(/);
    expect(fnBody(src, "reopenActionCard")).toMatch(/dropBareEditSeed\(/);
    expect(fnBody(src, "sendText")).toMatch(/isBareEditSeed\(/);
    expect(src).toMatch(/showEditHint\(draft, editSeed\)/);
    expect(src).toMatch(/editHintKey\(from\?\.business\)/); // REQ-581
  });
});
