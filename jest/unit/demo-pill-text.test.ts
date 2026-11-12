/**
 * REQ-294 — demo-loop cycle 1, issues m21 + m43: the demo pill keeps the guide's name (the
 * ended notice wraps; the phone's compact pill opens its details full-width and wrapping), the
 * pill carries the app's own font stack (not `font:inherit`, which on the 404 page was the
 * browser's default face), and the 404 page sets its body font and says DocuMonster.
 */
import * as fs from "fs";
import * as path from "path";
import { PILL_FONT } from "../../shared/demo-mode/pill.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

/** the text of one JSX block: from its data-cy to the closing of its element */
const block = (src: string, from: string, to: string) => {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error(`no block ${from} … ${to}`);
  return src.slice(a, b);
};

describe("REQ-294 the pill carries the app's own font (demo m21: monospace on the 404 page)", () => {
  test("PILL_FONT is the app's --font-body stack", () => {
    const css = read("front-end/static/dashboard.css");
    const body = css.match(/--font-body:\s*([^;]+);/)?.[1].trim();
    expect(body).toBeDefined();
    expect(PILL_FONT).toBe(body);
  });

  test("the pill style uses PILL_FONT, never font:inherit", () => {
    const o = read("front-end/islands/DemoModeOverlay.tsx");
    const pillStyle = o.match(/const pillStyle = `([^`]*)`/)?.[1] ?? "";
    expect(pillStyle).toContain("font-family:${PILL_FONT}");
    expect(pillStyle).not.toContain("font:inherit");
    expect(o).toMatch(
      /PILL_FONT,?\n[\s\S]*?from "\.\.\/\.\.\/shared\/demo-mode\/pill\.ts"/,
    );
  });
});

describe("REQ-294 the pill keeps the guide's name (demo m21: 'ended th…', 'Alex…')", () => {
  const o = read("front-end/islands/DemoModeOverlay.tsx");

  test("the ended notice wraps and is not cut; on a phone it drops the title", () => {
    const notice = block(
      o,
      'data-cy="demo-ended"',
      'data-cy="demo-ended-dismiss"',
    );
    expect(o).toMatch(/const wrap = "white-space:normal[^"]*"/);
    expect(notice).toMatch(/style=\{wrap\}/);
    expect(notice).not.toMatch(/style=\{cut\}/);
    expect(notice).toMatch(
      /\{!compact && <strong>\{t\("demoMode\.title"\)\}<\/strong>\}/,
    );
  });

  test("the compact pill's details open full-width and wrapping, the guiding text whole", () => {
    const details = block(o, 'data-cy="demo-details"', 'data-cy="demo-more"');
    expect(details).toMatch(/compact \? `flex-basis:100%;\$\{wrap\}` : cut/);
    expect(details).toMatch(/style=\{compact \? wrap : cut\}>\{guidingText\}/);
    expect(details).not.toMatch(/<span style=\{cut\}>\{guidingText\}/);
    expect(details).toMatch(
      /\{!compact && <strong>\{t\("demoMode\.title"\)\}<\/strong>\}/,
    );
    // the live pill itself stays one line (REQ-228) until the details are opened — or, REQ-548
    // (cycle 4, p4-p3e), End asks (pillWraps; its truth table is in demo-end-ask-compact.test.ts)
    const at = o.indexOf('data-cy="demo-details"');
    const live = o.slice(o.lastIndexOf('data-cy="demo-pill"', at), at);
    expect(live).toMatch(
      /pillWraps\(\{ compact, open, asking \}\) \? ";flex-wrap:wrap" : ""/,
    );
  });
});

describe("REQ-294 the 404 page (demo m43: the old brand; m21: no page font)", () => {
  const e = read("front-end/routes/_error.tsx");

  test("the brand link reads brand.namePrefix + brand.nameSuffix, like the login card", () => {
    expect(e).toMatch(/tFor\(lang, "brand\.namePrefix"\)/);
    expect(e).toMatch(/tFor\(lang, "brand\.nameSuffix"\)/);
    expect(e).not.toMatch(/Paperwork/);
  });

  test("the page links error-page.css, which sets the body font to the app's stack", () => {
    expect(e).toMatch(
      /<link rel="stylesheet" href=\{asset\("\/error-page\.css"\)\} \/>/,
    );
    const css = read("front-end/static/error-page.css");
    const body = css.match(/body\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(body).toMatch(/font-family:\s*"Inter", system-ui/);
  });
});
