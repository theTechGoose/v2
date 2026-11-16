/**
 * REQ-846 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle dm3, issue p11: the stage's waiting / signed-out banner ([data-cy=demo-waiting],
 * REQ-391 m21) was drawn at the frame's own top (`top: fit.top - bannerH`, the frame's width, ~31 px
 * tall, z over the replica), so it covered the frozen frame's top ~30 px — the customer's header
 * ("Monday · November 16 / Hey, Maria"). REQ-642 built a chrome row ABOVE the frame for the stage's
 * badges; the banner now sits in it: `stageBadgeTop(fit.top - bannerH)`, STAGE_BADGE_H tall, one
 * line with an ellipsis, the whole notice (both sentences) in title + aria-label. While it shows,
 * the row is its own: the pointer-off and tab-switched badges, which share the row, wait.
 */
import * as fs from "fs";
import * as path from "path";
import {
  STAGE_BADGE_GAP,
  STAGE_BADGE_H,
  STAGE_TOP_INSET,
  stageBadgesShown,
  stageBadgeTop,
} from "../../shared/demo-mode/stage-chrome";

const ROOT = path.resolve(__dirname, "../..");
const src = fs.readFileSync(
  path.join(ROOT, "front-end/islands/DemoStage.tsx"),
  "utf8",
);

/** the JSX block of one `{cond && (<div data-cy=…>…)}` */
function block(cy: string): string {
  const at = src.indexOf(`data-cy="${cy}"`);
  expect(at).toBeGreaterThan(-1);
  const open = src.lastIndexOf("{", src.lastIndexOf("&& (", at));
  return src.slice(open, src.indexOf("\n            )}", at));
}

describe("REQ-846 (demo-loop cycle dm3, p11) the waiting / signed-out banner sits in REQ-642's chrome row, never over the frame", () => {
  test("geometry: a chrome-row badge's bottom is at or above the frame's top, for any frame top the stage's inset allows", () => {
    for (const frameTop of [STAGE_TOP_INSET, STAGE_TOP_INSET + 40, 200]) {
      const top = stageBadgeTop(frameTop);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(top + STAGE_BADGE_H).toBeLessThanOrEqual(frameTop);
      expect(frameTop - (top + STAGE_BADGE_H)).toBe(STAGE_BADGE_GAP);
    }
  });

  test("demo-waiting's top is stageBadgeTop(fit.top - bannerH), never the frame's own top", () => {
    const b = block("demo-waiting");
    expect(b).toContain("stageBadgeTop(fit.top - bannerH)");
    expect(b).not.toMatch(/top:\$\{\s*fit\.top - bannerH\s*\}px/);
  });

  test("it is one STAGE_BADGE_H line with an ellipsis, centred on the frame like the other badges", () => {
    const b = block("demo-waiting");
    expect(b).toContain("height:${STAGE_BADGE_H}px");
    expect(b).toContain("white-space:nowrap");
    expect(b).toContain("text-overflow:ellipsis");
    expect(b).toContain("overflow:hidden");
    expect(b).toContain("transform:translateX(-50%)");
    expect(b).toMatch(/max-width:\$\{\s*fit\.width\s*\}px/);
    expect(b).not.toContain("flex-wrap:wrap");
    expect(b).toContain("pointer-events:none");
  });

  test("the whole notice — both sentences, signed out or waiting — is in its title and aria-label", () => {
    const b = block("demo-waiting");
    expect(b).toMatch(/title=\{waitingNote\}/);
    expect(b).toMatch(/aria-label=\{waitingNote\}/);
    const def = src.slice(src.indexOf("const waitingNote ="));
    const body = def.slice(0, def.indexOf(";\n"));
    expect(body).toContain('t("demoMode.signedOut", { name })');
    expect(body).toContain('t("demoMode.signedOutKeep")');
    expect(body).toContain('t("demoMode.waitingFor", { name })');
    expect(body).toContain('t("demoMode.waitingKeep")');
  });

  test("while it shows, the row is its own: pointer-off and tab-switched wait (pointer-absent already does, REQ-838)", () => {
    for (
      const cy of [
        "demo-pointer-off",
        "demo-tab-switched",
        "demo-pointer-absent",
      ]
    ) {
      // REQ-868 (dm5 p8) — the three badges open on one gate, `badges`, from stageBadgesShown
      const at = src.indexOf(`data-cy="${cy}"`);
      const cond = src.slice(
        src.lastIndexOf("{badges", at),
        src.lastIndexOf("&& (", at),
      );
      expect(cond).toMatch(/^\{badges &&/);
    }
    expect(src).toMatch(
      /const badges = stageBadgesShown\(\{[^}]*waiting: look\.waiting[^}]*\}\)/,
    );
    expect(
      stageBadgesShown({
        ended: false,
        mirrored: true,
        elsewhere: false,
        waiting: true,
      }),
    ).toBe(false);
  });
});
