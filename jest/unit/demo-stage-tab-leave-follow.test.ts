/**
 * REQ-823 — demo-loop cycle dm1, issues m8 ("Stage banner says 'Now showing …'s other tab' after a
 * navigation in the same tab") and M2 ("After the customer logs out with a second tab open, the
 * stage shows 'Live' on the background /quotes tab"). RCA at demo-fixes cbcae62d:
 *
 *   - m8: an address-bar navigation, `page.goto` or the browser's reload button fires no Navigation
 *     API `navigate`, so the leaving page says "closing" (leave-hint.ts). transport.ts `tabLeft`
 *     held the followed browser tab for "navigating" only: with another tab connected the stage
 *     switched to it at once and back when the same tab's next page claimed ~1 s later, and
 *     DemoStage's `followTabs` read A→B→A as a tab switch ("Now showing {name}'s other tab").
 *   - M2: the customer's sign-out (DashSidebar's `pm:logout`, then `location.href = "/"`) went out
 *     as "navigating" (a 5 s "Loading their next page…" for a page that never comes — "/" has no
 *     session, so no overlay), then the stage fell back to her other tab, whose session was dead
 *     too: nothing in demo mode heard the sign-out, and the backend left its sockets open.
 *
 * The fix: a followed browser tab whose page goes closing (or says nothing) while another tab is
 * open is held for SILENT_GRACE_MS — the same tab's next page takes the stage back, a real close
 * falls over after it; followTabs weighs a follow against the tab last ON SHOW (A→B unseen→A is no
 * switch); a page says `signout` as it goes after the sign-out event, the overlay says it and
 * closes its link at once and tells the browser's other tabs; a stage whose followed tab signed
 * out says "{name} signed out" at once and follows no other tab of the dead session.
 */
import * as fs from "fs";
import * as path from "path";
import {
  parseClientMessage,
  parseServerMessage,
  PRESENCE_GRACE_MS,
  SILENT_GRACE_MS,
} from "../../shared/demo-mode/protocol";
import {
  connectDemo,
  type LinkStatus,
} from "../../front-end/lib/demo-mode/transport";
import { watchLeaveHint } from "../../front-end/lib/demo-mode/leave-hint";

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
  const pageGone: { at: number; why?: string }[] = [];
  let signedOut = 0;
  const link = connectDemo({
    sessionId: "s1",
    role: "presenter",
    pid: "hans",
    onPeer: () => {},
    onStatus: (s: LinkStatus) => statuses.push(s),
    onPeerOnline: (cid?: string) => followed.push(cid),
    onEnded: () => {},
    onPageGone: (at: number, why?: string) => pageGone.push({ at, why }),
    // REQ-823 (M2) — the followed tab's customer signed out
    onSignedOut: () => void signedOut++,
  } as Any);
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
    pageGone,
    signedOut: () => signedOut,
    status: () => statuses[statuses.length - 1],
    following: () => followed[followed.length - 1],
    online: (cid: string) => ws.recv({ t: "peer", online: true, cid }),
    gone: (cid: string, why?: string) =>
      ws.recv({ t: "peer", online: false, cid, ...(why ? { why } : {}) }),
    claim: (cid: string, at: number, tab?: string, f?: 1, i?: 1) =>
      ws.recv({
        t: "claim",
        cid,
        at,
        ...(tab ? { tab } : {}),
        ...(f ? { f } : {}),
        ...(i ? { i } : {}),
      }),
    /** what this stage sent addressed to a tab (sync, a relay) */
    to: (cid: string) =>
      ws.sent.filter((m) =>
        (m.t === "sync" && m.to === cid) || (m.t === "relay" && m.tab === cid)
      ),
    /** the connections it offered, by tab */
    offers: (cid: string) =>
      ws.sent.filter((m) =>
        m.t === "signal" && m.to === cid &&
        m.data?.description?.type === "offer"
      ),
  };
}

/** the demo's state: the app tab (browser tab A) claimed last, /quotes (browser tab Q) open
 *  behind it — the tester's two tabs, both "visible" as headless says of every tab */
function appTabInFrontOfQuotes() {
  const s = stage();
  s.online("a1");
  s.claim("a1", 100, "tab-A", 1);
  s.online("q1");
  s.claim("q1", 200, "tab-Q", 1);
  s.claim("a1", 300, "tab-A", 1); // the customer came back to the app tab and used it
  expect(s.following()).toBe("a1");
  return s;
}

