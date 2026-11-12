/**
 * REQ-417 — demo-loop cycle 2, demo issues m44 + p13-q (RCA CONFIRMED/UPHELD at deb85b35).
 * m44: "'Volver a la oficina' always goes to /field/tasks" — WorkerScreen's office link was a
 * hard-coded href="/field/tasks", whatever office page the owner opened the worker view from
 * (Roles → Workers → "Open the worker view"). The link now goes back where the owner came from:
 * a `?from=<path>` param (set by the office's "Open the worker view" links) or a same-origin
 * Referer, allow-listed to the office app's own paths, falling back to /field/tasks. The day
 * navigator carries `from` along so a day change keeps the way back.
 * p13-q: "Note placeholder truncated" — the note box was a one-line <input>, so the ES placeholder
 * "Nota para la oficina (portón, perro, extra…)" was cut at 390 px. It is now an auto-growing
 * <textarea rows=2> that wraps its placeholder.
 */
import * as fs from "fs";
import * as path from "path";
import { workerDayNav, workerOfficeHref } from "../../front-end/lib/field";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const island = read("front-end/islands/WorkerScreen.tsx");
const route = read("front-end/routes/worker/index.tsx");
const ORIGIN = "https://documonster.com";

describe("REQ-417 (m44) workerOfficeHref — back to the office page the owner came from", () => {
  test("REQ-417 ?from= an office path wins", () => {
    expect(workerOfficeHref("/field/workers", null, ORIGIN)).toBe(
      "/field/workers",
    );
    expect(workerOfficeHref("/customers", `${ORIGIN}/dashboard`, ORIGIN)).toBe(
      "/customers",
    );
    expect(workerOfficeHref("/dashboard", null, ORIGIN)).toBe("/dashboard");
  });

  test("REQ-417 with no ?from=, a same-origin Referer to an office page is used", () => {
    expect(workerOfficeHref(null, `${ORIGIN}/field/workers`, ORIGIN)).toBe(
      "/field/workers",
    );
    expect(workerOfficeHref(null, `${ORIGIN}/settings?tab=team`, ORIGIN)).toBe(
      "/settings?tab=team",
    );
  });

  test("REQ-417 a cross-origin Referer is ignored", () => {
    expect(
      workerOfficeHref(null, "https://evil.example/field/workers", ORIGIN),
    ).toBe("/field/tasks");
  });

  test("REQ-417 off-site or non-office ?from= values fall back to /field/tasks", () => {
    for (
      const bad of [
        "https://evil.example/",
        "//evil.example/x",
        "/\\evil.example",
        "javascript:alert(1)",
        "/worker",
        "/worker?date=2026-11-11",
        "/api/me/wipe",
        "/login",
        "/q/abc",
        "field/tasks",
        "/field/tasks\r\nSet-Cookie: x=1",
        "",
      ]
    ) {
      expect(workerOfficeHref(bad, null, ORIGIN)).toBe("/field/tasks");
    }
  });

  test("REQ-417 a /worker Referer (a day change) is not 'the office'", () => {
    expect(
      workerOfficeHref(null, `${ORIGIN}/worker?date=2026-11-11`, ORIGIN),
    ).toBe("/field/tasks");
  });

  test("REQ-417 nothing to go on → /field/tasks", () => {
    expect(workerOfficeHref(null, null, ORIGIN)).toBe("/field/tasks");
  });

  test("REQ-417 the day navigator keeps ?from= so a day change keeps the way back", () => {
    const nav = workerDayNav("2026-11-12", "2026-11-12", "/field/workers");
    expect(nav.prev.href).toBe(
      "/worker?date=2026-11-11&from=%2Ffield%2Fworkers",
    );
    expect(nav.next.href).toBe(
      "/worker?date=2026-11-13&from=%2Ffield%2Fworkers",
    );
    const past = workerDayNav("2026-11-10", "2026-11-12", "/field/workers");
    expect(past.today).toBe("/worker?from=%2Ffield%2Fworkers");
    // without one, the links are REQ-362's
    expect(workerDayNav("2026-11-12", "2026-11-12").prev.href).toBe(
      "/worker?date=2026-11-11",
    );
  });
});

describe("REQ-417 (m44) the route and island are bound to it", () => {
  test("REQ-417 the /worker route resolves the office link from ?from= and the Referer", () => {
    expect(route).toMatch(/workerOfficeHref\(/);
    expect(route).toMatch(/searchParams\.get\("from"\)/);
    expect(route).toMatch(/headers\.get\("referer"\)/);
    expect(route).toMatch(/<WorkerScreen[^>]*\bofficeHref=\{/s);
  });

  test("REQ-417 the office link is no longer hard-coded to /field/tasks", () => {
    const link = island.match(/<a[^>]*data-cy="w-office"[^>]*>/s)?.[0] ??
      island.match(/<a\s[\s\S]*?data-cy="w-office"[\s\S]*?>/)?.[0];
    expect(link).toBeDefined();
    expect(link).not.toMatch(/href="\/field\/tasks"/);
    expect(link).toMatch(/href=\{officeHref\}/);
  });

  test("REQ-417 the Roles → Workers 'Open the worker view' link says where it came from", () => {
    const workers = read("front-end/islands/FieldWorkersPage.tsx");
    expect(workers).toMatch(
      /href="\/worker\?from=%2Ffield%2Fworkers"[^>]*data-cy="wk-open"/,
    );
  });
});

describe("REQ-417 (p13-q) the worker's note box wraps its placeholder", () => {
  test("REQ-417 the note is a <textarea rows={2}>, not a one-line <input>", () => {
    const note = island.match(/<(input|textarea)\s[^>]*?data-cy="w-note"/s)
      ?.[1];
    expect(note).toBe("textarea");
    const ta = island.match(/<textarea\s[\s\S]*?data-cy="w-note"[\s\S]*?\/>/)
      ?.[0] ?? "";
    expect(ta).toMatch(/rows=\{2\}/);
    expect(ta).toMatch(/placeholder=\{t\("worker\.notePh"\)\}/);
  });

  test("REQ-417 the note textarea grows with its text", () => {
    expect(island).toMatch(/scrollHeight/);
    expect(island).toMatch(/\.note textarea\s*\{[^}]*resize:\s*none/);
  });
});
