/**
 * REQ-547 — demo-loop cycle 4, issues M21 + m32: after the customer rejoined, the stage showed
 * the ClientsBoard cards' back panel (`.ccard2__panel`: "No subscriptions", "$2,250.00") as a
 * ghost over the front, and once an empty NEW CUSTOMER card. A snapshot rebuilds the whole page
 * and its <link rel=stylesheet> arrive a moment later; when they do, every element whose look
 * the sheet changes runs its CSS transition FROM the unstyled look (a Chromium probe: the closed
 * panel read opacity 0.53 60 ms after its sheet loaded) — states the customer never had.
 *
 * So the replay holds every transition and animation still (`transition:none`, 0 s animations)
 * from a snapshot until it has settled, and again while a stylesheet an op added is loading; and
 * a later snapshot whose sheets are not in the frame yet keeps the previous page on show while
 * they load (preloaded into it), so the stage never shows a half-styled rebuild.
 */
import { createRecorder } from "../../front-end/lib/demo-mode/mirror-record";
import * as replayMod from "../../front-end/lib/demo-mode/mirror-replay";
import { createReplayer } from "../../front-end/lib/demo-mode/mirror-replay";
import type { MirrorFrame } from "../../shared/demo-mode/mirror";
import {
  docWith,
  FakeMutationObserver,
  FDocument,
  FElement,
  find,
  findAll,
  h,
} from "./support/fake-dom";

/** the customer's /customers page: its stylesheet(s) and a card with its back panel */
function customersPage(sheets = ["/assets/clients.css?v=1"]): FDocument {
  return docWith(
    (d) =>
      h(
        d,
        "html",
        {},
        h(
          d,
          "head",
          {},
          ...sheets.map((href) => h(d, "link", { rel: "stylesheet", href })),
        ),
        h(
          d,
          "body",
          {},
          h(
            d,
            "article",
            { class: "ccard2" },
            h(d, "div", { class: "ccard2__body" }, "Bob Smith"),
            h(d, "div", { class: "ccard2__panel" }, "No subscriptions"),
          ),
        ),
      ),
    "https://app.test/customers",
    420,
    800,
  );
}
function stageDoc(): FDocument {
  const d = new FDocument("about:srcdoc", 1, 1);
  d.appendChild(h(d, "html", {}, h(d, "head"), h(d, "body")));
  return d;
}
function snapshotOf(doc: FDocument): MirrorFrame {
  const frames: MirrorFrame[] = [];
  const rec = createRecorder(doc as unknown as Document, {
    emit: (f) => frames.push(JSON.parse(JSON.stringify(f))),
    Observer: FakeMutationObserver as unknown as typeof MutationObserver,
    manual: true,
  });
  rec.snapshot();
  rec.stop();
  return frames[0];
}

/** a replayer whose clock, timers and layout passes the test drives */
function replayer(stage: FDocument) {
  const clock = { t: 1_000 };
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const passes: (() => void)[] = [];
  const rep = createReplayer(
    stage as unknown as Document,
    {
      schedule: (fn: () => void) => passes.push(fn),
      Resize: null,
      now: () => clock.t,
      later: (fn: () => void, ms: number) => {
        const t = { fn, ms, cancelled: false };
        timers.push(t);
        return () => {
          t.cancelled = true;
        };
      },
    } as Parameters<typeof createReplayer>[1],
  );
  const flush = () => {
    while (passes.length) passes.shift()!();
  };
  /** every pending timer of at most `ms` runs */
  const fire = (ms: number) => {
    for (const t of timers.splice(0)) {
      if (!t.cancelled && t.ms <= ms) t.fn();
      else if (!t.cancelled) timers.push(t);
    }
  };
  return { rep, clock, timers, flush, fire };
}

const STILL = (css: string) =>
  /transition:\s*none\s*!important/.test(css) &&
  /animation-duration:\s*0s\s*!important/.test(css);
/** the frame's "still" rule is in force: a sheet of the stage's own that turns every transition
 *  and animation off — adopted by the frame's document (a browser's, and the fake DOM's), or a
 *  <style> in the frame where there are no adopted sheets */
function stillOn(stage: FDocument): boolean {
  const adopted =
    (stage as unknown as { adoptedStyleSheets?: { cssText: string }[] })
      .adoptedStyleSheets ?? [];
  if (adopted.some((x) => STILL(x.cssText))) return true;
  const rule = find(
    stage,
    (e: FElement) => e.localName === "style" && STILL(e.textContent),
  );
  return !!rule && !!stage.documentElement?.contains(rule);
}
const still = (rep: unknown): boolean => {
  const f = (rep as { still?: () => boolean }).still;
  if (typeof f !== "function") throw new Error("the replayer has no still()");
  return f.call(rep);
};
const sheetsIn = (stage: FDocument) =>
  findAll(
    stage,
    (e: FElement) =>
      e.localName === "link" && e.getAttribute("rel") === "stylesheet",
  );