describe("REQ-823 m8 — a same-tab navigation the page cannot tell from a close: the stage holds that browser tab for SILENT_GRACE_MS", () => {
  test("the followed tab says it is CLOSING (an address-bar navigation, page.goto, the reload button) while /quotes is open: 'between', /quotes never synced, offered or named — and the same tab's next page takes the stage back", () => {
    jest.useFakeTimers();
    const s = appTabInFrontOfQuotes();
    const n = s.followed.length;
    const toQ = s.to("q1").length;

    s.gone("a1", "closing");
    expect(s.followed.length).toBe(n); // no onPeerOnline("q1") — the banner's trigger
    expect(s.status()).toBe("between");
    expect(s.to("q1").length).toBe(toQ); // no sync, no leave sent to /quotes

    // about a second later the same browser tab's next page arrives; it has not said who it is
    jest.advanceTimersByTime(900);
    s.online("a2");
    expect(s.followed.length).toBe(n);
    expect(s.status()).toBe("between");

    // its claim names browser tab A (its load claim: newer than /quotes'): the stage is back on it
    s.claim("a2", 1_000, "tab-A");
    expect(s.followed.slice(n)).toEqual(["a2"]);
    expect(s.status()).toBe("relay");

    // the hold running out later changes nothing; /quotes was never asked for anything
    jest.advanceTimersByTime(SILENT_GRACE_MS * 3);
    expect(s.followed.slice(n)).toEqual(["a2"]);
    expect(s.to("q1").length).toBe(toQ);
    expect(s.offers("q1")).toEqual([]);
    s.link.close();
  });

  test("a page that went without a word (a crash, a lost network) is held the same way: its next page takes the stage back", () => {
    jest.useFakeTimers();
    const s = appTabInFrontOfQuotes();
    const n = s.followed.length;
    s.gone("a1");
    expect(s.followed.length).toBe(n);
    expect(s.status()).toBe("between");
    jest.advanceTimersByTime(1_200);
    s.online("a2");
    s.claim("a2", 0, "tab-A"); // its welcome claim: never claimed itself, at 0
    expect(s.followed.slice(n)).toEqual(["a2"]);
    expect(s.status()).toBe("relay");
    s.link.close();
  });

  test("a real close: no page of that tab comes — the stage falls over to /quotes once SILENT_GRACE_MS is up, not before", () => {
    jest.useFakeTimers();
    const s = appTabInFrontOfQuotes();
    const n = s.followed.length;
    s.gone("a1", "closing");
    jest.advanceTimersByTime(SILENT_GRACE_MS - 100);
    expect(s.followed.length).toBe(n);
    expect(s.status()).toBe("between");
    jest.advanceTimersByTime(200);
    expect(s.following()).toBe("q1");
    expect(s.followed.slice(n)).toEqual(["q1"]);
    expect(s.status()).toBe("relay");
    s.link.close();
  });

  test("during the hold the customer really uses /quotes (a newer claim): the stage follows /quotes at once", () => {
    jest.useFakeTimers();
    const s = appTabInFrontOfQuotes();
    s.gone("a1", "closing");
    s.claim("q1", 400, "tab-Q", 1, 1);
    expect(s.following()).toBe("q1");
    expect(s.status()).toBe("relay");
    s.link.close();
  });

  // REQ-823 AMENDMENT (REQ-838, demo-loop cycle dm2, m5) — with no other tab open the closing page
  // is held the same way: "between" for SILENT_GRACE_MS, never "waiting" at once (the stage's
  // "Waiting for {name}'s app…" flashed at every address-bar navigation)
  test("no other tab is open: a closing page is 'between' (held for SILENT_GRACE_MS, REQ-838), and the same tab's next page is followed when it comes", () => {
    jest.useFakeTimers();
    const s = stage();
    s.online("a1");
    s.claim("a1", 100, "tab-A", 1);
    const k = s.statuses.length;
    s.gone("a1", "closing");
    expect(s.statuses.slice(k)).toEqual(["between"]);
    s.online("a2");
    s.claim("a2", 0, "tab-A");
    expect(s.following()).toBe("a2");
    expect(s.status()).toBe("relay");
    expect(s.statuses.slice(k)).toEqual(["between", "relay"]);
    s.link.close();
  });

  test("a background tab closing changes nothing on the stage", () => {
    jest.useFakeTimers();
    const s = appTabInFrontOfQuotes();
    const n = s.followed.length;
    s.gone("q1", "closing");
    expect(s.followed.length).toBe(n);
    expect(s.following()).toBe("a1");
    expect(s.status()).toBe("relay");
    s.link.close();
  });
});

