/**
 * REQ-898 — the page's controls that the pill's sampling grid steps over are found by their centre.
 *
 * REQ-228's e2e (the whole pill covers no control on /dashboard at 1280×800) failed on every
 * branch point tried, back to origin/develop: the pill sat at (12,549) 524×43 over three 13×10 px
 * money-bar segment buttons at y 551 — `samplePoints` (REQ-379: a point every 40 px across, three
 * rows) can miss a control smaller than its pitch. The same gap let REQ-890's compact End
 * question on /welcome (74 px tall: rows sampled at 629, 664, 699) sit over the footer's 24 px
 * links at 670–694 (REQ-866 / REQ-876 e2e). The overlay's `countControls` and `pageUnder` now also
 * count every control whose CENTRE lies in the box (`centresIn`) and which a hit at that centre
 * reaches — read once per placement (`pageControls`, dropped in a microtask).
 */
import * as fs from "fs";
import * as path from "path";
import { centresIn, edgesIn } from "../../shared/demo-mode/pill.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("REQ-898 AMENDMENT (dm8, p4) — a control the box merely touches (its centre outside, no grid point on the sliver) is found too", () => {
  test("REQ-898 edgesIn: the 'Nuevo cliente' button whose bottom the compact peek pill overlapped by 1.4 px at 390 px", () => {
    const pill = { left: 12, top: 353.4, width: 276.7, height: 42.6 };
    const button = { left: 26, top: 312.8, width: 338, height: 42 }; // bottom 354.8
    expect(edgesIn([button], pill)).toEqual([0]);
    // a box clear of the pill: not; a box whose centre is in the pill: centresIn has it, not this
    expect(edgesIn([{ left: 26, top: 300, width: 338, height: 42 }], pill))
      .toEqual([]);
    expect(edgesIn([{ left: 20, top: 360, width: 50, height: 20 }], pill))
      .toEqual([]);
    // touching edges (no shared area) is not an overlap
    expect(edgesIn([{ left: 26, top: 311.4, width: 338, height: 42 }], pill))
      .toEqual([]);
  });

  test("REQ-898 AMENDMENT wiring: the overlay counts the controls found by their edge too, verified by a hit inside the shared sliver", () => {
    const overlay = read("front-end/islands/DemoModeOverlay.tsx");
    expect(overlay).toMatch(
      /import \{[^}]*\bedgesIn\b[^}]*\} from "\.\.\/\.\.\/shared\/demo-mode\/pill\.ts"/,
    );
    const byCentre = overlay.slice(
      overlay.indexOf("function controlsByCentre("),
      overlay.indexOf("function pageUnder("),
    );
    expect(byCentre).toMatch(/edgesIn\(/);
  });
});

describe("REQ-898 — controls smaller than the sampling grid's pitch are found by their centre", () => {
  test("REQ-898 centresIn: the dashboard's money-bar segments under the whole pill; the footer links under the asking pill", () => {
    const pill = { left: 12, top: 549, width: 524, height: 43 };
    const segs = [276, 289, 302, 315, 328].map((cx) => ({
      left: cx - 6.5,
      top: 546,
      width: 13,
      height: 10,
    }));
    expect(centresIn(segs, pill)).toEqual([0, 1, 2, 3, 4]);
    // the asking pill on /welcome and the footer's links (24 px, between the sampled rows)
    const ask = { left: 12, top: 627, width: 626, height: 74 };
    const links = [
      { left: 452, top: 670, width: 128, height: 24 }, // Términos de servicio: centre 516,682
      { left: 598, top: 670, width: 230, height: 24 }, // Política de reembolsos: centre 713 — right of the pill
      { left: 455, top: 701, width: 122, height: 24 }, // Política de privacidad: centre 516,713 — below
    ];
    expect(centresIn(links, ask)).toEqual([0]);
  });

  test("REQ-898 centresIn: a centre on the box's left/top edge is in, on the right/bottom edge is out; nothing: []", () => {
    const box = { left: 100, top: 100, width: 50, height: 20 };
    expect(centresIn([{ left: 95, top: 95, width: 10, height: 10 }], box))
      .toEqual([0]);
    expect(centresIn([{ left: 145, top: 115, width: 10, height: 10 }], box))
      .toEqual([]);
    expect(centresIn([], box)).toEqual([]);
    expect(centresIn([{ left: 0, top: 0, width: 1000, height: 1000 }], box))
      .toEqual([]);
  });

  test("REQ-898 wiring: the overlay reads the page's controls once per placement and counts the ones by centre in both counters", () => {
    const overlay = read("front-end/islands/DemoModeOverlay.tsx");
    expect(overlay).toMatch(
      /import \{[^}]*\bcentresIn\b[^}]*\} from "\.\.\/\.\.\/shared\/demo-mode\/pill\.ts"/,
    );
    const controls = overlay.slice(
      overlay.indexOf("function pageControls("),
      overlay.indexOf("function controlsByCentre("),
    );
    expect(controls).toMatch(/document\.querySelectorAll\(CONTROL_SELECTOR\)/);
    expect(controls).toMatch(/closest\("\[data-demo-overlay\]"\)/);
    expect(controls).toMatch(
      /queueMicrotask\(\(\) => \{\s*pageControlsNow = null;/,
    );
    const byCentre = overlay.slice(
      overlay.indexOf("function controlsByCentre("),
      overlay.indexOf("function pageUnder("),
    );
    // verified by a hit at the centre (hidden controls are not counted), through a backdrop
    expect(byCentre).toMatch(
      /hitAt\(\s*box\.left \+ box\.width \/ 2,\s*box\.top \+ box\.height \/ 2,\s*backdrop,?\s*\)/,
    );
    expect(byCentre).toMatch(/c === el \|\| el\.contains\(c\)/);
    const under = overlay.slice(
      overlay.indexOf("function pageUnder("),
      overlay.indexOf("function countControls("),
    );
    expect(under).toMatch(
      /for \(const c of controlsByCentre\(r, backdrop\)\) found\.add\(c\);/,
    );
    const count = overlay.slice(
      overlay.indexOf("function countControls("),
      overlay.indexOf("const bannerH ="),
    );
    expect(count).toMatch(
      /for \(const c of controlsByCentre\(r, backdrop\)\) found\.add\(c\);/,
    );
  });
});
