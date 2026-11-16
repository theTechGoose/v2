/**
 * REQ-834 — demo-loop cycle dm2, issue M1 ("Tab open before customer logout never rejoins after
 * re-login; stage shows the other tab as 'Live'"). RCA at demo-fixes 27db8c23: REQ-823's sign-out
 * handling (dm1 M2) set `signedOutRef.current = true` in every open tab's overlay and nothing ever
 * cleared it, so the /active ask returned early for the rest of the page's life. The customer
 * signed out in tab 0 and back in; tab 1 (never reloaded, its cookie now the new live session)
 * never asked again, never showed the pill, never joined a new demo either.
 *
 * The fix: the latch is a sign-out TIME, not a page-lifetime flag. Asks are skipped only for
 * SIGNOUT_HOLD_MS (5 s: the redirect and the backend's session delete); after that the server
 * decides (a dead session's ask fails; a signed-in-again one gets its demo). A page that mounts
 * with a session says `{k:"signin"}` on the same BroadcastChannel, and a latched overlay clears
 * the latch and asks at once.
 */
import * as fs from "fs";
import * as path from "path";
import { activePoll } from "../../front-end/lib/demo-mode/active-poll";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// deno-lint-ignore no-explicit-any
type Any = any;

const sig = () =>
  require("../../front-end/lib/demo-mode/signout-signal") as {
    SIGNOUT_HOLD_MS: number;
    signoutGate(o: {
      out: () => void;
      back: () => void;
      clock?: () => number;
      win?: Any;
      channel?: () => Any;
    }): { holds(): boolean; stop(): void };
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
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("REQ-834 (dm2 M1) — the sign-out latch is time-boxed and a sign-in elsewhere lifts it", () => {
  test("the hold is about 5 s: long enough for the redirect and the session delete, never the page's life", () => {
    const { SIGNOUT_HOLD_MS } = sig();
    expect(SIGNOUT_HOLD_MS).toBeGreaterThanOrEqual(3_000);
    expect(SIGNOUT_HOLD_MS).toBeLessThanOrEqual(5_000);
  });

  test("a page with a session says it signed in when it mounts; nothing holds before a sign-out", () => {
    const { signoutGate } = sig();
    const chan = fakeChannel();
    const gate = signoutGate({
      out: () => {},
      back: () => {},
      win: fakeWin(),
      channel: () => chan,
    });
    expect(chan.posted).toEqual([{ k: "signin" }]);
    expect(gate.holds()).toBe(false);
    gate.stop();
    expect(chan.closed).toBe(1);
  });

  test("another tab signs out, then a page signs in again: the latch lifts at once and the overlay asks again (back), once", () => {
    const { signoutGate } = sig();
    const chan = fakeChannel();
    let t = 1_000;
    let outs = 0;
    let backs = 0;
    const gate = signoutGate({
      out: () => void outs++,
      back: () => void backs++,
      clock: () => t,
      win: fakeWin(),
      channel: () => chan,
    });
    chan.from({ k: "signout" });
    expect(outs).toBe(1);
    expect(gate.holds()).toBe(true);
    t += 1_500;
    chan.from({ k: "signin" });
    expect(gate.holds()).toBe(false);
    expect(backs).toBe(1);
    // a sign-in heard with no sign-out behind it asks nothing
    chan.from({ k: "signin" });
    expect(backs).toBe(1);
    chan.from({ k: "junk" });
    chan.from(null);
    expect(backs).toBe(1);
    gate.stop();
  });

  test("with no sign-in heard, the hold expires by itself: the server decides after SIGNOUT_HOLD_MS", () => {
    const { signoutGate, SIGNOUT_HOLD_MS } = sig();
    const win = fakeWin();
    const chan = fakeChannel();
    let t = 50_000;
    const gate = signoutGate({
      out: () => {},
      back: () => {},
      clock: () => t,
      win,
      channel: () => chan,
    });
    win.fire("pm:logout"); // this tab's own sign-out
    expect(chan.posted).toEqual([{ k: "signin" }, { k: "signout" }]);
    t += SIGNOUT_HOLD_MS - 1;
    expect(gate.holds()).toBe(true);
    t += 1;
    expect(gate.holds()).toBe(false);
    gate.stop();
  });

  test("the overlay's /active poll, gated the overlay's way: skipped while held, asks on the sign-in broadcast, asks again once the window is over", async () => {
    const { signoutGate, SIGNOUT_HOLD_MS } = sig();
    const chan = fakeChannel();
    let t = 0;
    let asked = 0;
    const ref: { poller: { now(): void } | null } = { poller: null };
    const gate = signoutGate({
      out: () => {},
      back: () => ref.poller?.now(),
      clock: () => t,
      win: fakeWin(),
      channel: () => chan,
    });
    const poller = activePoll({
      every: 60_000,
      rest: 60_000,
      connected: () => false,
      clock: () => t,
      ask: () => {
        if (!gate.holds()) asked++;
        return Promise.resolve();
      },
    });
    ref.poller = poller;
    poller.now();
    await flush();
    expect(asked).toBe(1);
    chan.from({ k: "signout" });
    t += 3_000;
    poller.now();
    await flush();
    expect(asked).toBe(1); // held: a dead sign-in's page asks nothing
    chan.from({ k: "signin" }); // tab 0 signed in again
    await flush();
    expect(asked).toBe(2);
    // and the window alone: a second sign-out, no sign-in, the hold runs out
    chan.from({ k: "signout" });
    poller.now();
    await flush();
    expect(asked).toBe(2);
    t += SIGNOUT_HOLD_MS;
    poller.now();
    await flush();
    expect(asked).toBe(3);
    poller.stop();
    gate.stop();
  });

  test("the overlay is wired to the gate: no page-lifetime flag, the ask checks holds(), the sign-in asks via the poller", () => {
    const overlay = read("front-end/islands/DemoModeOverlay.tsx");
    expect(overlay).not.toMatch(/signedOutRef/);
    expect(overlay).toMatch(
      /import \{ signoutGate \} from "\.\.\/lib\/demo-mode\/signout-signal\.ts";/,
    );
    const at = overlay.indexOf("signoutGate(");
    expect(at).toBeGreaterThan(0);
    const body = overlay.slice(at, at + 1_200);
    expect(body).toMatch(/back: \(\) => pollerRef\.current\?\.now\(\)/);
    expect(overlay).toMatch(/if \(gateRef\.current\?\.holds\(\)\) return;/);
  });
});
