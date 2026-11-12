/**
 * REQ-393 — demo issues M2 and M8 (demo-loop cycle 2): the presenter's pointer is the spot under
 * his mouse, wherever it is on the stage.
 *
 *   - the wire: an anchor OFF the shared screen (`o: 1` — his mouse beside the phone frame) and a
 *     relay for ONE customer tab (`tab: <cid>`) parse; junk is dropped; `sameAnchor` tells an off
 *     anchor from one on the screen;
 *   - `outsideBox`, and `placeIn(…, off)`: an off anchor is drawn on the edge, marked outside;
 *   - the cursor hand-off: a stage opened under a still mouse gets no pointer event at all, so the
 *     page that opens it hands the last pointer position over (taken once, fresh only);
 *   - the transport: the tab the stage leaves hears `leave`, addressed to it; every presenter relay
 *     goes to the tab the stage follows (the hub used to hand it to every tab);
 *   - the stage's and the overlay's wiring: the resting pointer is looked up again on EVERY layout
 *     pass (no settle window), the mouse is followed document-wide (only leaving the window is a
 *     `leave`), off the frame it is an off anchor, the stage says so and outlines the frame.
 */
import * as fs from "fs";
import * as path from "path";
import * as motion from "../../shared/demo-mode/motion";
import * as protocol from "../../shared/demo-mode/protocol";
import type {
  Anchor,
  PeerMessage,
  Role,
} from "../../shared/demo-mode/protocol";
import {
  connectDemo,
  type LinkStatus,
  type PeerFrom,
} from "../../front-end/lib/demo-mode/transport";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// deno-lint-ignore no-explicit-any
type Any = any;
type Pt = { x: number; y: number };
type Box = { left: number; top: number; width: number; height: number };

// looked up at run time: a missing export (or module) fails its own tests, not the whole file
const m = motion as unknown as {
  outsideBox(p: Pt, b: Box): boolean;
  placeIn(
    p: Pt,
    b: Box,
    a?: { w: number; h: number },
    off?: boolean,
  ): { at: Pt; outside: boolean };
  ARROW_BOX: { w: number; h: number };
};
const handoff = () =>
  require("../../front-end/lib/demo-mode/cursor-handoff") as {
    CURSOR_KEY: string;
    CURSOR_HANDOFF_MS: number;
    handCursor(store: unknown, p: Pt | null, now?: number): void;
    takeCursor(store: unknown, now?: number): Pt | null;
  };

