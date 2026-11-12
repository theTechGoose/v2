/**
 * REQ-541 — demo-loop cycle 4, issue M22: with a second staff browser on the same account, the
 * first stage froze on the customer's last screen (only a small "Open in another window" chip
 * said so), and when the demo was ended from the second browser the first one was left
 * impersonating the customer: its /active poll found no demo, showed "No demo is open" with a
 * plain link to /admin, and /admin then put up "You are guiding {name} in this browser".
 *
 *  - a stage that showed a demo and then finds none (the /active poll, or the re-check on a
 *    closed link) hands the presenter their own account back (stop-impersonating → /admin);
 *  - the "No demo is open" screen's Back to admin also stops impersonating before it navigates;
 *  - a window replaced by another one of the same account is greyed, under a banner across the
 *    frame: "This demo moved to another window" + Use this window.
 */
import * as fs from "fs";
import * as path from "path";
import * as stageFrame from "../../shared/demo-mode/stage-frame";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const ISLAND = "front-end/islands/DemoStage.tsx";

type Look = ReturnType<typeof stageFrame.stageFrameLook> & {
  elsewhere?: boolean;
};
const look = (a: {
  status: "direct" | "relay" | "waiting" | "replaced";
  mirrored: boolean;
  stale: boolean;
  styled: boolean;
}): Look => (stageFrame.stageFrameLook as unknown as (x: typeof a) => Look)(a);
// looked up at run time: a missing export fails its own tests, not the whole file
const afterActiveCheck = (a: { found: boolean; shown: boolean }): string =>
  (stageFrame as unknown as {
    afterActiveCheck(x: typeof a): string;
  }).afterActiveCheck(a);

describe("REQ-541 (cycle 4, M22) — a replaced stage window is plainly not live", () => {
  test("REQ-541 replaced with the customer's screen in the frame: greyed, and the moved banner is on", () => {
    const l = look({
      status: "replaced",
      mirrored: true,
      stale: false,
      styled: true,
    });
    expect(l.visibility).toBe("visible");
    expect(l.filter).toBe(stageFrame.WAITING_FILTER);
    expect(l.elsewhere).toBe(true);
    expect(l.waiting).toBe(false);
  });

  test("REQ-541 replaced before any frame came: still the moved banner, never a connecting spinner", () => {
    const l = look({
      status: "replaced",
      mirrored: false,
      stale: false,
      styled: false,
    });
    expect(l.elsewhere).toBe(true);
  });

  test("REQ-541 a live window is not 'elsewhere'", () => {
    const l = look({
      status: "direct",
      mirrored: true,
      stale: false,
      styled: true,
    });
    expect(l.elsewhere ?? false).toBe(false);
    expect(l.filter).toBe("none");
  });

  test("REQ-541 the island draws the banner across the frame with Use this window, and hides the connecting spinner", () => {
    const src = read(ISLAND);
    const at = src.indexOf('data-cy="demo-elsewhere"');
    expect(at).toBeGreaterThan(-1);
    const banner = src.slice(at, at + 2500);
    expect(banner).toMatch(/demoMode\.movedElsewhere/);
    expect(banner).toMatch(/demoMode\.useHere/);
    expect(src).toMatch(/look\.elsewhere/);
    expect(src).toMatch(
      /look\.visibility === "hidden" && !look\.elsewhere/,
    );
  });

  test("REQ-541 the banner's words are in en and es", () => {
    for (const lang of ["en", "es"]) {
      const dict = JSON.parse(read(`lang/${lang}.json`));
      expect(typeof dict["demoMode.movedElsewhere"]).toBe("string");
      expect(dict["demoMode.movedElsewhere"].length).toBeGreaterThan(10);
    }
  });
});

describe("REQ-541 (cycle 4, M22) — a stage whose demo is gone hands the account back", () => {
  test("REQ-541 the /active answer: found → show; none after a demo was shown → hand back; none on a fresh stage → the empty screen", () => {
    expect(afterActiveCheck({ found: true, shown: false })).toBe("show");
    expect(afterActiveCheck({ found: true, shown: true })).toBe("show");
    expect(afterActiveCheck({ found: false, shown: true })).toBe("handBack");
    expect(afterActiveCheck({ found: false, shown: false })).toBe("empty");
  });

  test("REQ-541 the island's poll and its closed-link re-check both go through afterActiveCheck and hand back", () => {
    const src = read(ISLAND);
    const uses = src.match(/afterActiveCheck\(/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(2);
    expect(src).toMatch(/backToOwnAccount\(\{ by: "unknown" \}\)/);
  });

  test("REQ-541 the empty screen's Back to admin stops impersonating first — no plain link to /admin", () => {
    const src = read(ISLAND);
    const at = src.indexOf('data-cy="demo-stage-empty"');
    expect(at).toBeGreaterThan(-1);
    const empty = src.slice(at, at + 1200);
    expect(empty).not.toMatch(/href="\/admin"/);
    expect(empty).toMatch(/data-cy="demo-stage-back"/);
    expect(empty).toMatch(/onClick=\{\(\) => void backToOwnAccount\(/);
    // backToOwnAccount is what calls stopImpersonating
    const fn = src.slice(src.indexOf("async function backToOwnAccount"));
    expect(fn.slice(0, 600)).toMatch(/adminClient\.stopImpersonating\(\)/);
  });
});
