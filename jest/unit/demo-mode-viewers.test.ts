/**
 * REQ-232 — every customer tab and every staff window is its own connection (the demo's B3,
 * demo-lifecycle-m1, demo-lifecycle-m3, demo-lifecycle-p1 and M21; demo-rca.md "demo-lifecycle").
 *
 *   - the wire: welcome, presence, signals and relays carry the socket's `cid`; a tab's `claim`, a
 *     stage's `sync` and a stage's `replaced` parse; junk does not.
 *   - the transport, on a fake socket (and a fake RTCPeerConnection where the addressing matters):
 *     a stage keeps the SET of the customer's tabs — one leaving while another is there never shows
 *     "waiting", a page change inside the grace never shows it; it follows the tab that claimed last
 *     and drops the others' messages; it falls back to the tab used most recently (and asks it for
 *     its whole view) when the followed one leaves; its offer is addressed to one tab; the customer
 *     keeps one connection per stage — two windows of one account included; a replaced stage stops
 *     for good; a tab re-claims after a reconnect and when a new stage arrives.
 *   - the wiring: plain status words in both languages, no "accept", no "direct"/"relay"; the
 *     overlay claims and never moves a staff page onto the stage on its own; the banner leaves the
 *     demo before handing the account back.
 */
import * as fs from "fs";
import * as path from "path";
import {
  parseClientMessage,
  parseServerMessage,
  type PeerMessage,
  PRESENCE_GRACE_MS,
  type Role,
} from "../../shared/demo-mode/protocol";
import {
  connectDemo,
  type LinkStatus,
  type PeerFrom,
} from "../../front-end/lib/demo-mode/transport";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// ── a fake socket and a fake RTCPeerConnection ──────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
type Any = any;

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
  // the test's side
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

class FakeChannel {
  readyState = "connecting";
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  constructor(public label: string) {}
  send() {}
  close() {
    this.readyState = "closed";
  }
}

