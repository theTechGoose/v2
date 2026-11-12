/**
 * REQ-648 — demo-loop cycle 5, issues M3 ("the stage trails a customer page change by seconds while
 * lag reads 0.0s") and c4-m28 ("short-lived screens missed on stage; once ~5 s behind"). RCA at
 * demo-fixes 2444608a (analyst CONFIRMED, skeptic UPHELD):
 *
 *   - every page change in the app is a full document load, and the new page's link opened only in
 *     the overlay island's effect — after ALL of the page's island code had loaded and hydrated —
 *     so on a slow dev server the stage held the page the customer had left for seconds
 *     ("Loading their next page…"), and the presenter's arrow went out against it: aimed at
 *     "Billing", it landed on her "Quotes";
 *   - the stage's lag figure starts at each frame's push, so that whole boot time read 0.0 s;
 *   - REQ-547's hold kept a new page's snapshot out of the frame while its sheets loaded, yet the
 *     pill said Live (`awaiting` ended at apply), and a second snapshot of the held page restarted
 *     the hold.
 *
 * The fix: the departure of the followed tab's page carries the deploy's stamp of its `leaving`,
 * and the stage times every page change — from it to the next page ON SHOW (`createPageClock`) —
 * in its dev chip and in the pill ("Loading their next page… N s behind"); while it waits, the
 * frame is dimmed and his pointer is not sent; a held page is said on show only when it is
 * (`onShown`), and a later snapshot of it keeps its hold; and the customer's link starts from a
 * small script of its own in `_app.tsx`'s head, before the islands (early-link.ts), which the
 * overlay adopts.
 */
import * as fs from "fs";
import * as path from "path";
import {
  connectDemo,
  type DemoLinkOptions,
  type LinkStatus,
  type PeerFrom,
  TIME_AGAIN_MS,
} from "../../front-end/lib/demo-mode/transport";
import {
  createPageClock,
  MIRROR_LAG_WINDOW,
  type MirrorFrame,
  PAGE_CLOCK_MAX_MS,
} from "../../shared/demo-mode/mirror";
import {
  behindSeconds,
  LAG_BEHIND_MS,
  LOADING_FILTER,
  stageFrameLook,
  stageStatus,
  WAITING_FILTER,
} from "../../shared/demo-mode/stage-frame";
import {
  parseServerMessage,
  type PeerMessage,
  PRESENCE_GRACE_MS,
  STAGE_PATH,
} from "../../shared/demo-mode/protocol";
import { createRecorder } from "../../front-end/lib/demo-mode/mirror-record";
import { createReplayer } from "../../front-end/lib/demo-mode/mirror-replay";
import {
  EARLY_ADOPT_MS,
  EARLY_SLOT,
  startEarlyLink,
  takeEarlyLink,
} from "../../front-end/lib/demo-mode/early-link";
import { keepDemo } from "../../front-end/lib/demo-mode/pill-carry";
import { TAB_KEY_STORAGE } from "../../front-end/lib/demo-mode/tab-key";
import { demoEarly } from "../../front-end/vite-demo-early";
import {
  docWith,
  FakeMutationObserver,
  FDocument,
  FElement,
  findAll,
  h,
} from "./support/fake-dom";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// deno-lint-ignore no-explicit-any
type Any = any;

// ── the page clock ───────────────────────────────────────────────────────────────────────────

describe("REQ-648 (cycle 5, M3) the stage times each page change of the customer's: their page going → the next on show", () => {
  test("left(at) → shown() measures the gap on the deploy's clock; waiting() counts it while it runs", () => {
    let now = 10_000;
    const c = createPageClock({ clock: () => now });
    expect(c.waiting()).toBeNull();
    expect(c.stats()).toEqual({ last: null, p50: null, max: null });
    c.left(9_700); // the server stamped their `leaving` 300 ms before the stage heard it
    expect(c.waiting()).toBe(300);
    now = 13_200;
    expect(c.waiting()).toBe(3_500);
    c.shown();
    expect(c.waiting()).toBeNull();
    expect(c.stats()).toEqual({ last: 3_500, p50: 3_500, max: 3_500 });
  });

  test("a page on show with no page gone (the first snapshot, a resync) measures nothing; a second departure before the next page keeps the first (the stage was behind since then)", () => {
    let now = 1_000;
    const c = createPageClock({ clock: () => now });
    c.shown();
    expect(c.stats().last).toBeNull();
    c.left(1_000);
    now = 1_800;
    c.left(1_700); // she went on before the stage showed the page in between
    now = 4_000;
    c.shown();
    expect(c.stats().last).toBe(3_000);
    // the same page again (a resync): nothing new
    now = 9_000;
    c.shown();
    expect(c.stats()).toEqual({ last: 3_000, p50: 3_000, max: 3_000 });
  });

  test("a clock a little behind the stamp is never a negative gap; a page that comes back long after (the app closed, opened again) is no page change", () => {
    let now = 5_000;
    const c = createPageClock({ clock: () => now });
    c.left(5_040);
    expect(c.waiting()).toBe(0);
    c.shown();
    expect(c.stats().last).toBe(0);
    c.left(now);
    now += PAGE_CLOCK_MAX_MS + 1;
    c.shown();
    expect(c.stats().last).toBe(0); // not recorded
    expect(c.waiting()).toBeNull();
  });

  test("the median and the worst over the latest MIRROR_LAG_WINDOW changes; cancel() drops a running wait", () => {
    let now = 0;
    const c = createPageClock({ clock: () => now });
    for (const gap of [400, 4_000, 900]) {
      c.left(now);
      now += gap;
      c.shown();
      now += 10_000;
    }
    expect(c.stats()).toEqual({ last: 900, p50: 900, max: 4_000 });
    c.left(now);
    c.cancel();
    expect(c.waiting()).toBeNull();
    now += 1_000;
    c.shown();
    expect(c.stats().last).toBe(900);
    expect(MIRROR_LAG_WINDOW).toBeGreaterThan(3);
  });
});

