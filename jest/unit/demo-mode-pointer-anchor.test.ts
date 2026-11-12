/**
 * REQ-305 — demo issues M2, M7, m16 and setup-m6 (demo-loop cycle 1): a pointer's anchor is
 * resolved AGAINST A SETTLED FRAME, AND AGAIN whenever the frame's layout changes — never once
 * against an unstyled or not-yet-scrolled replay and then left there.
 *
 *   - the replayer settles its scrolls (and tells the stage its layout may have moved) after every
 *     applied frame, when a stylesheet, an image or a font of the frame loads, and when the page
 *     grows — not only on three timers after a snapshot (setup-m6: a scripted scroll that lands
 *     before the frame has its height is taken again once it has);
 *   - `styled()` says whether every stylesheet the replay links is in: the stage's presenter
 *     pointer names a mirrored node only then (M2 — before that, a fraction of the frame);
 *   - a resolved point outside the box it is drawn in is put on the box's edge, the whole arrow
 *     showing, marked as pointing outside (`placeIn`), never drawn off-screen (m16);
 *   - `sameAnchor`: a resting pointer placed again is sent only when it names another place;
 *   - both islands keep the last anchor per sender and place it again (the stage after every
 *     layout pass of the replay and every resize, the customer's overlay on scroll, resize and
 *     every recorded change); the stage hides the customer's pointer on a NEW page only, never on
 *     a resync of the same one; the customer's app sends its resting pointer again after every
 *     snapshot and whenever its page moved under the still cursor (M7, m16).
 */
import * as fs from "fs";
import * as path from "path";
import { createRecorder } from "../../front-end/lib/demo-mode/mirror-record";
import { createReplayer } from "../../front-end/lib/demo-mode/mirror-replay";
import type { MirrorFrame } from "../../shared/demo-mode/mirror";
import * as motion from "../../shared/demo-mode/motion";
import * as protocol from "../../shared/demo-mode/protocol";
import type { Anchor } from "../../shared/demo-mode/protocol";
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

type Box = { left: number; top: number; width: number; height: number };
type Pt = { x: number; y: number };
// looked up at run time: a missing export fails its own tests, not the whole file
const placeIn = (p: Pt, box: Box, arrow?: { w: number; h: number }) =>
  (motion as unknown as {
    placeIn(p: Pt, b: Box, a?: { w: number; h: number }): {
      at: Pt;
      outside: boolean;
    };
  }).placeIn(p, box, arrow);
const sameAnchor = (a: Anchor | null, b: Anchor | null) =>
  (protocol as unknown as {
    sameAnchor(a: Anchor | null, b: Anchor | null): boolean;
  }).sameAnchor(a, b);

/** the customer's page: a stylesheet, an image, a panel that scrolls, and a long body */
function customerPage(head: (d: FDocument) => FElement[] = defaultHead) {
  return docWith(
    (d) =>
      h(
        d,
        "html",
        {},
        h(d, "head", {}, ...head(d)),
        h(
          d,
          "body",
          {},
          h(d, "img", { src: "/hero.png" }),
          h(
            d,
            "main",
            { class: "chat" },
            h(d, "p", {}, "one"),
            h(d, "p", {}, "two"),
          ),
          h(d, "footer", {}, "the end"),
        ),
      ),
    "https://app.test/q/abc",
    420,
    800,
  );
}
function defaultHead(d: FDocument): FElement[] {
  return [
    h(d, "link", { rel: "stylesheet", href: "/dashboard.css" }),
    h(d, "link", { rel: "icon", href: "/favicon.png" }),
  ];
}

function stageDoc(): FDocument {
  const d = new FDocument("about:srcdoc", 1, 1);
  d.appendChild(h(d, "html", {}, h(d, "head"), h(d, "body")));
  return d;
}

function snapshotOf(doc: FDocument): MirrorFrame[] {
  const frames: MirrorFrame[] = [];
  const rec = createRecorder(doc as unknown as Document, {
    emit: (f) => frames.push(JSON.parse(JSON.stringify(f))),
    Observer: FakeMutationObserver as unknown as typeof MutationObserver,
    manual: true,
  });
  rec.snapshot();
  rec.stop();
  return frames;
}

