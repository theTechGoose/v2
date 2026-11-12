/**
 * REQ-416 — demo-loop cycle 2, issue p13-n ("Worker sign-in stays Spanish
 * after 'Salir'"). The worker's language (REQ-285) is applied for the signed-in
 * session only — never persisted over the browser's own pm_lang — and Salir
 * puts the screen back in the language the page was opened in (or the one the
 * person picked on the EN/ES switch).
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const island = () => read("front-end/islands/WorkerScreen.tsx");

describe("REQ-416 the worker's language lasts the session, Salir restores the page's", () => {
  test("setLang takes a { persist } option", () => {
    expect(read("front-end/lib/i18n.ts")).toMatch(
      /export function setLang\(\s*lang: Lang,\s*opts[^)]*persist\?: boolean/,
    );
  });

  test("the signed-in worker's language is applied without persisting it", () => {
    expect(island()).toMatch(
      /if \(wl\) setLang\(wl, \{ persist: false \}\)/,
    );
  });

  test("logout restores the page's language", () => {
    const src = island();
    const fn = src.slice(src.indexOf("function logout()"));
    const body = fn.slice(0, fn.indexOf("\n  }\n"));
    expect(body).toMatch(
      /setLang\(pageLangRef\.current, \{ persist: false \}\)/,
    );
    // the page language starts as initialLang, and the switch updates it
    expect(src).toMatch(/const pageLangRef = useRef<Lang>\(initialLang\)/);
    expect(src).toMatch(/pageLangRef\.current = c;/);
  });
});