const panelIn = (stage: FDocument) =>
  find(stage, (e: FElement) => e.getAttribute("class") === "ccard2__panel");
type Kid = { i: number; c?: Kid[] };
const kid = (snap: MirrorFrame, ...path: number[]): number => {
  let n = (snap as unknown as { root: Kid }).root;
  for (const k of path) n = n.c![k];
  return n.i;
};

describe("REQ-547 (cycle 4, M21 + m32) — a replayed snapshot never animates from its unstyled look", () => {
  test("REQ-547 from a snapshot until its sheets (and fonts, images) are in, every transition and animation in the frame is held still; once settled the page's own transitions work again", () => {
    const stage = stageDoc();
    const { rep, flush } = replayer(stage);
    expect(rep.apply(snapshotOf(customersPage()))).toBe(true);
    expect(still(rep)).toBe(true);
    expect(stillOn(stage)).toBe(true);
    flush(); // a layout pass before the sheet is in changes nothing
    expect(stillOn(stage)).toBe(true);
    const [sheet] = sheetsIn(stage);
    stage.fire("load", sheet);
    // the panel took its closed look while still: no fade from the unstyled look
    expect(stillOn(stage)).toBe(true);
    flush();
    expect(rep.settled()).toBe(true);
    expect(still(rep)).toBe(false);
    expect(stillOn(stage)).toBe(false);
  });

  test("REQ-547 the still rule survives an op that rewrites the page's <head> while it is loading", () => {
    const stage = stageDoc();
    const { rep, flush } = replayer(stage);
    const snap = snapshotOf(customersPage());
    rep.apply(snap);
    expect(rep.nodeOf(kid(snap, 0))).toBe(stage.head);
    // the customer's head keeps exactly its link: the stage's own style must not be lost
    rep.apply(
      {
        t: "ops",
        ops: [{ o: "k", i: kid(snap, 0), c: [kid(snap, 0, 0)] }],
      } as never,
    );
    flush();
    expect(stillOn(stage)).toBe(true);
  });

  test("REQ-547 where the frame has no adopted stylesheets, the rule is a <style> of the stage's own, put back after an op rewrites the <head>, and taken out once settled", () => {
    const stage = stageDoc();
    delete (stage as unknown as { adoptedStyleSheets?: unknown })
      .adoptedStyleSheets;
    const { rep, flush } = replayer(stage);
    const snap = snapshotOf(customersPage());
    rep.apply(snap);
    expect(stillOn(stage)).toBe(true);
    rep.apply(
      {
        t: "ops",
        ops: [{ o: "k", i: kid(snap, 0), c: [kid(snap, 0, 0)] }],
      } as never,
    );
    expect(stillOn(stage)).toBe(true);
    stage.fire("load", sheetsIn(stage)[0]);
    flush();
    expect(stillOn(stage)).toBe(false);
  });

  test("REQ-547 a stylesheet an op adds later (another route's CSS) holds the frame still again until it loads", () => {
    const stage = stageDoc();
    const { rep, flush } = replayer(stage);
    const snap = snapshotOf(customersPage());
    rep.apply(snap);
    stage.fire("load", sheetsIn(stage)[0]);
    flush();
    expect(stillOn(stage)).toBe(false);
    rep.apply(
      {
        t: "ops",
        ops: [{
          o: "k",
          i: kid(snap, 0),
          c: [kid(snap, 0, 0), {
            i: 9_001,
            t: "link",
            a: { rel: "stylesheet", href: "/assets/dashboard.css?v=1" },
          }],
        }],
      } as never,
    );
    expect(stillOn(stage)).toBe(true);
    flush();
    expect(stillOn(stage)).toBe(true);
    const added =
      sheetsIn(stage).filter((l) =>
        (l.getAttribute("href") ?? "").endsWith("/assets/dashboard.css?v=1")
      )[0];
    stage.fire("load", added);
    flush();
    expect(stillOn(stage)).toBe(false);
  });
});

