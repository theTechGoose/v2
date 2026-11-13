/**
 * REQ-640 — demo-loop cycle 5, issues M29 ("the stage follows a background tab — the invoice
 * preview — instead of the tab the customer is using") and m24 ("the stage shows an old page first
 * at demo start or after a stage reload"). RCA at demo-fixes 2444608a:
 *
 *   - transport.ts `claim()` stamped EVERY claim Date.now() at the moment it ran — a page's load
 *     claim therefore carried its hydration time, so a background tab that merely booted later
 *     (the preview, opened with noopener) outranked the tab the customer moved to; an emulated
 *     focus event in a background tab stamped "now" too.
 *   - a stage that joins learns the customer's tabs as bare `peer`s (at 0) and followed whichever
 *     arrived LAST until every tab reclaimed; the hub kept no claim to send with the roster.
 *
 * The fix: a load or focus claim is stamped with the page's own load start (performance.timeOrigin
 * on the browser's shared clock) or this page's newest input, never "now" — only a click, a key, a
 * wheel/touch, the tab coming to the front or a back-forward restore claims at "now", and such a
 * claim says it is input-backed (`i: 1`), which wins a tie; the hub keeps each tab's last claim and
 * sends it with the roster to a joining stage.
 */
import * as fs from "fs";
import * as path from "path";
import { connectDemo } from "../../front-end/lib/demo-mode/transport";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// deno-lint-ignore no-explicit-any
type Any = any;

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
  const followed: (string | undefined)[] = [];
  const link = connectDemo({
    sessionId: "s1",
    role: "presenter",
    pid: "hans",
    onPeer: () => {},
    onStatus: () => {},
    onPeerOnline: (cid?: string) => followed.push(cid),
    onEnded: () => {},
  });
  const ws = FakeWS.all[FakeWS.all.length - 1];
  ws.open();
  ws.recv({
    t: "welcome",
    role: "presenter",
    sessionId: "s1",
    peerOnline: true,
    pid: "hans",
    cid: "stage-1",
  });
  return {
    link,
    ws,
    followed,
    following: () => followed[followed.length - 1],
    synced: () => ws.of("sync").map((m) => m.to),
  };
}

function viewer(o: { loadedAt?: number; focus?: boolean } = {}) {
  const link = connectDemo({
    sessionId: "s1",
    role: "viewer",
    tab: "tab-P",
    hasFocus: () => o.focus ?? true,
    ...(o.loadedAt !== undefined ? { loadedAt: o.loadedAt } : {}),
    onPeer: () => {},
    onStatus: () => {},
    onPeerOnline: () => {},
    onEnded: () => {},
  } as Any);
  const ws = FakeWS.all[FakeWS.all.length - 1];
  ws.open();
  ws.recv({
    t: "welcome",
    role: "viewer",
    sessionId: "s1",
    peerOnline: true,
    cid: "p1",
  });
  return { link: link as Any, ws };
}

