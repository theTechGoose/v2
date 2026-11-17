/**
 * REQ-672 — demo-loop cycle 5, issues p9 "A chip looks selected before
 * anyone picks it" and c4-p4-p5a "Unselected 'Wider scope' option has a
 * green border". Raphael: "fix every issue the demo found, loop until there
 * are none."
 *
 * The real front-end/static/assistant-page.css is loaded into a browser with
 * the markup AsstChat.tsx renders for a wizard option row and the job-option
 * cards; the computed styles must keep "selected" (green border + fill) for
 * the picked option only:
 *  - the custom chip ("Pick a date") has the same background as its siblings;
 *  - a suggested chip has no fill and carries a visible "Suggested" tag;
 *  - hovering an unselected job option never gives it the selected border.
 */
import { story } from "#shots";

const CSS_URL = new URL(
  "../../front-end/static/assistant-page.css",
  import.meta.url,
);

const MARKUP = `
<div class="wiz__opts">
  <button type="button" class="wiz-opt" id="plain">ASAP</button>
  <button type="button" class="wiz-opt wiz-opt--suggested" id="suggested">1 day<span class="wiz-opt__tag">Suggested</span></button>
  <button type="button" class="wiz-opt wiz-opt--custom" id="custom">Pick a date</button>
  <button type="button" class="wiz-opt wiz-opt--selected" id="selected">1 week</button>
</div>
<div class="chat__jobopts-list" style="margin-top:40px">
  <div class="chat__jobopt" id="job-a"><div class="chat__jobopt-head"><span class="chat__jobopt-radio"></span><span class="chat__jobopt-name">Wider scope</span></div></div>
  <div class="chat__jobopt is-selected" id="job-sel"><div class="chat__jobopt-head"><span class="chat__jobopt-radio"></span><span class="chat__jobopt-name">Standard</span></div></div>
  <div class="chat__jobopt" id="job-b"><div class="chat__jobopt-head"><span class="chat__jobopt-radio"></span><span class="chat__jobopt-name">Basic</span></div></div>
</div>`;

Deno.test("REQ-672 p9 + c4-p4-p5a: only the picked chip / job option looks selected (custom, suggested, hover)", (t) =>
  story(t, async ({ page, expect }) => {
    const css = await Deno.readTextFile(CSS_URL);
    await page.setContent(
      `<!doctype html><html><head><style>${css}</style></head><body style="padding:20px">${MARKUP}</body></html>`,
      { waitUntil: "load" },
    );
    const look = (id: string) =>
      page.evaluate((id) => {
        const s = getComputedStyle(document.getElementById(id)!);
        return {
          bg: s.backgroundColor,
          border: s.borderTopColor,
          style: s.borderTopStyle,
          shadow: s.boxShadow,
        };
      }, id);

    // Park the pointer away from everything.
    await page.mouse.move(1, 790);
    const plain = await look("plain");
    const custom = await look("custom");
    const suggested = await look("suggested");
    const selected = await look("selected");
    expect(
      custom.bg === plain.bg,
      `the custom chip's background matches its siblings (${custom.bg} vs ${plain.bg})`,
    );
    expect(
      custom.style === "dashed",
      `the custom chip keeps a dashed border (${custom.style})`,
    );
    expect(
      suggested.bg === plain.bg,
      `a suggested chip is not filled like a selected one (${suggested.bg} vs plain ${plain.bg}, selected ${selected.bg})`,
    );
    expect(
      !suggested.shadow.includes("inset"),
      `a suggested chip has no inset ring (${suggested.shadow})`,
    );
    expect(
      await page.locator("#suggested .wiz-opt__tag").isVisible(),
      "a suggested chip says 'Suggested' in words",
    );

    const jobSel = await look("job-sel");
    await page.hover("#job-a");
    const hovered = await look("job-a");
    expect(
      hovered.border !== jobSel.border,
      `a hovered unselected job option does not take the selected border (${hovered.border} vs ${jobSel.border})`,
    );
    expect(
      hovered.bg !== jobSel.bg,
      `a hovered unselected job option does not take the selected fill (${hovered.bg})`,
    );
  }));
