/**
 * REQ-436 — demo-loop cycle 3, issues M2 / M2b / M2c / M5 ("the stage stays on another tab after
 * the customer returns; a background tab that refreshes takes the stage; the followed tab
 * navigates while another is open and the stage flips to the background tab, 'Live'; the
 * presenter's pointer vanishes on an older tab"). RCA at demo-fixes cc5d4b0e:
 *
 *   - transport.ts `tabLeft` read REQ-391's `why` only when no tab was left: with a second tab
 *     open, a followed tab that NAVIGATED was replaced at once by the background tab (sync, offer,
 *     onPeerOnline → DemoStage showed that tab "Live", and the navigating tab got the presenter's
 *     pointer taken away) until the new page's mount claim landed.
 *   - DemoModeOverlay claimed at mount on `visibilityState === "visible"` alone: a visible but
 *     unfocused page (a headless tab, a side-by-side window) that reloaded took the stage.
 *   - only pointerdown / focus / visibilitychange claimed: a keyboard or wheel user never did.
 *
 * The fix follows BROWSER TABS, not sockets: every page of one browser tab carries the same key
 * (sessionStorage) on its claims — sent on every welcome too — and whether it has focus. A stage
 * whose followed tab navigates keeps following that key ("between") for PRESENCE_GRACE_MS, and
 * its next page takes the stage back the moment it says its key; another tab is followed only
 * when the grace ends, when the tab said it is closing, or when another tab is really claimed.
 */
import * as fs from "fs";
import * as path from "path";
import { PRESENCE_GRACE_MS } from "../../shared/demo-mode/protocol";
import {
  connectDemo,
  type LinkStatus,
} from "../../front-end/lib/demo-mode/transport";
import { demoTabKey } from "../../front-end/lib/demo-mode/tab-key";

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

