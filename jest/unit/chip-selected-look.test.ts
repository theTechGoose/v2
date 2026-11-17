/**
 * REQ-672 (demo-loop cycle 5, demo issues p9 "A chip looks selected before
 * anyone picks it" and c4-p4-p5a "Unselected 'Wider scope' option has a green
 * border"). Raphael: "fix every issue the demo found, loop until there are
 * none."
 *
 * Root cause (RCA, skeptic UPHELD at 2444608a):
 *  - `.wiz-opt--custom` ("Pick a date", "Custom") carried a coffee-50 tinted
 *    background unlike its sibling chips, so on a row of plain chips it read
 *    as a state (front-end/static/assistant-page.css:5605-5609).
 *  - `.wiz-opt--suggested` / `--prefill` (AsstChat.tsx:9236-9252) painted the
 *    same green border + green fill as a selected chip, with no words saying
 *    it was only a suggestion; the prefill chip even carried `--prev`.
 *  - `.chat__jobopt:hover` used the brand-green border that also means
 *    `.is-selected`, outside `@media (hover: hover)`, so a resting pointer or
 *    a sticky touch hover made an unselected job option look selected.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const CSS = read("front-end/static/assistant-page.css");
const CHAT = read("front-end/islands/AsstChat.tsx");

/** Top-level (not inside an @media block) declarations of `selector {…}`. */
function topRules(css: string, selector: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let i = 0;
  let start = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      i = css.indexOf("*/", i + 2) + 2;
      start = i;
      continue;
    }
    if (c === "{") {
      const head = css.slice(start, i).trim();
      if (depth === 0) {
        const end = css.indexOf("}", i);
        const body = css.slice(i + 1, end);
        if (head.startsWith("@")) {
          // skip the whole at-rule block
          let d = 0;
          let j = i;
          for (; j < css.length; j++) {
            if (css[j] === "{") d++;
            else if (css[j] === "}" && --d === 0) break;
          }
          i = j + 1;
          start = i;
          continue;
        }
        const sels = head.split(",").map((s) => s.trim());
        if (sels.includes(selector)) out.push(body);
        i = end + 1;
        start = i;
        continue;
      }
    }
    if (c === "}" || c === ";") start = i + 1;
    i++;
  }
  return out;
}

/** Bodies of `@media (hover: hover) { … }` blocks. */
function hoverMediaBlocks(css: string): string[] {
  const out: string[] = [];
  const re = /@media\s*\(hover:\s*hover\)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    let d = 1;
    let j = m.index + m[0].length;
    for (; j < css.length && d > 0; j++) {
      if (css[j] === "{") d++;
      else if (css[j] === "}") d--;
    }
    out.push(css.slice(m.index + m[0].length, j - 1));
  }
  return out;
}

describe("REQ-672 p9 — a wizard chip never looks selected before a pick", () => {
  it("REQ-672: the custom chip ('Pick a date', 'Custom') has no tinted background of its own", () => {
    const decls = topRules(CSS, ".wiz-opt--custom").join("\n");
    expect(decls).toMatch(/border-style:\s*dashed/);
    expect(decls).not.toMatch(/background/);
  });

  it("REQ-672: the custom chip's hover only applies on real hover devices", () => {
    expect(topRules(CSS, ".wiz-opt--custom:hover")).toEqual([]);
  });

  it("REQ-672: a suggested/prefilled chip has no fill and no inset ring — only --selected is filled", () => {
    for (const sel of [".wiz-opt--suggested", ".wiz-opt--prefill"]) {
      const decls = topRules(CSS, sel).join("\n");
      expect([sel, decls]).toEqual([
        sel,
        expect.stringMatching(/border-style:\s*dashed/),
      ]);
      expect([sel, /background(-color)?:\s*var\(--green-50/.test(decls)])
        .toEqual([sel, false]);
      expect([sel, /box-shadow:\s*inset/.test(decls)]).toEqual([sel, false]);
    }
  });

  it("REQ-672: the prefill chip is not marked as the previous choice", () => {
    expect(CHAT).not.toMatch(/"wiz-opt--prev wiz-opt--prefill"/);
    expect(CHAT).toMatch(/wiz-opt--prefill/);
  });

  it("REQ-672: a suggested/prefilled chip says 'Suggested' in words", () => {
    const wiz = CHAT.slice(CHAT.indexOf('if (m.kind === "wizard")'));
    expect(wiz).toMatch(/class="wiz-opt__tag"/);
    expect(wiz).toMatch(/"asstChat\.wiz\.suggestedTag"/);
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    expect(en["asstChat.wiz.suggestedTag"]).toBe("Suggested");
    expect(es["asstChat.wiz.suggestedTag"]).toBe("Sugerido");
    expect(topRules(CSS, ".wiz-opt__tag").length).toBeGreaterThan(0);
  });
});

describe("REQ-672 c4-p4-p5a — a job option's hover is not the selected look", () => {
  it("REQ-672: no top-level :hover on the job option cards (touch keeps a sticky hover)", () => {
    expect(topRules(CSS, ".chat__jobopt:hover")).toEqual([]);
    expect(topRules(CSS, ".chat__jobopt-custom:hover")).toEqual([]);
  });

  it("REQ-672: the hover-device hover is neutral, never the brand-green border", () => {
    const hovers = hoverMediaBlocks(CSS)
      .flatMap((b) => topRules(b, ".chat__jobopt:hover"))
      .join("\n");
    expect(hovers).toMatch(/border-color/);
    expect(hovers).not.toMatch(/brand-green/);
  });

  it("REQ-672: the green border and mint fill stay on is-selected", () => {
    const sel = topRules(CSS, ".chat__jobopt.is-selected").join("\n");
    expect(sel).toMatch(/border-color:\s*var\(--brand-green/);
    expect(sel).toMatch(/background:\s*var\(--mint-50/);
  });
});