describe("REQ-823 M2 — the customer signed out: the stage says so at once and follows no other tab of the dead session", () => {
  test("the followed tab signs out with /quotes open: 'waiting' at once — never 'between' — onSignedOut, no page clock; /quotes is never synced, offered or named, however long; its own departure changes nothing", () => {
    jest.useFakeTimers();
    const s = appTabInFrontOfQuotes();
    const n = s.followed.length;
    const toQ = s.to("q1").length;
    const k = s.statuses.length;

    s.gone("a1", "signout");
    expect(s.statuses.slice(k)).toEqual(["waiting"]);
    expect(s.signedOut()).toBe(1);
    expect(s.pageGone).toEqual([]); // no "Loading their next page… N s behind"
    expect(s.followed.length).toBe(n);

    jest.advanceTimersByTime(PRESENCE_GRACE_MS * 3);
    expect(s.followed.length).toBe(n);
    expect(s.to("q1").length).toBe(toQ);
    expect(s.offers("q1")).toEqual([]);
    expect(s.status()).toBe("waiting");
    expect(s.statuses.slice(k)).not.toContain("between");

    // the other tab's overlay heard the sign-out too and closed its link
    s.gone("q1", "signout");
    expect(s.status()).toBe("waiting");
    expect(s.followed.length).toBe(n);
    s.link.close();
  });

  test("the only tab signs out: 'waiting' at once — no grace", () => {
    jest.useFakeTimers();
    const s = stage();
    s.online("a1");
    s.claim("a1", 100, "tab-A", 1);
    const k = s.statuses.length;
    s.gone("a1", "signout");
    expect(s.statuses.slice(k)).toEqual(["waiting"]);
    expect(s.signedOut()).toBe(1);
    expect(s.pageGone).toEqual([]);
    s.link.close();
  });

  test("after the sign-out a tab that is really used since (her phone, another session) is followed; an old claim said again is not", () => {
    jest.useFakeTimers();
    const s = appTabInFrontOfQuotes();
    const n = s.followed.length;
    s.gone("a1", "signout");
    s.claim("q1", 200, "tab-Q", 1); // said again on a welcome: from before the sign-out
    expect(s.followed.length).toBe(n);
    expect(s.status()).toBe("waiting");
    s.claim("q1", 900, "tab-Q", 1, 1); // the customer taps it
    expect(s.followed.slice(n)).toEqual(["q1"]);
    expect(s.status()).toBe("relay");
    s.link.close();
  });

  test("after the sign-out the same browser tab signed in again (a page with its key) is followed at once", () => {
    jest.useFakeTimers();
    const s = appTabInFrontOfQuotes();
    const n = s.followed.length;
    s.gone("a1", "signout");
    s.online("a2");
    expect(s.followed.length).toBe(n);
    s.claim("a2", 0, "tab-A");
    expect(s.followed.slice(n)).toEqual(["a2"]);
    expect(s.status()).toBe("relay");
    s.link.close();
  });

  test("a tab the stage does not follow signing out changes nothing (her other device's tab stays followed)", () => {
    jest.useFakeTimers();
    const s = appTabInFrontOfQuotes();
    const n = s.followed.length;
    s.gone("q1", "signout");
    expect(s.signedOut()).toBe(0);
    expect(s.followed.length).toBe(n);
    expect(s.status()).toBe("relay");
    s.link.close();
  });
});

