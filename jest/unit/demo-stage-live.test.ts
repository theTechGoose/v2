/**
 * REQ-391 — demo-loop cycle 2, issues M4 ("the stage runs 5–15 s behind while still saying Live")
 * and m21 ("the stage takes 5–10 s to notice the customer's tab is gone; the Waiting card covers
 * page text"). RCA at demo-fixes deb85b35: "Live" meant only that a snapshot of the followed tab
 * was in the frame (REQ-309), and the 5 s presence grace (REQ-232) kept it over the OLD page while
 * a full page change reloaded — and over a closed tab for 5 s; frames carried no send time, so
 * nobody could tell how late the stage was; the waiting notice was a card in the frame's middle.
 *
 *   - the wire: a tab says WHY it goes (`leaving`: navigating | closing) and the server stamps it
 *     on that tab's `peer … online:false`; a `time` round trip gives each browser the deploy's
 *     clock; every mirror chunk carries its frame's send time (`t`) on that clock.
 *   - the mirror: the sender stamps each frame when it is pushed; the receiver measures every
 *     frame it hands on (send → handed on, and send → last chunk in: the wire alone) and keeps
 *     the last, the median and the worst.
 *   - the stage's link: "closing" ends the grace at once (waiting), "navigating" keeps it under a
 *     status of its own ("between"), a socket gone without a word gets a short grace.
 *   - the pill's words: Live only when the frame shows the followed tab's screen in time;
 *     "Loading their next page…", "Catching up…", "Behind N s" otherwise.
 *   - the customer's page knows, at pagehide, whether a page of the app comes next.
 *   - the wiring, and the words in both languages.
 */
import * as fs from "fs";
import * as path from "path";
import {
  parseClientMessage,
  parsePeerMessage,
  parseServerMessage,
  type PeerMessage,
  PRESENCE_GRACE_MS,
  SILENT_GRACE_MS,
} from "../../shared/demo-mode/protocol";
import {
  createMirrorReceiver,
  createMirrorSender,
  MIRROR_LAG_WINDOW,
  type MirrorFrame,
  newLoadId,
} from "../../shared/demo-mode/mirror";
import {
  behindSeconds,
  LAG_BEHIND_MS,
  LAG_LIVE_MS,
  stageFrameLook,
  stageStatus,
  WAITING_FILTER,
} from "../../shared/demo-mode/stage-frame";
import {
  connectDemo,
  type LinkStatus,
} from "../../front-end/lib/demo-mode/transport";
import {
  NAV_PENDING_MS,
  watchLeaveHint,
} from "../../front-end/lib/demo-mode/leave-hint";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// deno-lint-ignore no-explicit-any
type Any = any;

const snap = (n = 1): MirrorFrame => ({
  t: "snap",
  w: 420,
  h: 800,
  u: "/dashboard",
  root: {
    i: 1,
    t: "html",
    c: [{ i: 2, t: "body", c: [{ i: 3, x: `page ${n} `.repeat(40) }] }],
  },
  ops: [],
});
const ops = (text: string): MirrorFrame => ({
  t: "ops",
  ops: [{ o: "x", i: 3, x: text }],
});

