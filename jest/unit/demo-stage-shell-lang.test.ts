/**
 * REQ-812 — demo-loop cycle dm1, issue p2: "Second demo's stage page is half Spanish (html lang,
 * title) and half English (pill)". The stage worked out the PRESENTER's language (REQ-341) only for
 * its DocTitle and the DemoStage island and never put it on ctx.state.lang, so the app shell's
 * resolveSsrLang fell through to ctx.state.user — the impersonated CUSTOMER, Spanish after they
 * switched in an earlier demo — and <html lang>, the boot language and HtmlLang's on-mount title
 * heal (REQ-709) all went Spanish. The /demo middleware now sets ctx.state.lang to the presenter's
 * language, so the shell and the page agree.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-812 the /demo pages speak the presenter's language from the shell down", () => {
  const mw = read("front-end/routes/demo/_middleware.ts");
  const route = read("front-end/routes/demo/stage.tsx");

  test("REQ-812 the /demo middleware sets ctx.state.lang = await presenterLangForRequest(ctx.req, user)", () => {
    expect(mw).toMatch(
      /import \{[^}]*presenterLangForRequest[^}]*\} from "\.\.\/\.\.\/lib\/presenter-lang\.ts"/,
    );
    expect(mw).toMatch(
      /ctx\.state\.lang = await presenterLangForRequest\(\s*ctx\.req,\s*user,?\s*\)/,
    );
  });

  test("REQ-812 the language is set before the page renders (before ctx.next())", () => {
    const set = mw.indexOf("ctx.state.lang =");
    const next = mw.indexOf("ctx.next()");
    expect(set).toBeGreaterThan(-1);
    expect(next).toBeGreaterThan(set);
  });

  test("REQ-812 the stage reuses ctx.state.lang — one whoami per request, the same language as the shell", () => {
    expect(route).not.toMatch(/presenterLangForRequest/);
    expect(route).toMatch(/const lang(?:: Lang)? = ctx\.state\.lang\b/);
  });

  test("REQ-812 the shell resolves ctx.state.lang first (<html lang>, the boot language, HtmlLang initial)", () => {
    expect(read("front-end/lib/ssr-lang.ts")).toMatch(
      /return asLang\(src\.state\?\.lang\) \?\?/,
    );
    const app = read("front-end/routes/_app.tsx");
    expect(app).toMatch(/const ssrLang = resolveSsrLang\(ctx\)/);
    expect(app).toMatch(/bootLangScript\(ssrLang\)/);
    expect(app).toMatch(/<html lang=\{lang\}>/);
    expect(app).toMatch(/<HtmlLang initial=\{lang\} \/>/);
  });
});
