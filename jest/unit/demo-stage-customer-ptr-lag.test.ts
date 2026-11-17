/**
 * REQ-639 — demo issue c3-M6 (backlog from cycle 3, fixed in demo-loop cycle 5): the customer's
 * pointer was drawn one row off on the stage ("2–3 días" for "4 horas", "Custom" for "50/50").
 * The customer's anchor was made on their LIVE page, and the stage placed it on a replay that
 * had not yet received the frame carrying that page (a chip row re-laid out, a scroll), so the
 * arrow landed on whatever sat at that spot in the older frame.
 *
 *   - pure (shared/demo-mode/customer-pointer.ts): `anchorFrame` — the frame number (in its page
 *     load) that carries the screen an anchor was made on: the next one to go out when the
 *     recorder holds changes not sent yet, else the last one sent; `anchorAhead` — the replay
 *     shows an older frame (or an older page load) than that: the stage holds the pointer;
 *   - the wire: a node anchor carries `f`, its frame number; the sender says how many frames it
 *     pushed; the receiver hands each frame on with its number; the recorder says whether
 *     changes are waiting to go out;
 *   - wiring: the customer's overlay stamps `f`; the stage keeps the applied frame's number and
 *     draws the customer's pointer (moves and clicks) only once that frame is in.
 */
import * as fs from "fs";
import * as path from "path";
import type { Anchor } from "../../shared/demo-mode/protocol";
import { parsePeerMessage } from "../../shared/demo-mode/protocol";
import {
  createMirrorReceiver,
  createMirrorSender,
  type MirrorFrame,
  newLoadId,
} from "../../shared/demo-mode/mirror";
import { createRecorder } from "../../front-end/lib/demo-mode/mirror-record";
import { docWith, FakeMutationObserver, h } from "./support/fake-dom";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

type Shown = { load: string | null; seq: number | null };
// looked up at run time: a missing module or export fails its own tests, not the whole file
const cp = () =>
  require("../../shared/demo-mode/customer-pointer") as {
    anchorFrame(pushed: number, waiting: boolean): number | null;
    anchorAhead(a: Anchor | null, shown: Shown): boolean;
  };

const L1 = "0000000001-aaaa";
const L2 = "0000000002-bbbb";
const at = (l: string, f?: number): Anchor => ({
  vx: 0.5,
  vy: 0.4,
  n: { id: 12, x: 0.5, y: 0.5, l, ...(f === undefined ? {} : { f }) },
});

describe("REQ-639 anchorFrame: the frame that carries the screen the customer's anchor was made on (c3-M6)", () => {
  test("changes waiting to go out: the next frame pushed carries them", () => {
    expect(cp().anchorFrame(5, true)).toBe(5);
    expect(cp().anchorFrame(0, true)).toBe(0);
  });
  test("nothing waiting: the last frame pushed already shows it", () => {
    expect(cp().anchorFrame(5, false)).toBe(4);
  });
  test("no frame pushed and none waiting: no number", () => {
    expect(cp().anchorFrame(0, false)).toBeNull();
  });
});

describe("REQ-639 anchorAhead: the stage holds the customer's pointer while its replay is older than the anchor's frame (c3-M6)", () => {
  test("same page load, the replay one frame behind: held", () => {
    expect(cp().anchorAhead(at(L1, 7), { load: L1, seq: 6 })).toBe(true);
  });
  test("released once that frame is applied, and after", () => {
    expect(cp().anchorAhead(at(L1, 7), { load: L1, seq: 7 })).toBe(false);
    expect(cp().anchorAhead(at(L1, 7), { load: L1, seq: 9 })).toBe(false);
  });
  test("a newer page load than the replay shows: held (its snapshot is not in)", () => {
    expect(cp().anchorAhead(at(L2, 0), { load: L1, seq: 40 })).toBe(true);
  });
  test("nothing shown yet: held", () => {
    expect(cp().anchorAhead(at(L1, 0), { load: null, seq: null })).toBe(true);
  });
  test("an older page load's anchor, an anchor with no frame number (an older page), a bare fraction, none: never held", () => {
    expect(cp().anchorAhead(at(L1, 3), { load: L2, seq: 0 })).toBe(false);
    expect(cp().anchorAhead(at(L1), { load: L1, seq: 0 })).toBe(false);
    expect(cp().anchorAhead({ vx: 0.1, vy: 0.2 }, { load: L1, seq: 0 }))
      .toBe(false);
    expect(cp().anchorAhead(null, { load: L1, seq: 0 })).toBe(false);
  });
});

