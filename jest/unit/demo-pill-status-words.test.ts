/**
 * REQ-838 — demo-loop cycle dm2 (run r9c47ba57), issues m5, p4 and p8. RCA (analyst + skeptic
 * UPHELD) at demo-fixes 27db8c23:
 *
 *   - m5: an address-bar navigation, `page.goto` or the browser's reload button fires no Navigation
 *     API `navigate`, so the leaving page says "closing" (leave-hint.ts). With no other tab of the
 *     customer's open, transport.ts `tabLeft` called endGrace() and the stage said "Waiting for
 *     {name}'s app…" until the next page joined 0.1–0.4 s later (REQ-823 held a closing page only
 *     while ANOTHER tab was open). And on that drop and on the next page's join the stage guessed
 *     the pill's status (pillFaceOffline / pillFaceAwaiting), dropped the customer's label and
 *     ghostWords fell back to the PRESENTER's dictionary: "Demo mode DocuMonster is guiding you
 *     Conectando… End demo".
 *   - p4: the customer signed out: the stage kept their pill's ghost (pillShown ignored the
 *     sign-out; with the presenter's "Connecting…"), his "You" marker, and told him to move his
 *     pointer "to show it" on a screen that has no demo.
 *   - p8: the presenter left the stage: the customer's pill said "{name} is guiding you ·
 *     Connecting…" — the link's "waiting" (the socket fine, no stage) fell through to Connecting….
 */
import * as fs from "fs";
import * as path from "path";
import {
  parsePeerMessage,
  PILL_LABEL_MAX,
  PRESENCE_GRACE_MS,
  SILENT_GRACE_MS,
} from "../../shared/demo-mode/protocol";
import {
  ghostWords,
  pillFaceAwaiting,
  pillFaceOffline,
  statusKeyOf,
} from "../../shared/demo-mode/pill";
import { pillStatusOf } from "../../shared/demo-mode/pill-copy";
import {
  connectDemo,
  JOIN_GRACE_MS,
  type LinkStatus,
} from "../../front-end/lib/demo-mode/transport";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
/** the presenter's dictionary on the stage, by key (Spanish, as fleet-1's presenter had it) */
const stageT = (k: string) => `stage-es:${k}`;

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