describe("REQ-391 the wire: why a tab went, the deploy's clock, a frame's send time", () => {
  test("a tab's leaving parses with a known why; anything else is junk", () => {
    expect(parseClientMessage('{"t":"leaving","why":"navigating"}')).toEqual({
      t: "leaving",
      why: "navigating",
    });
    expect(parseClientMessage('{"t":"leaving","why":"closing"}')).toEqual({
      t: "leaving",
      why: "closing",
    });
    expect(parseClientMessage('{"t":"leaving","why":"bored"}')).toBeNull();
    expect(parseClientMessage('{"t":"leaving"}')).toBeNull();
  });

  test("the clock: a browser asks with its own time, the server answers with both", () => {
    expect(parseClientMessage('{"t":"time","c":1700000000000}')).toEqual({
      t: "time",
      c: 1700000000000,
    });
    expect(parseClientMessage('{"t":"time","c":"now"}')).toBeNull();
    expect(parseServerMessage('{"t":"time","c":10,"s":20}')).toEqual({
      t: "time",
      c: 10,
      s: 20,
    });
    expect(parseServerMessage('{"t":"time","c":10}')).toBeNull();
    expect(parseServerMessage('{"t":"time","s":20}')).toBeNull();
  });

  test("a tab gone says why on its presence; a bad why is dropped, and an arrival never has one", () => {
    expect(
      parseServerMessage(
        '{"t":"peer","online":false,"cid":"t1","why":"closing"}',
      ),
    ).toEqual({ t: "peer", online: false, cid: "t1", why: "closing" });
    expect(
      parseServerMessage(
        '{"t":"peer","online":false,"cid":"t1","why":"navigating"}',
      ),
    ).toEqual({ t: "peer", online: false, cid: "t1", why: "navigating" });
    expect(
      parseServerMessage('{"t":"peer","online":false,"cid":"t1","why":"x"}'),
    ).toEqual({ t: "peer", online: false, cid: "t1" });
    expect(
      parseServerMessage(
        '{"t":"peer","online":true,"cid":"t1","why":"closing"}',
      ),
    ).toEqual({ t: "peer", online: true, cid: "t1" });
  });

  test("a mirror chunk keeps its send time; a bad one is dropped, never the chunk", () => {
    const c = { k: "dom", l: "lp0q1x2-ab12", s: 3, i: 0, n: 1, d: "{}" };
    expect(parsePeerMessage({ ...c, t: 1700000000123 })).toEqual({
      ...c,
      t: 1700000000123,
    });
    for (const bad of [-1, 1.5, "soon", null, Number.POSITIVE_INFINITY]) {
      expect(parsePeerMessage({ ...c, t: bad })).toEqual(c);
    }
  });
});