// ── the pill's words, the frame's look ───────────────────────────────────────────────────────

describe("REQ-648 the pill says how far behind the stage is while it waits for their next page", () => {
  const base = {
    ended: false,
    status: "between" as const,
    mirrored: true,
    awaiting: false,
    resyncing: false,
    behind: 0,
  };

  test("Loading their next page… carries N s once the wait is over LAG_BEHIND_MS, whether their page is gone (between) or the new tab's snapshot is not in (awaiting)", () => {
    expect(stageStatus({ ...base, pageBehind: 0 })).toEqual({
      key: "loadingNext",
    });
    expect(behindSeconds(LAG_BEHIND_MS - 100, 0)).toBe(0);
    expect(
      stageStatus({ ...base, pageBehind: behindSeconds(3_400, 0) }),
    ).toEqual({ key: "loadingNext", n: 3 });
    expect(
      stageStatus({ ...base, status: "relay", awaiting: true, pageBehind: 2 }),
    ).toEqual({ key: "loadingNext", n: 2 });
    // no wait for a page: a page figure never makes the pill say anything else
    expect(stageStatus({ ...base, status: "relay", pageBehind: 5 })).toEqual({
      key: "live",
    });
    // their app gone (waiting) or not mirrored yet: as before
    expect(stageStatus({ ...base, status: "waiting", pageBehind: 5 }))
      .toEqual({ key: "waiting" });
    expect(stageStatus({ ...base, mirrored: false, pageBehind: 5 })).toEqual({
      key: "connecting",
    });
    // without the field, as before
    expect(stageStatus(base)).toEqual({ key: "loadingNext" });
  });

  test("the words, in both languages", () => {
    const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
    const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
    expect(en["demoMode.loadingNextBehind"]).toMatch(/\{n\}/);
    expect(en["demoMode.loadingNextBehind"]).toMatch(/next page/i);
    expect(es["demoMode.loadingNextBehind"]).toMatch(/\{n\}/);
    expect(es["demoMode.loadingNextBehind"]).toMatch(/siguiente página/i);
  });
});

describe("REQ-648 the frame of a page they left is dimmed while the next one loads", () => {
  test("loading their next page: on show, dimmed (LOADING_FILTER) — never the waiting look nor its banner", () => {
    expect(LOADING_FILTER).not.toBe("none");
    expect(LOADING_FILTER).not.toBe(WAITING_FILTER);
    for (const status of ["between", "relay", "direct"] as const) {
      expect(stageFrameLook({
        status,
        mirrored: true,
        stale: false,
        styled: true,
        loadingNext: true,
      })).toEqual({
        visibility: "visible",
        filter: LOADING_FILTER,
        waiting: false,
        loading: true,
      });
    }
  });

  test("the stale screen of an app that dropped keeps the waiting look and its banner; not loading, as before", () => {
    expect(stageFrameLook({
      status: "between",
      mirrored: true,
      stale: true,
      styled: true,
      loadingNext: true,
    })).toEqual({
      visibility: "visible",
      filter: WAITING_FILTER,
      waiting: true,
    });
    expect(stageFrameLook({
      status: "relay",
      mirrored: true,
      stale: false,
      styled: true,
      loadingNext: false,
    })).toEqual({ visibility: "visible", filter: "none", waiting: false });
    expect(stageFrameLook({
      status: "relay",
      mirrored: false,
      stale: false,
      styled: true,
      loadingNext: true,
    })).toEqual({ visibility: "hidden", filter: "none", waiting: false });
  });
});