/** a ResizeObserver the test drives by hand */
class FakeResize {
  static made: FakeResize[] = [];
  observed: unknown[] = [];
  constructor(public cb: () => void) {
    FakeResize.made.push(this);
  }
  observe(el: unknown) {
    this.observed.push(el);
  }
  disconnect() {
    this.observed = [];
  }
}

/** a document's FontFaceSet, as far as the replayer uses it */
class FakeFonts {
  listeners = new Map<string, Set<() => void>>();
  addEventListener(t: string, fn: () => void) {
    if (!this.listeners.has(t)) this.listeners.set(t, new Set());
    this.listeners.get(t)!.add(fn);
  }
  removeEventListener(t: string, fn: () => void) {
    this.listeners.get(t)?.delete(fn);
  }
  fire(t: string) {
    for (const fn of this.listeners.get(t) ?? []) fn();
  }
}

const el = (doc: FDocument, pred: (e: FElement) => boolean) => {
  const e = find(doc, pred);
  if (!e) throw new Error("no such element");
  return e;
};
const sheetOf = (d: FDocument) =>
  el(
    d,
    (e) => e.localName === "link" && e.getAttribute("rel") === "stylesheet",
  );

describe("REQ-305 the replay settles its scrolls whenever its layout may have changed (setup-m6)", () => {
  beforeEach(() => {
    FakeResize.made = [];
  });

  test("a scroll the frame could not take yet is taken again after the frame, when a stylesheet or image loads, and when the page grows — and the stage is told after each pass", () => {
    const doc = customerPage();
    el(doc, (e) => e.localName === "main").scrollTop = 35;
    doc.defaultView.scrollY = 600;
    const frames = snapshotOf(doc);
    const stage = stageDoc();
    const passes: (() => void)[] = [];
    let layouts = 0;
    const rep = createReplayer(
      stage as unknown as Document,
      {
        schedule: (fn: () => void) => passes.push(fn),
        Resize: FakeResize as unknown as typeof ResizeObserver,
        onLayout: () => layouts++,
      } as Parameters<typeof createReplayer>[1],
    );
    expect(rep.apply(frames[0])).toBe(true);
    const twin = el(stage, (e) => e.localName === "main");
    const html = stage.documentElement!;
    // the browser could not take them: an unstyled frame is not tall enough yet
    const dropped = () => {
      twin.scrollTop = 0;
      html.scrollTop = 0;
    };
    const taken = () => ({ main: twin.scrollTop, window: html.scrollTop });

    // 1. the pass after the frame (the next animation frame): the scrolls, then the stage
    expect(passes.length).toBe(1);
    dropped();
    passes.shift()!();
    expect(taken()).toEqual({ main: 35, window: 600 });
    expect(layouts).toBe(1);

    // 2. the frame's stylesheet loads (a load event, captured on the frame's document)
    dropped();
    stage.fire("load", sheetOf(stage));
    expect(passes.length).toBe(1);
    passes.shift()!();
    expect(taken()).toEqual({ main: 35, window: 600 });
    expect(layouts).toBe(2);

    // 3. an image loads
    dropped();
    stage.fire("load", el(stage, (e) => e.localName === "img"));
    passes.shift()!();
    expect(taken()).toEqual({ main: 35, window: 600 });

    // 4. the page grows (the ResizeObserver on the frame's html and body)
    const ro = FakeResize.made[FakeResize.made.length - 1];
    expect(ro.observed).toEqual([html, stage.body]);
    dropped();
    ro.cb();
    passes.shift()!();
    expect(taken()).toEqual({ main: 35, window: 600 });
    expect(layouts).toBe(4);

    // 5. several triggers before the pass runs are one pass
    stage.fire("load", el(stage, (e) => e.localName === "img"));
    ro.cb();
    expect(rep.apply({ t: "ops", ops: [{ o: "s", i: 0, x: 0, y: 700 }] })).toBe(
      true,
    );
    expect(passes.length).toBe(1);
    dropped();
    passes.shift()!();
    expect(taken()).toEqual({ main: 35, window: 700 });
    expect(layouts).toBe(5);

    // 6. the latest scroll is the one settled, even when it landed before the layout did
    expect(rep.apply({ t: "ops", ops: [{ o: "s", i: 0, x: 0, y: 0 }] })).toBe(
      true,
    );
    html.scrollTop = 700; // the browser kept an old position: the pass puts the newest back
    passes.shift()!();
    expect(html.scrollTop).toBe(0);
    expect(layouts).toBe(6);

    // 7. the frame scrolled (the browser moved it): the stage is told — and nothing is settled,
    //    which would fight a scroll the replay made itself
    twin.scrollTop = 12;
    stage.fire("scroll", stage);
    expect(passes.length).toBe(1);
    passes.shift()!();
    expect(twin.scrollTop).toBe(12);
    expect(layouts).toBe(7);
    // a settle asked for while a scroll's pass is due is still done in it
    stage.fire("scroll", stage);
    stage.fire("load", el(stage, (e) => e.localName === "img"));
    expect(passes.length).toBe(1);
    passes.shift()!();
    expect(twin.scrollTop).toBe(35);
    expect(layouts).toBe(8);

    // 8. disposed: nothing listens any more
    (rep as unknown as { dispose(): void }).dispose();
    for (const t of ["load", "error", "scroll"]) {
      expect([t, stage.listening(t)]).toEqual([t, 0]);
    }
    expect(ro.observed).toEqual([]);
    stage.fire("load", el(stage, (e) => e.localName === "img"));
    expect(passes.length).toBe(0);
  });

  test("a scroll is put on at once — `scrollTo` with behavior \"instant\", never the page's own smooth scrolling (the quote page's `html { scroll-behavior: smooth }` left the frame halfway when the pointer was placed)", () => {
    const doc = customerPage();
    el(doc, (e) => e.localName === "main").scrollTop = 35;
    doc.defaultView.scrollY = 600;
    const stage = stageDoc();
    const passes: (() => void)[] = [];
    const rep = createReplayer(
      stage as unknown as Document,
      {
        schedule: (fn: () => void) => passes.push(fn),
        Resize: null,
      } as Parameters<typeof createReplayer>[1],
    );
    // a browser's scrollTo, recorded
    const calls: string[] = [];
    const withScrollTo = (e: FElement, name: string) => {
      (e as unknown as { scrollTo(o: ScrollToOptions): void }).scrollTo = (
        o: ScrollToOptions,
      ) => {
        calls.push(`${name} ${o.left},${o.top} ${o.behavior}`);
        e.scrollLeft = o.left ?? e.scrollLeft;
        e.scrollTop = o.top ?? e.scrollTop;
      };
    };
    const snap = snapshotOf(doc)[0];
    // the replay builds new elements: give them scrollTo as they arrive
    const build = stage.createElement.bind(stage);
    stage.createElement = (tag: string) => {
      const e = build(tag);
      if (tag === "html" || tag === "main") withScrollTo(e, tag);
      return e;
    };
    expect(rep.apply(snap)).toBe(true);
    expect(calls).toEqual(["main 0,35 instant", "html 0,600 instant"]);
    calls.length = 0;
    expect(rep.apply({ t: "ops", ops: [{ o: "s", i: 0, x: 0, y: 900 }] })).toBe(
      true,
    );
    expect(calls).toEqual(["html 0,900 instant"]);
    // the settle pass puts back only what the replay lost, the same way
    calls.length = 0;
    el(stage, (e) => e.localName === "main").scrollTop = 0;
    passes.length = 0;
    rep.settle();
    expect(calls).toEqual(["main 0,35 instant"]);
  });

  test("a web font of the frame loading is a pass too (text, and what follows it, moved); dispose stops listening", () => {
    const doc = customerPage();
    doc.defaultView.scrollY = 300;
    const stage = stageDoc();
    const fonts = new FakeFonts();
    (stage as unknown as { fonts: FakeFonts }).fonts = fonts;
    const passes: (() => void)[] = [];
    let layouts = 0;
    const rep = createReplayer(
      stage as unknown as Document,
      {
        schedule: (fn: () => void) => passes.push(fn),
        Resize: null,
        onLayout: () => layouts++,
      } as Parameters<typeof createReplayer>[1],
    );
    expect(rep.apply(snapshotOf(doc)[0])).toBe(true);
    passes.shift()!();
    stage.documentElement!.scrollTop = 0;
    fonts.fire("loadingdone");
    expect(passes.length).toBe(1);
    passes.shift()!();
    expect(stage.documentElement!.scrollTop).toBe(300);
    expect(layouts).toBe(2);
    (rep as unknown as { dispose(): void }).dispose();
    fonts.fire("loadingdone");
    expect(passes.length).toBe(0);
  });

  test("a new snapshot watches the new page's html and body (the old root is gone)", () => {
    const doc = customerPage();
    const stage = stageDoc();
    const rep = createReplayer(
      stage as unknown as Document,
      {
        schedule: () => {},
        Resize: FakeResize as unknown as typeof ResizeObserver,
      } as Parameters<typeof createReplayer>[1],
    );
    expect(rep.apply(snapshotOf(doc)[0])).toBe(true);
    const first = FakeResize.made[FakeResize.made.length - 1];
    expect(first?.observed).toEqual([stage.documentElement, stage.body]);
    expect(rep.apply(snapshotOf(doc)[0])).toBe(true);
    const second = FakeResize.made[FakeResize.made.length - 1];
    expect(second).not.toBe(first);
    expect(first.observed).toEqual([]);
    expect(second.observed).toEqual([stage.documentElement, stage.body]);
  });
});

