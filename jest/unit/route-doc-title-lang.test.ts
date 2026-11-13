/**
 * REQ-709 — demo-loop cycle 5, issue m4: "Tab title in the other language".
 * /dashboard?lang=en for an account whose language is "es" painted
 * <title>Panel · DocuMonster</title> over an English page (fleet-6 stdout:257):
 * the route built its DocTitle/footer `lang` from `user?.language` alone, while
 * the islands and <html lang> render from resolveSsrLang (state.lang > ?lang= >
 * user.language > pm_lang). And the shell's HtmlLang only followed a LATER
 * language change, so the wrong first title never healed.
 *
 * Guards, for every app-shell route that exists now and every one added later:
 *   1. a route that renders the dashboard shell (DashTopbar / DashSidebar) takes
 *      its own language from resolveSsrLang(ctx) — the islands' language;
 *   2. no route that renders a DocTitle derives `lang` from `user?.language`
 *      (/welcome keeps its own onboarding chain — REQ-091/REQ-414 — and is the
 *      one listed exception);
 *   3. HtmlLang sets the tab title from the DocTitle on mount, in the language
 *      it was handed, not only on a later switch.
 * The rendered proof is front-end/lib/route-doc-title-lang.int.test.tsx and
 * front-end/lib/html-lang-title.test.tsx.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
/** source without comments, so a comment never satisfies or trips a rule */
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");

function tsxUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (abs: string) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const p = path.join(abs, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx$/.test(e.name)) out.push(path.relative(ROOT, p));
    }
  };
  walk(path.join(ROOT, dir));
  return out.sort();
}

const ROUTES = tsxUnder("front-end/routes");
const SHELL = ROUTES.filter((f) =>
  /<Dash(Topbar|Sidebar)\b/.test(code(read(f)))
);
const WITH_TITLE = ROUTES.filter((f) => /<DocTitle\b/.test(code(read(f))));
/** a route that resolves its language its own way, on purpose */
const OWN_CHAIN = new Set(["front-end/routes/welcome.tsx"]);

describe("REQ-709 (m4) an app route's tab title and footer are in the page's language", () => {
  it("REQ-709 finds the app-shell routes the RCA named", () => {
    for (
      const f of [
        "dashboard/index.tsx",
        "quotes/index.tsx",
        "invoices/index.tsx",
        "assistant/index.tsx",
        "assistant/[threadId].tsx",
        "accounts-manager/index.tsx",
        "admin/index.tsx",
      ]
    ) expect(SHELL).toContain(`front-end/routes/${f}`);
  });

  it.each(SHELL)(
    "REQ-709 %s takes its language from resolveSsrLang(ctx)",
    (f) => {
      const src = code(read(f));
      expect(src).toMatch(
        /import \{[^}]*\bresolveSsrLang\b[^}]*\} from "(\.\.\/)+lib\/ssr-lang\.ts"/,
      );
      expect(src).toMatch(
        /\bconst lang(?:: Lang)? = resolveSsrLang\(ctx\) \?\? "es"/,
      );
    },
  );

  it.each(WITH_TITLE.filter((f) => !OWN_CHAIN.has(f)))(
    "REQ-709 %s does not build its DocTitle language from user?.language",
    (f) => {
      const lines = code(read(f)).split("\n");
      const bad = lines.filter((l) =>
        /\bconst lang\b/.test(l) && /\buser\?\.language\b/.test(l)
      );
      expect(bad).toEqual([]);
    },
  );

  it("REQ-709 HtmlLang sets the tab title from the DocTitle on mount, not only on a switch", () => {
    const src = code(read("front-end/islands/HtmlLang.tsx"));
    const beforeSub = src.slice(0, src.indexOf("langSignal.subscribe"));
    expect(beforeSub).toMatch(/followTitle\(document, initial\)/);
  });
});