describe("REQ-823 m8 — followTabs weighs a follow against the browser tab last ON SHOW", () => {
  const pa = () =>
    require("../../shared/demo-mode/presenter-anchor") as {
      followTabs(): {
        follow(cid: string | undefined, key?: string): boolean;
        learn(cid: string, key: string): boolean;
        shown(): void;
        unsure(): boolean;
      };
    };

  test("A on show → B followed but never on show → A's next page: no switch (no banner); A → B on show → A: a switch, said", () => {
    const t = pa().followTabs();
    expect(t.follow("a1", "tab-A")).toBe(false);
    t.shown();
    // the stage fell over to B: a switch (B's page is not in yet)
    expect(t.follow("b1", "tab-B")).toBe(true);
    // A's next page before any page of B showed: the tab he was looking at
    expect(t.follow("a2", "tab-A")).toBe(false);
    t.shown();
    expect(t.follow("b2", "tab-B")).toBe(true);
    t.shown(); // B's page on show: he saw tab B
    expect(t.follow("a3", "tab-A")).toBe(true);
  });

  test("keys said late (onPeerTab → learn): B never on show, then A's next page is no switch; a page on show before its key counts once the key comes", () => {
    const t = pa().followTabs();
    t.follow("a1", "tab-A");
    t.shown();
    expect(t.follow("b1", undefined)).toBe(false);
    expect(t.learn("b1", "tab-B")).toBe(true);
    expect(t.follow("a2", undefined)).toBe(false);
    expect(t.unsure()).toBe(true);
    expect(t.learn("a2", "tab-A")).toBe(false);
    expect(t.unsure()).toBe(false);
    expect(t.follow("b2", undefined)).toBe(false);
    t.shown();
    expect(t.learn("b2", "tab-B")).toBe(true);
    expect(t.follow("a3", "tab-A")).toBe(true);
  });
});

