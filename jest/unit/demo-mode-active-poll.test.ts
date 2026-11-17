/**
 * REQ-222 (demo issue M11) — after a demo ends, the customer's app keeps asking the server
 * `GET /demo-mode/active` every 5 s, so a new demo reaches them without a reload.
 *
 * The overlay's poll was a self-scheduling setTimeout chain that scheduled its next ask only while
 * not connected; a demo that ENDED from the connected state never restarted it (onStatus skips
 * the re-poll for "ended", onEnded / end() only clear the demo). `activePoll` makes the poll a
 * function of the connection state: whenever this side is not connected, an ask is due within
 * `every` ms.
 */
import * as fs from "fs";
import * as path from "path";
import { activePoll } from "../../front-end/lib/demo-mode/active-poll";
import { ACTIVE_POLL_MS } from "../../shared/demo-mode/protocol";
import { CATCHUP_MIN_MS } from "../../front-end/lib/poll";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** let the ask's promise settle under fake timers */
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("REQ-222 (M11) the customer's /active poll survives the end of a connected demo", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test("REQ-222 not connected: asks at once, then every 5 s", async () => {
    let connected = false;
    const ask = jest.fn(() => Promise.resolve());
    const poll = activePoll({
      ask,
      every: ACTIVE_POLL_MS,
      connected: () => connected,
    });
    poll.now();
    await settle();
    expect(ask).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(ACTIVE_POLL_MS);
    await settle();
    expect(ask).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(ACTIVE_POLL_MS);
    await settle();
    expect(ask).toHaveBeenCalledTimes(3);
    poll.stop();
  });

  test("REQ-222 connected: the asking stops", async () => {
    let connected = false;
    const ask = jest.fn(() => Promise.resolve());
    const poll = activePoll({
      ask,
      every: ACTIVE_POLL_MS,
      connected: () => connected,
    });
    poll.now();
    await settle();
    connected = true;
    jest.advanceTimersByTime(ACTIVE_POLL_MS); // the ask already scheduled runs, then no more
    await settle();
    const n = ask.mock.calls.length;
    jest.advanceTimersByTime(ACTIVE_POLL_MS * 4);
    await settle();
    expect(ask).toHaveBeenCalledTimes(n);
    poll.stop();
  });

  test("REQ-222 the demo ends from the connected state: an ask comes within 5 s and keeps coming, and a new demo is picked up", async () => {
    let connected = false;
    let serverHasNewDemo = false;
    const seen: string[] = [];
    const ask = jest.fn(async () => {
      seen.push(serverHasNewDemo ? "demo-2" : "none");
    });
    const poll = activePoll({
      ask,
      every: ACTIVE_POLL_MS,
      connected: () => connected,
    });
    poll.now();
    await settle();
    // the presenter joins: connected; the chain stops (by design)
    connected = true;
    jest.advanceTimersByTime(ACTIVE_POLL_MS);
    await settle();
    const before = ask.mock.calls.length;
    // the demo ends: the link reports "ended", the link is torn down — not connected any more
    connected = false;
    poll.idle();
    jest.advanceTimersByTime(ACTIVE_POLL_MS);
    await settle();
    expect(ask.mock.calls.length).toBe(before + 1);
    // staff start a new demo; the next ask sees it — no reload
    serverHasNewDemo = true;
    jest.advanceTimersByTime(ACTIVE_POLL_MS);
    await settle();
    expect(ask.mock.calls.length).toBe(before + 2);
    expect(seen[seen.length - 1]).toBe("demo-2");
    poll.stop();
  });

  test("REQ-222 an ask in flight when the link drops still re-arms the poll once it answers", async () => {
    let connected = true;
    let answer!: () => void;
    const ask = jest.fn(() => new Promise<void>((r) => (answer = r)));
    const poll = activePoll({
      ask,
      every: ACTIVE_POLL_MS,
      connected: () => connected,
    });
    poll.now(); // asked while connected
    connected = false;
    poll.idle(); // in flight: nothing new yet
    expect(ask).toHaveBeenCalledTimes(1);
    answer();
    await settle();
    jest.advanceTimersByTime(ACTIVE_POLL_MS);
    await settle();
    expect(ask).toHaveBeenCalledTimes(2);
    poll.stop();
  });

  test("REQ-222 a failed ask (backend away) keeps polling", async () => {
    const ask = jest.fn(() => Promise.reject(new Error("away")));
    const poll = activePoll({
      ask,
      every: ACTIVE_POLL_MS,
      connected: () => false,
    });
    poll.now();
    await settle();
    jest.advanceTimersByTime(ACTIVE_POLL_MS);
    await settle();
    expect(ask).toHaveBeenCalledTimes(2);
    poll.stop();
  });

  test("REQ-222 idle twice, or now() while a timer waits, never doubles the chain", async () => {
    const ask = jest.fn(() => Promise.resolve());
    const poll = activePoll({
      ask,
      every: ACTIVE_POLL_MS,
      connected: () => false,
    });
    poll.idle();
    poll.idle();
    poll.now();
    poll.now();
    await settle();
    expect(ask).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(ACTIVE_POLL_MS);
    await settle();
    expect(ask).toHaveBeenCalledTimes(3);
    jest.advanceTimersByTime(ACTIVE_POLL_MS);
    await settle();
    expect(ask).toHaveBeenCalledTimes(4);
    poll.stop();
  });

  test("REQ-222 stopped: nothing more is asked", async () => {
    const ask = jest.fn(() => Promise.resolve());
    const poll = activePoll({
      ask,
      every: ACTIVE_POLL_MS,
      connected: () => false,
    });
    poll.now();
    await settle();
    poll.stop();
    poll.idle();
    jest.advanceTimersByTime(ACTIVE_POLL_MS * 3);
    await settle();
    expect(ask).toHaveBeenCalledTimes(1);
  });

  test("REQ-222 the overlay drives its poll with activePoll and re-arms it whenever it is not connected", () => {
    const src = read("front-end/islands/DemoModeOverlay.tsx");
    expect(src).toMatch(/from "\.\.\/lib\/demo-mode\/active-poll\.ts"/);
    expect(src).toMatch(/activePoll\(/);
    // an effect on the connection state: not connected (the end included) → idle()
    expect(src).toMatch(
      /if \(!peerOnline\) pollerRef\.current\?\.idle\(\);\s*\}, \[peerOnline, demo\?\.id\]\)/,
    );
    // the old self-scheduling chain is gone
    expect(src).not.toMatch(/timer = setTimeout\(check, ACTIVE_POLL_MS\)/);
  });
});