class FakePC {
  static all: FakePC[] = [];
  closed = false;
  connectionState = "new";
  localDescription: Any = null;
  remote: Any = null;
  onicecandidate: ((e: Any) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((e: Any) => void) | null = null;
  constructor() {
    FakePC.all.push(this);
  }
  createDataChannel(label: string) {
    return new FakeChannel(label);
  }
  createOffer() {
    return Promise.resolve({ type: "offer", sdp: "o" });
  }
  createAnswer() {
    return Promise.resolve({ type: "answer", sdp: "a" });
  }
  setLocalDescription(d: Any) {
    this.localDescription = { ...d, toJSON: () => d };
    return Promise.resolve();
  }
  setRemoteDescription(d: Any) {
    this.remote = d;
    return Promise.resolve();
  }
  addIceCandidate() {
    return Promise.resolve();
  }
  close() {
    this.closed = true;
    this.connectionState = "closed";
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
  FakePC.all = [];
  g.WebSocket = FakeWS;
  Object.defineProperty(globalThis, "location", {
    value: { protocol: "http:", host: "demo.test" },
    configurable: true,
    writable: true,
  });
  delete g.RTCPeerConnection;
});
afterEach(() => {
  jest.useRealTimers();
  g.WebSocket = saved.WebSocket;
  Object.defineProperty(globalThis, "location", {
    value: saved.location,
    configurable: true,
    writable: true,
  });
  if (saved.RTCPeerConnection) g.RTCPeerConnection = saved.RTCPeerConnection;
  else delete g.RTCPeerConnection;
});

/** flush the promise chains a signal starts */
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

function link(role: Role, pid?: string) {
  const statuses: LinkStatus[] = [];
  const got: { m: PeerMessage; from: PeerFrom }[] = [];
  const presence: [string, boolean][] = [];
  let wholeViewAsks = 0;
  const l = connectDemo({
    sessionId: "s1",
    role,
    ...(pid ? { pid } : {}),
    onPeer: (m, from) => got.push({ m, from }),
    onStatus: (s) => statuses.push(s),
    onPeerOnline: () => wholeViewAsks++,
    onPresence: (p, on) => presence.push([p, on]),
    onEnded: () => {},
  });
  const ws = FakeWS.all[FakeWS.all.length - 1];
  return {
    link: l,
    ws,
    statuses,
    got,
    presence,
    asks: () => wholeViewAsks,
    status: () => statuses[statuses.length - 1],
  };
}

/** a stage, its socket open and welcomed */
function stage(pid = "hans", cid = "stage-1") {
  const s = link("presenter", pid);
  s.ws.open();
  s.ws.recv({
    t: "welcome",
    role: "presenter",
    sessionId: "s1",
    peerOnline: false,
    pid,
    cid,
  });
  return s;
}
const tabOnline = (ws: FakeWS, cid: string, online = true) =>
  ws.recv({ t: "peer", online, cid });
/** REQ-242 — what a tab sends is its screen as mirror chunks; the path rides in the chunk text */
const view = (path: string) => ({
  k: "dom",
  l: "lp0q1x2-ab12",
  s: 0,
  i: 0,
  n: 1,
  d: path,
});
const fromTab = (ws: FakeWS, cid: string, path: string) =>
  ws.recv({ t: "relay", from: "viewer", cid, data: view(path) });
/** the statuses from the first time a tab was there (before that, "waiting" is the truth) */
const sinceLive = (st: LinkStatus[]) =>
  st.slice(Math.max(0, st.indexOf("relay")));
const paths = (got: { m: PeerMessage }[]) =>
  got.flatMap((x) => x.m.k === "dom" ? [x.m.d] : []);

describe("REQ-232 the wire carries the socket", () => {
  test("welcome, presence, signals and relays carry the cid; claim, sync and replaced parse; junk does not", () => {
    expect(
      parseServerMessage(
        '{"t":"welcome","role":"viewer","sessionId":"s1","peerOnline":true,"cid":"c1"}',
      ),
    ).toEqual({
      t: "welcome",
      role: "viewer",
      sessionId: "s1",
      peerOnline: true,
      cid: "c1",
    });
    expect(parseServerMessage('{"t":"peer","online":false,"cid":"c2"}'))
      .toEqual({ t: "peer", online: false, cid: "c2" });
    expect(
      parseServerMessage('{"t":"peer","online":true,"pid":"hans","cid":"s9"}'),
    ).toEqual({ t: "peer", online: true, pid: "hans", cid: "s9" });
    expect(
      parseServerMessage(
        '{"t":"signal","from":"viewer","cid":"c1","data":{"sdp":"a"}}',
      ),
    ).toEqual({ t: "signal", from: "viewer", cid: "c1", data: { sdp: "a" } });
    expect(
      parseServerMessage(
        '{"t":"relay","from":"viewer","cid":"c1","data":{"k":"leave"}}',
      ),
    ).toEqual({ t: "relay", from: "viewer", cid: "c1", data: { k: "leave" } });
    expect(parseServerMessage('{"t":"claim","cid":"c1","at":17}')).toEqual({
      t: "claim",
      cid: "c1",
      at: 17,
    });
    expect(parseServerMessage('{"t":"claim","at":17}')).toBeNull();
    expect(parseServerMessage('{"t":"claim","cid":"c1","at":"x"}'))
      .toBeNull();
    expect(parseServerMessage('{"t":"sync"}')).toEqual({ t: "sync" });
    expect(parseServerMessage('{"t":"replaced"}')).toEqual({ t: "replaced" });
    // a cid that is not a string is dropped, as a pid is
    expect(parseServerMessage('{"t":"peer","online":true,"cid":7}')).toEqual({
      t: "peer",
      online: true,
    });

    expect(parseClientMessage('{"t":"claim","at":1700}')).toEqual({
      t: "claim",
      at: 1700,
    });
    expect(parseClientMessage('{"t":"claim","at":"soon"}')).toEqual({
      t: "claim",
      at: 0,
    });
    expect(parseClientMessage('{"t":"sync","to":"c1"}')).toEqual({
      t: "sync",
      to: "c1",
    });
    expect(parseClientMessage('{"t":"sync"}')).toBeNull();
  });

  test("the grace is a few seconds: long enough for a page load, short enough to tell a closed app", () => {
    expect(PRESENCE_GRACE_MS).toBeGreaterThanOrEqual(3_000);
    expect(PRESENCE_GRACE_MS).toBeLessThanOrEqual(10_000);
  });
});

describe("REQ-232 a stage keeps the set of the customer's tabs (B3, demo-lifecycle-m1)", () => {
  test("a tab closing while another is still there never shows waiting", () => {
    const s = stage();
    tabOnline(s.ws, "t1");
    tabOnline(s.ws, "t2");
    expect(s.status()).toBe("relay");
    tabOnline(s.ws, "t2", false);
    expect(s.status()).toBe("relay");
    expect(sinceLive(s.statuses)).not.toContain("waiting");
    s.link.close();
  });

  test("a page change (the tab's socket goes, the new page's comes) inside the grace never shows waiting; nobody back after it does", () => {
    jest.useFakeTimers();
    const s = stage();
    tabOnline(s.ws, "t1");
    expect(s.status()).toBe("relay");
    tabOnline(s.ws, "t1", false);
    jest.advanceTimersByTime(PRESENCE_GRACE_MS - 500);
    tabOnline(s.ws, "t1-next");
    jest.advanceTimersByTime(PRESENCE_GRACE_MS * 2);
    expect(sinceLive(s.statuses)).not.toContain("waiting");
    expect(s.status()).toBe("relay");
    tabOnline(s.ws, "t1-next", false);
    expect(s.status()).toBe("relay");
    jest.advanceTimersByTime(PRESENCE_GRACE_MS + 50);
    expect(s.status()).toBe("waiting");
    s.link.close();
  });

  test("the stage follows the tab that claimed last: another tab's view never reaches it until that tab claims; each switch asks the new tab for its whole view", () => {
    const s = stage();
    tabOnline(s.ws, "t1");
    s.ws.recv({ t: "claim", cid: "t1", at: 100 });
    expect(s.ws.of("sync")).toEqual([{ t: "sync", to: "t1" }]);
    fromTab(s.ws, "t1", "/dashboard");
    tabOnline(s.ws, "t2");
    fromTab(s.ws, "t2", "/settings");
    expect(paths(s.got)).toEqual(["/dashboard"]);
    // tab 2 is the one the customer uses now
    s.ws.recv({ t: "claim", cid: "t2", at: 200 });
    expect(s.ws.of("sync")).toEqual([
      { t: "sync", to: "t1" },
      { t: "sync", to: "t2" },
    ]);
    fromTab(s.ws, "t2", "/settings");
    fromTab(s.ws, "t1", "/dashboard");
    expect(paths(s.got)).toEqual(["/dashboard", "/settings"]);
    // the customer's pointer from the tab left behind is hidden
    expect(s.got.some((x) => x.m.k === "leave" && x.from.cid === "t1")).toBe(
      true,
    );
    // an old claim arriving late never takes it back
    s.ws.recv({ t: "claim", cid: "t1", at: 150 });
    fromTab(s.ws, "t1", "/dashboard");
    expect(paths(s.got)).toEqual(["/dashboard", "/settings"]);
    s.link.close();
  });

  test("the followed tab closing: the stage falls back to the tab used most recently, asks it for its whole view, and stays live", () => {
    const s = stage();
    tabOnline(s.ws, "t1");
    s.ws.recv({ t: "claim", cid: "t1", at: 100 });
    tabOnline(s.ws, "t2");
    s.ws.recv({ t: "claim", cid: "t2", at: 200 });
    tabOnline(s.ws, "t3"); // a background tab: never claimed
    tabOnline(s.ws, "t2", false);
    expect(s.ws.of("sync").map((m: Any) => m.to)).toEqual(["t1", "t2", "t1"]);
    fromTab(s.ws, "t1", "/dashboard");
    fromTab(s.ws, "t3", "/customers");
    expect(paths(s.got)).toEqual(["/dashboard"]);
    expect(sinceLive(s.statuses)).not.toContain("waiting");
    // a tab that already left never comes back through a late claim
    s.ws.recv({ t: "claim", cid: "t2", at: 900 });
    expect(s.ws.of("sync").map((m: Any) => m.to)).toEqual(["t1", "t2", "t1"]);
    s.link.close();
  });

  test("the stage's offer and its candidates are addressed to the one tab it follows", async () => {
    g.RTCPeerConnection = FakePC;
    const s = stage();
    tabOnline(s.ws, "t1");
    s.ws.recv({ t: "claim", cid: "t1", at: 100 });
    tabOnline(s.ws, "t2");
    await settle();
    const offers = s.ws.of("signal").filter((m: Any) =>
      m.data.description?.type === "offer"
    );
    expect(offers.map((m: Any) => m.to)).toEqual(["t1"]);
    FakePC.all[0].onicecandidate?.({
      candidate: { toJSON: () => ({ candidate: "c" }) },
    });
    expect(s.ws.of("signal").filter((m: Any) => m.data.candidate)).toEqual([
      { t: "signal", data: { candidate: { candidate: "c" } }, to: "t1" },
    ]);
    // the answer from the tab it follows is taken; a stray one from another tab is not
    s.ws.recv({
      t: "signal",
      from: "viewer",
      cid: "t2",
      data: { description: { type: "answer", sdp: "x" } },
    });
    s.ws.recv({
      t: "signal",
      from: "viewer",
      cid: "t1",
      data: { description: { type: "answer", sdp: "a1" } },
    });
    await settle();
    expect(FakePC.all[0].remote).toEqual({ type: "answer", sdp: "a1" });
    s.link.close();
  });

  test("replaced by a newer stage of the same account: status replaced, the socket closed, never reconnects", () => {
    jest.useFakeTimers();
    const s = stage();
    tabOnline(s.ws, "t1");
    s.ws.recv({ t: "replaced" });
    expect(s.status()).toBe("replaced");
    expect(s.ws.readyState).toBe(FakeWS.CLOSED);
    jest.advanceTimersByTime(60_000);
    expect(FakeWS.all.length).toBe(1);
    expect(s.status()).toBe("replaced");
  });

  test("its own account's other window is never a colleague", () => {
    const s = stage("hans", "stage-1");
    s.ws.recv({ t: "peer", online: true, pid: "hans", cid: "stage-2" });
    s.ws.recv({ t: "peer", online: true, pid: "lia", cid: "stage-9" });
    expect(s.presence).toEqual([["lia", true]]);
    s.link.close();
  });
});

describe("REQ-232 the customer's tab (demo-lifecycle-m3)", () => {
  /** a tab, its socket open and welcomed */
  function tab(cid = "t1") {
    const t = link("viewer");
    return {
      ...t,
      welcome: () => {
        t.ws.open();
        t.ws.recv({
          t: "welcome",
          role: "viewer",
          sessionId: "s1",
          peerOnline: false,
          cid,
        });
      },
    };
  }

  test("claim: sent when the socket is up, again after a reconnect's welcome and when a new stage arrives; a sync asks for the whole view", () => {
    jest.useFakeTimers();
    jest.setSystemTime(1_000);
    const t = tab();
    t.link.claim();
    expect(t.ws.sent).toEqual([]); // the socket is not up yet
    t.welcome();
    expect(t.ws.of("claim")).toEqual([{ t: "claim", at: 1_000 }]);
    t.ws.recv({ t: "peer", online: true, pid: "hans", cid: "s1" });
    expect(t.ws.of("claim")).toEqual([
      { t: "claim", at: 1_000 },
      { t: "claim", at: 1_000 },
    ]);
    const before = t.asks();
    t.ws.recv({ t: "sync" });
    expect(t.asks()).toBe(before + 1);
    // the socket drops and comes back: the new socket says it is the tab in use
    t.ws.close();
    jest.advanceTimersByTime(1_500);
    const again = FakeWS.all[FakeWS.all.length - 1];
    expect(again).not.toBe(t.ws);
    again.open();
    again.recv({
      t: "welcome",
      role: "viewer",
      sessionId: "s1",
      peerOnline: true,
      cid: "t1b",
    });
    expect(again.of("claim")).toEqual([{ t: "claim", at: 1_000 }]);
    t.link.close();
  });

  test("two windows of one staff account are two connections: the second offer never tears the first down, each answer goes to its own stage", async () => {
    g.RTCPeerConnection = FakePC;
    const t = tab();
    t.welcome();
    t.ws.recv({ t: "peer", online: true, pid: "hans", cid: "s1" });
    t.ws.recv({ t: "peer", online: true, pid: "hans", cid: "s2" });
    const offer = (cid: string) =>
      t.ws.recv({
        t: "signal",
        from: "presenter",
        pid: "hans",
        cid,
        data: { description: { type: "offer", sdp: cid } },
      });
    offer("s1");
    await settle();
    offer("s2");
    await settle();
    expect(FakePC.all.length).toBe(2);
    expect(FakePC.all[0].closed).toBe(false);
    const answers = t.ws.of("signal").filter((m: Any) =>
      m.data.description?.type === "answer"
    );
    expect(answers.map((m: Any) => m.to)).toEqual(["s1", "s2"]);
    t.link.close();
  });

  test("presence per account: one window of two going says nothing; the last one going is said once; the status holds through the grace", () => {
    jest.useFakeTimers();
    const t = tab();
    t.welcome();
    t.ws.recv({ t: "peer", online: true, pid: "hans", cid: "s1" });
    t.ws.recv({ t: "peer", online: true, pid: "hans", cid: "s2" });
    expect(t.presence).toEqual([["hans", true]]);
    expect(t.status()).toBe("relay");
    t.ws.recv({ t: "peer", online: false, pid: "hans", cid: "s1" });
    expect(t.presence).toEqual([["hans", true]]);
    expect(t.status()).toBe("relay");
    t.ws.recv({ t: "peer", online: false, pid: "hans", cid: "s2" });
    expect(t.presence).toEqual([["hans", true], ["hans", false]]);
    expect(t.status()).toBe("relay");
    jest.advanceTimersByTime(PRESENCE_GRACE_MS + 50);
    expect(t.status()).toBe("waiting");
    // a presenter dropped from the demo (no cid): all of their windows go
    t.ws.recv({ t: "peer", online: true, pid: "lia", cid: "s7" });
    t.ws.recv({ t: "peer", online: true, pid: "lia", cid: "s8" });
    t.ws.recv({ t: "peer", online: false, pid: "lia" });
    expect(t.presence.slice(-2)).toEqual([["lia", true], ["lia", false]]);
    t.link.close();
  });
});

describe("REQ-232 the wiring: plain words, no auto-placement, Return really returns", () => {
  const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
  const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
  const overlay = read("front-end/islands/DemoModeOverlay.tsx");
  const stageSrc = read("front-end/islands/DemoStage.tsx");
  // REQ-269 (i18n-m2): the bar's markup lives in its translated view component
  // (reconciled on demo-fixes) — the island keeps the stop() logic.
  const banner = read("front-end/islands/ImpersonationBanner.tsx") +
    read("front-end/components/ImpersonationBannerView.tsx");

  test("both dictionaries say plainly whether the demo is live — never accept, never direct or relay", () => {
    for (
      const k of [
        "connected",
        "connecting",
        "live",
        "waitingFor",
        "elsewhere",
        "useHere",
        "rejoin",
        "returnAsk",
        "leave",
      ]
    ) {
      expect(typeof en[`demoMode.${k}`]).toBe("string");
      expect(typeof es[`demoMode.${k}`]).toBe("string");
      expect(en[`demoMode.${k}`]).not.toBe(es[`demoMode.${k}`]);
    }
    for (const gone of ["direct", "relay", "waiting"]) {
      expect(en[`demoMode.${gone}`]).toBeUndefined();
      expect(es[`demoMode.${gone}`]).toBeUndefined();
    }
    for (const d of [en, es]) {
      expect(d["demoMode.waitingFor"]).toContain("{name}");
      expect(d["demoMode.returnAsk"]).toContain("{name}");
      for (const [k, v] of Object.entries(d)) {
        if (!k.startsWith("demoMode.")) continue;
        expect(v).not.toMatch(/accept|acept|\bdirect|\brelay|relevo/i);
      }
    }
  });

  test("the pills map the link to the plain words; neither island prints the transport mode", () => {
    for (const src of [overlay, stageSrc]) {
      expect(src).not.toMatch(/demoMode\.(direct|relay|waiting)"/);
    }
    expect(overlay).toContain('t("demoMode.connected")');
    expect(overlay).toContain('t("demoMode.connecting")');
    expect(stageSrc).toContain('t("demoMode.live")');
    expect(stageSrc).toContain('t("demoMode.waitingFor", { name })');
    expect(stageSrc).toContain('t("demoMode.elsewhere")');
    expect(stageSrc).toContain('data-cy="demo-use-here"');
  });

  test("a staff page never moves itself onto the stage: the poll only reports, the started event places, any other page offers Back to the demo", () => {
    // REQ-222 (M11) — the ask lives in the active poll's `ask`
    const check = overlay.slice(
      overlay.indexOf("const poller = activePoll({"),
      overlay.indexOf("pollRef.current = check;"),
    );
    expect(check.length).toBeGreaterThan(50);
    expect(check).not.toMatch(/placePresenter\(/);
    const started = overlay.slice(
      overlay.indexOf("const onStarted = (e: Event) => {"),
      overlay.indexOf("globalThis.addEventListener(DEMO_STARTED_EVENT"),
    );
    expect(started).toMatch(/placePresenter\(found\)/);
    expect(overlay).toContain('data-cy="demo-rejoin"');
    expect(overlay).toContain('t("demoMode.rejoin")');
  });

  test("the customer's tab claims the stage when it is in front, gets focus or is clicked", () => {
    expect(overlay).toMatch(/\.claim\(\)/);
    for (const ev of ['"focus"', '"visibilitychange"', '"pointerdown"']) {
      expect(overlay).toContain(ev);
    }
  });

  test("Return to your account during a demo asks, leaves the demo, then hands the account back", () => {
    const client = read("front-end/clients/demo-mode.ts");
    expect(client).toMatch(/leave: \(id: string/);
    expect(client).toContain("/demo-mode/sessions/${id}/leave");
    const stop = banner.slice(banner.indexOf("async function stop("));
    expect(stop).toMatch(/demoModeClient\.active\(/);
    const leave = stop.indexOf("demoModeClient.leave(");
    const back = stop.indexOf("adminClient.stopImpersonating(");
    expect(leave).toBeGreaterThan(-1);
    expect(back).toBeGreaterThan(leave);
    expect(banner).toContain('data-cy="imp-leave-demo"');
    expect(banner).toContain('t("demoMode.returnAsk"');
    const controller = read(
      "backend/src/demo-mode/entrypoints/demo-mode-controller/mod.ts",
    );
    expect(controller).toMatch(/@Post\("sessions\/:id\/leave"\)/);
  });
});
