/**
 * REQ-231 — demo issues stage-content-m2 + quote-invoice-money-m11 (RCA
 * ssr-lang-flash). The behaviour is pinned by front-end/lib/ssr-lang.test.ts
 * (deno: render an island per request, concurrent requests, the client seed);
 * this keeps the wiring that makes it reach every page in the merge gate:
 *
 *  - main.ts runs the per-request language middleware before the file routes,
 *  - the app shell hands the browser the language the server rendered in,
 *  - the browser's module-load seed takes that language before localStorage.
 */
import { readFileSync } from "fs";
import { join } from "path";

const FE = join(__dirname, "../../front-end");
const read = (p: string) => readFileSync(join(FE, p), "utf8");

describe("REQ-231 SSR language wiring", () => {
  it("REQ-231: main.ts installs ssrLangMiddleware ahead of app.fsRoutes()", () => {
    const main = read("main.ts");
    expect(main).toMatch(/import \{[^}]*ssrLangMiddleware[^}]*\} from "\.\/lib\/ssr-lang\.ts"/);
    const use = main.indexOf("app.use(ssrLangMiddleware)");
    expect(use).toBeGreaterThan(-1);
    expect(use).toBeLessThan(main.indexOf("app.fsRoutes()"));
  });

  it("REQ-231: _app.tsx resolves the language with resolveSsrLang and boots it into the page", () => {
    const app = read("routes/_app.tsx");
    expect(app).toMatch(/resolveSsrLang\(ctx\)/);
    expect(app).toMatch(/bootLangScript\(/);
  });

  it("REQ-231: lang.ts seeds the client from window.__PM_LANG through pickClientLang", () => {
    const lang = read("lib/lang.ts");
    expect(lang).toMatch(/__PM_LANG/);
    expect(lang).toMatch(/pickClientLang\(\{/);
  });

  it("REQ-231: lang.ts (client-bundled) never imports node:async_hooks — only the server module does", () => {
    expect(read("lib/lang.ts")).not.toMatch(/async_hooks/);
    expect(read("lib/ssr-lang.ts")).toMatch(/from "node:async_hooks"/);
  });
});
