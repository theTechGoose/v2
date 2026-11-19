/**
 * REQ-1057 (LOOP-007 cycle 2, q2-44) — the assistant confirms the customer,
 * then immediately asks "Who is this for?".
 *
 * With a customer bound to the quote, the lock prompt already says "Quote
 * locked! This one's for Maria Gonzalez — let's set the terms."
 * (lockQuote.cta.lockedPromptKnown). After Continue, the customer step's
 * known-customer card ("Use Maria Gonzalez ✓ / Change", REQ-331) is headed
 * by the generic `asstChat.customerStep.whoFor` = "Who is this for?" — the
 * same open question the unknown-customer pick list asks. REQ-331 promises
 * the assistant never re-asks a customer it was already told.
 *
 * The island (front-end/islands/AsstChat.tsx, CustomerStepPanel) is too big
 * to mount under jest, so — like the neighbouring REQ-390 wiring checks —
 * this reads the branch's source and resolves its heading key against the
 * real en/es dictionaries.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const SRC = fs.readFileSync(
  path.join(ROOT, "front-end/islands/AsstChat.tsx"),
  "utf8",
);
const EN = JSON.parse(
  fs.readFileSync(path.join(ROOT, "lang/en.json"), "utf8"),
) as Record<string, string>;
const ES = JSON.parse(
  fs.readFileSync(path.join(ROOT, "lang/es.json"), "utf8"),
) as Record<string, string>;

/** CustomerStepPanel's body, from its declaration to the next top-level function. */
function panelSource(): string {
  const start = SRC.indexOf("function CustomerStepPanel(");
  if (start < 0) throw new Error("CustomerStepPanel not found in AsstChat.tsx");
  const rest = SRC.slice(start + 1);
  const next = rest.search(/\n(?:export\s+)?function\s+\w+\s*\(/);
  return SRC.slice(start, next < 0 ? undefined : start + 1 + next);
}

/** The `return (…)` of the known-customer branch: `if (known && !changed) {…}`. */
function knownBranch(): string {
  const panel = panelSource();
  const at = panel.search(/if\s*\(\s*known\s*&&\s*!changed\s*\)/);
  if (at < 0) throw new Error("known-customer branch not found");
  const body = panel.slice(at);
  // the branch ends where the default view's comment / return begins
  const end = body.search(/\/\/\s*-{2,}\s*View:\s*default/);
  return end < 0 ? body : body.slice(0, end);
}

/** The default (unknown-customer) view, after the known branch. */
function defaultView(): string {
  const panel = panelSource();
  const at = panel.search(/\/\/\s*-{2,}\s*View:\s*default/);
  if (at < 0) throw new Error("default view not found");
  return panel.slice(at, at + 1500);
}

/** The i18n key(s) inside the branch's <h3 class="wiz__step-q"> (if any). */
function headingKeys(src: string): string[] {
  const h3 = src.match(/<h3[^>]*wiz__step-q[^>]*>([\s\S]*?)<\/h3>/);
  if (!h3) return [];
  return [...h3[1].matchAll(/["']((?:asstChat|termsWizard)\.[\w.]+)["']/g)]
    .map((m) => m[1]);
}

function render(dict: Record<string, string>, key: string, name: string) {
  return (dict[key] ?? key).replace(/\{name\}/g, name);
}

describe("REQ-1057 (LOOP-007 q2-44): the known-customer card confirms, never asks 'Who is this for?'", () => {
  it("REQ-1057: the known-customer branch does not use asstChat.customerStep.whoFor", () => {
    expect(knownBranch()).not.toContain("asstChat.customerStep.whoFor");
  });

  it("REQ-1057: the known-customer heading (if any) names the customer in EN and ES, not the open question", () => {
    const branch = knownBranch();
    const keys = headingKeys(branch);
    // A heading-less card is fine (the fix's other option): nothing to ask.
    for (const key of keys) {
      for (
        const [lang, dict] of [["en", EN], ["es", ES]] as const
      ) {
        const shown = render(dict, key, "Maria Gonzalez");
        expect({ lang, key, shown }).toEqual(
          expect.objectContaining({
            shown: expect.not.stringMatching(
              /who is this for|para quién es esto/i,
            ),
          }),
        );
        expect({ lang, key, shown }).toEqual(
          expect.objectContaining({
            shown: expect.stringContaining("Maria Gonzalez"),
          }),
        );
      }
    }
    // A heading that is there must be fed the customer's name.
    if (keys.length > 0) {
      const h3 = branch.match(/<h3[^>]*wiz__step-q[^>]*>([\s\S]*?)<\/h3>/)!;
      expect(h3[1]).toMatch(/name:\s*k\.name|known\.customer\.name/);
    }
  });

  it("REQ-1057: the unknown-customer default view still asks 'Who is this for?' / '¿Para quién es esto?'", () => {
    expect(headingKeys(defaultView())).toContain(
      "asstChat.customerStep.whoFor",
    );
    expect(EN["asstChat.customerStep.whoFor"]).toBe("Who is this for?");
    expect(ES["asstChat.customerStep.whoFor"]).toBe("¿Para quién es esto?");
  });
});