describe("REQ-823 M2 — the wire and the page say `signout`", () => {
  test("a tab's `leaving` may say signout, and its departure carries it", () => {
    expect(parseClientMessage('{"t":"leaving","why":"signout"}')).toEqual({
      t: "leaving",
      why: "signout",
    });
    expect(
      parseServerMessage(
        '{"t":"peer","online":false,"cid":"t1","why":"signout"}',
      ),
    ).toEqual({ t: "peer", online: false, cid: "t1", why: "signout" });
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

  test("after the app's sign-out event (pm:logout) the page goes for 'signout' — the redirect's own navigation behind it changes nothing; stop() lets go of it", () => {
    const win = target();
    const navigation = target();
    const hint = watchLeaveHint(
      {
        location: {
          href: "https://app.test/quotes",
          origin: "https://app.test",
        },
        navigation,
        addEventListener: win.addEventListener,
        removeEventListener: win.removeEventListener,
      },
      () => 5_000,
    );
    expect(hint.why()).toBe("closing");
    win.fire("pm:logout");
    expect(hint.why()).toBe("signout");
    // DashSidebar then sets location.href = "/": a navigation of this app
    navigation.fire("navigate", {
      destination: { url: "https://app.test/", sameDocument: false },
      downloadRequest: null,
    });
    expect(hint.why()).toBe("signout");
    hint.stop();
    expect(win.count() + navigation.count()).toBe(0);
  });
});

describe("REQ-823 M2 — the sign-out reaches this tab's overlay and the browser's other tabs (signout-signal)", () => {
  const sig = () =>
    require("../../front-end/lib/demo-mode/signout-signal") as {
      SIGNOUT_EVENT: string;
      onSignout(
        fn: () => void,
        opts?: { win?: Any; channel?: () => Any },
      ): () => void;
    };

  function fakeWin() {
    const ls = new Map<string, Set<(e: Any) => void>>();
    return {
      addEventListener(t: string, f: (e: Any) => void) {
        if (!ls.has(t)) ls.set(t, new Set());
        ls.get(t)!.add(f);
      },
      removeEventListener(t: string, f: (e: Any) => void) {
        ls.get(t)?.delete(f);
      },
      fire(t: string) {
        for (const f of [...(ls.get(t) ?? [])]) f({ type: t });
      },
      count: (t: string) => ls.get(t)?.size ?? 0,
    };
  }
  function fakeChannel() {
    const ls = new Set<(e: { data: unknown }) => void>();
    const posted: unknown[] = [];
    return {
      posted,
      closed: 0,
      postMessage(m: unknown) {
        posted.push(m);
      },
      addEventListener(_t: "message", f: (e: { data: unknown }) => void) {
        ls.add(f);
      },
      removeEventListener(_t: "message", f: (e: { data: unknown }) => void) {
        ls.delete(f);
      },
      close() {
        this.closed++;
      },
      /** a post from another tab of the browser */
      from(data: unknown) {
        for (const f of [...ls]) f({ data });
      },
    };
  }

  test("DashSidebar's event is the one heard: pm:logout", () => {
    expect(sig().SIGNOUT_EVENT).toBe("pm:logout");
    expect(read("front-end/islands/DashSidebar.tsx")).toMatch(
      /dispatchEvent\(new Event\("pm:logout"\)\)/,
    );
  });

  test("this tab's sign-out is heard at once and told to the other tabs; another tab's is heard (not told again); junk is not; unsubscribe lets go of both", () => {
    const { onSignout } = sig();
    const win = fakeWin();
    const chan = fakeChannel();
    let heard = 0;
    const off = onSignout(() => void heard++, { win, channel: () => chan });
    win.fire("pm:logout");
    expect(heard).toBe(1);
    expect(chan.posted).toEqual([{ k: "signout" }]);
    chan.from({ k: "signout" });
    expect(heard).toBe(2);
    expect(chan.posted).toHaveLength(1);
    chan.from({ k: "impersonating" });
    chan.from(null);
    expect(heard).toBe(2);
    off();
    expect(win.count("pm:logout")).toBe(0);
    expect(chan.closed).toBe(1);
    win.fire("pm:logout");
    chan.from({ k: "signout" });
    expect(heard).toBe(2);
  });

  test("no BroadcastChannel in the runtime: this tab still hears its own sign-out", () => {
    const { onSignout } = sig();
    const win = fakeWin();
    let heard = 0;
    const off = onSignout(() => void heard++, { win, channel: () => null });
    win.fire("pm:logout");
    expect(heard).toBe(1);
    off();
  });
});

describe("REQ-823 the wiring: the overlay, the stage, the words", () => {
  const overlay = read("front-end/islands/DemoModeOverlay.tsx");
  const stageSrc = read("front-end/islands/DemoStage.tsx");
  const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
  const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

  test("M2: the overlay hears the sign-out (onSignout) — says leaving('signout') on its link and closes it BEFORE the redirect, forgets the carried demo and drops it", () => {
    expect(overlay).toMatch(
      /import \{ onSignout \} from "\.\.\/lib\/demo-mode\/signout-signal\.ts";/,
    );
    const at = overlay.indexOf("onSignout(");
    expect(at).toBeGreaterThan(0);
    const body = overlay.slice(at, at + 900);
    const said = body.indexOf('leaving("signout")');
    const closed = body.indexOf(".close()");
    expect(said).toBeGreaterThan(0);
    expect(closed).toBeGreaterThan(said);
    expect(body).toMatch(/forgetDemo\(sessionStore\(\)\)/);
    expect(body).toMatch(/setDemo\(null\)/);
  });

  test("m8: the stage tells followTabs when the followed tab's page is on show, and a follow that is no switch drops a pending tab notice", () => {
    const shown = stageSrc.slice(stageSrc.indexOf("const pageShown = () => {"));
    expect(shown.slice(0, shown.indexOf("\n  };"))).toMatch(
      /tabsRef\.current\.shown\(\);/,
    );
    expect(stageSrc).toMatch(
      /if \(tabsRef\.current\.follow\(cid, tab\)\) otherTab\(\);\s*else switchedRef\.current = false;/,
    );
  });

  test("M2: the stage hears the sign-out (onSignedOut) and says '{name} signed out' in the pill and on the waiting banner until a tab is followed again", () => {
    expect(stageSrc).toMatch(/onSignedOut: \(\) => setSignedOut\(true\)/);
    const online = stageSrc.slice(
      stageSrc.indexOf("onPeerOnline: (cid, tab) => {"),
    );
    expect(online.slice(0, online.indexOf("\n      },\n"))).toMatch(
      /setSignedOut\(false\)/,
    );
    expect(stageSrc).toMatch(/t\("demoMode\.signedOut", \{ name \}\)/);
    const banner = stageSrc.slice(stageSrc.indexOf('data-cy="demo-waiting"'));
    const bannerBody = banner.slice(
      0,
      banner.indexOf("</div>\n              </div>"),
    );
    expect(bannerBody).toMatch(/signedOut/);
    expect(bannerBody).toMatch(/demoMode\.signedOutKeep/);
  });

  test("the words, en and es", () => {
    expect(en["demoMode.signedOut"]).toBe("{name} signed out");
    expect(es["demoMode.signedOut"]).toBe("{name} cerró sesión");
    expect(en["demoMode.signedOutKeep"]).toBe(
      "Their last screen stays here until they sign in again.",
    );
    expect(es["demoMode.signedOutKeep"]).toBe(
      "Su última pantalla se queda aquí hasta que vuelva a iniciar sesión.",
    );
  });
});