/** a stage's link on a fake socket, welcomed; the customer's tabs as the hub reports them */
function stage() {
  const statuses: LinkStatus[] = [];
  const followed: (string | undefined)[] = [];
  let signedOut = 0;
  const link = connectDemo({
    sessionId: "s1",
    role: "presenter",
    pid: "hans",
    onPeer: () => {},
    onStatus: (s: LinkStatus) => statuses.push(s),
    onPeerOnline: (cid?: string) => followed.push(cid),
    onEnded: () => {},
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
    statuses,
    followed,
    signedOut: () => signedOut,
    status: () => statuses[statuses.length - 1],
    since: (k: number) => statuses.slice(k),
    following: () => followed[followed.length - 1],
    online: (cid: string) => ws.recv({ t: "peer", online: true, cid }),
    gone: (cid: string, why?: string) =>
      ws.recv({ t: "peer", online: false, cid, ...(why ? { why } : {}) }),
    claim: (cid: string, at: number, tab?: string) =>
      ws.recv({ t: "claim", cid, at, ...(tab ? { tab } : {}) }),
  };
}

/** the customer's link on a fake socket (not opened yet); the stages as the hub reports them */
function customer() {
  const statuses: LinkStatus[] = [];
  const link = connectDemo({
    sessionId: "s1",
    role: "viewer",
    tab: "tab-A",
    onPeer: () => {},
    onStatus: (s: LinkStatus) => statuses.push(s),
    onPeerOnline: () => {},
    onEnded: () => {},
  } as Any);
  const ws = () => FakeWS.all[FakeWS.all.length - 1];
  return {
    link,
    statuses,
    ws,
    /** what the pill reads from: the link's last word ("connecting" until it said one) */
    status: () => statuses[statuses.length - 1] ?? "connecting",
    welcome: () =>
      ws().recv({
        t: "welcome",
        role: "viewer",
        sessionId: "s1",
        peerOnline: false,
        cid: "tab-socket-1",
      }),
    stage: (cid: string, online = true) =>
      ws().recv({ t: "peer", online, pid: "hans", cid }),
  };
}

describe("REQ-838 m5 — the customer's ONLY tab says it is closing (the address bar, page.goto, the reload button): the stage holds it, never 'waiting' at once", () => {
  test("its next page (the same browser tab) comes: 'between' then live — never 'Waiting for {name}'s app…'", () => {
    jest.useFakeTimers();
    const s = stage();
    s.online("a1");
    s.claim("a1", 100, "tab-A");
    expect(s.status()).toBe("relay");
    const k = s.statuses.length;
    s.gone("a1", "closing");
    expect(s.status()).toBe("between");
    // 0.1–0.4 s later the same tab's next page joins and says who it is
    jest.advanceTimersByTime(300);
    s.online("a2");
    s.claim("a2", 0, "tab-A");
    expect(s.following()).toBe("a2");
    expect(s.status()).toBe("relay");
    jest.advanceTimersByTime(SILENT_GRACE_MS * 3);
    expect(s.since(k)).toEqual(["between", "relay"]);
    s.link.close();
  });

  test("a page that never said its browser tab (an older page) is held the same way: 'between', then live on its next page", () => {
    jest.useFakeTimers();
    const s = stage();
    s.online("a1");
    const k = s.statuses.length;
    s.gone("a1", "closing");
    expect(s.status()).toBe("between");
    jest.advanceTimersByTime(400);
    s.online("a2");
    expect(s.following()).toBe("a2");
    expect(s.status()).toBe("relay");
    expect(s.since(k)).toEqual(["between", "relay"]);
    s.link.close();
  });

  test("a real close: 'between' until SILENT_GRACE_MS is up, then 'waiting' — long before PRESENCE_GRACE_MS", () => {
    jest.useFakeTimers();
    const s = stage();
    s.online("a1");
    s.claim("a1", 100, "tab-A");
    const k = s.statuses.length;
    s.gone("a1", "closing");
    jest.advanceTimersByTime(SILENT_GRACE_MS - 100);
    expect(s.status()).toBe("between");
    jest.advanceTimersByTime(200);
    expect(s.status()).toBe("waiting");
    expect(s.since(k)).toEqual(["between", "waiting"]);
    expect(SILENT_GRACE_MS).toBeLessThan(PRESENCE_GRACE_MS);
    s.link.close();
  });

  test("a sign-out is still 'waiting' at once (REQ-823 M2) — never 'between'", () => {
    jest.useFakeTimers();
    const s = stage();
    s.online("a1");
    s.claim("a1", 100, "tab-A");
    const k = s.statuses.length;
    s.gone("a1", "signout");
    expect(s.since(k)).toEqual(["waiting"]);
    expect(s.signedOut()).toBe(1);
    s.link.close();
  });
});

describe("REQ-838 p8 — the customer's link says 'waiting' (no stage) only once it can know: never while its socket is still joining", () => {
  test("open but not welcomed, and welcomed with no stage heard yet: still 'connecting' (the other hubs answer its arrival a moment later)", () => {
    jest.useFakeTimers();
    const c = customer();
    c.ws().open();
    expect(c.status()).toBe("connecting");
    c.welcome();
    jest.advanceTimersByTime(JOIN_GRACE_MS - 100);
    expect(c.status()).toBe("connecting");
    expect(c.statuses).not.toContain("waiting");
    // the stage's presence comes in: Connected, and it never said nobody was there
    c.stage("st-1");
    expect(c.status()).toBe("relay");
    expect(c.statuses).toEqual(["relay"]);
    c.link.close();
  });

  test("no stage within JOIN_GRACE_MS of the welcome: 'waiting' — and his stage coming back is live again", () => {
    jest.useFakeTimers();
    const c = customer();
    c.ws().open();
    c.welcome();
    jest.advanceTimersByTime(JOIN_GRACE_MS + 50);
    expect(c.status()).toBe("waiting");
    c.stage("st-1");
    expect(c.status()).toBe("relay");
    c.link.close();
  });

  test("his stage leaves: live through PRESENCE_GRACE_MS (a stage reload), then 'waiting' — no 'connecting' between", () => {
    jest.useFakeTimers();
    const c = customer();
    c.ws().open();
    c.welcome();
    c.stage("st-1");
    const k = c.statuses.length;
    c.stage("st-1", false);
    jest.advanceTimersByTime(PRESENCE_GRACE_MS - 100);
    expect(c.status()).toBe("relay");
    jest.advanceTimersByTime(200);
    expect(c.statuses.slice(k)).toEqual(["waiting"]);
    c.link.close();
  });

  test("a lost socket joins again: 'connecting' until its next welcome has had JOIN_GRACE_MS", () => {
    jest.useFakeTimers();
    const c = customer();
    c.ws().open();
    c.welcome();
    jest.advanceTimersByTime(JOIN_GRACE_MS + 50);
    expect(c.status()).toBe("waiting");
    c.ws().close();
    expect(c.status()).toBe("connecting");
    jest.advanceTimersByTime(1_000); // the first retry
    c.ws().open();
    c.welcome();
    jest.advanceTimersByTime(JOIN_GRACE_MS - 100);
    expect(c.status()).toBe("connecting");
    jest.advanceTimersByTime(200);
    expect(c.status()).toBe("waiting");
    c.link.close();
  });
});

describe("REQ-838 p8 — the customer's pill: 'Connecting…' only while connecting; '{name} stepped away' while the link is up and no stage is", () => {
  test("pillStatusOf: the link's word → the pill's status", () => {
    expect(pillStatusOf("direct", true)).toBe("live");
    expect(pillStatusOf("relay", true)).toBe("live");
    // the socket is up, the hub has no stage of his: he left the stage
    expect(pillStatusOf("waiting", false)).toBe("away");
    // a connected page's carry (REQ-535) still says Connected while its own link comes up
    expect(pillStatusOf("waiting", true)).toBe("live");
    expect(pillStatusOf("connecting", true)).toBe("live");
    // the link is opening (or lost): Connecting… — never "away"
    expect(pillStatusOf("connecting", false)).toBe("connecting");
    expect(pillStatusOf("closed", false)).toBe("connecting");
    expect(pillStatusOf("ended", false)).toBe("ended");
    expect(pillStatusOf("ended", true)).toBe("ended");
  });

  test("'away' rides to the stage (the wire keeps it); the stage's own word for it names nobody", () => {
    const r = { left: 12, top: 760, width: 420, height: 40 };
    const m = parsePeerMessage({ k: "pill", r, status: "away" });
    expect(m && m.k === "pill" && m.status).toBe("away");
    expect(statusKeyOf("away")).toBe("demoMode.away");
    for (const d of [en, es]) {
      expect(typeof d["demoMode.away"]).toBe("string");
      expect(d["demoMode.away"]).not.toMatch(/\{/);
    }
    expect(en["demoMode.away"]).not.toBe(es["demoMode.away"]);
  });

  test("the words, en and es: '{name} stepped away' (several: '{names} …') and 'The demo is still open'", () => {
    expect(en["demoMode.guideAway"]).toBe("{name} stepped away");
    expect(es["demoMode.guideAway"]).toBe("{name} se ausentó");
    expect(en["demoMode.guideAwayMany"]).toBe("{names} stepped away");
    expect(es["demoMode.guideAwayMany"]).toBe("{names} se ausentaron");
    expect(en["demoMode.stillOpen"]).toBe("The demo is still open");
    expect(es["demoMode.stillOpen"]).toBe("La demo sigue abierta");
  });

  test("the overlay draws the pill from pillStatusOf: the away words in place of 'is guiding you' and 'Connecting…', and says 'away' to the stage", () => {
    const o = read("front-end/islands/DemoModeOverlay.tsx");
    expect(o).toMatch(
      /const pillStatus = pillStatusOf\(status, live\);/,
    );
    const away = o.slice(o.indexOf("const pillStatus = pillStatusOf("));
    const words = away.slice(0, away.indexOf("faceRef.current = {"));
    expect(words).toMatch(/t\("demoMode\.guideAway", \{ name: names \}\)/);
    expect(words).toMatch(/t\("demoMode\.guideAwayMany", \{ names \}\)/);
    expect(words).toMatch(/t\("demoMode\.stillOpen"\)/);
    // "Connecting…" is said for the link connecting only
    expect(words).toMatch(/t\("demoMode\.connecting"\)/);
    // the away status names the guide: the compact pill does not name him twice
    expect(words).toMatch(
      // REQ-833 also keeps it off through a join's grace (reconciled on demo-fixes)
      /const showGuide = copy\.showShort && !started && !away(?: && !joined)?;/,
    );
    const face = away.slice(away.indexOf("faceRef.current = {"));
    expect(face.slice(0, face.indexOf("};"))).toMatch(/status: pillStatus,/);
  });
});

describe("REQ-838 m5 + p4 — the stage's copy of the customer's pill says its status in the CUSTOMER's words, whatever the stage guesses", () => {
  /** the customer's pill, English, as their overlay sends it (with the words it carries) */
  const live = {
    status: "live" as const,
    label: "Connected",
    text: "DocuMonster is guiding you",
    title: "Demo mode",
    end: "End demo",
    connectingLabel: "Connecting…",
    endedLabel: "The demo ended",
  };

  test("their app dropped (pillFaceOffline): 'Connecting…' in their words — never the stage's 'Conectando…'", () => {
    const down = pillFaceOffline(live, "waiting");
    expect(down.status).toBe("connecting");
    const w = ghostWords(down, stageT);
    expect(w).toMatchObject({
      title: "Demo mode",
      text: "DocuMonster is guiding you",
      status: "Connecting…",
      end: "End demo",
    });
    expect(JSON.stringify(w)).not.toContain("stage-es:");
    // the demo ended: their words for that too
    expect(ghostWords(pillFaceOffline(live, "ended"), stageT).status).toBe(
      "The demo ended",
    );
  });

  test("their next page joined (pillFaceAwaiting): 'Connecting…' in their words until its pill speaks", () => {
    const w = ghostWords(pillFaceAwaiting(live), stageT);
    expect(w.status).toBe("Connecting…");
    expect(JSON.stringify(w)).not.toContain("stage-es:");
    // the demo ended on the stage (its own guess, in her words): a page joining keeps that
    const ended = pillFaceAwaiting(pillFaceOffline(live, "ended"));
    expect(ended.status).toBe("ended");
    expect(ghostWords(ended, stageT).status).toBe("The demo ended");
    // an ended face that sent only the carried word
    const bare = pillFaceAwaiting({
      ...live,
      status: "ended",
      label: undefined,
    });
    expect(ghostWords(bare, stageT).status).toBe("The demo ended");
  });

  test("a face already in the guessed state keeps its own word (the ended notice says 'The demo ended' itself)", () => {
    const notice = {
      status: "ended" as const,
      label: "La demo terminó",
      text: "Hans terminó la demo",
      title: "Modo demo",
    };
    expect(ghostWords(pillFaceOffline(notice, "ended"), stageT).status).toBe(
      "La demo terminó",
    );
  });

  test("a pill that sent no word for it (a page from before) still gets a status, in the stage's words (REQ-430)", () => {
    const old = { status: "live" as const, label: "Conectado", text: "Hans" };
    expect(ghostWords(pillFaceOffline(old, "waiting"), stageT).status).toBe(
      "stage-es:demoMode.connecting",
    );
    expect(ghostWords(pillFaceAwaiting(old), stageT).status).toBe(
      "stage-es:demoMode.connecting",
    );
  });

  test("the words ride the wire, checked and capped like the label", () => {
    const r = { left: 12, top: 760, width: 420, height: 40 };
    const m = parsePeerMessage({
      k: "pill",
      r,
      status: "live",
      connectingLabel: "Conectando…",
      endedLabel: "x".repeat(200),
    });
    expect(m && m.k === "pill" && m.connectingLabel).toBe("Conectando…");
    expect(m && m.k === "pill" && m.endedLabel!.length).toBe(PILL_LABEL_MAX);
    const junk = parsePeerMessage({
      k: "pill",
      r,
      connectingLabel: 7,
      endedLabel: { x: 1 },
    });
    expect(junk && junk.k === "pill" && junk.connectingLabel).toBeUndefined();
    expect(junk && junk.k === "pill" && junk.endedLabel).toBeUndefined();
  });

  test("the overlay carries the words in its own language, sends them, and the stage keeps them", () => {
    const o = read("front-end/islands/DemoModeOverlay.tsx");
    const at = o.indexOf(
      "faceRef.current = {\n    compact,\n    open: compact && open,",
    );
    expect(at).toBeGreaterThan(-1);
    const face = o.slice(at, o.indexOf("};", at));
    expect(face).toMatch(/connectingLabel: t\("demoMode\.connecting"\)/);
    expect(face).toMatch(/endedLabel: t\("demoMode\.ended"\)/);
    const send = o.slice(o.indexOf("const sendPill = () => {"));
    const body = send.slice(0, send.indexOf("sendPillRef.current = sendPill;"));
    expect(body).toMatch(/connectingLabel: f\.connectingLabel/);
    expect(body).toMatch(/endedLabel: f\.endedLabel/);
    const s = read("front-end/islands/DemoStage.tsx");
    const faceOf = s.slice(s.indexOf("const faceOf = (m: PillMsg)"));
    const copied = faceOf.slice(0, faceOf.indexOf("});"));
    expect(copied).toMatch(/connectingLabel: m\.connectingLabel/);
    expect(copied).toMatch(/endedLabel: m\.endedLabel/);
  });
});

describe("REQ-838 p4 — the customer signed out: the stage draws nothing of a screen they no longer have", () => {
  const s = read("front-end/islands/DemoStage.tsx");
  /** the JSX condition a `{mirrored && … && (` opener puts on the element at `marker` */
  const guardOf = (marker: string) => {
    const at = s.indexOf(marker);
    expect(at).toBeGreaterThan(-1);
    const open = s.lastIndexOf("{mirrored", at);
    return s.slice(open, s.indexOf("(", open));
  };

  test("no ghost of their pill (open or tucked): pillShown is null while they are signed out", () => {
    expect(s).toMatch(
      // REQ-896 — and while waiting after anything but a navigation
      /const pillShown =\s*look\.elsewhere \|\| signedOut \|\|[\s\S]{0,160}\? null\s*: pillBox;/,
    );
  });

  test("no 'move it to show it' advice while their app is gone — signed out or waiting", () => {
    // REQ-868 (dm5 p8) — the chrome-row badges share one gate, `badges = stageBadgesShown({…})`,
    // which carries `waiting: look.waiting` (and is false while waiting)
    const at = s.indexOf('data-cy="demo-pointer-absent"');
    expect(at).toBeGreaterThan(-1);
    const open = s.lastIndexOf("{badges", at);
    const g = s.slice(open, s.indexOf("(", open));
    expect(g).toMatch(/!signedOut/);
    expect(s).toMatch(
      /const badges = stageBadgesShown\(\{[^}]*waiting: look\.waiting[^}]*\}\)/,
    );
  });

  test("none of his pointer either: his 'You' marker and his arrow's ghost are not drawn while they are signed out", () => {
    expect(guardOf("<OwnPointer")).toMatch(/!signedOut/);
    expect(guardOf("<PointerGhost")).toMatch(/!signedOut/);
  });
});