/**
 * REQ-299 (demo cycle 1, issue p4) — the overlay's catch-up when the tab is shown again is
 * debounced: `catchUp()` asks only if the last ask began 2 s or more ago. `now()` (a roster
 * change, the peer dropped, the started event) still asks at once.
 */
describe("REQ-299 the overlay's visible catch-up is debounced", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test("REQ-299 catchUp() less than 2 s after the last ask does nothing; 2 s later it asks", async () => {
    const ask = jest.fn(() => Promise.resolve());
    const poll = activePoll({
      ask,
      every: ACTIVE_POLL_MS,
      connected: () => false,
    });
    poll.now();
    await settle();
    expect(ask).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(500);
    poll.catchUp();
    poll.catchUp();
    poll.catchUp();
    await settle();
    expect(ask).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(CATCHUP_MIN_MS);
    poll.catchUp();
    await settle();
    expect(ask).toHaveBeenCalledTimes(2);
    poll.stop();
  });

  test("REQ-299 a catchUp() that asks re-arms the schedule from that ask, not on top of it", async () => {
    const ask = jest.fn(() => Promise.resolve());
    const poll = activePoll({
      ask,
      every: ACTIVE_POLL_MS,
      connected: () => false,
    });
    poll.now();
    await settle();
    jest.advanceTimersByTime(3_000);
    poll.catchUp();
    await settle();
    expect(ask).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(ACTIVE_POLL_MS - 1);
    await settle();
    expect(ask).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(1);
    await settle();
    expect(ask).toHaveBeenCalledTimes(3);
    poll.stop();
  });

  test("REQ-299 the overlay's visibilitychange handler goes through catchUp(), not an unconditional ask", () => {
    const src = read("front-end/islands/DemoModeOverlay.tsx");
    const at = src.indexOf("const onVisible = ");
    expect(at).toBeGreaterThan(-1);
    const handler = src.slice(at, src.indexOf("};", at));
    expect(handler).toMatch(/poller\.catchUp\(\)/);
    expect(handler).not.toMatch(/check\(\)|poller\.now\(\)/);
  });
});