// ── the wire, the stage's link ───────────────────────────────────────────────────────────────

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
function fakeNet() {
  FakeWS.all = [];
  g.WebSocket = FakeWS;
  Object.defineProperty(globalThis, "location", {
    value: { protocol: "http:", host: "demo.test" },
    configurable: true,
    writable: true,
  });
}
function realNet() {
  jest.useRealTimers();
  g.WebSocket = saved.WebSocket;
  Object.defineProperty(globalThis, "location", {
    value: saved.location,
    configurable: true,
    writable: true,
  });
}

describe("REQ-648 the departure of a tab's page carries when it said it was going, on the deploy's clock", () => {
  test("a departure keeps the server's stamp (`at`); junk, or an arrival, has none", () => {
    expect(
      parseServerMessage(
        '{"t":"peer","online":false,"cid":"t1","why":"navigating","at":1700000000123}',
      ),
    ).toEqual({
      t: "peer",
      online: false,
      cid: "t1",
      why: "navigating",
      at: 1700000000123,
    });
    for (const bad of ['"soon"', "-5", "0", "null"]) {
      expect(
        parseServerMessage(
          `{"t":"peer","online":false,"cid":"t1","why":"navigating","at":${bad}}`,
        ),
      ).toEqual({ t: "peer", online: false, cid: "t1", why: "navigating" });
    }
    expect(
      parseServerMessage('{"t":"peer","online":true,"cid":"t1","at":12345}'),
    ).toEqual({ t: "peer", online: true, cid: "t1" });
  });
});

describe("REQ-648 a stage hears when the page it follows went (onPageGone)", () => {
  beforeEach(fakeNet);
  afterEach(realNet);

  function stage() {
    const gone: { at: number; why?: string }[] = [];
    const link = connectDemo({
      sessionId: "s1",
      role: "presenter",
      pid: "hans",
      onPeer: () => {},
      onStatus: () => {},
      onPeerOnline: () => {},
      onEnded: () => {},
      onPageGone: (at: number, why?: string) => gone.push({ at, why }),
    } as DemoLinkOptions);
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
    const claim = (cid: string, at: number, tab: string) =>
      ws.recv({ t: "claim", cid, at, tab });
    const tab = (cid: string, online = true, extra: Any = {}) =>
      ws.recv({ t: "peer", online, cid, ...extra });
    return { link, ws, gone, claim, tab };
  }

  test("the followed tab's page goes: the server's stamp of its `leaving`; with none, this link's own now(); another tab's page going says nothing", () => {
    jest.useFakeTimers();
    jest.setSystemTime(50_000);
    const s = stage();
    s.tab("a1");
    s.claim("a1", 100, "tabA");
    s.tab("b1");
    s.claim("b1", 50, "tabB"); // followed: a1 (the later claim)
    s.tab("b1", false, { why: "navigating", at: 49_500 });
    expect(s.gone).toEqual([]); // not the followed tab
    s.tab("a1", false, { why: "navigating", at: 49_800 });
    expect(s.gone).toEqual([{ at: 49_800, why: "navigating" }]);
    // its next page (same browser tab) takes the stage back; then it goes with no stamp
    s.tab("a2");
    s.claim("a2", 0, "tabA");
    jest.setSystemTime(60_000);
    s.tab("a2", false); // a page from before the stamp, or one that said nothing
    expect(s.gone[1]).toEqual({ at: s.link.now(), why: undefined });
    expect(s.gone.length).toBe(2);
    jest.advanceTimersByTime(PRESENCE_GRACE_MS);
    s.link.close();
  });

  test("a followed tab that says it is CLOSING starts no page change: no next page is coming (the stage says it is waiting at once)", () => {
    const s = stage();
    s.tab("a1");
    s.claim("a1", 100, "tabA");
    s.tab("a1", false, { why: "closing", at: 1_000 });
    expect(s.gone).toEqual([]);
    s.link.close();
  });
});

// ── the replay: a page on show is said, a held page keeps its hold ──────────────────────────────

function page(
  sheets: string[],
  title: string,
  href = "https://app.test/customers",
): FDocument {
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
          h(d, "title", {}, title),
          ...sheets.map((s) => h(d, "link", { rel: "stylesheet", href: s })),
        ),
        h(d, "body", {}, h(d, "main", {}, title)),
      ),
    href,
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
function replay(stage: FDocument) {
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const passes: (() => void)[] = [];
  const shown: number[] = [];
  const rep = createReplayer(
    stage as unknown as Document,
    {
      schedule: (fn: () => void) => passes.push(fn),
      Resize: null,
      now: () => 0,
      later: (fn: () => void, ms: number) => {
        const t = { fn, ms, cancelled: false };
        timers.push(t);
        return () => {
          t.cancelled = true;
        };
      },
      onShown: () => shown.push(shown.length + 1),
    } as Any,
  ) as Any;
  const flush = () => {
    while (passes.length) passes.shift()!();
  };
  const live = () => timers.filter((t) => !t.cancelled);
  return { rep, flush, timers, live, shown };
}
const sheetLinks = (d: FDocument) =>
  findAll(
    d,
    (e: FElement) =>
      e.localName === "link" && e.getAttribute("rel") === "stylesheet",
  );