describe("REQ-393 the wire: an anchor off the shared screen, and a relay for one customer tab", () => {
  test("an off anchor (o: 1) parses on a move and a click; it never names a node; any other `o` is dropped", () => {
    expect(
      protocol.parsePeerMessage({
        k: "move",
        a: { vx: 0, vy: 0.4, o: 1 },
        t: 5,
      }),
    ).toEqual({ k: "move", a: { vx: 0, vy: 0.4, o: 1 }, t: 5 });
    expect(
      protocol.parsePeerMessage({ k: "click", a: { vx: 1, vy: 0.5, o: 1 } }),
    ).toEqual({ k: "click", a: { vx: 1, vy: 0.5, o: 1 } });
    // off the screen: no element of it is pointed at
    expect(
      protocol.parsePeerMessage({
        k: "move",
        a: { vx: 1, vy: 0.5, o: 1, n: { id: 3, x: 0.5, y: 0.5, l: "L1" } },
      }),
    ).toEqual({ k: "move", a: { vx: 1, vy: 0.5, o: 1 } });
    for (const o of [2, true, "1", 0]) {
      expect(
        protocol.parsePeerMessage({ k: "move", a: { vx: 0.2, vy: 0.3, o } }),
      ).toEqual({ k: "move", a: { vx: 0.2, vy: 0.3 } });
    }
  });

  test("sameAnchor: an off anchor is never the same place as one on the screen at the same fraction", () => {
    const off: Anchor = { vx: 0, vy: 0.5, o: 1 } as Anchor;
    expect(protocol.sameAnchor(off, { vx: 0, vy: 0.5 })).toBe(false);
    expect(protocol.sameAnchor({ vx: 0, vy: 0.5 }, off)).toBe(false);
    expect(protocol.sameAnchor(off, { vx: 0, vy: 0.5, o: 1 } as Anchor))
      .toBe(true);
    expect(protocol.sameAnchor(off, { vx: 0, vy: 0.6, o: 1 } as Anchor))
      .toBe(false);
  });

  test("a client relay may name ONE customer tab (`tab`: its cid); a tab that is not a string is dropped; `to: presenters` wins", () => {
    expect(
      protocol.parseClientMessage(
        '{"t":"relay","data":{"k":"leave"},"tab":"c1"}',
      ),
    ).toEqual({ t: "relay", data: { k: "leave" }, tab: "c1" });
    expect(
      protocol.parseClientMessage('{"t":"relay","data":{"k":"leave"},"tab":7}'),
    ).toEqual({ t: "relay", data: { k: "leave" } });
    expect(
      protocol.parseClientMessage(
        '{"t":"relay","data":{"k":"leave"},"tab":""}',
      ),
    ).toEqual({ t: "relay", data: { k: "leave" } });
    expect(
      protocol.parseClientMessage(
        '{"t":"relay","data":{"k":"leave"},"to":"presenters","tab":"c1"}',
      ),
    ).toEqual({ t: "relay", data: { k: "leave" }, to: "presenters" });
  });
});

describe("REQ-393 outsideBox and placeIn(…, off): an off anchor is drawn on the edge, marked outside", () => {
  const box = { left: 100, top: 50, width: 400, height: 300 };
  test("outsideBox: the edges are inside; past any edge is outside", () => {
    expect(m.outsideBox({ x: 100, y: 50 }, box)).toBe(false);
    expect(m.outsideBox({ x: 500, y: 350 }, box)).toBe(false);
    expect(m.outsideBox({ x: 300, y: 200 }, box)).toBe(false);
    expect(m.outsideBox({ x: 99, y: 200 }, box)).toBe(true);
    expect(m.outsideBox({ x: 501, y: 200 }, box)).toBe(true);
    expect(m.outsideBox({ x: 300, y: 49 }, box)).toBe(true);
    expect(m.outsideBox({ x: 300, y: 351 }, box)).toBe(true);
  });
  test("off: the point the anchor names (on an edge) is pulled in so the whole 24 × 30 arrow shows, and marked outside", () => {
    // the left edge (vx 0), the right edge (vx 1), the bottom edge (vy 1), a corner
    expect(m.placeIn({ x: 100, y: 200 }, box, m.ARROW_BOX, true)).toEqual({
      at: { x: 100, y: 200 },
      outside: true,
    });
    expect(m.placeIn({ x: 500, y: 200 }, box, m.ARROW_BOX, true)).toEqual({
      at: { x: 476, y: 200 },
      outside: true,
    });
    expect(m.placeIn({ x: 300, y: 350 }, box, m.ARROW_BOX, true)).toEqual({
      at: { x: 300, y: 320 },
      outside: true,
    });
    expect(m.placeIn({ x: 500, y: 350 }, box, m.ARROW_BOX, true)).toEqual({
      at: { x: 476, y: 320 },
      outside: true,
    });
  });
  test("without off, a point on the screen is drawn where it is (REQ-305 unchanged)", () => {
    expect(m.placeIn({ x: 300, y: 200 }, box)).toEqual({
      at: { x: 300, y: 200 },
      outside: false,
    });
    expect(m.placeIn({ x: 300, y: 200 }, box, m.ARROW_BOX, false)).toEqual({
      at: { x: 300, y: 200 },
      outside: false,
    });
  });
});

/** a sessionStorage stand-in */
function memStore() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

