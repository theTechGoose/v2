/**
 * REQ-845 — demo-loop cycle dm3, issue m1: the presenter rests on the sidebar's "Dashboard" link,
 * over its words; the customer collapses the sidebar; the link is still there as an icon, but the
 * arrow vanished from her screen. The replay anchored to the INNERMOST mirrored element under the
 * point (span.nav-item__label), which a collapsed sidebar takes out of the page
 * (DashSidebar.tsx `{!collapsed && <span class="nav-item__label">}`), and its print
 * ({t:'span'}) matches no other node. The anchor is now the nearest control around the point
 * (`closest(CONTROL_SELECTOR)`: the <a href>), which the collapse keeps.
 *
 * REQ-645 still holds: an element that is truly gone draws nothing (pointOf null).
 */
import { createRecorder } from "../../front-end/lib/demo-mode/mirror-record";
import { createReplayer } from "../../front-end/lib/demo-mode/mirror-replay";
import type { MirrorFrame } from "../../shared/demo-mode/mirror";
import {
  docWith,
  FakeMutationObserver,
  FDocument,
  FElement,
  find,
  h,
} from "./support/fake-dom";

type Print = { t: string; cy?: string; r?: string; h?: string; nm?: string };
type Rep = ReturnType<typeof createReplayer> & {
  printOf?(id: number): Print | null;
  findPrint?(p: Print): number | null;
};

function stageDoc(): FDocument {
  const d = new FDocument("about:srcdoc", 1, 1);
  d.appendChild(h(d, "html", {}, h(d, "head"), h(d, "body")));
  return d;
}

/** the customer's dashboard: the sidebar's Dashboard link, its icon and its label; and a line
 *  of text with no control around it */
const sidebar = () =>
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
          "nav",
          { class: "sidebar" },
          h(
            d,
            "a",
            {
              href: "https://app.test/dashboard",
              class: "nav-item",
              title: "Dashboard",
            },
            h(d, "span", { class: "nav-item__icon" }),
            h(d, "span", { class: "nav-item__label" }, "Dashboard"),
          ),
        ),
        h(d, "main", {}, h(d, "p", { class: "note" }, "Welcome back")),
      ),
    )
  );

const el = (doc: FDocument, cls: string) =>
  find(doc, (e) => e.getAttribute("class") === cls) as FElement;

function setUp() {
  const doc = sidebar();
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
  let at = 0;
  const pump = () => {
    for (; at < frames.length; at++) rep.apply(frames[at]);
  };
  pump();
  // laid out as expanded: the link the sidebar's width, the label right of the icon
  el(stage, "nav-item").rect = { left: 8, top: 172, width: 224, height: 36 };
  el(stage, "nav-item__icon").rect = {
    left: 20,
    top: 179,
    width: 22,
    height: 22,
  };
  el(stage, "nav-item__label").rect = {
    left: 54,
    top: 181,
    width: 80,
    height: 18,
  };
  el(stage, "note").rect = { left: 300, top: 100, width: 400, height: 20 };
  return { doc, rec, rep, stage, pump };
}

describe("REQ-845 (demo-loop cycle dm3, m1) the presenter's anchor is the control around the point, so a sidebar collapse keeps his arrow", () => {
  test("REQ-845: over span.nav-item__label the anchor (and its print) is the <a href>, not the span", () => {
    const { rep, stage } = setUp();
    const a = rep.anchorAt(93.5, 189.5)!;
    expect(a).not.toBeNull();
    expect(rep.nodeOf(a.id)).toBe(el(stage, "nav-item"));
    // the fraction is inside the link's box, where he pointed
    expect(a.x).toBeCloseTo((93.5 - 8) / 224, 5);
    expect(a.y).toBeCloseTo((189.5 - 172) / 36, 5);
    expect(rep.printOf!(a.id)).toMatchObject({
      t: "a",
      h: "https://app.test/dashboard",
    });
  });

  test("REQ-845: the sidebar collapses (the label span leaves the page) — the anchor is still live and drawn on the link", () => {
    const { doc, rec, rep, stage, pump } = setUp();
    const a = rep.anchorAt(93.5, 189.5)!;
    // DashSidebar collapsed: the label is gone, the link gets aria-label and narrows to its icon
    el(doc, "nav-item__label").remove();
    el(doc, "nav-item").setAttribute("aria-label", "Dashboard");
    rec.flush();
    pump();
    expect(find(stage, (e) => e.getAttribute("class") === "nav-item__label"))
      .toBeNull();
    el(stage, "nav-item").rect = { left: 8, top: 172, width: 48, height: 36 };
    const p = rep.pointOf(a);
    expect(p).not.toBeNull();
    expect(p!.x).toBeGreaterThanOrEqual(8);
    expect(p!.x).toBeLessThanOrEqual(56);
    expect(p!.y).toBeCloseTo(189.5, 5);
  });

  test("REQ-845 / REQ-645 kept: a point with no control around it anchors its innermost element, and an element truly gone draws nothing", () => {
    const { doc, rec, rep, stage, pump } = setUp();
    const a = rep.anchorAt(320, 110)!;
    expect(rep.nodeOf(a.id)).toBe(el(stage, "note"));
    el(doc, "note").remove();
    rec.flush();
    pump();
    expect(rep.pointOf(a)).toBeNull();
  });
});
