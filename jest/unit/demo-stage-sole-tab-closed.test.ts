/**
 * REQ-645 AMENDMENT (demo-loop run 8, p2) — the customer closed her ONLY tab and opened a new one;
 * the stage said "Now showing {name}'s other tab (Dashboard)" for TAB_NOTE_MS, though she had one
 * tab. `followTabs` weighed the new tab's key against the closed tab's and called it a switch.
 * Now: when the last of her tabs goes (the link holds with nobody left: `onTabsGone`), the stage
 * forgets which tab it followed (`closed`); the next tab followed is her tab, not "the other" one.
 * Her OTHER tab followed after the one she used closed (two tabs open) is still said — nobody was
 * gone then.
 */
import * as fs from "fs";
import * as path from "path";
import {
  connectDemo,
  type LinkStatus,
} from "../../front-end/lib/demo-mode/transport";
import { followTabs } from "../../shared/demo-mode/presenter-anchor";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// deno-lint-ignore no-explicit-any
type Any = any;

class FakeWS {
  static OPEN = 1;
  static CLOSED = 3;
  static all: FakeWS[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeWS.all.push(this);
  }
  send(_s: string) {}
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

function stage() {
  const gone: number[] = [];
  const link = connectDemo({
    sessionId: "s1",
    role: "presenter",
    pid: "hans",
    onPeer: () => {},
    onStatus: (_s: LinkStatus) => {},
    onPeerOnline: () => {},
    onEnded: () => {},
    onTabsGone: () => gone.push(Date.now()),
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
    gone,
    online: (cid: string) => ws.recv({ t: "peer", online: true, cid }),
    leave: (cid: string, why?: string) =>
      ws.recv({ t: "peer", online: false, cid, ...(why ? { why } : {}) }),
    claim: (cid: string, at: number, tab: string) =>
      ws.recv({ t: "claim", cid, at, tab, f: 1 }),
  };
}

describe("REQ-645 AMENDMENT 2 (dm8, p2) — her only tab closed and a new one opened is no 'other tab'", () => {
  test("followTabs.closed(): the next tab followed is no switch; without it, it is", () => {
    const t = followTabs();
    expect(t.follow("a1", "tab-A")).toBe(false);
    t.shown();
    t.closed();
    expect(t.follow("b1", "tab-B")).toBe(false);
    const u = followTabs();
    u.follow("a1", "tab-A");
    u.shown();
    expect(u.follow("b1", "tab-B")).toBe(true);
  });

  test("followTabs.closed() then the same tab's next page (a reload says 'closing' too): no switch either", () => {
    const t = followTabs();
    t.follow("a1", "tab-A");
    t.shown();
    t.closed();
    expect(t.follow("a2", "tab-A")).toBe(false);
  });

  test("transport: the last of her tabs leaving says onTabsGone; one leaving while another is open does not", () => {
    jest.useFakeTimers();
    const s = stage();
    s.online("a1");
    s.claim("a1", 100, "tab-A");
    s.leave("a1", "closing");
    expect(s.gone.length).toBe(1);
    s.online("b1");
    s.claim("b1", 200, "tab-B");
    s.online("c1");
    s.claim("c1", 300, "tab-C");
    s.leave("c1", "closing");
    expect(s.gone.length).toBe(1);
    s.leave("b1");
    expect(s.gone.length).toBe(2);
    s.link.close();
  });

  test("wiring: the stage forgets the followed tab when the link says every tab of hers is gone", () => {
    const stage = read("front-end/islands/DemoStage.tsx");
    expect(stage).toMatch(
      /onTabsGone: \(\) => \{?\s*tabsRef\.current\.closed\(\)/,
    );
    const anchor = read("shared/demo-mode/presenter-anchor.ts");
    expect(anchor).toMatch(/closed\(\): void;/);
  });
});