describe("REQ-838 AMENDMENT (demo-loop run 9, p4) — the stage's link says 'waiting' (no tab of hers) only once it can know: never while its socket is still joining", () => {
  test("welcomed, the roster not in yet: 'connecting', not a flash of 'waiting' before her tab's presence lands", () => {
    jest.useFakeTimers();
    const s = stage();
    expect(s.statuses).not.toContain("waiting");
    jest.advanceTimersByTime(JOIN_GRACE_MS - 100);
    expect(s.statuses).not.toContain("waiting");
    s.online("a1");
    s.claim("a1", 100, "tab-A");
    expect(s.status()).toBe("relay");
    expect(s.statuses).not.toContain("waiting");
    s.link.close();
  });
  test("no tab within JOIN_GRACE_MS of the welcome: 'waiting' — and her tab coming is live", () => {
    jest.useFakeTimers();
    const s = stage();
    jest.advanceTimersByTime(JOIN_GRACE_MS + 50);
    expect(s.status()).toBe("waiting");
    s.online("a1");
    s.claim("a1", 100, "tab-A");
    expect(s.status()).toBe("relay");
    s.link.close();
  });
  test("her only tab closing after the join: 'between' then 'waiting' as before — the join grace is spent", () => {
    jest.useFakeTimers();
    const s = stage();
    s.online("a1");
    s.claim("a1", 100, "tab-A");
    const k = s.statuses.length;
    s.gone("a1", "closing");
    expect(s.since(k)).toEqual(["between"]);
    jest.advanceTimersByTime(SILENT_GRACE_MS + 10);
    expect(s.status()).toBe("waiting");
    s.link.close();
  });
});