const preloads = (d: FDocument) =>
  sheetLinks(d).filter((l) => l.getAttribute("media") === "not all");
const titleIn = (d: FDocument) =>
  findAll(d, (e: FElement) => e.localName === "title")[0]?.textContent ?? "";

describe("REQ-648 the replay says when a snapshot's page is ON SHOW, and a later snapshot of a held page keeps its hold", () => {
  test("onShown: at once for a page whose sheets the frame has; for a held one only when it goes in — held() says it is held meanwhile", () => {
    const stage = stageDoc();
    const { rep, flush, shown } = replay(stage);
    rep.apply(snapshotOf(page(["/a.css"], "Dashboard")));
    expect(shown.length).toBe(1); // the first snapshot is never held
    stage.fire("load", sheetLinks(stage)[0]);
    flush();
    expect(rep.held()).toBe(false);
    rep.apply(snapshotOf(page(["/a.css", "/b.css"], "Customers")));
    expect(rep.held()).toBe(true);
    expect(titleIn(stage)).toBe("Dashboard");
    expect(shown.length).toBe(1);
    stage.fire("load", preloads(stage)[0]);
    flush();
    expect(rep.held()).toBe(false);
    expect(titleIn(stage)).toBe("Customers");
    expect(shown.length).toBe(2);
  });

  test("a page change whose page links only sheets the frame has goes on show at once", () => {
    const stage = stageDoc();
    const { rep, flush, shown } = replay(stage);
    rep.apply(snapshotOf(page(["/a.css"], "Dashboard")));
    stage.fire("load", sheetLinks(stage)[0]);
    flush();
    rep.apply(snapshotOf(page(["/a.css"], "Settings")));
    expect(rep.held()).toBe(false);
    expect(titleIn(stage)).toBe("Settings");
    expect(shown.length).toBe(2);
  });

  test("a second snapshot of the held page (the customer answers the stage's arrival AND its sync) keeps the sheet already loading and the first hold's deadline — the hold never starts over", () => {
    const stage = stageDoc();
    const { rep, flush, live, shown } = replay(stage);
    rep.apply(snapshotOf(page(["/a.css"], "Dashboard")));
    stage.fire("load", sheetLinks(stage)[0]);
    flush();
    rep.apply(snapshotOf(page(["/a.css", "/b.css"], "Customers")));
    const loading = preloads(stage);
    expect(loading.length).toBe(1);
    const deadline = live();
    expect(deadline.length).toBe(1);
    rep.apply(snapshotOf(page(["/a.css", "/b.css"], "Customers ·2")));
    // the same preload element, still loading; the same deadline
    expect(preloads(stage).length).toBe(1);
    expect(preloads(stage)[0]).toBe(loading[0]);
    expect(live().length).toBe(1);
    expect(live()[0]).toBe(deadline[0]);
    expect(rep.held()).toBe(true);
    // the first hold's deadline puts the LATEST snapshot in
    deadline[0].fn();
    flush();
    expect(titleIn(stage)).toBe("Customers ·2");
    expect(shown.length).toBe(2);
    expect(preloads(stage)).toEqual([]);
  });

  test("…and when the sheet it was loading comes in, the latest snapshot goes in at once", () => {
    const stage = stageDoc();
    const { rep, flush, shown } = replay(stage);
    rep.apply(snapshotOf(page(["/a.css"], "Dashboard")));
    stage.fire("load", sheetLinks(stage)[0]);
    flush();
    rep.apply(snapshotOf(page(["/a.css", "/b.css"], "Customers")));
    const first = preloads(stage)[0];
    rep.apply(snapshotOf(page(["/a.css", "/b.css"], "Customers ·2")));
    stage.fire("load", first);
    flush();
    expect(titleIn(stage)).toBe("Customers ·2");
    expect(shown.length).toBe(2);
  });
});

// ── the customer's early link ─────────────────────────────────────────────────────────────────