describe("REQ-391 the mirror stamps every frame and the receiver measures how late it is", () => {
  test("every chunk of a frame carries the clock read when the frame was pushed — not when it was encoded", async () => {
    let clock = 5_000;
    const sent: PeerMessage[] = [];
    const sender = createMirrorSender({
      send: (m) => sent.push(m),
      load: newLoadId(1),
      chunkChars: 64,
      clock: () => clock,
    });
    void sender.push(snap()); // several chunks
    clock = 6_000;
    void sender.push(ops("one"));
    clock = 9_999; // encoding happens later: it must not show
    await sender.idle();
    const times = (s: number) =>
      sent.flatMap((m) => m.k === "dom" && m.s === s ? [m.t] : []);
    expect(times(0).length).toBeGreaterThan(1);
    expect(new Set(times(0))).toEqual(new Set([5_000]));
    expect(times(1)).toEqual([6_000]);
  });

  test("the receiver keeps the last frame's lag and, over its window, the median and the worst — of the whole path and of the wire alone (a frame held for an earlier one is late in the first, not the second)", async () => {
    let clock = 0;
    const got: MirrorFrame[] = [];
    const rx = createMirrorReceiver({
      onFrame: (f) => got.push(f),
      clock: () => clock,
    });
    expect(rx.lag()).toEqual({
      last: null,
      p50: null,
      max: null,
      netP50: null,
      netMax: null,
    });
    const L = newLoadId(9);
    const chunk = (s: number, f: MirrorFrame, t: number) => ({
      l: L,
      s,
      i: 0,
      n: 1,
      t,
      d: JSON.stringify(f),
    });
    clock = 1_050;
    await rx.push(chunk(0, snap(), 1_000)); // in at once: 50 ms
    clock = 1_250;
    await rx.push(chunk(2, ops("two"), 1_200)); // early: held for frame 1
    clock = 3_100;
    await rx.push(chunk(1, ops("one"), 1_100)); // 2 s late on the wire; frame 2 drains behind it
    await rx.idle();
    expect(got.length).toBe(3);
    const lag = rx.lag();
    expect(lag.last).toBe(1_900); // frame 2: sent at 1 200, handed on at 3 100
    expect(lag.max).toBe(2_000); // frame 1
    expect(lag.p50).toBe(1_900); // of 50, 2 000, 1 900
    expect(lag.netMax).toBe(2_000); // frame 1's wire
    expect(lag.netP50).toBe(50); // of 50, 50, 2 000: frame 2 was in on time, then held
  });

  test("a frame without a send time (a page from before REQ-391) measures nothing; a clock a little behind is never a negative lag; reset starts over", async () => {
    let clock = 10_000;
    const rx = createMirrorReceiver({ onFrame: () => {}, clock: () => clock });
    const L = newLoadId(9);
    await rx.push({ l: L, s: 0, i: 0, n: 1, d: JSON.stringify(snap()) });
    expect(rx.lag().last).toBeNull();
    await rx.push({
      l: L,
      s: 1,
      i: 0,
      n: 1,
      t: 10_400,
      d: JSON.stringify(ops("x")),
    });
    expect(rx.lag().last).toBe(0);
    clock = 12_000;
    await rx.push({
      l: L,
      s: 2,
      i: 0,
      n: 1,
      t: 11_000,
      d: JSON.stringify(ops("y")),
    });
    expect(rx.lag().last).toBe(1_000);
    rx.reset();
    expect(rx.lag()).toEqual({
      last: null,
      p50: null,
      max: null,
      netP50: null,
      netMax: null,
    });
  });

  test("the window is bounded: an old spike leaves it", async () => {
    expect(MIRROR_LAG_WINDOW).toBeGreaterThanOrEqual(50);
    expect(MIRROR_LAG_WINDOW).toBeLessThanOrEqual(1_000);
    let clock = 9_000;
    const rx = createMirrorReceiver({ onFrame: () => {}, clock: () => clock });
    const L = newLoadId(9);
    await rx.push({ l: L, s: 0, i: 0, n: 1, t: 0, d: JSON.stringify(snap()) });
    expect(rx.lag().max).toBe(9_000);
    for (let s = 1; s <= MIRROR_LAG_WINDOW; s++) {
      clock += 100;
      await rx.push({
        l: L,
        s,
        i: 0,
        n: 1,
        t: clock - 100,
        d: JSON.stringify(ops(`b${s}`)),
      });
    }
    expect(rx.lag().max).toBe(100);
    expect(rx.lag().p50).toBe(100);
  });
});

// ── a fake socket (the transport's own tests use the same shape) ─────────────────────────────
class FakeWS {
  static OPEN = 1;
  static CLOSED = 3;
  static all: FakeWS[] = [];
  readyState = 0;
  sent: Any[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeWS.all.push(this);
  }
  send(s: string) {
    this.sent.push(JSON.parse(s));
  }
  close() {
    if (this.readyState === FakeWS.CLOSED) return;
    this.readyState = FakeWS.CLOSED;
    this.onclose?.();
  }
  open() {
    this.readyState = FakeWS.OPEN;
    this.onopen?.();
  }
  recv(m: unknown) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
  of(t: string) {
    return this.sent.filter((m) => m.t === t);
  }
}

