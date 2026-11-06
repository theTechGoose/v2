/**
 * REQ-211 — Raphael, 2026-11-06: "There is something that says what landing page it is coming
 * from?" — "can you make it so the answer is yes?". The browser's side: every landing form posts
 * the page it is on and the `?ad=` that brought the person. The islands post through
 * front-end/clients/landing.ts, which attaches both from the browser's location; the home page's
 * signup (static/landing-scripts.js, plain JS) attaches them itself.
 */
import * as fs from "fs";
import * as path from "path";
import { leadOriginHere, leadOriginOf } from "../../shared/lead-origin/mod";
import { withLeadOrigin } from "../../front-end/clients/landing";

const ROOT = path.resolve(__dirname, "..", "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("REQ-211 — the landing client attaches the page and the ad from the browser's location", () => {
  const g = globalThis as { location?: unknown };
  const original = g.location;
  afterEach(() => {
    if (original === undefined) delete g.location;
    else g.location = original;
  });

  test("on /landing5?ad=cumple the post carries page /landing5 and ad cumple beside the form's fields", () => {
    g.location = { pathname: "/landing5", search: "?ad=cumple" };
    expect(withLeadOrigin({ phoneNumber: "+15125550199", language: "es" }))
      .toEqual({
        phoneNumber: "+15125550199",
        language: "es",
        page: "/landing5",
        ad: "cumple",
      });
  });

  test("on /landing2 with no ad the post carries the page only", () => {
    g.location = { pathname: "/landing2", search: "?lang=en" };
    expect(withLeadOrigin({ mode: "call", phone: "+15125550199" })).toEqual({
      mode: "call",
      phone: "+15125550199",
      page: "/landing2",
    });
  });

  test("with no location (server-side) the input is untouched", () => {
    delete g.location;
    expect(withLeadOrigin({ a: 1 })).toEqual({ a: 1 });
  });

  test("the server reads back exactly what the browser attached", () => {
    expect(
      leadOriginOf(
        leadOriginHere({ pathname: "/landing3", search: "?ad=Graduacion" }),
      ),
    ).toEqual({ page: "/landing3", ad: "graduacion" });
  });
});

describe("REQ-211 — the home page's signup script posts the page and the ad too", () => {
  const script = read("front-end/static/landing-scripts.js");
  test("the send-otp body names the page (location.pathname) and the ad (?ad=)", () => {
    const body = script.slice(script.indexOf('fetch("/api/auth/send-otp"'));
    expect(body).toMatch(/page:\s*location\.pathname/);
    expect(body).toMatch(
      /ad:\s*[^,]*searchParams\.get\("ad"\)|URLSearchParams\(location\.search\)\.get\("ad"\)/,
    );
  });
});
