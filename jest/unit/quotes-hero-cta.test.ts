/**
 * REQ-307 (demo-loop cycle 1, issue M11) — "+ New quote" / "Nueva cotización"
 * on /quotes does something: the hero CTA is a real link to the assistant's
 * new-conversation route. Before: `<button class="qph__cta" type="button">`
 * with no onClick, no href and no form, in a plain SSR component — the
 * ui-breakdown doc itself called it "DEAD STUB (no onClick)".
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-307 (M11) the /quotes hero CTA opens the assistant", () => {
  const sections = read("front-end/components/QuotesSections.tsx");
  const hero = sections.slice(
    sections.indexOf("export function QuotesHero"),
    sections.indexOf("interface KpisProps"),
  );

  test('REQ-307 the hero\'s .qph__cta is an <a href="/assistant"> tagged data-cy="quote-new"', () => {
    const at = hero.indexOf('class="qph__cta"');
    expect(at).toBeGreaterThan(-1);
    const open = hero.lastIndexOf("<", at);
    const tag = hero.slice(open, hero.indexOf(">", at) + 1);
    expect(tag).toMatch(/^<a\b/);
    expect(tag).toContain('href="/assistant"');
    expect(tag).toContain('data-cy="quote-new"');
  });

  test("REQ-307 no bare .qph__cta <button> is left in the quotes sections", () => {
    expect(sections).not.toMatch(/<button[^>]*class="qph__cta"/);
  });

  test("REQ-307 the ui-breakdown note no longer calls the CTA a dead stub", () => {
    const doc = read(
      "front-end/ui-breakdown/pages/quotes/components/quotes-sections/quotes-sections.md",
    );
    expect(doc).not.toContain("DEAD STUB");
  });

  test("REQ-307 the CTA label exists in both languages", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    expect(en["quotesHero.cta"]).toBe("New quote");
    expect(es["quotesHero.cta"]).toBe("Nueva cotización");
  });
});