/** a tab's sessionStorage */
function store(seed: Record<string, string> = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}
const DEMO = {
  id: "demo-1",
  role: "viewer" as const,
  presenterName: "Hans",
  targetName: "Ana Torres",
  targetUserId: "u-ana",
  presenters: [{ userId: "hans", name: "Hans", color: "#2f6d29" }],
};
/** the window as the early link sees it: its location, its listeners, whether it is the top one */
function win(pathname = "/customers", top = true) {
  const ls = new Map<string, Set<(e: Any) => void>>();
  const w: Any = {
    location: {
      pathname,
      href: `https://app.test${pathname}`,
      origin: "https://app.test",
    },
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
    count: (t: string) => ls.get(t)?.size ?? 0,
  };
  w.self = w;
  w.top = top ? w : {};
  return w;
}
function customerDoc(loading = false) {
  const d = page([], "Customers") as Any;
  d.readyState = loading ? "loading" : "interactive";
  d.hasFocus = () => true;
  return d as FDocument & { readyState: string };
}
const RECORD = {
  Observer: FakeMutationObserver as unknown as typeof MutationObserver,
  manual: true,
};
function early(o: {
  carried?: boolean;
  role?: "viewer" | "presenter";
  pathname?: string;
  top?: boolean;
  loading?: boolean;
} = {}) {
  const s = store({ [TAB_KEY_STORAGE]: "tabKeyAna0001" });
  if (o.carried !== false) {
    keepDemo(s, { ...DEMO, role: o.role ?? "viewer" }, true, Date.now());
  }
  const host = win(o.pathname, o.top !== false);
  const doc = customerDoc(o.loading);
  const v = startEarlyLink({
    host,
    doc: doc as unknown as Document,
    store: s,
    record: RECORD,
  });
  const ws = FakeWS.all[FakeWS.all.length - 1] as FakeWS | undefined;
  return { v, host, doc, ws, s };
}
const welcome = (ws: FakeWS) =>
  ws.recv({
    t: "welcome",
    role: "viewer",
    sessionId: "demo-1",
    peerOnline: true,
    cid: "tab-new",
  });
const stageHere = (ws: FakeWS) =>
  ws.recv({ t: "peer", online: true, pid: "hans", cid: "stage-1" });
const domOut = (ws: FakeWS) =>
  ws.of("relay").filter((m) => m.data?.k === "dom");

describe("REQ-648 a link asks the deploy's time again after its welcome: the early link's first ask comes while its page is still loading", () => {
  beforeEach(fakeNet);
  afterEach(realNet);

  test("asked at the welcome and again at each TIME_AGAIN_MS; the quickest round trip sets now() — an answer that sat behind the page's own work never skews the clock for good", () => {
    jest.useFakeTimers();
    jest.setSystemTime(100_000);
    const link = connectDemo({
      sessionId: "demo-1",
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
      sessionId: "demo-1",
      peerOnline: false,
      cid: "tab-new",
    });
    expect(ws.of("time")).toEqual([{ t: "time", c: 100_000 }]);
    expect(TIME_AGAIN_MS.length).toBeGreaterThan(1);
    expect(Math.max(...TIME_AGAIN_MS)).toBeGreaterThan(3_000);
    // the page was busy loading: the answer sat in its queue, a 3 s round trip (nothing else is
    // answered meanwhile) — the clock is off by half of it
    jest.advanceTimersByTime(3_000);
    ws.recv({ t: "time", c: 100_000, s: 100_010 });
    expect(link.now() - Date.now()).toBe(-1_490);
    // the page idle since: every later ask is answered at once (the same clock on both ends)
    const late = ws.of("time").length;
    let answered = late;
    for (let t = 3_000; t <= Math.max(...TIME_AGAIN_MS) + 50; t += 50) {
      jest.advanceTimersByTime(50);
      const asks = ws.of("time");
      for (; answered < asks.length; answered++) {
        const c = asks[answered].c as number;
        ws.recv({ t: "time", c, s: c });
      }
    }
    expect(ws.of("time").length).toBe(1 + TIME_AGAIN_MS.length);
    expect(answered).toBeGreaterThan(late);
    expect(Math.abs(link.now() - Date.now())).toBeLessThanOrEqual(25);
    link.close();
    // a closed link asks nothing more
    const asked = ws.of("time").length;
    jest.advanceTimersByTime(60_000);
    expect(ws.of("time").length).toBe(asked);
  });
});