describe("REQ-391 the stage's link says why the followed tab went", () => {
  const g = globalThis as Any;
  const saved = { WebSocket: g.WebSocket, location: g.location };
  beforeEach(() => {
    FakeWS.all = [];
    g.WebSocket = FakeWS;
    Object.defineProperty(globalThis, "location", {
      value: { protocol: "http:", host: "demo.test" },
      configurable: true,
      writable: true,
    });
  });
  afterEach(() => {
    jest.useRealTimers();
    g.WebSocket = saved.WebSocket;
    Object.defineProperty(globalThis, "location", {
      value: saved.location,
      configurable: true,
      writable: true,
    });
  });

  function stage() {
    const statuses: LinkStatus[] = [];
    const followed: (string | undefined)[] = [];
    const link = connectDemo({
      sessionId: "s1",
      role: "presenter",
      pid: "hans",
      onPeer: () => {},
      onStatus: (s) => statuses.push(s),
      onPeerOnline: (cid?: string) => followed.push(cid),
      onEnded: () => {},
    });
    const ws = FakeWS.all[FakeWS.all.length - 1];
    ws.open();
    ws.recv({
      t: "welcome",
      role: "presenter",
      sessionId: "s1",
      peerOnline: false,
      pid: "hans",
      cid: "stage-1",
    });
    const tab = (cid: string, online = true, why?: string) =>
      ws.recv({ t: "peer", online, cid, ...(why ? { why } : {}) });
    return {
      link,
      ws,
      tab,
      statuses,
      followed,
      status: () => statuses[statuses.length - 1],
      since: (k: number) => statuses.slice(k),
    };
  }

  test("the tab says it is closing: waiting AT ONCE — no grace, never 'between' (m21)", () => {
    jest.useFakeTimers();
    const s = stage();
    s.tab("t1");
    expect(s.status()).toBe("relay");
    const k = s.statuses.length;
    s.tab("t1", false, "closing");
    expect(s.status()).toBe("waiting");
    expect(s.since(k)).toEqual(["waiting"]);
    s.link.close();
  });

  test("the tab says it is navigating: 'between' at once, never 'waiting' while its next page comes inside the grace (M4)", () => {
    jest.useFakeTimers();
    const s = stage();
    s.tab("t1");
    const k = s.statuses.length;
    s.tab("t1", false, "navigating");
    expect(s.status()).toBe("between");
    jest.advanceTimersByTime(PRESENCE_GRACE_MS - 500);
    expect(s.status()).toBe("between");
    s.tab("t1-next");
    expect(s.status()).toBe("relay");
    jest.advanceTimersByTime(PRESENCE_GRACE_MS * 2);
    expect(s.since(k)).toEqual(["between", "relay"]);
    s.link.close();
  });

  test("navigating, and no next page ever comes: waiting once the grace is over, not before", () => {
    jest.useFakeTimers();
    const s = stage();
    s.tab("t1");
    s.tab("t1", false, "navigating");
    jest.advanceTimersByTime(PRESENCE_GRACE_MS - 50);
    expect(s.status()).toBe("between");
    jest.advanceTimersByTime(100);
    expect(s.status()).toBe("waiting");
    s.link.close();
  });

  test("a socket gone without a word (a crash, a lost network, a page from before REQ-391): a short grace — waiting after SILENT_GRACE_MS, long before PRESENCE_GRACE_MS", () => {
    jest.useFakeTimers();
    expect(SILENT_GRACE_MS).toBeGreaterThanOrEqual(1_000);
    expect(SILENT_GRACE_MS).toBeLessThanOrEqual(2_500);
    const s = stage();
    s.tab("t1");
    s.tab("t1", false);
    expect(s.status()).toBe("between");
    jest.advanceTimersByTime(SILENT_GRACE_MS - 100);
    expect(s.status()).toBe("between");
    jest.advanceTimersByTime(200);
    expect(s.status()).toBe("waiting");
    s.link.close();
  });

  test("another of the customer's tabs is still there: no grace at all — the stage follows it and stays live", () => {
    jest.useFakeTimers();
    const s = stage();
    s.tab("t1");
    s.tab("t2");
    s.ws.recv({ t: "claim", cid: "t2", at: 200 });
    const k = s.statuses.length;
    s.tab("t2", false, "closing");
    expect(s.followed[s.followed.length - 1]).toBe("t1");
    expect(s.since(k)).toEqual([]);
    expect(s.status()).toBe("relay");
    s.link.close();
  });

  test("the deploy's clock: after the welcome the link asks the time; the answer, halfway through the round trip, sets now()", () => {
    jest.useFakeTimers();
    jest.setSystemTime(10_000);
    const s = stage();
    expect(s.ws.of("time")).toEqual([{ t: "time", c: 10_000 }]);
    expect(s.link.now()).toBe(10_000); // no answer yet: this browser's own clock
    jest.advanceTimersByTime(200);
    s.ws.recv({ t: "time", c: 10_000, s: 60_000 });
    expect(s.link.now()).toBe(60_100);
    jest.advanceTimersByTime(1_000);
    expect(s.link.now()).toBe(61_100);
    // a slower round trip says less: it never replaces a better one
    s.ws.recv({ t: "time", c: 9_000, s: 99_000 });
    expect(s.link.now()).toBe(61_100);
    s.link.close();
  });

  test("the customer's side says why it goes on its socket", () => {
    const link = connectDemo({
      sessionId: "s1",
      role: "viewer",
      onPeer: () => {},
      onStatus: () => {},
      onPeerOnline: () => {},
      onEnded: () => {},
    });
    const ws = FakeWS.all[FakeWS.all.length - 1];
    ws.open();
    ws.recv({
      t: "welcome",
      role: "viewer",
      sessionId: "s1",
      peerOnline: false,
      cid: "t1",
    });
    link.leaving("navigating");
    link.leaving("closing");
    expect(ws.of("leaving")).toEqual([
      { t: "leaving", why: "navigating" },
      { t: "leaving", why: "closing" },
    ]);
    link.close();
  });
});