describe("REQ-640 (cycle 5, M29) a claim's time is when the customer last did something there, never when the code ran", () => {
  test("a load claim carries the page's load start, not the time the overlay hydrated", () => {
    jest.useFakeTimers();
    jest.setSystemTime(9_000); // the effect runs 4 s after the page began loading
    const v = viewer({ loadedAt: 5_000 });
    v.link.claim("load");
    expect(v.ws.of("claim").pop()).toEqual({
      t: "claim",
      at: 5_000,
      tab: "tab-P",
      f: 1,
    });
    v.link.close();
  });

  test("a focus claim never stamps 'now': it re-says the page's load start or its last input", () => {
    jest.useFakeTimers();
    jest.setSystemTime(9_000);
    const v = viewer({ loadedAt: 5_000 });
    v.link.claim("focus"); // an emulated focus event in a background tab
    expect(v.ws.of("claim").pop()).toMatchObject({ at: 5_000 });
    expect(v.ws.of("claim").pop().i).toBeUndefined();
    jest.setSystemTime(9_500);
    v.link.claim(); // a click: now, input-backed
    expect(v.ws.of("claim").pop()).toEqual({
      t: "claim",
      at: 9_500,
      tab: "tab-P",
      f: 1,
      i: 1,
    });
    jest.setSystemTime(20_000);
    v.link.claim("focus");
    expect(v.ws.of("claim").pop()).toMatchObject({ at: 9_500, i: 1 });
    // the welcome after a reconnect re-says the last claim, input flag included
    v.ws.recv({
      t: "welcome",
      role: "viewer",
      sessionId: "s1",
      peerOnline: true,
      cid: "p1",
    });
    expect(v.ws.of("claim").pop()).toMatchObject({ at: 9_500, i: 1 });
    v.link.close();
  });

  test("the M29 timeline: a preview tab that booted LATER but loaded EARLIER than the customer's next page never holds the stage once that page claims", () => {
    const s = stage();
    // the preview (tab P) loaded at 1 000 and claimed on load; tab 1's /customers began loading
    // at 5 000 — both claims carry their LOAD times, so the order is the customer's, not boot speed
    s.ws.recv({ t: "peer", online: true, cid: "p1" });
    s.ws.recv({ t: "claim", cid: "p1", at: 1_000, tab: "tab-P", f: 1 });
    s.ws.recv({ t: "peer", online: true, cid: "c1" });
    s.ws.recv({ t: "claim", cid: "c1", at: 5_000, tab: "tab-1", f: 1 });
    expect(s.following()).toBe("c1");
    // the preview's emulated focus re-says its load time: it does not take the stage back
    s.ws.recv({ t: "claim", cid: "p1", at: 1_000, tab: "tab-P", f: 1 });
    expect(s.following()).toBe("c1");
    s.link.close();
  });

  test("a tie on the claim's time goes to the input-backed claim over a focused load/focus claim", () => {
    const s = stage();
    s.ws.recv({ t: "peer", online: true, cid: "c1" });
    s.ws.recv({ t: "peer", online: true, cid: "p1" });
    s.ws.recv({ t: "claim", cid: "c1", at: 500, tab: "tab-1", i: 1 });
    s.ws.recv({ t: "claim", cid: "p1", at: 500, tab: "tab-P", f: 1 });
    expect(s.following()).toBe("c1");
    s.link.close();
  });
});

describe("REQ-640 (cycle 5, m24) a joining stage ranks the roster by the tabs' kept claims", () => {
  test("a reloaded stage follows the tab claimed last from its very first sync — never the tab whose `peer` merely came last", () => {
    const s = stage();
    s.ws.recv({
      t: "peer",
      online: true,
      cid: "a1",
      at: 300,
      tab: "tab-A",
      f: 1,
      i: 1,
    });
    s.ws.recv({ t: "peer", online: true, cid: "q1", at: 100, tab: "tab-Q" });
    expect(s.following()).toBe("a1");
    expect(s.synced()).toEqual(["a1"]);
    expect(s.followed).toEqual(["a1"]);
    s.link.close();
  });

  test("the roster's claims rank as live ones do: a later live claim still moves the stage", () => {
    const s = stage();
    s.ws.recv({ t: "peer", online: true, cid: "a1", at: 300, tab: "tab-A" });
    s.ws.recv({ t: "peer", online: true, cid: "q1", at: 100, tab: "tab-Q" });
    s.ws.recv({ t: "claim", cid: "q1", at: 400, tab: "tab-Q", i: 1 });
    expect(s.following()).toBe("q1");
    s.link.close();
  });
});

describe("REQ-640 the overlay stamps its claims by kind", () => {
  const overlay = read("front-end/islands/DemoModeOverlay.tsx");

  test("the link is told the page's load start on the shared clock", () => {
    expect(overlay).toMatch(/loadedAt:\s*pageLoadedAt/);
    expect(overlay).toMatch(
      /const pageLoadedAt = performance\.timeOrigin \|\| Date\.now\(\)/,
    );
  });

  test("the load-time claim is a load claim; a focus event a focus claim; pointerdown/keys claim as input", () => {
    expect(overlay).toMatch(/\)\s*claim\("load"\);/);
    expect(overlay).toMatch(/addEventListener\("focus", onFocus\)/);
    expect(overlay).toMatch(/const onFocus = \(\) => claim\("focus"\)/);
    expect(overlay).toMatch(/addEventListener\("pointerdown", onPointer,/);
    expect(overlay).toMatch(/const onPointer = \(\) => claim\("input"\)/);
  });
});
