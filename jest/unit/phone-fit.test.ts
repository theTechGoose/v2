/**
 * REQ-353 — demo-loop cycle 1, demo issues M40 and m23: on a 390 px phone
 * the app never scrolls sideways and the headers fit. The browser story
 * (e2e/phone-fit) measures the real layout; these pin the rules that make it
 * so, so a later edit cannot quietly drop one.
 */
import * as fs from "fs";
import * as path from "path";
import { TOPBAR_CSS } from "../../front-end/lib/topbar-css";

const FE = path.join(__dirname, "../../front-end");
const read = (p: string) => fs.readFileSync(path.join(FE, p), "utf8");

/** the bodies of every `@media (max-width: <n>px)` block with n ≤ max */
function phoneBlocks(css: string, max = 640): string {
  const out: string[] = [];
  const re = /@media\s*\(\s*max-width\s*:\s*(\d+)px\s*\)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    if (Number(m[1]) > max) continue;
    let depth = 1;
    let i = re.lastIndex;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
    }
    out.push(css.slice(re.lastIndex, i - 1));
  }
  return out.join("\n");
}

/** the declarations of `selector { … }` inside css (all occurrences joined) */
function rule(css: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|[}\\s,])${esc}\\s*\\{([^}]*)\\}`, "g");
  return [...css.matchAll(re)].map((m) => m[1]).join(";");
}

describe("REQ-353 M40/m23: a 390 px phone never scrolls sideways and the headers fit", () => {
  test("the topbar's phone rules let the greeting shrink (ellipsis) instead of pushing the EN/ES pill off screen", () => {
    const phone = phoneBlocks(TOPBAR_CSS);
    const greet = rule(phone, ".topbar__greet");
    expect(greet).toMatch(/min-width\s*:\s*0/);
    expect(greet).toMatch(/flex-shrink\s*:\s*1|flex\s*:\s*1/);
    const name = rule(phone, ".topbar__greet-name");
    expect(name).toMatch(/text-overflow\s*:\s*ellipsis/);
    expect(name).toMatch(/overflow\s*:\s*hidden/);
    expect(rule(phone, ".topbar")).toMatch(/padding\s*:\s*0 12px/);
  });

  test("<main> clips sideways overflow on phones in both shells, so nothing can scroll it 17 px", () => {
    for (const sheet of ["static/assistant-page.css", "static/dashboard.css"]) {
      const main = rule(phoneBlocks(read(sheet)), ".main");
      expect({ sheet, clip: /overflow(-x)?\s*:\s*clip/.test(main) }).toEqual({
        sheet,
        clip: true,
      });
    }
  });

  test("every programmatic composer focus in AsstChat passes preventScroll", () => {
    const src = read("islands/AsstChat.tsx");
    const calls = [...src.matchAll(/taRef\.current\?\.focus\(([^)]*)\)/g)];
    expect(calls.length).toBeGreaterThan(0);
    const bare = calls.filter((m) => !/preventScroll\s*:\s*true/.test(m[1]));
    expect(bare.map((m) => m[0])).toEqual([]);
  });

  test("the worker header wraps on a phone instead of squeezing 'Mis tareas' under the EN/ES pill", () => {
    const src = read("islands/WorkerScreen.tsx");
    const phone = phoneBlocks(src, 480);
    expect(rule(phone, ".top")).toMatch(/flex-wrap\s*:\s*wrap/);
    expect(rule(phone, ".top .brand")).toMatch(
      /flex\s*:\s*1 0 auto|flex-shrink\s*:\s*0/,
    );
  });
});

describe("REQ-612 p4-p8c (demo-loop cycle 4): the worker header's actions wrap together on a phone", () => {
  const src = read("islands/WorkerScreen.tsx");

  test("Back to office and Sign out sit in one .top__actions group inside .top", () => {
    const at = src.indexOf('<div class="top__actions">');
    expect(at).toBeGreaterThan(src.indexOf('<div class="top">'));
    const group = src.slice(at, src.indexOf("</div>", at));
    expect(group).toContain('data-cy="w-office"');
    expect(group).toContain('data-cy="w-logout"');
  });

  test("on a phone the group takes a whole row, end-aligned, and its labels never wrap", () => {
    const phone = rule(phoneBlocks(src, 480), ".top__actions");
    expect(phone).toMatch(/flex-basis\s*:\s*100%|flex\s*:\s*[01] [01] 100%/);
    expect(phone).toMatch(/justify-content\s*:\s*flex-end/);
    expect(rule(src, ".top__actions")).toMatch(/display\s*:\s*flex/);
    expect(rule(src, ".top__actions .btn")).toMatch(/white-space\s*:\s*nowrap/);
  });
});