describe("REQ-648 the customer's link starts before the islands (early-link.ts)", () => {
  beforeEach(fakeNet);
  afterEach(realNet);

  test("no carried demo, a presenter's carry, a page in a frame, the stage itself: nothing opens", () => {
    expect(early({ carried: false }).v).toBeNull();
    expect(early({ role: "presenter" }).v).toBeNull();
    expect(early({ top: false }).v).toBeNull();
    expect(early({ pathname: STAGE_PATH }).v).toBeNull();
    expect(FakeWS.all.length).toBe(0);
  });

  test("a carried viewer demo: one socket to that demo, the browser tab said on the welcome's claim, and the page's snapshot as soon as a stage is there", () => {
    const { v, ws } = early();
    expect(v).not.toBeNull();
    expect(v!.demoId).toBe("demo-1");
    expect(FakeWS.all.length).toBe(1);
    expect(ws!.url).toMatch(/session=demo-1/);
    ws!.open();
    welcome(ws!);
    expect(ws!.of("claim")[0]).toMatchObject({
      t: "claim",
      tab: "tabKeyAna0001",
    });
    stageHere(ws!);
    return v!.sender.idle().then(() => {
      expect(domOut(ws!).length).toBeGreaterThan(0);
      v!.link.close();
    });
  });

  test("a stage before the document is parsed: the snapshot waits for DOMContentLoaded", async () => {
    const { v, ws, doc } = early({ loading: true });
    ws!.open();
    welcome(ws!);
    stageHere(ws!);
    await v!.sender.idle();
    expect(domOut(ws!).length).toBe(0);
    doc.readyState = "interactive";
    doc.fire("DOMContentLoaded", doc);
    await v!.sender.idle();
    expect(domOut(ws!).length).toBeGreaterThan(0);
    v!.link.close();
  });

  test("before the overlay: a resync is answered; the presenter's pointer and an end are kept for it", async () => {
    const { v, ws } = early();
    ws!.open();
    welcome(ws!);
    stageHere(ws!);
    await v!.sender.idle();
    const before = domOut(ws!).length;
    ws!.recv({
      t: "relay",
      from: "presenter",
      pid: "hans",
      cid: "stage-1",
      data: { k: "resync" },
    });
    await v!.sender.idle();
    expect(domOut(ws!).length).toBeGreaterThan(before);
    ws!.recv({
      t: "relay",
      from: "presenter",
      pid: "hans",
      cid: "stage-1",
      data: { k: "move", a: { vx: 0.5, vy: 0.5 }, t: 7 },
    });
    // the overlay takes over: the pointer is handed on
    const got: PeerMessage[] = [];
    const statuses: LinkStatus[] = [];
    v!.adopt({
      sessionId: "demo-1",
      role: "viewer",
      onPeer: (m: PeerMessage, _f: PeerFrom) => got.push(m),
      onStatus: (s: LinkStatus) => statuses.push(s),
      onPeerOnline: () => {},
      onEnded: () => {},
    });
    await Promise.resolve();
    expect(statuses).toEqual(["relay"]);
    expect(got).toEqual([{ k: "move", a: { vx: 0.5, vy: 0.5 }, t: 7 }]);
    v!.link.close();
  });

  test("an end heard before the overlay is handed on to it", async () => {
    const { v, ws } = early();
    ws!.open();
    welcome(ws!);
    stageHere(ws!);
    ws!.recv({ t: "ended", by: "presenter", pid: "hans" });
    const ends: unknown[][] = [];
    v!.adopt({
      sessionId: "demo-1",
      role: "viewer",
      onPeer: () => {},
      onStatus: () => {},
      onPeerOnline: () => {},
      onEnded: (...a: unknown[]) => ends.push(a),
    });
    await Promise.resolve();
    expect(ends).toEqual([["presenter", undefined, "hans"]]);
    v!.link.close();
  });

  test("the page goes before the overlay took the link: it says why (REQ-391) and its pointer goes; once taken over, the overlay says it, the early listener is gone", () => {
    const first = early();
    first.ws!.open();
    welcome(first.ws!);
    first.host.fire("pagehide");
    expect(first.ws!.of("leaving")).toEqual([{ t: "leaving", why: "closing" }]);
    expect(
      first.ws!.of("relay").some((m) => m.data?.k === "leave"),
    ).toBe(true);
    first.v!.link.close();

    const second = early();
    second.ws!.open();
    welcome(second.ws!);
    second.v!.adopt({
      sessionId: "demo-1",
      role: "viewer",
      onPeer: () => {},
      onStatus: () => {},
      onPeerOnline: () => {},
      onEnded: () => {},
    });
    expect(second.host.count("pagehide")).toBe(0);
    second.host.fire("pagehide");
    expect(second.ws!.of("leaving")).toEqual([]);
    second.v!.link.close();
  });

  test("taken over: the same link (no second socket), and every callback goes to the overlay from then on", async () => {
    const { v, ws, host, doc } = early();
    ws!.open();
    welcome(ws!);
    stageHere(ws!);
    const taken = takeEarlyLink(host, "demo-1");
    expect(taken).toBe(v);
    const online: number[] = [];
    const link = taken!.adopt({
      sessionId: "demo-1",
      role: "viewer",
      onPeer: () => {},
      onStatus: () => {},
      onPeerOnline: () => online.push(1),
      onEnded: () => {},
    });
    expect(link).toBe(v!.link);
    ws!.recv({ t: "sync" });
    expect(online).toEqual([1]);
    expect(FakeWS.all.length).toBe(1);
    // the overlay's frames hook: every frame the recorder sends moves its pointers (REQ-305)
    const frames: number[] = [];
    taken!.onFrame(() => frames.push(1));
    doc.body!.appendChild(h(doc, "p", {}, "a new row"));
    taken!.recorder.flush();
    expect(frames.length).toBe(1);
    v!.link.close();
  });

  test("nobody takes it over EARLY_ADOPT_MS after the page loaded (its overlay found no demo): closed, and the slot is no longer offered — a page is never mirrored without the pill on it", () => {
    jest.useFakeTimers();
    const { v, ws, host, doc } = early();
    ws!.open();
    welcome(ws!);
    doc.readyState = "complete";
    host.fire("load");
    jest.advanceTimersByTime(EARLY_ADOPT_MS - 1);
    expect(ws!.readyState).toBe(FakeWS.OPEN);
    jest.advanceTimersByTime(1);
    expect(ws!.readyState).toBe(FakeWS.CLOSED);
    expect(host[EARLY_SLOT]).toBe("taken");
    expect(takeEarlyLink(host, "demo-1")).toBeNull();
    expect(v!.demoId).toBe("demo-1");
  });

  test("…while one the overlay took over stays open", () => {
    jest.useFakeTimers();
    const { v, ws, host, doc } = early();
    ws!.open();
    welcome(ws!);
    takeEarlyLink(host, "demo-1")!.adopt({
      sessionId: "demo-1",
      role: "viewer",
      onPeer: () => {},
      onStatus: () => {},
      onPeerOnline: () => {},
      onEnded: () => {},
    });
    doc.readyState = "complete";
    host.fire("load");
    jest.advanceTimersByTime(EARLY_ADOPT_MS * 2);
    expect(ws!.readyState).toBe(FakeWS.OPEN);
    v!.link.close();
  });

  test("takeEarlyLink: the slot is the overlay's from then on — another demo's early link is closed (never two sockets), and a late early script opens nothing", () => {
    const { v, host, ws } = early();
    ws!.open();
    expect(takeEarlyLink(host, "demo-2")).toBeNull();
    expect(ws!.readyState).toBe(FakeWS.CLOSED);
    expect(host[EARLY_SLOT]).toBe("taken");
    const s = store({ [TAB_KEY_STORAGE]: "tabKeyAna0001" });
    keepDemo(s, DEMO, true, Date.now());
    const late = startEarlyLink({
      host,
      doc: customerDoc() as unknown as Document,
      store: s,
      record: RECORD,
    });
    expect(late).toBeNull();
    expect(FakeWS.all.length).toBe(1);
    expect(v!.demoId).toBe("demo-1");
  });
});

