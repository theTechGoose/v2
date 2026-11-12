/**
 * REQ-297 — demo-loop cycle 1, issue m27: the staff stage kept showing the gone customer's page
 * at full brightness. When the link is "waiting" (after PRESENCE_GRACE_MS — the grace stays, it
 * is what keeps a page change from flashing "waiting") the mirror frame is dimmed and greyed and
 * a centred "Waiting for {name}'s app…" overlay sits on it; the next applied snapshot restores it.
 */
import * as fs from "fs";
import * as path from "path";
import {
  stageFrameLook,
  WAITING_FILTER,
} from "../../shared/demo-mode/stage-frame.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-297 m27 — the frame's look from the link status", () => {
  test("REQ-297 live with a snapshot: visible, no filter, no overlay", () => {
    for (const status of ["direct", "relay"] as const) {
      expect(
        stageFrameLook({ status, mirrored: true, stale: false, styled: true }),
      ).toEqual({
        visibility: "visible",
        filter: "none",
        waiting: false,
      });
    }
  });

  test("REQ-297 waiting with their last screen: greyed and dimmed, the overlay on", () => {
    const look = stageFrameLook({
      status: "waiting",
      mirrored: true,
      stale: true,
      styled: true, // REQ-370 — the replay is styled
    });
    expect(look.visibility).toBe("visible");
    expect(look.filter).toBe(WAITING_FILTER);
    expect(WAITING_FILTER).toMatch(/grayscale\(1\)/);
    expect(WAITING_FILTER).toMatch(/brightness\(\.6\)/);
    expect(look.waiting).toBe(true);
  });

  test("REQ-297 back online but no snapshot applied yet: still the stale, dimmed screen", () => {
    const look = stageFrameLook({
      status: "direct",
      mirrored: true,
      stale: true,
      styled: true, // REQ-370 — the replay is styled
    });
    expect(look.filter).toBe(WAITING_FILTER);
    expect(look.waiting).toBe(true);
  });

  test("REQ-297 nothing mirrored yet: hidden, and no waiting overlay (the connecting spinner owns it)", () => {
    const look = stageFrameLook({
      status: "waiting",
      mirrored: false,
      stale: false,
      styled: true, // REQ-370 — the replay is styled
    });
    expect(look.visibility).toBe("hidden");
    expect(look.waiting).toBe(false);
  });

  test("REQ-297 ended / replaced / closed never dim: their own banners say what happened", () => {
    for (
      const status of ["ended", "replaced", "closed", "connecting"] as const
    ) {
      const look = stageFrameLook({
        status,
        mirrored: true,
        stale: false,
        styled: true,
      });
      expect(look.filter).toBe("none");
      expect(look.waiting).toBe(false);
    }
  });
});

describe("REQ-297 m27 — the stage is wired to it", () => {
  const src = read("front-end/islands/DemoStage.tsx");

  test("REQ-297 the frame's style comes from stageFrameLook (filter + visibility)", () => {
    expect(src).toMatch(
      /from "\.\.\/\.\.\/shared\/demo-mode\/stage-frame\.ts"/,
    );
    expect(src).toMatch(/stageFrameLook\(/);
    expect(src).toMatch(/filter:\$\{look\.filter\}/);
    expect(src).toMatch(/visibility:\$\{look\.visibility\}/);
  });

  test("REQ-297 a waiting overlay names the customer and sits over the frame", () => {
    expect(src).toMatch(/data-cy="demo-waiting"/);
    expect(src).toMatch(/look\.waiting &&/);
    expect(src).toMatch(/t\("demoMode\.waitingFor", \{ name \}\)/);
    expect(src).toMatch(/t\("demoMode\.waitingKeep"\)/);
  });

  test("REQ-297 the stale flag is raised on waiting and cleared by the next applied snapshot", () => {
    expect(src).toMatch(/setStale\(true\)/);
    expect(src).toMatch(/setStale\(false\)/);
  });
});

describe("REQ-297 m27 — the overlay's words, en and es", () => {
  const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
  const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
  test("REQ-297 demoMode.waitingKeep exists in both and keeps {name}-free", () => {
    expect(en["demoMode.waitingKeep"]).toBeTruthy();
    expect(es["demoMode.waitingKeep"]).toBeTruthy();
    expect(en["demoMode.waitingKeep"]).not.toBe(es["demoMode.waitingKeep"]);
  });
  test("REQ-297 demoMode.waitingFor still names the customer in both", () => {
    expect(en["demoMode.waitingFor"]).toMatch(/\{name\}/);
    expect(es["demoMode.waitingFor"]).toMatch(/\{name\}/);
  });
});
