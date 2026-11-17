/**
 * REQ-219 — Raphael, 2026-11-10, on Google Search Console's "Not found (404)"
 * for documonster.com: "you do that" — make every old link land on the site.
 *
 * The old domain was a registrar forwarder: it answered "/" and 404 for every
 * other path, so an old link (a text, an email, a search result) was dead.
 * Pointed at the app instead, the app sends every request for a retired host
 * to the SAME path on the site's own origin, permanently.
 */
import * as fs from "fs";
import * as path from "path";
import { SITE_ORIGIN } from "../../shared/quote-flow/site-meta";
import {
  RETIRED_HOSTS,
  retiredHostRedirect,
} from "../../shared/site-host/retired";

const ROOT = path.resolve(__dirname, "../..");
const OLD = ["paperwork", "monster.com"].join("");

describe("REQ-219: a request for a retired host goes to the same path on the site's origin", () => {
  test("REQ-219: the old domain, its www, and the site's own www are retired", () => {
    expect([...RETIRED_HOSTS].sort()).toEqual(
      [OLD, `www.${OLD}`, "www.documonster.com"].sort(),
    );
  });

  test("REQ-219: path and query survive; the target is always https on SITE_ORIGIN", () => {
    expect(retiredHostRedirect(OLD, "/")).toBe(`${SITE_ORIGIN}/`);
    expect(retiredHostRedirect(OLD, "/login")).toBe(`${SITE_ORIGIN}/login`);
    expect(retiredHostRedirect(`www.${OLD}`, "/q/abc?lang=es&x=1")).toBe(
      `${SITE_ORIGIN}/q/abc?lang=es&x=1`,
    );
    expect(retiredHostRedirect("www.documonster.com", "/landing2?ad=a1")).toBe(
      `${SITE_ORIGIN}/landing2?ad=a1`,
    );
  });

  test("REQ-219: case, a port and a trailing dot do not hide a retired host", () => {
    expect(retiredHostRedirect(OLD.toUpperCase(), "/x")).toBe(
      `${SITE_ORIGIN}/x`,
    );
    expect(retiredHostRedirect(`${OLD}:443`, "/x")).toBe(`${SITE_ORIGIN}/x`);
    expect(retiredHostRedirect(`WWW.${OLD}.`, "/x")).toBe(`${SITE_ORIGIN}/x`);
  });

  test("REQ-219: the site itself, a preview host, localhost and no host at all are left alone", () => {
    for (
      const host of [
        "documonster.com",
        "documonster.com:443",
        "localhost:5280",
        "127.0.0.1:5280",
        "v2-abc123.deno.dev",
        `not${OLD}`,
        `${OLD}.evil.example`,
        "",
        null,
        undefined,
      ]
    ) {
      expect(retiredHostRedirect(host, "/login")).toBeNull();
    }
  });

  test("REQ-219: a path cannot turn the redirect into another site", () => {
    // "//evil.example" after an origin is still a path on that origin
    expect(retiredHostRedirect(OLD, "//evil.example/x")).toBe(
      `${SITE_ORIGIN}/evil.example/x`,
    );
    expect(retiredHostRedirect(OLD, "evil")).toBe(`${SITE_ORIGIN}/evil`);
  });

  test("REQ-219: the app asks the rule before anything else — static files included", () => {
    const main = fs.readFileSync(path.join(ROOT, "front-end/main.ts"), "utf8");
    const rule = main.indexOf("retiredHostRedirect(");
    const statics = main.indexOf("app.use(staticFiles())");
    expect(rule).toBeGreaterThan(-1);
    expect(statics).toBeGreaterThan(-1);
    expect(rule).toBeLessThan(statics);
    expect(main).toMatch(/status:\s*301/);
  });
});