describe("REQ-305 styled(): the replay has every stylesheet it links (M2 — no node is looked for in an unstyled frame)", () => {
  const styled = (rep: unknown) => (rep as { styled(): boolean }).styled();

  test("false while a linked stylesheet has not loaded; true once it loaded (its load event, or its sheet) or failed; a snapshot starts over; a link that left the page is not waited for; a page with no stylesheet is styled at once", () => {
    const doc = customerPage();
    const stage = stageDoc();
    const rep = createReplayer(
      stage as unknown as Document,
      {
        schedule: () => {},
        Resize: null,
      } as Parameters<typeof createReplayer>[1],
    );
    expect(styled(rep)).toBe(true); // nothing linked yet
    expect(rep.apply(snapshotOf(doc)[0])).toBe(true);
    expect(styled(rep)).toBe(false);
    // an image's load is not the stylesheet's
    stage.fire("load", el(stage, (e) => e.localName === "img"));
    expect(styled(rep)).toBe(false);
    stage.fire("load", sheetOf(stage));
    expect(styled(rep)).toBe(true);

    // a fresh snapshot: a fresh link, not loaded yet
    expect(rep.apply(snapshotOf(doc)[0])).toBe(true);
    expect(styled(rep)).toBe(false);
    // the browser attached the sheet at once (from its memory cache): that counts
    (sheetOf(stage) as unknown as { sheet: unknown }).sheet = {};
    expect(styled(rep)).toBe(true);

    // a sheet that fails is not waited for either
    expect(rep.apply(snapshotOf(doc)[0])).toBe(true);
    expect(styled(rep)).toBe(false);
    stage.fire("error", sheetOf(stage));
    expect(styled(rep)).toBe(true);

    // a link taken out of the page (an ops frame) is forgotten
    expect(rep.apply(snapshotOf(doc)[0])).toBe(true);
    expect(styled(rep)).toBe(false);
    sheetOf(stage).remove();
    expect(styled(rep)).toBe(true);

    // a page with no stylesheet at all
    const bare = docWith((d) =>
      h(d, "html", {}, h(d, "head"), h(d, "body", {}, "hi"))
    );
    expect(rep.apply(snapshotOf(bare)[0])).toBe(true);
    expect(styled(rep)).toBe(true);
  });

  test("a stylesheet the browser never loads — disabled, an alternate, or with no address — never holds the replay unstyled", () => {
    const stage = stageDoc();
    const rep = createReplayer(
      stage as unknown as Document,
      {
        schedule: () => {},
        Resize: null,
      } as Parameters<typeof createReplayer>[1],
    );
    for (
      const attrs of [
        { rel: "stylesheet", href: "/x.css", disabled: "" },
        { rel: "alternate stylesheet", href: "/x.css" },
        { rel: "stylesheet", href: "" },
        { rel: "stylesheet" },
      ] as Record<string, string>[]
    ) {
      const page = customerPage((d) => [h(d, "link", attrs)]);
      expect(rep.apply(snapshotOf(page)[0])).toBe(true);
      expect([JSON.stringify(attrs), styled(rep)]).toEqual([
        JSON.stringify(attrs),
        true,
      ]);
    }
    // ...while one that will load is waited for
    const page = customerPage((d) => [
      h(d, "link", { rel: "stylesheet", href: "/x.css", disabled: "" }),
      h(d, "link", { rel: "stylesheet", href: "/y.css" }),
    ]);
    expect(rep.apply(snapshotOf(page)[0])).toBe(true);
    expect(styled(rep)).toBe(false);
  });
});