/** a stage's link on a fake socket, and the customer's tabs as the hub reports them */
function stage() {
  const statuses: LinkStatus[] = [];
  const followed: (string | undefined)[] = [];
  const left: string[] = [];
  const link = connectDemo({
    sessionId: "s1",
    role: "presenter",
    pid: "hans",
    onPeer: (m, from) => {
      if (m.k === "leave" && from.cid) left.push(from.cid);
    },
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
  return {
    link,
    ws,
    statuses,
    followed,
    left,
    status: () => statuses[statuses.length - 1],
    following: () => followed[followed.length - 1],
    online: (cid: string) => ws.recv({ t: "peer", online: true, cid }),
    gone: (cid: string, why?: string) =>
      ws.recv({ t: "peer", online: false, cid, ...(why ? { why } : {}) }),
    claim: (cid: string, at: number, tab?: string, f?: 1) =>
      ws.recv({
        t: "claim",
        cid,
        at,
        ...(tab ? { tab } : {}),
        ...(f ? { f } : {}),
      }),
    /** what this stage sent addressed to a tab (sync, a relay) */
    to: (cid: string) =>
      ws.sent.filter((m) =>
        (m.t === "sync" && m.to === cid) || (m.t === "relay" && m.tab === cid)
      ),
  };
}

/** the demo's state: the app tab (browser tab A) claimed last, /q (browser tab Q) open behind it */
function appTabInFrontOfQuote() {
  const s = stage();
  s.online("a1");
  s.claim("a1", 100, "tab-A", 1);
  s.online("q1");
  s.claim("q1", 200, "tab-Q", 1);
  s.claim("a1", 300, "tab-A", 1); // the customer came back to the app tab and used it
  expect(s.following()).toBe("a1");
  return s;
}

describe("REQ-436 the stage follows browser tabs, not sockets (M2b)", () => {
  test("the followed tab navigates while /q is open: the stage does NOT follow /q within the grace — it says 'between', sends /q nothing, and the tab's next page takes it back", () => {
    jest.useFakeTimers();
    const s = appTabInFrontOfQuote();
    const followedBefore = s.followed.length;
    const toQ = s.to("q1").length;

    s.gone("a1", "navigating"); // an EN/ES switch, a reload after a mutation
    expect(s.followed.length).toBe(followedBefore); // no onPeerOnline("q1")
    expect(s.status()).toBe("between");
    expect(s.to("q1").length).toBe(toQ); // no sync, no leave sent to /q

    // the presenter's pointer moves while the page loads: never to /q, never bare to every tab
    s.link.send({ k: "move", a: { vx: 0.5, vy: 0.5 } }, true);
    const moves = s.ws.of("relay").filter((m) => m.data.k === "move");
    expect(moves.length).toBe(1);
    expect(moves[0].tab).toBe("a1");

    // the new page's socket arrives; it has not said who it is yet: still between, still not /q
    jest.advanceTimersByTime(1_500);
    s.online("a2");
    expect(s.followed.length).toBe(followedBefore);
    expect(s.status()).toBe("between");

    // its welcome claim names browser tab A (it never claimed itself: at 0): the stage resumes there
    s.claim("a2", 0, "tab-A");
    expect(s.following()).toBe("a2");
    expect(s.status()).toBe("relay");
    expect(s.ws.of("sync").map((m) => m.to)).toContain("a2");
    expect(s.followed.slice(followedBefore)).toEqual(["a2"]);

    // the grace timer running out later changes nothing
    jest.advanceTimersByTime(PRESENCE_GRACE_MS * 2);
    expect(s.following()).toBe("a2");
    expect(s.followed.slice(followedBefore)).toEqual(["a2"]);
    expect(s.status()).toBe("relay");
    s.link.close();
  });

  test("the new page's claim comes before the old page's departure: the stage moves to it, and the departure changes nothing", () => {
    jest.useFakeTimers();
    const s = appTabInFrontOfQuote();
    const n = s.followed.length;
    s.online("a2");
    s.claim("a2", 0, "tab-A"); // announced, not claimed: the same browser tab
    s.gone("a1", "navigating");
    expect(s.following()).toBe("a2");
    expect(s.followed.slice(n)).toEqual(["a2"]);
    expect(s.status()).toBe("relay");
    s.link.close();
  });

  test("no next page within the grace: then — and only then — the stage falls back to the open /q tab", () => {
    jest.useFakeTimers();
    const s = appTabInFrontOfQuote();
    const n = s.followed.length;
    s.gone("a1", "navigating");
    jest.advanceTimersByTime(PRESENCE_GRACE_MS - 100);
    expect(s.followed.length).toBe(n);
    expect(s.status()).toBe("between");
    jest.advanceTimersByTime(200);
    expect(s.following()).toBe("q1");
    expect(s.status()).toBe("relay");
    s.link.close();
  });

  test("the followed tab says it is closing: the stage follows /q at once (no grace)", () => {
    jest.useFakeTimers();
    const s = appTabInFrontOfQuote();
    s.gone("a1", "closing");
    expect(s.following()).toBe("q1");
    expect(s.status()).toBe("relay");
    s.link.close();
  });

  test("during the grace the customer really uses /q (a newer claim): the stage follows /q", () => {
    jest.useFakeTimers();
    const s = appTabInFrontOfQuote();
    s.gone("a1", "navigating");
    s.claim("q1", 400, "tab-Q", 1);
    expect(s.following()).toBe("q1");
    expect(s.status()).toBe("relay");
    s.link.close();
  });

  test("a background tab's departure while navigating changes nothing on the stage", () => {
    jest.useFakeTimers();
    const s = appTabInFrontOfQuote();
    const n = s.followed.length;
    s.gone("q1", "navigating");
    expect(s.followed.length).toBe(n);
    expect(s.following()).toBe("a1");
    expect(s.status()).toBe("relay");
    s.link.close();
  });

  test("two claims at the same moment: the tab that reports focus wins", () => {
    const s = stage();
    s.online("a1");
    s.online("q1");
    s.claim("a1", 500, "tab-A", 1);
    s.claim("q1", 500, "tab-Q"); // arrived later, same time, no focus
    expect(s.following()).toBe("a1");
    s.link.close();
  });
});

describe("REQ-436 the customer's side names its browser tab and its focus on every claim (M2/M2c)", () => {
  function viewer(focused: boolean) {
    let focus = focused;
    const link = connectDemo({
      sessionId: "s1",
      role: "viewer",
      tab: "tab-A",
      hasFocus: () => focus,
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
      cid: "a2",
    });
    return { link, ws, setFocus: (f: boolean) => (focus = f) };
  }

  test("a page that never claimed still says, on its welcome, which browser tab it is (at 0)", () => {
    const v = viewer(false);
    expect(v.ws.of("claim")).toEqual([{ t: "claim", at: 0, tab: "tab-A" }]);
    v.link.close();
  });

  test("a claim carries the tab key and f:1 when the page has focus", () => {
    jest.useFakeTimers();
    jest.setSystemTime(9_000);
    const v = viewer(true);
    v.link.claim();
    expect(v.ws.of("claim").pop()).toEqual({
      t: "claim",
      at: 9_000,
      tab: "tab-A",
      f: 1,
    });
    v.link.close();
  });
});

describe("REQ-436 a stable key per browser tab (sessionStorage survives the tab's own page changes)", () => {
  function store() {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      m,
    };
  }

  test("the same storage gives the same key on every page; another tab's storage another key; the key is wire-safe", () => {
    const a = store();
    const k1 = demoTabKey(a);
    const k2 = demoTabKey(a);
    expect(k1).toBe(k2);
    expect(k1).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(demoTabKey(store())).not.toBe(k1);
  });

  test("a junk stored value is replaced; no storage (private mode throws) still gives a key", () => {
    const a = store();
    a.setItem("pm:demo-tab", "<bad key>");
    expect(demoTabKey(a)).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(demoTabKey(throwing)).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(demoTabKey(null)).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });
});

describe("REQ-436 the overlay's claim wiring (M2/M2c/M5)", () => {
  const overlay = read("front-end/islands/DemoModeOverlay.tsx");

  test("the link gets the browser tab's key and the page's focus", () => {
    expect(overlay).toMatch(/tab:\s*demoTabKey\(/);
    expect(overlay).toMatch(/hasFocus:\s*\(\)\s*=>\s*document\.hasFocus\(\)/);
  });

  test("at mount (and on pageshow) a page claims only when visible AND focused — a background reload never takes the stage", () => {
    // the old mount claim, on visibility alone, is gone
    expect(overlay).not.toMatch(
      /\n {4}if \(document\.visibilityState === "visible"\) claim\(\);/,
    );
    expect(overlay).toMatch(
      /const inFront = \(\) =>\s*document\.visibilityState === "visible" && document\.hasFocus\(\)/,
    );
    // REQ-549 (cycle 4, S4) — the mount claim goes through loadClaim (in front, not the app's
    // own reload, no other tab used since); pageshow re-claims only a back-forward-cache restore
    expect(overlay).toMatch(/loadClaim\(\{\s*inFront: inFront\(\),/);
    expect(overlay).toMatch(/if \(e\.persisted && inFront\(\)\) claim\(\);/);
    expect(overlay).toMatch(/addEventListener\("pageshow"/);
  });

  test("a keyboard, wheel or touch user claims too, not only a pointerdown", () => {
    for (const ev of ["keydown", "wheel", "touchstart", "pointerdown"]) {
      expect(overlay).toContain(`addEventListener("${ev}"`);
      expect(overlay).toContain(`removeEventListener("${ev}"`);
    }
  });
});
