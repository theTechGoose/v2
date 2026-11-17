/**
 * REQ-378 (demo-loop cycle 2, issue m22) — the stage sat on "Connecting to …" 10-20 s at the start
 * because the customer's app found the new demo only on its next `GET /demo-mode/active`, asked
 * every ACTIVE_POLL_MS (5 s) after the last answer. Now the ask is HELD by the server (up to
 * ACTIVE_WAIT_MS) and answers the moment a demo is opened for the caller; after a held answer
 * the next ask goes out ACTIVE_REASK_MS later, so the app is listening almost all the time. A
 * failed ask (signed out, backend away) still waits the full `every`.
 */
import * as fs from "fs";
import * as path from "path";
import { activePoll } from "../../front-end/lib/demo-mode/active-poll";
import {
  ACTIVE_POLL_MS,
  ACTIVE_REASK_MS,
  ACTIVE_WAIT_MS,
  WHERE_TTL_MS,
} from "../../shared/demo-mode/protocol";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("REQ-378 (m22) the customer's app hears of a new demo at once", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test("REQ-378 the server holds an ask up to ACTIVE_WAIT_MS; the app re-asks ACTIVE_REASK_MS after an answer; the page it reports never lapses between asks", () => {
    expect(ACTIVE_REASK_MS).toBeLessThanOrEqual(1_000);
    expect(ACTIVE_WAIT_MS).toBeGreaterThanOrEqual(5_000);
    // every ask also says where the app is (kept WHERE_TTL_MS): a held ask plus the gap stays under it
    expect(ACTIVE_WAIT_MS + ACTIVE_REASK_MS).toBeLessThan(WHERE_TTL_MS);
  });

  test("REQ-378 activePoll: after an ANSWER the next ask is `rest` ms away; after a failure it is `every`", async () => {
    let fail = false;
    const ask = jest.fn(() =>
      fail ? Promise.reject(new Error("401")) : Promise.resolve()
    );
    const poll = activePoll({
      ask,
      every: ACTIVE_POLL_MS,
      rest: ACTIVE_REASK_MS,
      connected: () => false,
    });
    poll.now();
    await settle();
    expect(ask).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(ACTIVE_REASK_MS);
    await settle();
    expect(ask).toHaveBeenCalledTimes(2);
    fail = true;
    jest.advanceTimersByTime(ACTIVE_REASK_MS);
    await settle();
    expect(ask).toHaveBeenCalledTimes(3); // this one fails
    jest.advanceTimersByTime(ACTIVE_REASK_MS);
    await settle();
    expect(ask).toHaveBeenCalledTimes(3); // a failure backs off to `every`
    jest.advanceTimersByTime(ACTIVE_POLL_MS - ACTIVE_REASK_MS);
    await settle();
    expect(ask).toHaveBeenCalledTimes(4);
    poll.stop();
  });

  test("REQ-378 the client sends `wait`; the overlay's poll asks with ACTIVE_WAIT_MS (only while shown) and rests ACTIVE_REASK_MS", () => {
    const client = read("front-end/clients/demo-mode.ts");
    expect(client).toMatch(/wait/);
    expect(client).toMatch(/[?&]wait=|"wait"/);
    const overlay = read("front-end/islands/DemoModeOverlay.tsx");
    const poll = overlay.slice(
      overlay.indexOf("const poller = activePoll({"),
      overlay.indexOf("pollRef.current = check;"),
    );
    expect(poll).toMatch(/rest: ACTIVE_REASK_MS/);
    expect(poll).toMatch(/demoModeClient\.active\(\{[^}]*\bwait\b/);
    expect(poll).toMatch(/ACTIVE_WAIT_MS/);
    // a hidden tab never holds a connection (HTTP/1.1 allows six per host): it asks plainly
    expect(poll).toMatch(/visibilityState === "visible"/);
  });
});