describe("REQ-305 placeIn: a resolved point outside its box goes on the box's edge, the whole arrow showing, marked as pointing outside (m16)", () => {
  const box = { left: 100, top: 50, width: 400, height: 300 };
  test("inside (edges included): the point itself, not outside", () => {
    expect(placeIn({ x: 120, y: 60 }, box)).toEqual({
      at: { x: 120, y: 60 },
      outside: false,
    });
    expect(placeIn({ x: 500, y: 350 }, box)).toEqual({
      at: { x: 500, y: 350 },
      outside: false,
    });
  });
  test("above the frame (the y = −19 case), below it (page coordinates, y = 1652), left and right of it: on the edge, far enough in that the 24 × 30 arrow shows, outside", () => {
    expect(motion.ARROW_BOX).toEqual({ w: 24, h: 30 });
    expect(placeIn({ x: 300, y: -19 }, box)).toEqual({
      at: { x: 300, y: 50 },
      outside: true,
    });
    expect(placeIn({ x: 300, y: 1652 }, box)).toEqual({
      at: { x: 300, y: 320 },
      outside: true,
    });
    expect(placeIn({ x: -110, y: 100 }, box)).toEqual({
      at: { x: 100, y: 100 },
      outside: true,
    });
    expect(placeIn({ x: 900, y: 900 }, box)).toEqual({
      at: { x: 476, y: 320 },
      outside: true,
    });
  });
  test("a box smaller than the arrow keeps the point at its top-left", () => {
    expect(
      placeIn({ x: 50, y: 50 }, { left: 0, top: 0, width: 10, height: 10 }),
    )
      .toEqual({ at: { x: 0, y: 0 }, outside: true });
  });
});

