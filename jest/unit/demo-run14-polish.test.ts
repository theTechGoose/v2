/**
 * Demo-loop run 14 (2026-11-17), by hand — Raphael: "fix the polish problems personally, until
 * there are none."
 *  m1 — REQ-820 AMENDMENT 2: the RESTART pill at 390 px (and a join whose whole pill appears out
 *       of nothing) was painted at the previous form's dock (the ended notice's: 136 px past the
 *       window, "End demo" cut off) and glided ~0.6 s across the form to its band. The pill's
 *       ResizeObserver now places it in the same frame it changed size (never the 150 ms debounce),
 *       and a pill of another size than at its last placement jumps (noGlide).
 *  m2 — REQ-890 AMENDMENT 3: the peek (the pill the customer opens from its folded tab) was slid
 *       along the tab's row to the fewest CONTROLS — over "Step 2 of 10" with its details open
 *       (two rows, 73 px). With `texts` given, a box clear of controls AND words is taken first —
 *       the tab's row, the other rows, the pill's spots — before the old rule.
 *  m3 — REQ-845 AMENDMENT: the replay's anchor swapped the element under the point for the
 *       control around it (`closest(CONTROL_SELECTOR)`) even when the point was OUTSIDE that
 *       control's box: the address suggestion list is a child of the "CALLE" label but drawn
 *       below it, so the customer's arrow clamped 51 px up onto the field. The swap needs the
 *       point inside the control's box.
 */
import * as fs from "fs";
import * as path from "path";
import { createRecorder } from "../../front-end/lib/demo-mode/mirror-record";
import { createReplayer } from "../../front-end/lib/demo-mode/mirror-replay";
import type { MirrorFrame } from "../../shared/demo-mode/mirror";
import { peekBox, PILL_BAND_GAP } from "../../shared/demo-mode/pill";
import {
  docWith,
  FakeMutationObserver,
  FDocument,
  FElement,
  find,
  h,
} from "./support/fake-dom";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const overlay = read("front-end/islands/DemoModeOverlay.tsx");
const replay = read("front-end/lib/demo-mode/mirror-replay.ts");

