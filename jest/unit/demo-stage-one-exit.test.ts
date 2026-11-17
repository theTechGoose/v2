/**
 * REQ-537 (demo-loop cycle 4, issue m36) — the stage has one exit. The impersonation banner (with
 * its "Return to your account") is not drawn on /demo/stage, where the pill's End already is; every
 * other page keeps it. With several presenters, the stage pill offers "Leave the demo" as a
 * secondary action (alone, End is the way out — leaving would end it anyway).
 */
import * as fs from "fs";
import * as path from "path";
import {
  impersonationBannerOn,
  stageLeaveShown,
} from "../../shared/demo-mode/stage-chrome.ts";
import { STAGE_PATH } from "../../shared/demo-mode/protocol.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-537 (m36) the stage has one exit", () => {
  test("the impersonation banner is off on the stage and on everywhere else", () => {
    expect(impersonationBannerOn(STAGE_PATH)).toBe(false);
    expect(impersonationBannerOn(`${STAGE_PATH}/`)).toBe(false);
    for (
      const p of [
        "/admin",
        "/dashboard",
        "/",
        "/demo",
        "/demo/stagex",
        "/quotes/1",
      ]
    ) {
      expect(impersonationBannerOn(p)).toBe(true);
    }
  });

  test("Leave the demo shows in the stage pill only with more than one presenter", () => {
    expect(stageLeaveShown(0)).toBe(false);
    expect(stageLeaveShown(1)).toBe(false);
    expect(stageLeaveShown(2)).toBe(true);
    expect(stageLeaveShown(5)).toBe(true);
  });

  test("the banner island gates itself on the page through impersonationBannerOn", () => {
    const src = read("front-end/islands/ImpersonationBanner.tsx");
    expect(src).toMatch(
      /from "\.\.\/\.\.\/shared\/demo-mode\/stage-chrome\.ts"/,
    );
    expect(src).toMatch(
      /impersonationBannerOn\(\s*globalThis\.location\.pathname/,
    );
  });

  test("the stage pill draws Leave (data-cy demo-leave) behind stageLeaveShown, leaving through the API", () => {
    const src = read("front-end/islands/DemoStage.tsx");
    expect(src).toMatch(/stageLeaveShown\(demo\.presenters\.length\)/);
    expect(src).toMatch(/data-cy="demo-leave"/);
    expect(src).toMatch(/demoModeClient\.leave\(/);
    expect(src).toMatch(/t\("demoMode\.leave"\)/);
  });
});