describe("REQ-547 (cycle 4, M21 + m32) — a later snapshot keeps the previous page on show until its sheets are in", () => {
  const holdMs = () => {
    const v = (replayMod as unknown as { HOLD_CAP_MS?: number }).HOLD_CAP_MS;
    if (typeof v !== "number") throw new Error("no HOLD_CAP_MS export");
    return v;
  };
  const preloadIn = (stage: FDocument, href: string) =>
    sheetsIn(stage).filter((l) =>
      (l.getAttribute("href") ?? "").endsWith(href) &&
      l.getAttribute("media") === "not all"
    )[0];

  test("REQ-547 a rejoin's snapshot with a sheet the frame does not have yet: the old page stays, the sheet is preloaded into it, and the new page goes in once it has loaded", () => {
    const stage = stageDoc();
    const { rep, flush } = replayer(stage);
    rep.apply(snapshotOf(customersPage(["/assets/dashboard.css?v=1"])));
    stage.fire("load", sheetsIn(stage)[0]);
    flush();
    const shown = stage.documentElement;

    expect(
      rep.apply(snapshotOf(customersPage(["/assets/clients.css?v=1"]))),
    ).toBe(true);
    // the previous page is still what the stage shows
    expect(stage.documentElement).toBe(shown);
    expect(rep.styled()).toBe(false);
    expect(rep.settled()).toBe(false);
    // fetched into the old page, never applied to it
    const pre = preloadIn(stage, "/assets/clients.css?v=1");
    expect(pre).toBeTruthy();
    stage.fire("load", pre);
    flush();
    // swapped in: the new page, held still until settled
    expect(stage.documentElement).not.toBe(shown);
    expect(panelIn(stage)).toBeTruthy();
    expect(stillOn(stage)).toBe(true);
    stage.fire("load", sheetsIn(stage)[0]);
    flush();
    expect(rep.settled()).toBe(true);
    expect(stillOn(stage)).toBe(false);
  });

  test("REQ-547 the page that goes in is styled at once by copies of the sheets the frame already loaded (a fresh <link> never is), until its own links are in", () => {
    const stage = stageDoc();
    const { rep, flush } = replayer(stage);
    rep.apply(snapshotOf(customersPage(["/assets/dashboard.css?v=1"])));
    stage.fire("load", sheetsIn(stage)[0]);
    flush();
    rep.apply(snapshotOf(customersPage(["/assets/clients.css?v=1"])));
    const pre = preloadIn(stage, "/assets/clients.css?v=1");
    // the preload's rules, as a same-origin sheet of a browser has them
    (pre as unknown as { sheet: unknown }).sheet = {
      cssRules: [{ cssText: ".ccard2__panel { opacity: 0; }" }],
    };
    stage.fire("load", pre);
    const adopted = () =>
      (stage as unknown as { adoptedStyleSheets: { cssText: string }[] })
        .adoptedStyleSheets.map((x) => x.cssText);
    expect(adopted().some((t) => t.includes(".ccard2__panel { opacity: 0; }")))
      .toBe(true);
    // the still rule stays last, over the copies
    expect(adopted()[adopted().length - 1]).toMatch(/transition:\s*none/);
    flush();
    expect(adopted().some((t) => t.includes(".ccard2__panel"))).toBe(true);
    stage.fire("load", sheetsIn(stage)[0]); // its own link is in
    flush();
    expect(adopted()).toEqual([]);
  });

  test("REQ-547 ops that come while a snapshot is held apply to it (nothing is lost at the swap)", () => {
    const stage = stageDoc();
    const { rep, flush } = replayer(stage);
    rep.apply(snapshotOf(customersPage(["/assets/dashboard.css?v=1"])));
    stage.fire("load", sheetsIn(stage)[0]);
    flush();
    const snap = snapshotOf(customersPage(["/assets/clients.css?v=1"]));
    rep.apply(snap);
    // html > body > article > div.ccard2__body > "Bob Smith"
    const text = kid(snap, 1, 0, 0, 0);
    expect(
      rep.apply(
        { t: "ops", ops: [{ o: "x", i: text, x: "Bob Smith Jr" }] } as never,
      ),
    ).toBe(true);
    stage.fire("load", preloadIn(stage, "/assets/clients.css?v=1"));
    flush();
    expect(stage.body?.textContent).toContain("Bob Smith Jr");
  });

  test("REQ-547 a snapshot whose sheets the frame already has goes in at once (a resync of the same page)", () => {
    const stage = stageDoc();
    const { rep, flush } = replayer(stage);
    rep.apply(snapshotOf(customersPage()));
    stage.fire("load", sheetsIn(stage)[0]);
    flush();
    const shown = stage.documentElement;
    rep.apply(snapshotOf(customersPage()));
    expect(stage.documentElement).not.toBe(shown);
  });

  test("REQ-547 a sheet that never answers holds the old page HOLD_CAP_MS at most (under the stage's STYLE_WAIT_MS)", () => {
    const stage = stageDoc();
    const { rep, flush, fire } = replayer(stage);
    rep.apply(snapshotOf(customersPage(["/assets/dashboard.css?v=1"])));
    stage.fire("load", sheetsIn(stage)[0]);
    flush();
    const shown = stage.documentElement;
    rep.apply(snapshotOf(customersPage(["/assets/clients.css?v=1"])));
    expect(stage.documentElement).toBe(shown);
    expect(holdMs()).toBeLessThan(1500);
    fire(holdMs());
    flush();
    expect(stage.documentElement).not.toBe(shown);
    expect(panelIn(stage)).toBeTruthy();
  });

  test("REQ-547 the first snapshot is never held (the stage hides the frame until it is styled, REQ-370)", () => {
    const stage = stageDoc();
    const { rep } = replayer(stage);
    const shell = stage.documentElement;
    rep.apply(snapshotOf(customersPage()));
    expect(stage.documentElement).not.toBe(shell);
  });
});