describe("REQ-820 AMENDMENT 2 (demo-loop run 14, m1): a pill that changed size is placed in the same frame and jumps to its box", () => {
  test("the pill's ResizeObserver places it at once, not after the 150 ms debounce", () => {
    expect(overlay).toMatch(/const resized = \(\) => place\(\);/);
    expect(overlay).not.toMatch(
      /const resized = \(\) => \{\s*if \(pillRef\.current\?\.querySelector\('\[data-cy="demo-end-ask"\]'\)\) place\(\);\s*later\(\);/,
    );
  });
  test("a size other than at the last placement sets noGlide", () => {
    expect(overlay).toMatch(
      /const sizedRef = useRef<\{ w: number; h: number \} \| null>\(null\);/,
    );
    expect(overlay).toMatch(
      /if \(\s*sizeNow && sizedRef\.current &&\s*\(sizedRef\.current\.w !== sizeNow\.w \|\|\s*sizedRef\.current\.h !== sizeNow\.h\)\s*\) \{\s*setNoGlide\(true\);\s*\}\s*if \(sizeNow\) sizedRef\.current = sizeNow;/,
    );
  });
});

describe("REQ-890 AMENDMENT 3 (demo-loop run 14, m2): the peek takes a box clear of controls AND words before one over words", () => {
  const view = { w: 390, h: 844 };
  const tab = { left: 0, top: 84, width: 96, height: 32 };
  // the whole pill with its details open at 390: two rows, 73 px; home at the bottom-left
  const home = { left: 12, top: 844 - 8 - 73, width: 366, height: 73 };
  test("without `texts`, as before: flush with the tab on its row (no controls there)", () => {
    const b = peekBox({ home, view, tab, controls: () => 0 });
    expect(b.top).toBe(tab.top + tab.height - home.height);
    expect(b.left).toBe(12);
  });
  test("the tab's row has words under every x (the step count): the first clear row below is taken", () => {
    const rowTop = tab.top + tab.height - home.height;
    // the step count lies across the tab's row (its box ends at rowTop + 73): a box starting
    // below that is clear of it
    const texts = (r: { top: number; height: number }) =>
      r.top < rowTop + home.height ? 1 : 0;
    const b = peekBox({ home, view, tab, controls: () => 0, texts });
    expect(b.top).toBe(rowTop + home.height + PILL_BAND_GAP);
    expect(texts(b)).toBe(0);
    expect(b.crowded).toBeUndefined();
  });
  test("words everywhere: the old rule (fewest controls on the tab's row) still answers", () => {
    const b = peekBox({ home, view, tab, controls: () => 0, texts: () => 1 });
    expect(b.top).toBe(tab.top + tab.height - home.height);
    expect(b.left).toBe(12);
  });
  test("a control on the tab's row and words on the next: the clear row after that, never the control", () => {
    const rowTop = tab.top + tab.height - home.height;
    const step = home.height + PILL_BAND_GAP;
    const controls = (r: { top: number }) => (r.top === rowTop ? 1 : 0);
    const texts = (r: { top: number }) => (r.top === rowTop + step ? 1 : 0);
    const b = peekBox({ home, view, tab, controls, texts });
    expect(controls(b)).toBe(0);
    expect(texts(b)).toBe(0);
  });
  test("a peek opens with its details closed whatever the remembered choice; 'more' during the peek opens them for that peek; the next peek starts closed", () => {
    expect(overlay).toMatch(/const shownOpen = tucked && peek \? peekOpen : open;/);
    expect(overlay).toMatch(
      /const toggleOpen = \(\) => \{\s*(?:\/\/[^\n]*\n\s*)*if \(tucked && peek\) \{\s*setPeekOpen\(\(v\) => !v\);\s*return;\s*\}/,
    );
    expect(overlay).toMatch(/useEffect\(\(\) => \{\s*if \(!peek\) setPeekOpen\(false\);\s*\}, \[peek\]\);/);
    // what the pill shows reads shownOpen, never the remembered `open` alone
    expect(overlay).toMatch(/pillWraps\(\{ compact, open: shownOpen, asking \}\)/);
    expect(overlay).toMatch(/aria-expanded=\{shownOpen\}/);
    // the peek is said on the pill (a story tells a peek from the pill as placed by it)
    expect(overlay).toMatch(/data-peek=\{tucked && peek \? "" : undefined\}/);
    expect(overlay).toMatch(/open: compact && shownOpen,/);
    expect(overlay).not.toMatch(/pillWraps\(\{ compact, open, asking \}\)/);
    expect(overlay).not.toMatch(/aria-expanded=\{open\}/);
  });
  test("the overlay hands the peek what is under a box: controls and words", () => {
    expect(overlay).toMatch(
      /texts: can && peekRef\.current\s*\?\s*\(r\) => countText\(r, backdrop\)\s*:\s*undefined,/,
    );
  });
});

describe("REQ-845 AMENDMENT (demo-loop run 14, m3): the anchor takes the control around the point only when the point is inside that control's box", () => {
  type Rep = ReturnType<typeof createReplayer>;
  function stageDoc(): FDocument {
    const d = new FDocument("about:srcdoc", 1, 1);
    d.appendChild(h(d, "html", {}, h(d, "head"), h(d, "body")));
    return d;
  }
  /** the settings address field: a <label> "CALLE" wrapping the input AND its suggestion list,
   *  which is drawn below the label's own box */
  const address = () =>
    docWith((d) =>
      h(
        d,
        "html",
        {},
        h(d, "head"),
        h(
          d,
          "body",
          {},
          h(
            d,
            "label",
            { class: "calle" },
            h(d, "span", { class: "calle__caption" }, "CALLE"),
            h(d, "input", { class: "calle__input", value: "1600 Congress Ave" }),
            h(
              d,
              "ul",
              { class: "street-list", id: "settings-street-list" },
              h(d, "li", { class: "street-list__row" }, "1600 Congress Ave, Austin"),
            ),
          ),
        ),
      )
    );
  const el = (doc: FDocument, cls: string) =>
    find(doc, (e) => e.getAttribute("class") === cls) as FElement;
  function setUp() {
    const doc = address();
    const frames: MirrorFrame[] = [];
    const rec = createRecorder(doc as unknown as Document, {
      emit: (f) => frames.push(JSON.parse(JSON.stringify(f))),
      Observer: FakeMutationObserver as unknown as typeof MutationObserver,
      manual: true,
    });
    rec.snapshot();
    const stage = stageDoc();
    const rep = createReplayer(stage as unknown as Document, {
      schedule: () => {},
      Resize: null,
    }) as Rep;
    for (const f of frames) rep.apply(f);
    // laid out: the label's box holds the caption and the input; the list opens BELOW the label
    el(stage, "calle").rect = { left: 20, top: 280, width: 350, height: 60 };
    el(stage, "calle__caption").rect = { left: 20, top: 280, width: 60, height: 16 };
    el(stage, "calle__input").rect = { left: 20, top: 300, width: 350, height: 40 };
    el(stage, "street-list").rect = { left: 20, top: 345, width: 350, height: 60 };
    el(stage, "street-list__row").rect = { left: 28, top: 350, width: 334, height: 24 };
    return { rep, stage };
  }
  test("m3: a point on the list's padding (outside the label's box) anchors the list, at its own fraction", () => {
    const { rep, stage } = setUp();
    const a = rep.anchorAt(200, 392)!;
    expect(a).not.toBeNull();
    expect(rep.nodeOf(a.id)).toBe(el(stage, "street-list"));
    expect(a.y).toBeCloseTo((392 - 345) / 60, 5);
    const p = rep.pointOf(a)!;
    expect(p.y).toBeCloseTo(392, 5);
  });
  test("REQ-845 kept: a point on the caption (inside the label's box) anchors the label", () => {
    const { rep, stage } = setUp();
    const a = rep.anchorAt(50, 288)!;
    expect(rep.nodeOf(a.id)).toBe(el(stage, "calle"));
  });
  test("the swap is gated on the point being inside the control's box", () => {
    expect(replay).toMatch(
      /x >= cr\.left && x <= cr\.left \+ cr\.width &&\s*y >= cr\.top && y <= cr\.top \+ cr\.height/,
    );
  });
});