describe("REQ-393 the cursor hand-off: a stage opened under a still mouse starts where the opening page last saw it", () => {
  test("handed over, then taken once", () => {
    const { handCursor, takeCursor } = handoff();
    const s = memStore();
    handCursor(s, { x: 610, y: 145 }, 1_000);
    expect(takeCursor(s, 2_000)).toEqual({ x: 610, y: 145 });
    expect(takeCursor(s, 2_100)).toBeNull();
  });
  test("an old hand-off is not where the mouse is any more; a hand-off of nothing clears it", () => {
    const { handCursor, takeCursor, CURSOR_HANDOFF_MS } = handoff();
    expect(CURSOR_HANDOFF_MS).toBeGreaterThanOrEqual(10_000);
    expect(CURSOR_HANDOFF_MS).toBeLessThanOrEqual(60_000);
    const s = memStore();
    handCursor(s, { x: 1, y: 2 }, 0);
    expect(takeCursor(s, CURSOR_HANDOFF_MS + 1)).toBeNull();
    handCursor(s, { x: 1, y: 2 }, 0);
    handCursor(s, null, 10);
    expect(takeCursor(s, 20)).toBeNull();
  });
  test("junk in the store, a store that throws, or no store: nothing, and nothing thrown", () => {
    const { handCursor, takeCursor, CURSOR_KEY } = handoff();
    const s = memStore();
    for (
      const junk of [
        "{",
        "null",
        '{"x":"1","y":2,"at":0}',
        '{"x":1,"y":2}',
        '{"x":1e999,"y":2,"at":0}',
      ]
    ) {
      s.map.set(CURSOR_KEY, junk);
      expect([junk, takeCursor(s, 5)]).toEqual([junk, null]);
    }
    const boom = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(() => handCursor(boom, { x: 1, y: 1 }, 0)).not.toThrow();
    expect(takeCursor(boom, 0)).toBeNull();
    expect(() => handCursor(null, { x: 1, y: 1 }, 0)).not.toThrow();
    expect(takeCursor(undefined, 0)).toBeNull();
  });
});

// ── the transport on a fake socket ──────────────────────────────────────────────────────────