// ── the early script's URL ───────────────────────────────────────────────────────────────────

describe("REQ-648 the early script's URL (front-end/vite-demo-early.ts)", () => {
  const root = "/srv/app/front-end";
  const stand = `${root}/lib/demo-mode/early-src.ts`;
  const entry = `${root}/lib/demo-mode/demo-early.ts`;

  test("in dev: the server reads the script's own source, served by Vite (/@fs/); nothing is added to a build", () => {
    const p = demoEarly() as Any;
    expect(p.config({ root }, { command: "serve" })).toBeUndefined();
    p.configResolved({ root });
    const code = p.load.call({ environment: { name: "ssr" } }, stand);
    expect(code).toContain(`"/@fs${entry}"`);
    expect(code).toMatch(/export const DEMO_EARLY_SRC = /);
  });

  test("in a build: an input of its own for the browser, and the server reads the chunk it was built to", () => {
    const p = demoEarly() as Any;
    const cfg = p.config({ root }, { command: "build" });
    expect(cfg.environments.client.build.rollupOptions.input).toEqual({
      "pm-demo-early": entry,
    });
    p.configResolved({ root });
    p.generateBundle.call({ environment: { name: "client" } }, {}, {
      "assets/x.js": {
        type: "chunk",
        isEntry: true,
        name: "other",
        fileName: "assets/x.js",
      },
      "assets/pm-demo-early-Ab12.js": {
        type: "chunk",
        isEntry: true,
        name: "pm-demo-early",
        fileName: "assets/pm-demo-early-Ab12.js",
      },
    });
    const code = p.load.call({ environment: { name: "ssr" } }, stand);
    expect(code).toContain('"/assets/pm-demo-early-Ab12.js"');
  });

  test("any other module, and the browser's own build, are left alone", () => {
    const p = demoEarly() as Any;
    p.config({ root }, { command: "serve" });
    p.configResolved({ root });
    expect(p.load.call({ environment: { name: "ssr" } }, entry)).toBeNull();
    expect(p.load.call({ environment: { name: "client" } }, stand)).toBeNull();
  });
});

// ── the wiring ───────────────────────────────────────────────────────────────────────────────

