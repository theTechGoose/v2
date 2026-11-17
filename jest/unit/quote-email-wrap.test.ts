/**
 * REQ-328 — demo-loop cycle 1, demo issue p10: "Business email wraps mid-word
 * on /q/" ("rosa@delgadojunk.exampl|e!"). The contractor-email anchor in the
 * /q contact footer carried `word-break:break-all` (P-58), which lets the
 * browser break between ANY two characters, so the address split wherever the
 * line happened to end even when the whole address would fit on the next
 * line. `overflow-wrap:anywhere` alone is the right tool: it breaks inside the
 * address only when no other opportunity exists (a 390 px card with a very
 * long address), and otherwise the address moves whole to the next line.
 *
 *   front-end/components/quote-doc.tsx → the mailto anchor + the closing span
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("REQ-328 p10: the /q contractor email never breaks mid-word when it fits a line", () => {
  const doc = read("front-end/components/quote-doc.tsx");
  const anchor = doc.match(
    /<a\s+href=\{`mailto:\$\{contractor\.email\}`\}[\s\S]*?<\/a>/,
  )?.[0];

  it("renders the contractor email as a mailto anchor", () => {
    expect(anchor).toBeDefined();
  });

  it("the anchor keeps overflow-wrap:anywhere (long addresses still fit a 390px card)", () => {
    expect(anchor).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("the anchor carries no word-break:break-all (the cause of 'exampl|e!')", () => {
    expect(anchor).not.toMatch(/word-break:\s*break-all/);
    expect(doc).not.toMatch(/style=[^>]*word-break:\s*break-all/);
  });

  it("the closing words (t.lookForward) sit in their own span after the anchor", () => {
    expect(doc).toMatch(
      /<span[^>]*data-cy="quote-contact-close"[^>]*>\s*\{t\.lookForward\}\s*<\/span>/,
    );
  });
});
