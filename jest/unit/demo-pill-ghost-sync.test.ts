/**
 * REQ-636 — demo-loop cycle 5, issue m8: the stage's copy of the customer's pill differed from
 * the pill (pair 3: "my pill re-expanded after the page change, stage kept it collapsed; then mine
 * collapsed too"; pairs 3/4: the ghost changed seconds before the frame it belonged to).
 *
 * Causes (RCA at 2444608a): (1) on a follow switch `pillFaceAwaiting` kept the old page's
 * `tucked`, while a new non-public page starts untucked; (2) the pill rides a side channel, so the
 * stage applied each face at once while the frame trailed by seconds; (3) a pill message that
 * arrived while the stage still followed the old tab was dropped by the transport's cid filter and
 * only re-sent on a later change.
 *
 * The fix: the awaiting face is no longer tucked; each pill is stamped with the frame clock
 * (`link.now()`) and the stage holds it until the replay reaches that frame (`createPillSync`);
 * on a follow switch the stage asks the new tab for its pill (`askPill`), and the customer
 * re-sends it on `askPill` and on `resync`.
 */
import * as fs from "fs";
import * as path from "path";
import { pillFaceAwaiting } from "../../shared/demo-mode/pill";
import {
  createPillSync,
  PILL_HOLD_MAX_MS,
  PILL_SYNC_SLACK_MS,
} from "../../shared/demo-mode/pill-sync";
import { parsePeerMessage } from "../../shared/demo-mode/protocol";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
/** the slice of `src` from `from` up to `to` */
const between = (src: string, from: string, to: string) => {
  const s = src.slice(src.indexOf(from));
  return s.slice(0, s.indexOf(to));
};

describe("REQ-636 (demo-loop cycle 5, m8) — the ghost waiting for a new page is not tucked", () => {
  test("a follow switch drops the old page's tuck (the new page decides it)", () => {
    const w = pillFaceAwaiting({
      status: "live",
      tucked: true,
      text: "Alex is guiding you",
    });
    expect(w.tucked).toBeUndefined();
    expect(w.status).toBe("connecting");
    expect(w.text).toBe("Alex is guiding you");
  });
});

describe("REQ-636 (demo-loop cycle 5, m8) — a pill face waits for its frame", () => {
  test("a stamped pill is held until the replay reaches the frame sent with it", () => {
    let now = 0;
    const s = createPillSync<string>({ now: () => now });
    s.frame(1_000);
    expect(s.offer("tucked", 5_000)).toBeNull(); // the frame of 5 s is not on the stage yet
    expect(s.frame(3_000)).toBeNull();
    expect(s.frame(5_000)).toBe("tucked");
    expect(s.frame(6_000)).toBeNull(); // handed on once
  });

  test("a pill the replay already reached (within the slack) shows at once", () => {
    const s = createPillSync<string>({ now: () => 0 });
    s.frame(10_000);
    expect(s.offer("a", 9_000)).toBe("a");
    expect(s.offer("b", 10_000 + PILL_SYNC_SLACK_MS)).toBe("b");
  });

  test("several held pills: the latest the frame reached wins, later ones keep waiting", () => {
    const s = createPillSync<string>({ now: () => 0 });
    s.frame(0);
    s.offer("one", 1_000);
    s.offer("two", 2_000);
    s.offer("three", 9_000);
    expect(s.frame(2_500)).toBe("two");
    expect(s.frame(9_000)).toBe("three");
  });

  test("an unstamped pill (an older page) shows at once", () => {
    const s = createPillSync<string>({ now: () => 0 });
    expect(s.offer("old")).toBe("old");
  });

  test("frames that stop coming never strand a pill: it shows after PILL_HOLD_MAX_MS", () => {
    let now = 0;
    const s = createPillSync<string>({ now: () => now });
    s.offer("x", 50_000);
    now = PILL_HOLD_MAX_MS - 1;
    expect(s.due()).toBeNull();
    now = PILL_HOLD_MAX_MS;
    expect(s.due()).toBe("x");
    expect(s.due()).toBeNull();
  });

  test("a follow switch starts over: the old tab's held pill is dropped, the new tab's waits for its own frame", () => {
    const s = createPillSync<string>({ now: () => 0 });
    s.frame(100_000);
    s.offer("old page", 200_000);
    s.reset();
    expect(s.offer("new page", 7_000)).toBeNull(); // new tab, its clock reached nothing yet
    expect(s.frame(7_000)).toBe("new page");
  });
});

describe("REQ-636 (demo-loop cycle 5, m8) — the wire", () => {
  test("a pill carries the frame clock; junk is dropped", () => {
    const r = { left: 0, top: 800, width: 40, height: 40 };
    expect(parsePeerMessage({ k: "pill", r, t: 1234.5 })).toEqual({
      k: "pill",
      r,
      t: 1234.5,
    });
    expect(parsePeerMessage({ k: "pill", r: null, t: 9 })).toEqual({
      k: "pill",
      r: null,
      t: 9,
    });
    expect(parsePeerMessage({ k: "pill", r, t: "x" })).toEqual({
      k: "pill",
      r,
    });
  });

  test("the stage can ask a tab for its pill", () => {
    expect(parsePeerMessage({ k: "askPill" })).toEqual({ k: "askPill" });
  });
});

describe("REQ-636 (demo-loop cycle 5, m8) — the islands are wired", () => {
  const o = read("front-end/islands/DemoModeOverlay.tsx");
  const s = read("front-end/islands/DemoStage.tsx");

  test("the customer stamps each pill with the frame clock", () => {
    const send = between(
      o,
      "const sendPill = () => {",
      "sendPillRef.current = sendPill;",
    );
    expect(send).toMatch(/k: "pill"[^}]*\bt: linkRef\.current\?\.now\(\)/s);
  });

  test("the customer re-sends its pill on resync and on askPill", () => {
    const peer = between(o, 'case "resync":', "onEnded:");
    expect(peer).toMatch(/case "askPill":/);
    expect(peer).toMatch(
      /sentPillRef\.current = null;\s*sendPillRef\.current\(\);/,
    );
  });

  test("the stage holds a pill for its frame and asks the new tab for its pill on a follow switch", () => {
    const pill = between(s, 'case "pill":', "break;");
    expect(pill).toMatch(/pills\.offer\(/);
    expect(s).toMatch(
      // REQ-636 AMENDMENT (reconciled on demo-fixes with REQ-639): `seq` comes before `sent`
      /onFrame: \(f, load, seq, sent\) =>[\s\S]{0,260}pills\.frame\(sent\)/,
    );
    expect(s).toMatch(/pills\.due\(\)/);
    // REQ-636 AMENDMENT (reconciled on demo-fixes with REQ-645 m36): onPeerOnline also hears the
    // browser tab's key
    const on = between(s, "onPeerOnline: (cid", "onPeer: (m");
    expect(on).toMatch(/pills\.reset\(\)/);
    expect(on).toMatch(/send\(\{ k: "askPill" \}\)/);
  });
});