class FakeWS {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
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
  recv(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  of(t: string) {
    return this.sent.filter((x) => x.t === t);
  }
}

const g = globalThis as Any;
const saved = {
  WebSocket: g.WebSocket,
  location: g.location,
  RTCPeerConnection: g.RTCPeerConnection,
};
beforeEach(() => {
  FakeWS.all = [];
  g.WebSocket = FakeWS;
  Object.defineProperty(globalThis, "location", {
    value: { protocol: "http:", host: "demo.test" },
    configurable: true,
    writable: true,
  });
  delete g.RTCPeerConnection; // the relay only: what the hub is handed is what is tested
});
afterEach(() => {
  g.WebSocket = saved.WebSocket;
  Object.defineProperty(globalThis, "location", {
    value: saved.location,
    configurable: true,
    writable: true,
  });
  if (saved.RTCPeerConnection) g.RTCPeerConnection = saved.RTCPeerConnection;
  else delete g.RTCPeerConnection;
});

function link(role: Role, pid?: string) {
  const got: { m: PeerMessage; from: PeerFrom }[] = [];
  const statuses: LinkStatus[] = [];
  const l = connectDemo({
    sessionId: "s1",
    role,
    ...(pid ? { pid } : {}),
    onPeer: (msg, from) => got.push({ m: msg, from }),
    onStatus: (s) => statuses.push(s),
    onPeerOnline: () => {},
    onEnded: () => {},
  });
  const ws = FakeWS.all[FakeWS.all.length - 1];
  return { link: l, ws, got, statuses };
}
function stage(pid = "hans") {
  const s = link("presenter", pid);
  s.ws.open();
  s.ws.recv({
    t: "welcome",
    role: "presenter",
    sessionId: "s1",
    peerOnline: false,
    pid,
    cid: "stage-1",
  });
  return s;
}
const tabOnline = (ws: FakeWS, cid: string, online = true) =>
  ws.recv({ t: "peer", online, cid });
const MOVE: PeerMessage = { k: "move", a: { vx: 0.5, vy: 0.5 }, t: 1 };
const relays = (ws: FakeWS) => ws.of("relay");

describe("REQ-393 the transport: the tab the stage leaves hears `leave`; a presenter's relay goes to the followed tab only", () => {
  test("a switch to another tab sends `leave` to the tab left — addressed to that one socket — and still hides its pointer here", () => {
    const s = stage();
    tabOnline(s.ws, "t1");
    s.ws.recv({ t: "claim", cid: "t1", at: 100 });
    tabOnline(s.ws, "t2");
    s.ws.sent.length = 0;
    s.ws.recv({ t: "claim", cid: "t2", at: 200 });
    expect(relays(s.ws)).toEqual([
      { t: "relay", data: { k: "leave" }, tab: "t1" },
    ]);
    expect(s.got.some((x) => x.m.k === "leave" && x.from.cid === "t1")).toBe(
      true,
    );
    // and back: tab 2 is told
    s.ws.sent.length = 0;
    s.ws.recv({ t: "claim", cid: "t1", at: 300 });
    expect(relays(s.ws)).toEqual([
      { t: "relay", data: { k: "leave" }, tab: "t2" },
    ]);
    s.link.close();
  });

  test("a tab that closed hears nothing (it is gone); the fallback tab is followed", () => {
    const s = stage();
    tabOnline(s.ws, "t1");
    s.ws.recv({ t: "claim", cid: "t1", at: 100 });
    tabOnline(s.ws, "t2");
    s.ws.recv({ t: "claim", cid: "t2", at: 200 });
    s.ws.sent.length = 0;
    tabOnline(s.ws, "t2", false);
    expect(relays(s.ws)).toEqual([]);
    expect(s.ws.of("sync")).toEqual([{ t: "sync", to: "t1" }]);
    s.link.send(MOVE, true);
    expect(relays(s.ws)).toEqual([{ t: "relay", data: MOVE, tab: "t1" }]);
    s.link.close();
  });

  test("every presenter relay to the customer names the followed tab: a move, a click, a leave, a resync", () => {
    const s = stage();
    tabOnline(s.ws, "t1");
    tabOnline(s.ws, "t2");
    s.ws.recv({ t: "claim", cid: "t1", at: 100 });
    s.ws.sent.length = 0;
    const msgs: PeerMessage[] = [
      MOVE,
      { k: "click", a: { vx: 0.1, vy: 0.2 } },
      { k: "leave" },
      { k: "resync" },
    ];
    for (const msg of msgs) s.link.send(msg);
    expect(relays(s.ws)).toEqual(
      msgs.map((data) => ({ t: "relay", data, tab: "t1" })),
    );
    s.link.close();
  });

  test("with a colleague: the pointer goes to the colleagues once (`to: presenters`) and to the followed tab once — the tab's copy never reaches them", () => {
    const s = stage();
    s.ws.recv({ t: "peer", online: true, pid: "lia", cid: "stage-9" });
    tabOnline(s.ws, "t1");
    s.ws.recv({ t: "claim", cid: "t1", at: 100 });
    s.ws.sent.length = 0;
    s.link.send(MOVE, true);
    expect(relays(s.ws)).toEqual([
      { t: "relay", data: MOVE, to: "presenters" },
      { t: "relay", data: MOVE, tab: "t1" },
    ]);
    s.link.close();
  });

  test("no tab followed yet: the relay names none (the hub hands it to the customer's tabs); the customer's own relay never names a tab", () => {
    const s = stage();
    s.link.send(MOVE, true);
    expect(relays(s.ws)).toEqual([{ t: "relay", data: MOVE }]);
    s.link.close();
    const v = link("viewer");
    v.ws.open();
    v.ws.recv({
      t: "welcome",
      role: "viewer",
      sessionId: "s1",
      peerOnline: false,
      cid: "t1",
    });
    v.ws.recv({ t: "peer", online: true, pid: "hans", cid: "stage-1" });
    v.link.send(MOVE, true);
    expect(relays(v.ws)).toEqual([{ t: "relay", data: MOVE }]);
    v.link.close();
  });
});

// ── the islands' wiring ───────────────────────────────────────────────────────────────────────

describe("REQ-393 the stage: the resting pointer is the spot under the presenter's mouse, wherever it is", () => {
  const stageSrc = read("front-end/islands/DemoStage.tsx");
  const fn = (name: string) => {
    const at = stageSrc.indexOf(`const ${name} = `);
    expect([name, at > -1]).toEqual([name, true]);
    return stageSrc.slice(at, stageSrc.indexOf("\n  };\n", at));
  };
  const layer = (() => {
    const at = stageSrc.indexOf('data-cy="demo-stage-layer"');
    expect(at).toBeGreaterThan(-1);
    return stageSrc.slice(at, stageSrc.indexOf("/>", at));
  })();

  test("M2 scroll: every layout pass looks the resting pointer up again (rated, reliable) — no settle window is left", () => {
    expect(fn("replace")).toMatch(
      /if \(lastMoveRef\.current\) rest\.push\(null\)/,
    );
    expect(stageSrc).not.toMatch(/restRef|snapGenRef/);
    expect(stageSrc).toMatch(
      /const rest = useMemo\(\(\) =>\s*moveThrottle<null>\(\{\s*gap: \(\) =>\s*linkRef\.current\?\.isDirect\(\) \? MOVE_GAP_DIRECT_MS : MOVE_GAP_RELAY_MS,\s*send: \(\) => restAgain\(\),/,
    );
    // the reliable channel: the last look-up must arrive
    expect(fn("restAgain")).toMatch(
      /linkRef\.current\?\.send\(\{ k: "move", a, t: performance\.now\(\) \}\);/,
    );
  });

  test("M8: beside the frame the anchor is the fraction where the mouse meets the frame's edge, marked off their screen, never a node; a resend keeps the mark", () => {
    const anchorOf = fn("anchorOf");
    const off = anchorOf.indexOf("outsideBox(p, f)");
    expect(off).toBeGreaterThan(-1);
    expect(anchorOf.slice(off, off + 200)).toMatch(/o: 1/);
    expect(off).toBeLessThan(anchorOf.indexOf("rep.anchorAt("));
    expect(fn("resendPointer")).toMatch(
      /\.\.\.pointToFrac\(p, fitBox\(\)\),\s*\.\.\.offFrame\(p\)/,
    );
    expect(fn("offFrame")).toMatch(
      /outsideBox\(p, fitBox\(\)\) \? \{ o: 1 as const \} : \{\}/,
    );
    // a colleague's off anchor is drawn on the frame's edge too
    expect(fn("placeOnStage")).toMatch(
      /placeIn\(toStage\(a\), fitBox\(\), ARROW_BOX, a\.o === 1\)/,
    );
  });

  test("M8, start, restart: the mouse is followed document-wide — leaving the frame is no `leave`, leaving the window is; the frame layer only eats clicks", () => {
    expect(stageSrc).toMatch(
      /document\.addEventListener\("pointermove", at, opts\);\s*document\.addEventListener\("pointerover", at, opts\);\s*document\.addEventListener\("pointerdown", at, opts\);/,
    );
    expect(stageSrc).toMatch(
      /document\.documentElement\.addEventListener\("pointerleave", gone\)/,
    );
    const gone = stageSrc.slice(stageSrc.indexOf("const gone = () => {"));
    expect(gone.slice(0, gone.indexOf("};"))).toMatch(
      /lastMoveRef\.current = null;[\s\S]*linkRef\.current\?\.send\(\{ k: "leave" \}\)/,
    );
    // only the window: the only `leave` this presenter sends
    expect(stageSrc.match(/send\(\{ k: "leave" \}\)/g)?.length).toBe(1);
    expect(layer).not.toMatch(/onPointerLeave|onPointerMove/);
    expect(layer).toMatch(
      /onPointerDown=\{\(e\) => \{\s*e\.preventDefault\(\);/,
    );
    // a move goes out only onto a frame fitted to their screen (before the first snapshot, or a
    // snapshot of a new size not fitted yet, the stage's point says nothing of theirs)
    const at = stageSrc.slice(
      stageSrc.indexOf("const at = (e: PointerEvent) => {"),
    );
    expect(at.slice(0, at.indexOf("\n    };"))).toMatch(
      /lastMoveRef\.current = p;\s*markOff\(\);\s*if \(fitted\(\) && linkRef\.current\) throttle\.push\(p\)/,
    );
    expect(fn("fitted")).toMatch(
      /return !!size && s !== HIDDEN && size\.w === s\.w && size\.h === s\.h;/,
    );
    for (const name of ["resendPointer", "restAgain"]) {
      expect([name, fn(name)]).toEqual([
        name,
        expect.stringMatching(/if \(!p \|\| !fitted\(\)\) return;/),
      ]);
    }
  });

  test("start / restart: a stage opened under a still mouse takes the hand-off once, and hands its own over when it goes", () => {
    expect(stageSrc).toMatch(
      /from "\.\.\/lib\/demo-mode\/cursor-handoff\.ts"/,
    );
    expect(stageSrc).toMatch(
      /const seeded = takeCursor\(sessionStore\(\)\);\s*if \(seeded && !lastMoveRef\.current\) lastMoveRef\.current = seeded;/,
    );
    expect(stageSrc).toMatch(
      /addEventListener\("pagehide", hand\)/,
    );
    expect(stageSrc).toMatch(
      /const hand = \(\) => handCursor\(sessionStore\(\), lastMoveRef\.current\)/,
    );
  });

  test("M8: off the frame the stage outlines it and says so, in the presenter's language", () => {
    expect(stageSrc).toMatch(/const \[off, setOff\] = useState\(false\)/);
    expect(stageSrc).toMatch(/data-cy="demo-pointer-off"/);
    expect(stageSrc).toContain('t("demoMode.pointerOff", { name })');
    expect(stageSrc).toMatch(/outline:\$\{\s*mirrored && off/);
    const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
    const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
    expect(en["demoMode.pointerOff"]).toBe(
      "Your pointer is off {name}'s screen",
    );
    expect(es["demoMode.pointerOff"]).toBe(
      "Tu puntero está fuera de la pantalla de {name}",
    );
  });
});

describe("REQ-393 the customer's overlay: an off anchor sits on the window's edge; the page that opens the stage hands the mouse over", () => {
  const overlay = read("front-end/islands/DemoModeOverlay.tsx");
  test("placeOnScreen draws an off anchor on the edge, marked outside", () => {
    expect(overlay).toMatch(
      /placeIn\(toScreen\(a\), viewportBox\(\), ARROW_BOX, a\.o === 1\)/,
    );
  });
  test("placePresenter hands the staff's last pointer position over before sending them to the stage; the page keeps it from its pointer events", () => {
    const place = overlay.slice(
      overlay.indexOf("async function placePresenter("),
    );
    const assign = place.indexOf("globalThis.location.assign(STAGE_PATH)");
    const hand = place.indexOf("handCursor(sessionStore(), cursorRef.current)");
    expect(hand).toBeGreaterThan(-1);
    expect(assign).toBeGreaterThan(hand);
    expect(overlay).toMatch(
      /document\.addEventListener\("pointermove", seen, opts\);\s*document\.addEventListener\("pointerdown", seen, opts\);/,
    );
  });
});
