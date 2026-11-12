/**
 * REQ-242 — demo mode's stage is a live mirror of the customer's actual screen. The pure half:
 * what rides the wire (`dom` chunks, `resync`, a pointer anchored to a mirrored node), how a frame
 * is cut into chunks and put back together in any order, how frames are applied strictly in order
 * (a gap is held, then stalls into a resync; a snapshot starts over; an older page load is
 * dropped), the gzip codec, and where the pointer's name tag goes inside a box.
 */
import {
  MIRROR_CHUNK_CHARS,
  MIRROR_MAX_CHUNKS,
  parseClientMessage,
  parsePeerMessage,
  type PeerMessage,
} from "../../shared/demo-mode/protocol";
import {
  ChunkAssembler,
  chunkText,
  createMirrorReceiver,
  createMirrorSender,
  decodeFrame,
  encodeFrame,
  FrameSequencer,
  MIRROR_GAP_MS,
  MIRROR_GZIP_OVER,
  type MirrorFrame,
  newLoadId,
  parseMirrorFrame,
} from "../../shared/demo-mode/mirror";
import {
  ARROW_IDLE_MS,
  TAG_IDLE_MS,
  tagPlacement,
} from "../../shared/demo-mode/motion";

const snap = (n = 1): MirrorFrame => ({
  t: "snap",
  w: 420,
  h: 800,
  u: "/assistant",
  root: {
    i: 1,
    t: "html",
    c: [{ i: 2, t: "head" }, {
      i: 3,
      t: "body",
      c: [{ i: 4, x: `hello ${n}` }],
    }],
  },
  ops: [{ o: "s", i: 0, x: 0, y: 12 }],
});
const ops = (x: string): MirrorFrame => ({
  t: "ops",
  ops: [{ o: "x", i: 4, x }],
});

describe("REQ-242 the wire: dom chunks, resync, and the node anchor", () => {
  test("a dom chunk parses with its load id, sequence, index, count, gzip flag and text; junk is dropped", () => {
    const m = { k: "dom", l: "lp0q1x2-ab12", s: 3, i: 1, n: 4, z: 1, d: "abc" };
    expect(parsePeerMessage(m)).toEqual(m);
    expect(parsePeerMessage({ ...m, z: undefined })).toEqual({
      k: "dom",
      l: "lp0q1x2-ab12",
      s: 3,
      i: 1,
      n: 4,
      d: "abc",
    });
    expect(parsePeerMessage({ ...m, extra: "x" })).toEqual(m);
    for (
      const bad of [
        { ...m, l: "" },
        { ...m, l: "has space" },
        { ...m, l: "x".repeat(65) },
        { ...m, s: -1 },
        { ...m, s: 1.5 },
        { ...m, i: 4 }, // i < n
        { ...m, n: 0 },
        { ...m, n: MIRROR_MAX_CHUNKS + 1, i: 0 },
        { ...m, d: 7 },
        { ...m, d: "" },
        { ...m, d: "x".repeat(MIRROR_CHUNK_CHARS + 1) },
        { ...m, z: 2 },
      ]
    ) {
      expect({ bad, parsed: parsePeerMessage(bad) }).toEqual({
        bad,
        parsed: null,
      });
    }
    // the relay carries it as any other peer message (the backend parses with the same code)
    expect(parseClientMessage(JSON.stringify({ t: "relay", data: m })))
      .toEqual({ t: "relay", data: m });
  });

  test("resync is bare; the old view patch is gone", () => {
    expect(parsePeerMessage({ k: "resync", junk: 1 })).toEqual({
      k: "resync",
    });
    expect(parsePeerMessage({ k: "view", v: { path: "/customers" } }))
      .toBeNull();
  });

  test("a move or click may carry the mirrored node under it: its id and the point's fraction of its box, clamped", () => {
    expect(
      parsePeerMessage({
        k: "move",
        a: { vx: 0.25, vy: 0.5, n: { id: 42, x: 0.5, y: 1.4 } },
        t: 9,
      }),
    ).toEqual({
      k: "move",
      a: { vx: 0.25, vy: 0.5, n: { id: 42, x: 0.5, y: 1 } },
      t: 9,
    });
    expect(
      parsePeerMessage({
        k: "click",
        a: { vx: 2, vy: 0.1, n: { id: 3, x: -1, y: 0.2 } },
      }),
    ).toEqual({
      k: "click",
      a: { vx: 1, vy: 0.1, n: { id: 3, x: 0, y: 0.2 } },
    });
    // a bad node anchor is dropped, the fraction stays
    for (
      const n of [{ id: 0, x: 0, y: 0 }, { id: 1.5, x: 0, y: 0 }, {
        id: 2,
        x: "a",
        y: 0,
      }, "x"]
    ) {
      expect(parsePeerMessage({ k: "move", a: { vx: 0.1, vy: 0.2, n } }))
        .toEqual({ k: "move", a: { vx: 0.1, vy: 0.2 } });
    }
  });
});