describe("REQ-391 the pill's words: Live only when the frame shows the followed tab's screen in time", () => {
  const base = {
    ended: false,
    status: "relay" as const,
    mirrored: true,
    awaiting: false,
    resyncing: false,
    behind: 0,
  };

  test("the link's own states keep their words", () => {
    expect(stageStatus({ ...base, ended: true })).toEqual({ key: "ended" });
    expect(stageStatus({ ...base, status: "ended" })).toEqual({ key: "ended" });
    expect(stageStatus({ ...base, status: "replaced" })).toEqual({
      key: "elsewhere",
    });
    expect(stageStatus({ ...base, status: "waiting" })).toEqual({
      key: "waiting",
    });
    for (const status of ["connecting", "closed"] as const) {
      expect(stageStatus({ ...base, status })).toEqual({ key: "connecting" });
    }
    // REQ-309 — no snapshot in the frame yet: connecting, whatever else is true
    expect(stageStatus({ ...base, mirrored: false })).toEqual({
      key: "connecting",
    });
  });

  test("their page went and the next may come ('between'): Loading their next page… over the old screen", () => {
    expect(stageStatus({ ...base, status: "between" })).toEqual({
      key: "loadingNext",
    });
    expect(stageStatus({ ...base, status: "between", mirrored: false }))
      .toEqual({ key: "connecting" });
  });

  test("a new tab or page is followed but its snapshot is not in yet: Loading their next page…, never Live", () => {
    expect(stageStatus({ ...base, awaiting: true })).toEqual({
      key: "loadingNext",
    });
    expect(stageStatus({ ...base, status: "direct", awaiting: true })).toEqual(
      { key: "loadingNext" },
    );
  });

  test("a resync asked and not in: Catching up…; frames arriving late: Behind N s; otherwise Live", () => {
    expect(stageStatus({ ...base, resyncing: true })).toEqual({
      key: "catchingUp",
    });
    expect(stageStatus({ ...base, behind: 3 })).toEqual({
      key: "behind",
      n: 3,
    });
    expect(stageStatus(base)).toEqual({ key: "live" });
    expect(stageStatus({ ...base, status: "direct" })).toEqual({ key: "live" });
    // what is most wrong is said first
    expect(stageStatus({ ...base, awaiting: true, resyncing: true, behind: 4 }))
      .toEqual({ key: "loadingNext" });
    expect(stageStatus({ ...base, resyncing: true, behind: 4 })).toEqual({
      key: "catchingUp",
    });
  });

  test("behind: over LAG_BEHIND_MS it says so in whole seconds; it stays until frames come within LAG_LIVE_MS (no flicker at the edge)", () => {
    expect(LAG_BEHIND_MS).toBe(1_500);
    expect(LAG_LIVE_MS).toBeLessThan(LAG_BEHIND_MS);
    expect(behindSeconds(null, 0)).toBe(0);
    expect(behindSeconds(null, 3)).toBe(0); // nothing measured (a new tab): not behind
    expect(behindSeconds(1_400, 0)).toBe(0);
    expect(behindSeconds(1_600, 0)).toBe(2);
    expect(behindSeconds(3_400, 0)).toBe(3);
    expect(behindSeconds(7_600, 2)).toBe(8); // pair 7's 7.6 s
    expect(behindSeconds(1_200, 2)).toBe(2); // between the two edges: as it was
    expect(behindSeconds(1_200, 0)).toBe(0);
    expect(behindSeconds(900, 2)).toBe(0);
  });

  test("the frame between pages: as it is (the pill says it), unless it is already the stale screen — then still dimmed under the banner", () => {
    expect(stageFrameLook({
      status: "between",
      mirrored: true,
      stale: false,
      styled: true,
    }))
      .toEqual({ visibility: "visible", filter: "none", waiting: false });
    expect(stageFrameLook({
      status: "between",
      mirrored: true,
      stale: true,
      styled: true,
    }))
      .toEqual({
        visibility: "visible",
        filter: WAITING_FILTER,
        waiting: true,
      });
  });
});