describe("REQ-639 the wire: a node anchor carries its frame number; frames are handed on with theirs", () => {
  test("parsePeerMessage keeps n.f, drops a bad one (never the move)", () => {
    const ok = parsePeerMessage({ k: "move", a: at(L1, 4), t: 1 });
    expect(ok).toEqual({ k: "move", a: at(L1, 4), t: 1 });
    const click = parsePeerMessage({ k: "click", a: at(L1, 0) });
    expect(click).toEqual({ k: "click", a: at(L1, 0) });
    for (const bad of [-1, 1.5, "3", 2 ** 40]) {
      const m = parsePeerMessage({
        k: "move",
        a: { vx: 0.5, vy: 0.4, n: { id: 12, x: 0.5, y: 0.5, l: L1, f: bad } },
      });
      expect(m).toEqual({ k: "move", a: at(L1) });
    }
  });

  test("the sender says how many frames it pushed; the receiver hands each frame on with that same number", async () => {
    const sent: { k: string }[] = [];
    const sender = createMirrorSender({
      send: (m) => sent.push(m),
      load: L1,
    }) as ReturnType<typeof createMirrorSender> & { pushed(): number };
    expect(sender.pushed()).toBe(0);
    const snap: MirrorFrame = {
      t: "snap",
      w: 400,
      h: 800,
      u: "/q",
      root: { i: 1, t: "html" },
      ops: [],
    };
    const ops: MirrorFrame = { t: "ops", ops: [] };
    void sender.push(snap);
    void sender.push(ops);
    void sender.push(ops);
    expect(sender.pushed()).toBe(3);
    await sender.idle();
    const got: [string, number | undefined][] = [];
    const rx = createMirrorReceiver({
      onFrame: ((f: MirrorFrame, load: string, seq?: number) =>
        got.push([f.t, seq])) as (f: MirrorFrame, load: string) => void,
    });
    for (const m of [...sent].reverse()) {
      // deno-lint-ignore no-explicit-any
      if (m.k === "dom") await rx.push(m as any);
    }
    await rx.idle();
    expect(got).toEqual([["snap", 0], ["ops", 1], ["ops", 2]]);
  });

  test("end to end: an anchor made while a change waits is held on the replay until the frame with that change is handed on", async () => {
    const sent: { k: string }[] = [];
    const sender = createMirrorSender({
      send: (m) => sent.push(m),
      load: newLoadId(9),
    }) as ReturnType<typeof createMirrorSender> & { pushed(): number };
    const doc = docWith((d) =>
      h(
        d,
        "html",
        {},
        h(d, "head"),
        h(d, "body", {}, h(d, "div", { class: "chips" })),
      )
    );
    const rec = createRecorder(doc as unknown as Document, {
      emit: (f) => void sender.push(f),
      Observer: FakeMutationObserver as unknown as typeof MutationObserver,
      manual: true,
    }) as ReturnType<typeof createRecorder> & { waiting(): boolean };
    rec.snapshot();
    expect(rec.waiting()).toBe(false);
    // the chips re-laid out on the customer's screen; not sent yet
    doc.body!.appendChild(h(doc, "div", { class: "chip" }));
    expect(rec.waiting()).toBe(true);
    const f = cp().anchorFrame(sender.pushed(), rec.waiting());
    expect(f).toBe(1);
    const a = at(sender.load, f!);
    const shown: Shown = { load: null, seq: null };
    const rx = createMirrorReceiver({
      onFrame: ((_f: MirrorFrame, load: string, seq?: number) => {
        shown.load = load;
        shown.seq = seq ?? null;
      }) as (f: MirrorFrame, load: string) => void,
    });
    await sender.idle();
    // deno-lint-ignore no-explicit-any
    for (const m of sent.splice(0)) if (m.k === "dom") await rx.push(m as any);
    await rx.idle();
    expect(shown.seq).toBe(0);
    expect(cp().anchorAhead(a, shown)).toBe(true); // the replay is a frame behind
    rec.flush();
    expect(rec.waiting()).toBe(false);
    await sender.idle();
    // deno-lint-ignore no-explicit-any
    for (const m of sent.splice(0)) if (m.k === "dom") await rx.push(m as any);
    await rx.idle();
    expect(shown.seq).toBe(1);
    expect(cp().anchorAhead(a, shown)).toBe(false); // released
    rec.stop();
  });
});

describe("REQ-639 wiring: the overlay stamps the frame; the stage holds the customer's pointer until it is in", () => {
  const overlay = read("front-end/islands/DemoModeOverlay.tsx");
  const stage = read("front-end/islands/DemoStage.tsx");

  test("the customer's overlay stamps each node anchor with anchorFrame(sender.pushed(), recorder.waiting())", () => {
    expect(overlay).toMatch(
      /anchorFrame\(\s*sender\.pushed\(\),\s*recorder\.waiting\(\),?\s*\)/,
    );
  });

  test("the stage keeps the number of the frame its replay applied, with its load", () => {
    expect(stage).toMatch(/const take = \(f: MirrorFrame, load: string, seq/);
    expect(stage).toMatch(/shownSeqRef\.current = seq/);
  });

  test("showCustomer holds the pointer while anchorAhead says the replay is behind; a click goes the same way", () => {
    const show = stage.slice(
      stage.indexOf("const showCustomer = () => {"),
      stage.indexOf("const placePeer = "),
    );
    expect(show).toMatch(
      /anchorAhead\(a, \{\s*load: loadRef\.current,\s*seq: shownSeqRef\.current/,
    );
    const click = stage.slice(
      stage.indexOf('case "click": {', stage.indexOf("switch (m.k)")),
    );
    expect(click.slice(0, 400)).toMatch(
      /customerRef\.current = m\.a;\s*showCustomer\(\);/,
    );
  });
});
