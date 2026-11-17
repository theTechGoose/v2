/**
 * REQ-687 AMENDMENT — demo-loop run 7 lane (the REQ-305 scroll stories on /q). The owner's sticky
 * preview banner (REQ-559/687) collapsed from two rows to a one-line strip once its sentinel left
 * the top, and the strip was the SAME in-flow box: the document got 63 px shorter under the reader,
 * and Chromium's scroll anchoring pulled the page back by that much (a probe: scrollTo(0, 250) →
 * 187; with overflow-anchor off it stayed at 250; the only mutation was `DIV.ctr__no-print`'s
 * child swap with the height 2739 → 2676). Now the sticky shell keeps the full banner's height
 * (measured while expanded, `min-height`), transparent and click-through while compact; the strip
 * is an inner box painted at its top. Nothing above the reader changes size, so nothing jumps.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("REQ-687 AMENDMENT (dm7 lane) — the collapsing preview banner keeps its in-flow height", () => {
  const src = read("front-end/components/quote-doc.tsx");
  const banner = src.slice(
    src.indexOf('data-cy="quote-preview-banner"'),
    src.indexOf('data-cy="quote-signed-banner"'),
  );

  test("REQ-687 AMENDMENT wiring: the shell reserves the expanded height and lets clicks through while compact", () => {
    expect(banner).toMatch(/min-height:\$\{slotH\}px/);
    expect(banner).toMatch(/compact\s*\?\s*`[^`]*pointer-events:none/);
  });

  test("REQ-687 AMENDMENT wiring: the painted box is an inner element (the strip), clickable", () => {
    expect(banner).toMatch(/data-cy="quote-preview-visual"/);
    const visual = banner.slice(
      banner.indexOf('data-cy="quote-preview-visual"'),
    );
    expect(visual).toMatch(/pointer-events:auto/);
    expect(visual).toMatch(/background:#fff6e5/);
  });

  test("REQ-687 AMENDMENT wiring: the expanded height is measured before paint while the banner is expanded", () => {
    expect(src).toMatch(
      /useLayoutEffect\(\(\) => \{[\s\S]{0,200}if \(compact\) return;[\s\S]{0,200}setSlotH\(/,
    );
  });
});