/** a minimal event target: what the hint listens on (the window, its navigation) */
function target() {
  const ls = new Map<string, Set<(e: Any) => void>>();
  return {
    addEventListener(t: string, f: (e: Any) => void) {
      if (!ls.has(t)) ls.set(t, new Set());
      ls.get(t)!.add(f);
    },
    removeEventListener(t: string, f: (e: Any) => void) {
      ls.get(t)?.delete(f);
    },
    fire(t: string, e: Any = {}) {
      for (const f of [...(ls.get(t) ?? [])]) f({ type: t, ...e });
    },
    count: () => [...ls.values()].reduce((n, s) => n + s.size, 0),
  };
}

describe("REQ-391 the customer's page knows, at pagehide, whether a page of the app comes next", () => {
  const href = "https://app.test/dashboard";
  const host = (nav = true) => {
    const win = target();
    const navigation = nav ? target() : undefined;
    let now = 1_000;
    const hint = watchLeaveHint(
      {
        location: { href, origin: "https://app.test" },
        navigation,
        addEventListener: win.addEventListener,
        removeEventListener: win.removeEventListener,
      },
      () => now,
    );
    return {
      hint,
      win,
      navigation: navigation!,
      tick: (ms: number) => (now += ms),
    };
  };
  const dest = (url: string, sameDocument = false) => ({
    destination: { url, sameDocument },
    downloadRequest: null,
  });

  test("nothing seen: closing", () => {
    expect(host().hint.why()).toBe("closing");
  });

  test("the Navigation API: a navigation to another page of this app (a link, location.href, a reload, a history step) — navigating", () => {
    for (
      const url of [
        "https://app.test/customers",
        "https://app.test/assistant/7729d42b",
        "https://app.test/dashboard", // a reload
      ]
    ) {
      const h = host();
      h.navigation.fire("navigate", dest(url));
      expect(h.hint.why()).toBe("navigating");
    }
  });

  test("…but not one that stays in this document, leaves the app's origin, or is a download; a failed navigation is forgotten, and so is a stale one", () => {
    const same = host();
    same.navigation.fire(
      "navigate",
      dest("https://app.test/dashboard#x", true),
    );
    expect(same.hint.why()).toBe("closing");
    const away = host();
    away.navigation.fire("navigate", dest("https://elsewhere.test/"));
    expect(away.hint.why()).toBe("closing");
    const blank = host();
    blank.navigation.fire("navigate", dest("about:blank"));
    expect(blank.hint.why()).toBe("closing");
    const dl = host();
    dl.navigation.fire("navigate", {
      ...dest("https://app.test/invoice.pdf"),
      downloadRequest: "invoice.pdf",
    });
    expect(dl.hint.why()).toBe("closing");
    const failed = host();
    failed.navigation.fire("navigate", dest("https://app.test/customers"));
    failed.navigation.fire("navigateerror");
    expect(failed.hint.why()).toBe("closing");
    const stale = host();
    stale.navigation.fire("navigate", dest("https://app.test/customers"));
    stale.tick(NAV_PENDING_MS + 1);
    expect(stale.hint.why()).toBe("closing");
  });

  test("without the Navigation API: a plain click on a link to another page of the app, or a form sent, says navigating — a click the app routed itself, a new-tab click, a hash link or a link away does not", () => {
    const link = (a: Partial<Record<string, unknown>>) => {
      const el = {
        href: "https://app.test/customers",
        target: "",
        hasAttribute: (n: string) => n === "download" && !!a.download,
        ...a,
      };
      return { closest: (sel: string) => sel.includes("a[") ? el : null };
    };
    const click = (a: Partial<Record<string, unknown>>, e: Any = {}) => ({
      target: link(a),
      button: 0,
      defaultPrevented: false,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      ...e,
    });
    const plain = host(false);
    plain.win.fire("click", click({}));
    expect(plain.hint.why()).toBe("navigating");
    for (
      const [a, e] of [
        [{}, { defaultPrevented: true }],
        [{}, { metaKey: true }],
        [{}, { ctrlKey: true }],
        [{}, { button: 1 }],
        [{ target: "_blank" }, {}],
        [{ download: true }, {}],
        [{ href: "https://app.test/dashboard#help" }, {}],
        [{ href: "https://elsewhere.test/" }, {}],
      ] as [Record<string, unknown>, Any][]
    ) {
      const h = host(false);
      h.win.fire("click", click(a, e));
      expect({ a, e, why: h.hint.why() }).toEqual({ a, e, why: "closing" });
    }
    const form = host(false);
    form.win.fire("submit", {
      defaultPrevented: false,
      target: { action: "https://app.test/settings", target: "" },
    });
    expect(form.hint.why()).toBe("navigating");
    const routed = host(false);
    routed.win.fire("submit", {
      defaultPrevented: true,
      target: { action: "https://app.test/settings", target: "" },
    });
    expect(routed.hint.why()).toBe("closing");
  });

  test("a reload from the keyboard (F5, Ctrl+R, Cmd+R) says navigating: this page comes back", () => {
    for (
      const k of [
        { key: "F5" },
        { key: "r", ctrlKey: true },
        { key: "R", metaKey: true },
      ]
    ) {
      const h = host();
      h.win.fire("keydown", k);
      expect(h.hint.why()).toBe("navigating");
    }
    const typing = host();
    typing.win.fire("keydown", { key: "r" });
    expect(typing.hint.why()).toBe("closing");
  });

  test("stop() lets go of every listener", () => {
    const h = host();
    expect(h.win.count() + h.navigation.count()).toBeGreaterThan(0);
    h.hint.stop();
    expect(h.win.count() + h.navigation.count()).toBe(0);
  });
});

