/**
 * REQ-189 — a stale island module never wedges a page: the dev server answers `no-store` for
 * every transformed module, and the shell reloads a page once when its island code fails to load.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-189 dev modules are never cached", () => {
  test("the Vite config carries a plugin that turns Vite's no-cache into no-store on every module response", () => {
    const cfg = read("front-end/vite.config.ts");
    expect(cfg).toMatch(/name: "pm-dev-no-store"/);
    expect(cfg).toMatch(/configureServer\(/);
    // it wraps res.setHeader so Vite's own `send()` (which sets no-cache after our middleware ran) is overridden
    expect(cfg).toMatch(/res\.setHeader = /);
    expect(cfg).toMatch(/"cache-control"/);
    expect(cfg).toMatch(/"no-cache"/);
    expect(cfg).toMatch(/"no-store"/);
    // pre-bundled deps keep their immutable caching: only the no-cache value is rewritten
    expect(cfg).toMatch(/value === "no-cache"/);
  });
});

describe("REQ-189 the shell recovers a page whose island code failed to load", () => {
  const app = read("front-end/routes/_app.tsx");
  const script = app.slice(
    app.indexOf("const MODULE_RECOVERY_SCRIPT"),
    app.indexOf("export default define.page"),
  );
  test("at most once per 30 s per tab, it refetches every loaded module bypassing the cache and reloads", () => {
    expect(script.length).toBeGreaterThan(100);
    expect(script).toMatch(/sessionStorage\.getItem\("pm:module-reloaded"\)/);
    expect(script).toMatch(
      /sessionStorage\.setItem\("pm:module-reloaded",String\(Date\.now\(\)\)\)/,
    );
    expect(script).toMatch(/Date\.now\(\)-last<30000/);
    expect(script).toMatch(/cache:"reload"/);
    expect(script).toMatch(/getEntriesByType\("resource"\)/);
    expect(script).toMatch(/location\.reload\(\)/);
  });
  test("it listens for the module script's error event (capture) and for the import failure rejections of every browser", () => {
    expect(script).toMatch(
      /addEventListener\("error",function\(e\)\{[\s\S]*?\},true\)/,
    );
    expect(script).toMatch(/addEventListener\("unhandledrejection"/);
    expect(script).toMatch(/Importing a module script failed/);
    expect(script).toMatch(/dynamically imported module/);
  });
  test("AMENDMENT: on a dev host, after every load, it refetches each module bypassing the cache, compares ETags with the tab's last load, and reloads once when any changed", () => {
    expect(script).toMatch(/\(localhost\|127/);
    const dev = script.slice(script.indexOf("(localhost|127"));
    expect(dev).toMatch(/addEventListener\("load"/);
    expect(dev).toMatch(/cache:"reload"/);
    expect(dev).toMatch(/headers\.get\("etag"\)/);
    expect(dev).toMatch(/sessionStorage\.getItem\("pm:module-etags"\)/);
    expect(dev).toMatch(
      /sessionStorage\.setItem\("pm:module-etags",JSON\.stringify\(next\)\)/,
    );
    expect(dev).toMatch(/if\(changed\.length===0\)return;/);
    expect(dev).toMatch(/Date\.now\(\)-last<30000/);
    expect(dev).toMatch(/location\.reload\(\)/);
    expect(script).not.toMatch(/pm:modules-purged/);
  });

  test("it rides the boot script on every page", () => {
    expect(app).toMatch(/SW_PURGE_SCRIPT \+ MODULE_RECOVERY_SCRIPT/);
  });
});
