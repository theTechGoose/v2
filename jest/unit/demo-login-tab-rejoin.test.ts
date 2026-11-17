/**
 * REQ-879 — demo-loop cycle dm5, issue m3 ("Stage stays Live on the old /settings tab while the
 * customer looks at a stale logged-out /login tab"). RCA at demo-fixes abbf6bc3: a /login page
 * server-rendered without a session (client.ts's 401 redirect to /login?next=…, after REQ-823's
 * sign-out) runs no demo code — _app.tsx mounts DemoModeOverlay only when hasSession — and never
 * noticed that a login in another tab put a live session back in the shared cookie. The stage
 * kept following the last tab that claimed.
 *
 * The fix: a session-less /login watches for the customer coming back to it (focus, the tab
 * shown, a click or a key) and asks GET /api/me; once that answers, it goes to `next` (or the
 * dashboard). That page loads with the session, mounts the overlay and claims, and the stage
 * follows it.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// deno-lint-ignore no-explicit-any
type Any = any;

const mod = () =>
  require("../../front-end/lib/login-rejoin") as {
    rejoinTarget(search: string): string;
    signedInNow(fetchFn: (u: string, i?: Any) => Promise<Any>): Promise<boolean>;
    watchLoginRejoin(o: {
      win: Any;
      doc: Any;
      signedIn: () => Promise<boolean>;
      go: (to: string) => void;
      target: string;
      clock?: () => number;
    }): () => void;
  };

function target() {
  const ls = new Map<string, Set<(e: Any) => void>>();
  return {
    visibilityState: "visible",
    addEventListener(t: string, f: (e: Any) => void) {
      if (!ls.has(t)) ls.set(t, new Set());
      ls.get(t)!.add(f);
    },
    removeEventListener(t: string, f: (e: Any) => void) {
      ls.get(t)?.delete(f);
    },
    fire(t: string, e: Any = {}) {
      for (const f of [...(ls.get(t) ?? [])]) f({ type: t, ...e });
    },
    count() {
      let n = 0;
      for (const s of ls.values()) n += s.size;
      return n;
    },
  };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("REQ-879 (demo-loop cycle dm5, m3) a stale logged-out /login tab rejoins the demo", () => {
  test("REQ-879 rejoinTarget: next when it is a path on this site, else the dashboard", () => {
    const { rejoinTarget } = mod();
    expect(rejoinTarget("?next=%2Fquotes")).toBe("/quotes");
    expect(rejoinTarget("?next=%2Fquotes%2Fq1%3Ftab%3Dx")).toBe("/quotes/q1?tab=x");
    expect(rejoinTarget("")).toBe("/dashboard");
    expect(rejoinTarget("?lang=es")).toBe("/dashboard");
    expect(rejoinTarget("?next=https%3A%2F%2Fevil.com")).toBe("/dashboard");
    expect(rejoinTarget("?next=%2F%2Fevil.com")).toBe("/dashboard");
    expect(rejoinTarget("?next=%2F%5Cevil.com")).toBe("/dashboard");
    expect(rejoinTarget("?next=javascript%3Aalert(1)")).toBe("/dashboard");
    // never back to a sign-in page
    expect(rejoinTarget("?next=%2Flogin")).toBe("/dashboard");
    expect(rejoinTarget("?next=%2Fverify%3Fphone%3D1")).toBe("/dashboard");
  });

  test("REQ-879 signedInNow: GET /api/me with the browser's cookie; 200 is signed in, 401 or a failure is not; the body is never left open", async () => {
    const { signedInNow } = mod();
    const seen: Array<[string, Any]> = [];
    let cancelled = 0;
    const res = (status: number) => ({
      ok: status >= 200 && status < 300,
      status,
      body: { cancel: () => (cancelled++, Promise.resolve()) },
    });
    expect(await signedInNow((u, i) => (seen.push([u, i]), Promise.resolve(res(200))))).toBe(true);
    expect(seen[0][0]).toBe("/api/me");
    expect(seen[0][1]).toMatchObject({ credentials: "include" });
    expect(await signedInNow(() => Promise.resolve(res(401)))).toBe(false);
    expect(await signedInNow(() => Promise.reject(new Error("offline")))).toBe(false);
    expect(cancelled).toBe(2);
  });

  test("REQ-879 watchLoginRejoin: the tab gaining focus after a login elsewhere goes to next", async () => {
    const { watchLoginRejoin } = mod();
    const win = target();
    const doc = target();
    const went: string[] = [];
    let signed = false;
    let asks = 0;
    let t = 0;
    watchLoginRejoin({
      win,
      doc,
      signedIn: () => (asks++, Promise.resolve(signed)),
      go: (to) => went.push(to),
      target: "/quotes",
      clock: () => (t += 5_000),
    });
    // still signed out: asked, stays
    win.fire("focus");
    await flush();
    expect(asks).toBe(1);
    expect(went).toEqual([]);
    // a login in another tab; she comes back to this one
    signed = true;
    win.fire("focus");
    await flush();
    expect(went).toEqual(["/quotes"]);
  });

  test("REQ-879 watchLoginRejoin: the tab shown again, a click or a key in it asks too; a hidden tab does not", async () => {
    const { watchLoginRejoin } = mod();
    for (const how of ["visible", "pointerdown", "keydown", "pageshow"] as const) {
      const win = target();
      const doc = target();
      const went: string[] = [];
      let t = 0;
      watchLoginRejoin({
        win,
        doc,
        signedIn: () => Promise.resolve(true),
        go: (to) => went.push(to),
        target: "/settings",
        clock: () => (t += 5_000),
      });
      if (how === "visible") {
        doc.visibilityState = "hidden";
        doc.fire("visibilitychange");
        await flush();
        expect(went).toEqual([]);
        doc.visibilityState = "visible";
        doc.fire("visibilitychange");
      } else if (how === "pageshow") win.fire("pageshow", { persisted: true });
      else win.fire(how);
      await flush();
      expect([how, went]).toEqual([how, ["/settings"]]);
    }
  });

  test("REQ-879 watchLoginRejoin: one ask at a time, at most once a second, goes once, and stop() removes every listener", async () => {
    const { watchLoginRejoin } = mod();
    const win = target();
    const doc = target();
    const went: string[] = [];
    let now = 10_000;
    let asks = 0;
    let answer: (v: boolean) => void = () => {};
    const stop = watchLoginRejoin({
      win,
      doc,
      signedIn: () => (asks++, new Promise<boolean>((r) => (answer = r))),
      go: (to) => went.push(to),
      target: "/quotes",
      clock: () => now,
    });
    win.fire("focus");
    win.fire("pointerdown");
    win.fire("keydown");
    expect(asks).toBe(1);
    answer(false);
    await flush();
    win.fire("pointerdown"); // inside the second
    expect(asks).toBe(1);
    now += 1_000;
    win.fire("pointerdown");
    expect(asks).toBe(2);
    answer(true);
    await flush();
    expect(went).toEqual(["/quotes"]);
    now += 5_000;
    win.fire("focus");
    await flush();
    expect(went).toEqual(["/quotes"]);
    expect(win.count() + doc.count()).toBeGreaterThan(0);
    stop();
    expect(win.count() + doc.count()).toBe(0);
  });

  test("REQ-879 wiring: /login's LoginForm watches for the session coming back, with ?next=", () => {
    const form = read("front-end/islands/LoginForm.tsx");
    expect(form).toMatch(/watchLoginRejoin\(/);
    expect(form).toMatch(/rejoinTarget\(\s*globalThis\.location\.search\s*\)/);
    expect(form).toMatch(/signedIn:\s*\(\)\s*=>\s*signedInNow\(/);
    expect(form).toMatch(/location\.replace\(/);
  });
});