describe("REQ-648 the wiring", () => {
  const app = read("front-end/routes/_app.tsx");
  const vite = read("front-end/vite.config.ts");
  const script = read("front-end/lib/demo-mode/demo-early.ts");
  const stand = read("front-end/lib/demo-mode/early-src.ts");
  const overlay = read("front-end/islands/DemoModeOverlay.tsx");
  const stage = read("front-end/islands/DemoStage.tsx");
  const replayer = read("front-end/lib/demo-mode/mirror-replay.ts");
  const transport = read("front-end/lib/demo-mode/transport.ts");
  const hub = read("backend/src/demo-mode/domain/coordinators/demo-hub/mod.ts");
  const socket = read(
    "backend/src/demo-mode/entrypoints/demo-mode-socket-controller/mod.ts",
  );

  test("_app.tsx puts the early script in the head of every signed-in page, async (it runs as soon as it is in)", () => {
    expect(app).toMatch(
      /import \{ DEMO_EARLY_SRC \} from "\.\.\/lib\/demo-mode\/early-src\.ts"/,
    );
    const head = app.slice(app.indexOf("<head>"), app.indexOf("</head>"));
    expect(head).toMatch(
      /hasSession && DEMO_EARLY_SRC[\s\S]{0,80}<script type="module" async src=\{DEMO_EARLY_SRC\}/,
    );
    expect(stand).toMatch(
      /export const DEMO_EARLY_SRC: string \| null = null;/,
    );
    expect(vite).toMatch(
      /import \{ demoEarly \} from "\.\/vite-demo-early\.ts"/,
    );
    expect(vite).toMatch(/demoEarly\(\)/);
  });

  test("the early script starts the early link and imports nothing of an island", () => {
    expect(script).toMatch(/startEarlyLink\(/);
    expect(script).not.toMatch(/islands\//);
    const linkSrc = read("front-end/lib/demo-mode/early-link.ts");
    expect(linkSrc).not.toMatch(/from "[^"]*islands\//);
    expect(linkSrc).not.toMatch(/from "preact/);
  });

  test("the overlay takes the early link over with the options it would have opened one with — its sender, recorder and socket — and its frames move the overlay's pointers", () => {
    expect(overlay).toMatch(
      /const early = takeEarlyLink\(globalThis, demo\.id\)/,
    );
    expect(overlay).toMatch(
      /const sender = early\?\.sender \?\? createMirrorSender\(/,
    );
    expect(overlay).toMatch(
      /const recorder = early\?\.recorder \?\? createRecorder\(/,
    );
    expect(overlay).toMatch(/early\?\.onFrame\(shifted\)/);
    expect(overlay).toMatch(/link = \(early\?\.adopt \?\? connectDemo\)\(\{/);
  });

  test("the server stamps a page's `leaving` and its departure carries it; the stage's link hands it on", () => {
    expect(socket).toMatch(/peer\.leftAt = Date\.now\(\)/);
    expect(hub).toMatch(/at: peer\.leftAt/);
    expect(transport).toMatch(/onPageGone\?\.\(/);
  });

  test("the stage: a page clock fed by onPageGone and by the replay's onShown — which alone ends the wait — the pill gets the page wait, the chip the page figure", () => {
    expect(stage).toMatch(/createPageClock\(/);
    expect(stage).toMatch(/onPageGone: \(at\) => pages\.left\(at\)/);
    expect(stage).toMatch(/onShown: \(\) => pageShownRef\.current\(\)/);
    const shown = stage.slice(stage.indexOf("const pageShown = () => {"));
    const body = shown.slice(0, shown.indexOf("\n  };") + 4);
    expect(body).toMatch(/setAwaiting\(false\)/);
    expect(body).toMatch(/\.shown\(\)/);
    const snap = stage.slice(
      stage.indexOf('if (f.t === "snap") {'),
      stage.indexOf("const pageShown"),
    );
    expect(snap).not.toMatch(/setAwaiting\(false\)/);
    expect(stage).toMatch(/pageBehind: lagView\.page/);
    expect(stage).toMatch(
      /t\("demoMode\.loadingNextBehind", \{ n: live\.n \}\)/,
    );
    const fn = stage.slice(stage.indexOf("function mirrorStatsText("));
    expect(fn.slice(0, fn.indexOf("\n}"))).toMatch(/page \$\{/);
    expect(replayer).toMatch(/opts\.onShown\?\.\(\)/);
  });

  test("while the stage waits for their next page: the frame is dimmed and his pointer is not sent — not a move, not the look-up of his still mouse, not a click", () => {
    expect(stage).toMatch(/const loadingNext = live\.key === "loadingNext"/);
    expect(stage).toMatch(/loadingNextRef\.current = loadingNext/);
    expect(stage).toMatch(/stageFrameLook\(\{[^}]*loadingNext/);
    const throttle = stage.slice(stage.indexOf("const throttle = useMemo"));
    expect(throttle.slice(0, throttle.indexOf("}), []);"))).toMatch(
      /if \(loadingNextRef\.current\) return;/,
    );
    const restAgain = stage.slice(stage.indexOf("const restAgain = () => {"));
    expect(restAgain.slice(0, restAgain.indexOf("\n  };"))).toMatch(
      /loadingNextRef\.current/,
    );
    const click = stage.slice(stage.indexOf("const sendClick = "));
    expect(click.slice(0, click.indexOf(";\n"))).toMatch(
      /loadingNextRef\.current/,
    );
  });
});
