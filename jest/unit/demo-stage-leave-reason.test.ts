/**
 * REQ-896 — demo-loop run 6 (dm6), issues p1 + p7. (p1) Closing the customer's only tab showed
 * "Loading their next page…" for up to SILENT_GRACE_MS before "Waiting for her app…": the label said
 * she was loading a page when the tab was gone. (p7) Once waiting, the stage's dimmed ghost of her
 * pill read "Connecting…" under the waiting banner — nothing was connecting; her page was gone.
 *
 * Shared cause: transport.ts `tabLeft` knows WHY the followed tab went (`closing`, `navigating`,
 * `signout`, or nothing said) but dropped it at `hold`/`startGrace`, so the stage could not word a
 * closed page differently from a navigation. The link now carries the last leave's reason with
 * every status (`onStatus(s, leave)`), cleared when a tab of hers comes back. `stageStatus` words a
 * "between" hold as "Loading their next page…" only for a navigation; a closing or silent hold is
 * the neutral "One moment…" (`pageGone`). And while waiting after anything but a navigation the
 * stage draws no ghost of her pill.
 */
// REVISION (demo-loop run 16, by hand): an ended stage drops the pill ghost too (REQ-868 AMENDMENT).
import * as fs from "fs";
import * as path from "path";
import { SILENT_GRACE_MS } from "../../shared/demo-mode/protocol";
import {
  connectDemo,
  type LinkStatus,
} from "../../front-end/lib/demo-mode/transport";
import { stageStatus } from "../../shared/demo-mode/stage-frame";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const en: Record<string, string> = require("../../lang/en.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const es: Record<string, string> = require("../../lang/es.json");

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

/** a stage's link on a fake socket; every status with the leave reason it came with */
function stage() {
  const statuses: [LinkStatus, string | undefined][] = [];
  const link = connectDemo({
    sessionId: "s1",
    role: "presenter",
    pid: "hans",
    onPeer: () => {},
    onStatus: (s: LinkStatus, why?: string) => statuses.push([s, why]),
    onPeerOnline: () => {},
    onEnded: () => {},
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
    last: () => statuses[statuses.length - 1],
    online: (cid: string) => ws.recv({ t: "peer", online: true, cid }),
    gone: (cid: string, why?: string) =>
      ws.recv({ t: "peer", online: false, cid, ...(why ? { why } : {}) }),
    claim: (cid: string, at: number, tab?: string) =>
      ws.recv({ t: "claim", cid, at, ...(tab ? { tab } : {}), f: 1 }),
  };
}

describe("REQ-896 (dm6, p1 + p7) the stage knows why the customer's page went", () => {
  test("REQ-896 transport: the only tab closing — 'between' then 'waiting', both saying 'closing'; a tab of hers back clears it", () => {
    jest.useFakeTimers();
    const s = stage();
    s.online("a1");
    s.claim("a1", 100, "tab-A");
    expect(s.last()).toEqual(["relay", undefined]);
    const k = s.statuses.length;
    s.gone("a1", "closing");
    expect(s.statuses.slice(k)).toEqual([["between", "closing"]]);
    jest.advanceTimersByTime(SILENT_GRACE_MS + 10);
    expect(s.last()).toEqual(["waiting", "closing"]);
    // her next page (a reload is "closing" too): followed, nothing left behind
    s.online("a2");
    s.claim("a2", 0, "tab-A");
    expect(s.last()).toEqual(["relay", undefined]);
    s.link.close();
  });

  test("REQ-896 transport: a navigation says so; a page gone without a word says nothing", () => {
    jest.useFakeTimers();
    const s = stage();
    s.online("a1");
    s.claim("a1", 100, "tab-A");
    let k = s.statuses.length;
    s.gone("a1", "navigating");
    expect(s.statuses.slice(k)).toEqual([["between", "navigating"]]);
    s.online("a2");
    s.claim("a2", 0, "tab-A");
    expect(s.last()).toEqual(["relay", undefined]);
    k = s.statuses.length;
    s.gone("a2");
    expect(s.statuses.slice(k)).toEqual([["between", undefined]]);
    jest.advanceTimersByTime(SILENT_GRACE_MS + 10);
    expect(s.last()).toEqual(["waiting", undefined]);
    s.link.close();
  });

  test("REQ-896 stageStatus: a hold after a navigation loads their next page; after a close, or nothing said, 'One moment…' (pageGone)", () => {
    const base = {
      ended: false,
      status: "between" as const,
      mirrored: true,
      awaiting: false,
      resyncing: false,
      behind: 0,
    };
    expect(stageStatus({ ...base, leave: "navigating" })).toEqual({
      key: "loadingNext",
    });
    expect(stageStatus({ ...base, leave: "navigating", pageBehind: 3 }))
      .toEqual({ key: "loadingNext", n: 3 });
    expect(stageStatus({ ...base, leave: "closing" })).toEqual({
      key: "pageGone",
    });
    expect(stageStatus({ ...base })).toEqual({ key: "pageGone" });
    expect(stageStatus({ ...base, leave: "closing", pageBehind: 3 })).toEqual(
      { key: "pageGone" },
    );
    // nothing mirrored yet: connecting, as before; a new tab awaited: loading its page, as before
    expect(stageStatus({ ...base, mirrored: false, leave: "closing" })).toEqual(
      { key: "connecting" },
    );
    expect(
      stageStatus({
        ...base,
        status: "relay",
        awaiting: true,
        leave: "closing",
      }),
    ).toEqual({ key: "loadingNext" });
    // waiting and ended are what they were
    expect(stageStatus({ ...base, status: "waiting", leave: "closing" }))
      .toEqual({ key: "waiting" });
    expect(stageStatus({ ...base, ended: true, leave: "closing" })).toEqual({
      key: "ended",
    });
  });

  test("REQ-896 words: 'One moment…' in both languages, not the loading line", () => {
    expect(en["demoMode.pageGone"]).toBe("One moment…");
    expect(es["demoMode.pageGone"]).toBe("Un momento…");
    expect(en["demoMode.pageGone"]).not.toBe(en["demoMode.loadingNext"]);
    expect(es["demoMode.pageGone"]).not.toBe(es["demoMode.loadingNext"]);
  });

  test("REQ-896 wiring: the stage keeps the leave reason, words pageGone, and draws no ghost while waiting after anything but a navigation", () => {
    const stage = read("front-end/islands/DemoStage.tsx");
    expect(stage).toMatch(
      /onStatus: \(s, why\) => \{\s*setStatus\(s\);\s*setLeaveWhy\(why\);/,
    );
    expect(stage).toMatch(
      /stageStatus\(\{[\s\S]{0,300}leave: leaveWhy,[\s\S]{0,200}\}\)/,
    );
    expect(stage).toMatch(
      /live\.key === "pageGone"\s*\?\s*t\("demoMode\.pageGone"\)/,
    );
    // the frame is held (dimmed, no pointer sent) for pageGone as for loadingNext
    expect(stage).toMatch(
      /const loadingNext = live\.key === "loadingNext" \|\|\s*live\.key === "pageGone";/,
    );
    // REQ-896 AMENDMENT (dm7, p2) — nor while a closed page is held ("One moment…")
    expect(stage).toMatch(
      /const pillShown = ended \|\| look\.elsewhere \|\| signedOut \|\|\s*\(look\.waiting && leaveWhy !== "navigating"\) \|\| live\.key === "pageGone"\s*\?\s*null\s*:\s*pillBox;/,
    );
  });
});
