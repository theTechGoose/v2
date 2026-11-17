/**
 * REQ-817 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle dm1 (run r83b6287b), issue m3: "Stage keeps naming the customer by phone number
 * (and a '+' cursor tag) after they gave a name".
 *
 * RCA (cbcae62d): GET /demo-mode/active recomputes `targetName` on every call, but the stage
 * (1) asked it only while the customer's app was NOT connected, and (2) when it did ask,
 * `sameDemo` compared only `id` + `presenters`, so a new name was dropped as "the same demo". Its
 * cursor's resting tag took the first character of each word: '+' for '+15125550402'.
 *
 * Now: `sameDemo` (shared, used by the stage and the customer's overlay) also compares the names;
 * the stage keeps asking /active while connected (every ACTIVE_NAME_REFRESH_MS) and asks at once
 * when the customer's next page joins; the tag / off-screen initial of a name with no letters is
 * the phone's last two digits, never '+'.
 */
import * as fs from "fs";
import * as path from "path";
import * as stageFrame from "../../shared/demo-mode/stage-frame";
import * as protocol from "../../shared/demo-mode/protocol";
import { tagLabel } from "../../shared/demo-mode/motion";
import { initialOf } from "../../shared/demo-mode/presenter-anchor";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

interface D {
  id: string;
  presenterName: string;
  targetName: string;
  presenters: { userId: string; name: string; color: string }[];
}
// looked up at run time: a missing export fails its own tests, not the whole file
const sameDemo = (a: D | null, b: D): boolean =>
  (stageFrame as unknown as { sameDemo(a: D | null, b: D): boolean })
    .sameDemo(a, b);
const askDelay = (peerOnline: boolean): number =>
  (stageFrame as unknown as { activeAskDelay(o: boolean): number })
    .activeAskDelay(peerOnline);
const REFRESH = (protocol as unknown as { ACTIVE_NAME_REFRESH_MS?: number })
  .ACTIVE_NAME_REFRESH_MS;

const base: D = {
  id: "d1",
  presenterName: "Hans",
  targetName: "+15125550402",
  presenters: [{ userId: "p1", name: "Hans", color: "#2563eb" }],
};

describe("REQ-817 (cycle dm1, m3) — the stage takes the customer's new name", () => {
  test("REQ-817 sameDemo: a poll whose only change is the customer's name is NOT the same demo", () => {
    expect(sameDemo(base, { ...base, targetName: "Maria Lopez" })).toBe(false);
  });
  test("REQ-817 sameDemo: a presenter's new name is not the same demo either", () => {
    expect(sameDemo(base, { ...base, presenterName: "Hans Gruber" })).toBe(
      false,
    );
  });
  test("REQ-817 sameDemo: the echo of the same answer is the same demo (no re-render)", () => {
    expect(sameDemo(base, { ...base, presenters: [...base.presenters] })).toBe(
      true,
    );
    expect(sameDemo(null, base)).toBe(false);
    expect(sameDemo(base, { ...base, id: "d2" })).toBe(false);
  });
  test("REQ-817 the stage keeps asking /active while the customer's app is connected (slowly)", () => {
    expect(typeof REFRESH).toBe("number");
    expect(REFRESH!).toBeGreaterThan(protocol.ACTIVE_POLL_MS);
    expect(REFRESH!).toBeLessThanOrEqual(30_000);
    expect(askDelay(false)).toBe(protocol.ACTIVE_POLL_MS);
    expect(askDelay(true)).toBe(REFRESH);
  });
  test("REQ-817 a phone number's resting tag is its last digits, never '+'", () => {
    expect(tagLabel("+15125550402", true)).toBe("02");
    expect(tagLabel("+15125550402", false)).toBe("+15125550402");
    expect(tagLabel("Maria Lopez", true)).toBe("ML");
    expect(tagLabel("maría", true)).toBe("M");
    expect(tagLabel("", true)).not.toContain("+");
  });
  test("REQ-817 a phone number's off-screen initial is its last digits, never '+'", () => {
    expect(initialOf("+15125550402")).toBe("02");
    expect(initialOf("Maria Lopez")).toBe("M");
    expect(initialOf("")).toBe("?");
    expect(initialOf("+-")).toBe("?");
  });
  test("REQ-817 wiring: the stage and the overlay use the shared sameDemo; the stage re-asks when connected and when the customer's page joins", () => {
    const stage = read("front-end/islands/DemoStage.tsx");
    const overlay = read("front-end/islands/DemoModeOverlay.tsx");
    for (const src of [stage, overlay]) {
      expect(src).not.toMatch(/const sameDemo = /);
      expect(src).toMatch(
        /\bsameDemo\b[\s\S]*from "[^"]*shared\/demo-mode\/stage-frame\.ts"/,
      );
    }
    expect(stage).toMatch(
      /setTimeout\(check, activeAskDelay\(peerOnlineRef\.current\)\)/,
    );
    expect(stage).not.toMatch(
      /if \(alive && !peerOnlineRef\.current\) \{\s*timer = setTimeout/,
    );
    const join = stage.slice(stage.indexOf("onPeerOnline: (cid, tab) => {"));
    expect(join.slice(0, join.indexOf("onPeerTab:"))).toMatch(
      /pollRef\.current\?\.\(\)/,
    );
  });
});