describe("REQ-305 sameAnchor: a pointer placed again is sent only when it names another place", () => {
  const n = (id: number, x = 0.5, y = 0.5, l = "L1") => ({ id, x, y, l });
  test("the same node of the same page load at the same spot is the same; another node, another load, another spot, or a node against a bare fraction is not", () => {
    expect(sameAnchor(null, null)).toBe(true);
    expect(sameAnchor({ vx: 0.2, vy: 0.3 }, null)).toBe(false);
    expect(sameAnchor({ vx: 0.2, vy: 0.3 }, { vx: 0.2, vy: 0.3 })).toBe(true);
    expect(sameAnchor({ vx: 0.2, vy: 0.3 }, { vx: 0.2005, vy: 0.3 })).toBe(
      true,
    );
    expect(sameAnchor({ vx: 0.2, vy: 0.3 }, { vx: 0.25, vy: 0.3 })).toBe(false);
    expect(
      sameAnchor({ vx: 0.2, vy: 0.3, n: n(7) }, { vx: 0.9, vy: 0.9, n: n(7) }),
    ).toBe(true); // the node is what is pointed at
    expect(
      sameAnchor({ vx: 0.2, vy: 0.3, n: n(7) }, { vx: 0.2, vy: 0.3, n: n(8) }),
    ).toBe(false);
    expect(
      sameAnchor({ vx: 0.2, vy: 0.3, n: n(7) }, {
        vx: 0.2,
        vy: 0.3,
        n: n(7, 0.5, 0.5, "L2"),
      }),
    ).toBe(false);
    expect(
      sameAnchor({ vx: 0.2, vy: 0.3, n: n(7) }, {
        vx: 0.2,
        vy: 0.3,
        n: n(7, 0.6, 0.5),
      }),
    ).toBe(false);
    expect(sameAnchor({ vx: 0.2, vy: 0.3, n: n(7) }, { vx: 0.2, vy: 0.3 }))
      .toBe(false);
  });
});