describe("REQ-242 chunks", () => {
  test("a text is cut into pieces of at most the chunk size and joins back to itself", () => {
    const text = "é😀x".repeat(20_000); // multi-unit characters across the cuts
    const parts = chunkText(text, 1000);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length > 0 && p.length <= 1000)).toBe(true);
    expect(parts.join("")).toBe(text);
    // no piece ends half way through a surrogate pair (each piece is valid on its own)
    expect(parts.every((p) => !/[\ud800-\udbff]$/.test(p))).toBe(true);
    expect(chunkText("short", 1000)).toEqual(["short"]);
  });

  test("the assembler puts a frame back together from chunks in any order, two frames interleaved; a duplicate changes nothing", () => {
    const asm = new ChunkAssembler();
    const a = chunkText("A".repeat(50) + "end-a", 10);
    const b = chunkText("B".repeat(25) + "end-b", 10);
    const msgs = [
      ...a.map((d, i) => ({ l: "L1", s: 1, i, n: a.length, d })),
      ...b.map((d, i) => ({ l: "L1", s: 2, i, n: b.length, z: 1 as const, d })),
    ];
    // a deterministic shuffle
    const order = msgs.map((m, k) => ({ m, k: (k * 7919) % 101 })).sort((
      x,
      y,
    ) => x.k - y.k).map((x) => x.m);
    const done: { l: string; s: number; z: boolean; text: string }[] = [];
    for (const m of order) {
      const r = asm.push(m);
      if (r) done.push(r);
      expect(asm.push(m)).toBeNull(); // the same chunk again: nothing new
    }
    expect(done.sort((x, y) => x.s - y.s)).toEqual([
      { l: "L1", s: 1, z: false, text: "A".repeat(50) + "end-a" },
      { l: "L1", s: 2, z: true, text: "B".repeat(25) + "end-b" },
    ]);
  });
});

describe("REQ-242 frames in order", () => {
  const clock = () => {
    let t = 1000;
    return { now: () => t, tick: (ms: number) => (t += ms) };
  };

  test("a snapshot, then ops in sequence; an early op is held until the missing one comes", () => {
    const c = clock();
    const q = new FrameSequencer({ gapMs: MIRROR_GAP_MS, now: c.now });
    const L = newLoadId(1_000);
    expect(q.push(L, 0, snap())).toEqual([snap()]);
    expect(q.push(L, 1, ops("a"))).toEqual([ops("a")]);
    expect(q.push(L, 3, ops("c"))).toEqual([]); // 2 is missing
    expect(q.stalled()).toBe(false);
    expect(q.push(L, 2, ops("b"))).toEqual([ops("b"), ops("c")]);
    expect(q.push(L, 2, ops("b"))).toEqual([]); // a duplicate
    expect(q.stalled()).toBe(false);
  });

  test("a gap that lasts MIRROR_GAP_MS stalls (the stage asks for a snapshot); the new snapshot jumps over it", () => {
    const c = clock();
    const q = new FrameSequencer({ gapMs: MIRROR_GAP_MS, now: c.now });
    const L = newLoadId(1_000);
    q.push(L, 0, snap(1));
    expect(q.push(L, 2, ops("lost-1-before-me"))).toEqual([]);
    c.tick(MIRROR_GAP_MS - 1);
    expect(q.stalled()).toBe(false);
    c.tick(2);
    expect(q.stalled()).toBe(true);
    // the resync's snapshot: same load, a later sequence — applied, and the held op before it dropped
    expect(q.push(L, 5, snap(2))).toEqual([snap(2)]);
    expect(q.stalled()).toBe(false);
    expect(q.push(L, 6, ops("next"))).toEqual([ops("next")]);
    // an older snapshot of the same load, arriving late, is stale
    expect(q.push(L, 4, snap(3))).toEqual([]);
  });

  test("a new page load starts over at its snapshot; its ops wait for it; the older load's late frames are dropped", () => {
    const q = new FrameSequencer({ gapMs: MIRROR_GAP_MS, now: () => 0 });
    const old = newLoadId(1_000);
    const fresh = newLoadId(2_000);
    expect(fresh > old).toBe(true); // load ids sort by when the page loaded
    q.push(old, 0, snap(1));
    q.push(old, 1, ops("old-1"));
    // the reloaded page's ops overtook its snapshot
    expect(q.push(fresh, 1, ops("new-1"))).toEqual([]);
    expect(q.push(fresh, 0, snap(2))).toEqual([snap(2), ops("new-1")]);
    expect(q.push(old, 2, ops("old-2"))).toEqual([]);
    expect(q.push(old, 3, snap(9))).toEqual([]);
  });

  test("ops of a load whose snapshot never came stall too", () => {
    const c = clock();
    const q = new FrameSequencer({ gapMs: MIRROR_GAP_MS, now: c.now });
    expect(q.push(newLoadId(5), 3, ops("orphan"))).toEqual([]);
    c.tick(MIRROR_GAP_MS + 1);
    expect(q.stalled()).toBe(true);
  });
});

