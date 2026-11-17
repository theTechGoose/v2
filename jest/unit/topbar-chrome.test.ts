/**
 * REQ-223 — the DashTopbar island ships its own chrome CSS (demo issues
 * i18n-formatting-m6 and i18n-formatting-m11).
 *
 * The EN/ES toggle and the phone rule that hides the search box and the
 * ticker lived only in dashboard.css, so /assistant (which links only
 * assistant-page.css) rendered the toggle as two grey browser-default boxes
 * and, at 390px, squeezed them on top of a still-visible search box. The
 * styles now travel with the island, so every route that renders DashTopbar
 * gets them whatever stylesheet it links.
 */
import * as fs from "fs";
import * as path from "path";
import { TOPBAR_CSS } from "../../front-end/lib/topbar-css";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const squash = (css: string) => css.replace(/\s+/g, "");

function routesRenderingTopbar(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (
      const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
    ) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) walk(rel);
      else if (/\.tsx$/.test(e.name) && /<DashTopbar\b/.test(read(rel))) {
        out.push(rel);
      }
    }
  };
  walk("front-end/routes");
  return out;
}

describe("REQ-223 the topbar island carries its own chrome CSS", () => {
  test("TOPBAR_CSS styles the EN/ES toggle: pill track, bare buttons, a lit 'on' button", () => {
    const css = squash(TOPBAR_CSS);
    expect(css).toMatch(/\.topbar__lang\{[^}]*display:flex/);
    expect(css).toMatch(/\.topbar__lang\{[^}]*flex-shrink:0/);
    expect(css).toMatch(/\.topbar__lang\{[^}]*border-radius:999px/);
    // the buttons drop the browser's grey border/background (the m11 "plain boxes")
    expect(css).toMatch(/\.topbar__lang-btn\{[^}]*border:none/);
    expect(css).toMatch(/\.topbar__lang-btn\{[^}]*background:transparent/);
    expect(css).toMatch(/\.topbar__lang-btn--on\{[^}]*background:#fff/);
  });

  test("REQ-799 (amends REQ-223): on phones (≤640px) the search box is the bar's own full-width second row — never hidden, never beside EN/ES (m6) — the / hint and the ticker are hidden", () => {
    const css = squash(TOPBAR_CSS);
    const phone = css.match(/@media\(max-width:640px\)\{(.*)\}/)?.[1] ?? "";
    expect(phone).not.toMatch(/\.topbar__search\{[^}]*display:none/);
    expect(phone).toMatch(/\.topbar\{[^}]*flex-wrap:wrap/);
    expect(phone).toMatch(/\.topbar__search\{[^}]*flex:1 ?1 ?100%/);
    expect(phone).toMatch(/\.topbar__search\{[^}]*order:10/);
    expect(phone).toMatch(/\.topbar__kbd\{[^}]*display:none/);
    expect(phone).toMatch(/\.topbar__ticker\{[^}]*display:none/);
  });

  test("DashTopbar renders TOPBAR_CSS inside the island (survives hydration, reaches every route)", () => {
    const src = read("front-end/islands/DashTopbar.tsx");
    expect(src).toMatch(
      /import \{ TOPBAR_CSS \} from "\.\.\/lib\/topbar-css\.ts"/,
    );
    expect(src).toMatch(/<style>\{TOPBAR_CSS\}<\/style>/);
  });

  test("the toggle's rules have one home: no route stylesheet re-declares .topbar__lang", () => {
    for (const f of ["dashboard.css", "assistant-page.css"]) {
      expect(read(`front-end/static/${f}`)).not.toMatch(/\.topbar__lang\b/);
    }
  });

  test("the /assistant routes still render DashTopbar and link no dashboard.css — the island alone styles them", () => {
    const routes = routesRenderingTopbar();
    expect(routes).toEqual(
      expect.arrayContaining([
        "front-end/routes/assistant/index.tsx",
        "front-end/routes/assistant/[threadId].tsx",
      ]),
    );
    for (
      const r of [
        "front-end/routes/assistant/index.tsx",
        "front-end/routes/assistant/[threadId].tsx",
      ]
    ) {
      expect(read(r)).not.toMatch(/\/dashboard\.css/);
    }
  });
});