describe("REQ-391 the wiring", () => {
  const stageSrc = read("front-end/islands/DemoStage.tsx");
  const overlay = read("front-end/islands/DemoModeOverlay.tsx");
  const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
  const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

  test("the stage's pill words come from stageStatus, fed by the frame, the follow switch, the resync and the measured lag", () => {
    expect(stageSrc).toMatch(/stageStatus\(\{/);
    expect(stageSrc).toMatch(/mirrored: !!mirrored/);
    expect(stageSrc).toContain('t("demoMode.loadingNext")');
    expect(stageSrc).toContain('t("demoMode.catchingUp")');
    expect(stageSrc).toMatch(/t\("demoMode\.behind", \{ n: /);
    // the follow switch waits for the new tab's snapshot; a snapshot ends the wait
    const online = stageSrc.slice(stageSrc.indexOf("onPeerOnline:"));
    expect(online.slice(0, online.indexOf("},") + 2)).toMatch(
      /setAwaiting\(true\)/,
    );
    const snapBranch = stageSrc.slice(
      stageSrc.indexOf('if (f.t === "snap") {'),
      stageSrc.indexOf("const onFrameLoad"),
    );
    expect(snapBranch).toMatch(/setAwaiting\(false\)/);
    // the receiver reads the deploy's clock; the stall tick reads the lag
    const rxMade = stageSrc.slice(stageSrc.indexOf("createMirrorReceiver("));
    expect(rxMade.slice(0, rxMade.indexOf("\n    });"))).toMatch(
      /clock: \(\) => linkRef\.current\?\.now\(\) \?\? Date\.now\(\)/,
    );
    expect(stageSrc).toMatch(/rx\.lag\(\)/);
    expect(stageSrc).toMatch(/behindSeconds\(/);
  });

  test("in dev the chip shows the lag: the median and the worst, the whole path and the wire", () => {
    const fn = stageSrc.slice(stageSrc.indexOf("function mirrorStatsText("));
    expect(fn.slice(0, fn.indexOf("\n}"))).toMatch(/lag/);
    expect(fn.slice(0, fn.indexOf("\n}"))).toMatch(/net/);
  });

  test("m21 — the waiting notice is a banner across the frame's top edge, not a card in its middle", () => {
    const start = stageSrc.indexOf('data-cy="demo-waiting"');
    expect(start).toBeGreaterThan(-1);
    const block = stageSrc.slice(
      stageSrc.lastIndexOf("{look.waiting &&", start),
      stageSrc.indexOf("</div>\n            )}", start),
    );
    expect(block).not.toMatch(/place-items:center/);
    expect(block).not.toMatch(/\$\{box\}/); // never the whole frame's box
    expect(block).toMatch(/top:\$\{\s*fit\.top - bannerH\s*\}px/);
    expect(block).toMatch(/width:\$\{\s*fit\.width\s*\}px/);
    expect(block).toMatch(/pointer-events:none/);
    expect(block).toContain('t("demoMode.waitingFor", { name })');
    expect(block).toContain('t("demoMode.waitingKeep")');
  });

  test("the customer's overlay stamps its frames with the deploy's clock and says why its page goes, before the pointer's leave", () => {
    const made = overlay.slice(overlay.indexOf("createMirrorSender("));
    expect(made.slice(0, made.indexOf("});"))).toMatch(
      /clock: \(\) => link\?\.now\(\) \?\? Date\.now\(\)/,
    );
    expect(overlay).toMatch(/watchLeaveHint\(/);
    const hide = overlay.slice(overlay.indexOf("const onHide = () =>"));
    const body = hide.slice(0, hide.indexOf("};") + 2);
    expect(body).toMatch(/link\?\.leaving\(hint\.why\(\)\)/);
    expect(body.indexOf("leaving(")).toBeLessThan(body.indexOf('k: "leave"'));
    expect(overlay).toMatch(/hint\.stop\(\)/);
  });

  test("the words, in both languages: plain, distinct, no transport jargon", () => {
    for (const k of ["loadingNext", "catchingUp", "behind"]) {
      expect(typeof en[`demoMode.${k}`]).toBe("string");
      expect(typeof es[`demoMode.${k}`]).toBe("string");
      expect(en[`demoMode.${k}`]).not.toBe(es[`demoMode.${k}`]);
      for (const d of [en, es]) {
        expect(d[`demoMode.${k}`]).not.toMatch(
          /accept|acept|\bdirect|\brelay|relevo|\blag\b/i,
        );
      }
    }
    expect(en["demoMode.loadingNext"]).toBe("Loading their next page…");
    expect(en["demoMode.catchingUp"]).toBe("Catching up…");
    expect(en["demoMode.behind"]).toBe("Behind {n} s");
    expect(es["demoMode.behind"]).toContain("{n}");
  });
});