describe("REQ-242 the codec and the two ends", () => {
  test("a frame over MIRROR_GZIP_OVER is gzipped and base64'd; a small one goes plain; both decode to the same frame", async () => {
    const big: MirrorFrame = {
      t: "ops",
      ops: Array.from(
        { length: 400 },
        (_, i) => ({ o: "x" as const, i: i + 1, x: `bubble ${i} — ¿qué tal?` }),
      ),
    };
    const z = await encodeFrame(big);
    expect(JSON.stringify(big).length).toBeGreaterThan(MIRROR_GZIP_OVER);
    expect(z.z).toBe(true);
    expect(z.text).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(z.text.length).toBeLessThan(JSON.stringify(big).length / 3);
    expect(await decodeFrame(z.text, true)).toEqual(big);
    const small = await encodeFrame(ops("hi"));
    expect(small.z).toBe(false);
    expect(await decodeFrame(small.text, false)).toEqual(ops("hi"));
    expect(await decodeFrame("not json", false)).toBeNull();
    expect(await decodeFrame("bm90IGd6aXA=", true)).toBeNull();
  });

  test("parseMirrorFrame keeps a well-formed frame and refuses junk", () => {
    expect(parseMirrorFrame(snap())).toEqual(snap());
    expect(parseMirrorFrame(ops("x"))).toEqual(ops("x"));
    for (
      const bad of [
        null,
        { t: "nope" },
        { t: "ops" },
        { t: "ops", ops: [{ o: "zz" }] },
        { t: "ops", ops: [{ o: "k", i: 1, c: [{ i: -1, t: "div" }] }] },
        { t: "ops", ops: [{ o: "a", i: 1, n: "on click", v: "x" }] },
        {
          t: "snap",
          w: 0,
          h: 800,
          u: "/x",
          root: { i: 1, t: "html" },
          ops: [],
        },
        {
          t: "snap",
          w: 400,
          h: 800,
          u: "/x",
          root: { i: 1, t: "<html>" },
          ops: [],
        },
      ]
    ) {
      expect({ bad, parsed: parseMirrorFrame(bad) }).toEqual({
        bad,
        parsed: null,
      });
    }
  });

  test("the sender numbers frames per page load and sends them as dom chunks; the receiver hands back the frames in order", async () => {
    const sent: PeerMessage[] = [];
    const sender = createMirrorSender({
      send: (m) => sent.push(m),
      load: newLoadId(7),
      chunkChars: 64,
    });
    const frames = [snap(), ops("one"), ops("two")];
    for (const f of frames) void sender.push(f);
    await sender.idle();
    expect(sent.every((m) => m.k === "dom")).toBe(true);
    expect(new Set(sent.map((m) => (m as { s: number }).s))).toEqual(
      new Set([0, 1, 2]),
    );
    expect(sent.length).toBeGreaterThan(3); // the snapshot took several chunks
    // reversed on the way: the receiver still applies them in order
    const got: MirrorFrame[] = [];
    const rx = createMirrorReceiver({ onFrame: (f) => got.push(f) });
    for (const m of [...sent].reverse()) {
      if (m.k === "dom") await rx.push(m);
    }
    await rx.idle();
    expect(got).toEqual(frames);
    expect(rx.stalled()).toBe(false);
  });
});

describe("REQ-242 the pointer's name tag stays inside its box and rests when idle", () => {
  const box = { left: 100, top: 50, width: 400, height: 300 };
  const tag = { w: 90, h: 22 };
  test("right of the arrow and below it, unless that runs past the box's right or bottom edge", () => {
    expect(tagPlacement({ x: 200, y: 100 }, box, tag)).toEqual({
      left: false,
      up: false,
    });
    // near the frame's right edge (not the window's): the tag flips to the left
    expect(tagPlacement({ x: 450, y: 100 }, box, tag)).toEqual({
      left: true,
      up: false,
    });
    // near the bottom: above the arrow
    expect(tagPlacement({ x: 200, y: 330 }, box, tag)).toEqual({
      left: false,
      up: true,
    });
  });
  test("the tag fades first, the arrow dims later", () => {
    expect(TAG_IDLE_MS).toBe(1_500);
    expect(ARROW_IDLE_MS).toBeGreaterThan(TAG_IDLE_MS);
  });
});