describe("REQ-305 the stage: anchors kept and placed again; its presenter's pointer names a node only in a styled replay (M2, M7, m16)", () => {
  const stage = read("front-end/islands/DemoStage.tsx");
  const fn = (name: string) => {
    const at = stage.indexOf(`const ${name} = `);
    expect(at).toBeGreaterThan(-1);
    return stage.slice(at, stage.indexOf("\n  };\n", at));
  };
  const snapBranch = (() => {
    const at = stage.indexOf('if (f.t === "snap")');
    expect(at).toBeGreaterThan(-1);
    return stage.slice(at, stage.indexOf("\n    }\n  };\n", at));
  })();

  test("anchorOf looks for the mirrored node under the presenter's pointer only once the replay is styled (else the fraction of the frame alone)", () => {
    expect(fn("anchorOf")).toMatch(
      /load && rep\?\.styled\(\)\s*\?\s*rep\.anchorAt\(/,
    );
  });

  // REQ-393 AMENDMENT (demo M2, cycle 2) — the resting pointer is looked up again on EVERY layout
  // pass, not only while a snapshot settles: the settle window is gone
  test("after a snapshot nothing is anchored at once: a new page gets the resting pointer as a fraction of the frame (resendPointer), then — on every layout pass (REQ-393: not only while the snapshot settles), once styled — on the node under it, sent only when that changed", () => {
    expect(snapBranch).not.toMatch(/anchorOf\(|anchorAt\(|restAgain\(/);
    expect(snapBranch).toMatch(/if \(newLoad\)[\s\S]{0,400}resendPointer\(\)/);
    // no settle window: each settle timer settles the scrolls and places everything again
    expect(snapBranch).not.toMatch(/restRef|snapGenRef/);
    expect(snapBranch).toMatch(/\.settle\(\);\s*replaceRef\.current\(\);/);
    // the fraction-only resend never reads the replay's nodes
    const resend = fn("resendPointer");
    expect(resend).not.toMatch(/anchorOf\(|anchorAt\(/);
    expect(resend).toMatch(/pointToFrac\(p, fitBox\(\)\)/);
    // the anchored one is sent only when it names another place than the last sent
    expect(fn("restAgain")).toMatch(
      /const was = sentRef\.current;\s*const a = anchorOf\(p\);\s*if \(sameAnchor\(was, a\)\) return;/,
    );
    expect(fn("replace")).toMatch(
      /if \(lastMoveRef\.current\) rest\.push\(null\)/,
    );
  });

  test("the customer's pointer is hidden on a NEW page load only, never on a resync snapshot of the same page", () => {
    const hideAt = snapBranch.indexOf("glide.hide()");
    const newLoadAt = snapBranch.indexOf("if (newLoad)");
    expect(newLoadAt).toBeGreaterThan(-1);
    expect(hideAt).toBeGreaterThan(newLoadAt);
    expect(snapBranch.slice(0, newLoadAt)).not.toMatch(/glide\.hide\(\)/);
  });

  test("the customer's and the colleagues' last anchors are kept, and placed again (clamped to the frame) after every layout pass of the replay, the settle timers and a resize of the stage", () => {
    expect(stage).toMatch(/const customerRef = useRef<Anchor \| null>\(null\)/);
    expect(stage).toMatch(/const peersRef = useRef<Map<string, Anchor>>/);
    expect(stage).toMatch(
      /case "move":[\s\S]{0,200}customerRef\.current = m\.a;\s*showCustomer\(\)/,
    );
    expect(stage).toMatch(/peersRef\.current\.set\(pid, m\.a\)/);
    expect(stage).toMatch(/case "leave":\s*customerRef\.current = null/);
    // REQ-393 — and an off-screen anchor (a colleague's mouse beside their frame) on the edge
    expect(fn("placeOnStage")).toMatch(
      /placeIn\(toStage\(a\), fitBox\(\)(, ARROW_BOX, a\.o === 1)?\)/,
    );
    expect(stage).toMatch(
      /createReplayer\(doc, \{[\s\S]{0,160}onLayout: \(\) => replaceRef\.current\(\)/,
    );
    expect(stage).toMatch(
      /useEffect\(\(\) => \{\s*replace\(\);\s*\}, \[fit\]\)/,
    );
    // a move resolved once and drawn wherever that put it is gone
    expect(stage).not.toMatch(/glideTo\(toStage\(/);
    expect(stage).not.toMatch(/at: toStage\(/);
  });
});

describe("REQ-305 the customer's overlay: presenters' anchors follow their nodes; its own resting pointer goes out again after a snapshot and when the page moves under it (M2, M7, m16)", () => {
  const overlay = read("front-end/islands/DemoModeOverlay.tsx");

  test("each presenter's last anchor is kept and placed again (clamped to the window) on scroll, resize, the body growing and every recorded change", () => {
    expect(overlay).toMatch(/const anchorsRef = useRef<Map<string, Anchor>>/);
    expect(overlay).toMatch(/anchorsRef\.current\.set\(pid, m\.a\)/);
    // REQ-393 — and an off-screen anchor (the presenter's mouse beside the frame) on the edge
    expect(overlay).toMatch(
      /placeIn\(toScreen\(a\), viewportBox\(\)(, ARROW_BOX, a\.o === 1)?\)/,
    );
    expect(overlay).toMatch(/addEventListener\("resize", shifted\)/);
    expect(overlay).toMatch(
      /document\.addEventListener\("scroll", shifted, \{\s*capture: true,/,
    );
    expect(overlay).toMatch(/new ResizeObserver\(shifted\)/);
    expect(overlay).toMatch(
      /emit: \(f\) => \{\s*void sender\.push\(f\);\s*shifted\(\)/,
    );
    // a move resolved once and drawn wherever that put it is gone
    expect(overlay).not.toMatch(/at: toScreen\(/);
  });

  test("the resting pointer is sent again after every snapshot (a presenter joined, a stage asked), and whenever the page moved under the still cursor so that it names another place", () => {
    expect(overlay).toMatch(/const lastMoveRef = useRef<Pt \| null>\(null\)/);
    const online = overlay.slice(overlay.indexOf("onPeerOnline:"));
    expect(online.slice(0, online.indexOf("},") + 2)).toMatch(
      /recorder\.snapshot\(\);\s*resendPointer\(\)/,
    );
    expect(overlay).toMatch(
      /case "resync":[\s\S]{0,160}recorder\.snapshot\(\);\s*resendPointer\(\)/,
    );
    expect(overlay).toMatch(
      /const rest = lastMoveRef\.current;[\s\S]{0,120}if \(!sameAnchor\(was, anchorOf\(rest\)\)\) throttle\.push\(rest\)/,
    );
  });
});

describe("REQ-305 the pointer says when it points outside its box", () => {
  test("useGlide carries `outside` and ignores the same target again; PeerPointer passes it; DemoPointer marks the arrow", () => {
    const glide = read("front-end/lib/demo-mode/use-glide.ts");
    expect(glide).toMatch(/outside: boolean/);
    expect(glide).toMatch(/glideTo\(target: Pt, outside\?: boolean\)/);
    const peer = read("front-end/components/demo-mode/PeerPointer.tsx");
    expect(peer).toMatch(/outside\?: boolean/);
    expect(peer).toMatch(/glide\.glideTo\(cmd\.at, cmd\.outside\)/);
    const pointer = read("front-end/components/demo-mode/DemoPointer.tsx");
    expect(pointer).toMatch(/data-outside=/);
  });
});
