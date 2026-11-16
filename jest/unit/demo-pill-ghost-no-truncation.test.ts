/**
 * REQ-865 — demo-loop cycle dm4, issue p1: the stage's ghost of the customer's pill cut "Alex is
 * guiding you" / "End the demo with Alex?" with an ellipsis at 1280 and 700 wide (EN and ES).
 *
 * The ghost's box was the customer's measured box × the frame's scale, but its insides were a
 * separate layout with other metrics: a `border:1.5px dashed` (3 px of content width, at any
 * scale; the customer's pill has no border), the status chip at `padding:1px 4px` with the 13·s
 * font (the customer's STATUS_CHIP is 2px 8px at 11.5px), End as a `1px 5px` chip (EndDemo's BTN is
 * 5px 12px at 12px). With End's question up the slack was gone and flex shrink cut the words.
 *
 * Now the ghost lays out at the CUSTOMER's px with the customer's own styles — the pill box's
 * metrics, STATUS_CHIP, EndDemo's BTN / No — in a box of the customer's width, then
 * `transform:scale(fit.s)` from its top-left. The dashed edge is an outline (no layout space).
 */
import * as fs from "fs";
import * as path from "path";
import {
  PILL_BOX_METRICS,
  PILL_STATUS_CHIP,
} from "../../shared/demo-mode/pill.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const between = (s: string, a: string, b: string) => {
  const i = s.indexOf(a);
  expect(i).toBeGreaterThanOrEqual(0);
  const j = s.indexOf(b, i + a.length);
  expect(j).toBeGreaterThan(i);
  return s.slice(i, j);
};

const stage = () => read("front-end/islands/DemoStage.tsx");
/** the full ghost (not the tucked tab's): from its marker comment to the waiting banner */
const ghost = () =>
  between(stage(), "{mirrored && pillShown && !pillTab", "{look.waiting");

describe("REQ-865 (demo-loop cycle dm4, p1): the stage's ghost lays the customer's pill out with her metrics, then scales", () => {
  test("REQ-865 unit: the pill's box metrics and status chip are one shared definition — the customer's pill uses them", () => {
    expect(PILL_BOX_METRICS).toMatch(/padding:7px 12px/);
    expect(PILL_BOX_METRICS).toMatch(/gap:10px/);
    expect(PILL_BOX_METRICS).toMatch(/font-size:13px/);
    expect(PILL_STATUS_CHIP).toMatch(/padding:2px 8px/);
    expect(PILL_STATUS_CHIP).toMatch(/font-size:11\.5px/);
    const overlay = read("front-end/islands/DemoModeOverlay.tsx");
    const pillStyle = between(overlay, "const pillStyle =", ";\n");
    expect(pillStyle).toContain("${PILL_BOX_METRICS}");
    expect(overlay).toMatch(/STATUS_CHIP\s*=\s*PILL_STATUS_CHIP/);
  });

  test("REQ-865 unit: the ghost has no layout border — its dashed edge is an outline", () => {
    const g = ghost();
    expect(g).not.toMatch(/[;`"]border:[^;]*dashed/);
    expect(g).toMatch(/outline:1\.5px dashed/);
  });

  test("REQ-865 unit: the ghost's insides are laid out at the customer's px (her width, her metrics) and scaled by fit.s from the top-left", () => {
    const g = ghost();
    expect(g).toContain("${PILL_BOX_METRICS}");
    // her width (the box cut to the frame, when cut, is ITS width at her px): g / s
    expect(g).toMatch(/const lw = g\.width \/ fit\.s/);
    expect(g).toMatch(/width:\$\{lw\}px/);
    expect(g).toMatch(/transform:scale\(\$\{fit\.s\}\)/);
    expect(g).toMatch(/transform-origin:0 0/);
    // never the old hand-scaled metrics
    expect(g).not.toMatch(/13 \* fit\.s/);
    expect(g).not.toMatch(/12 \* fit\.s/);
    expect(g).not.toMatch(/5 \* fit\.s/);
  });

  test("REQ-865 unit: status, End, Yes and No wear the customer's own styles (STATUS_CHIP, EndDemo's BTN and No)", () => {
    const g = ghost();
    expect(between(g, 'data-cy="demo-pill-ghost-status"', "</span>")).toContain(
      "PILL_STATUS_CHIP",
    );
    expect(between(g, 'data-cy="demo-pill-ghost-end"', "</span>")).toContain(
      "END_BTN",
    );
    expect(between(g, 'data-cy="demo-pill-ghost-yes"', "</span>")).toContain(
      "END_BTN",
    );
    expect(between(g, 'data-cy="demo-pill-ghost-no"', "</span>")).toContain(
      "END_NO",
    );
    expect(between(g, 'data-cy="demo-pill-ghost-asking"', "<strong")).toMatch(
      /gap:8px/,
    );
    // EndDemo's buttons take the pointer; the ghost's copies never do
    for (const cy of ["end", "yes", "no"]) {
      expect(between(g, `data-cy="demo-pill-ghost-${cy}"`, "</span>"))
        .toContain(
          "${inert}",
        );
    }
    expect(g).toMatch(/const inert = "pointer-events:none;cursor:default"/);
    const end = read("front-end/components/demo-mode/EndDemo.tsx");
    expect(end).toMatch(/export const END_BTN\s*=\s*BTN;/);
    expect(end).toMatch(/export const END_NO\s*=/);
    // EndDemo draws with the same constants
    expect(end).toMatch(/\$\{BTN\};\$\{\s*outline/);
    const no = between(end, 'data-cy="demo-end-cancel"', ">");
    const drawn = no.match(/style="([^"]*)"/);
    expect(drawn).not.toBeNull();
    const endNo = end.match(/export const END_NO =\s*"([^"]*)"/);
    expect(endNo).not.toBeNull();
    expect(endNo![1]).toBe(drawn![1]);
  });
});
