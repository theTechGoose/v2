/**
 * REQ-892 — demo-loop run 6 (dm6), issue m3 ("Stage stays 'En vivo' on /dashboard while the
 * customer looks at a stale logged-out landing '/' tab"). REQ-879 taught a session-less /login to
 * watch for the session coming back and go on; a sign-out lands on "/" (DashSidebar's logout), and
 * every other session-less page runs no demo code at all, so such a tab never rejoined.
 *
 * The fix: when a page's demo is dropped by a sign-out (the overlay's signout gate), the tab keeps
 * a mark in its sessionStorage. A page rendered without a session (any but /login, /verify, the
 * stage) loads a small module script of its own that, while that mark is fresh, watches as /login
 * does (focus, shown, click, key) and asks GET /api/me; once signed in again the tab goes to the
 * dashboard from "/", or reloads its own page elsewhere. The page then has the session, mounts the
 * overlay and claims the stage. An ordinary anonymous visitor (no mark) runs none of it.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// deno-lint-ignore no-explicit-any
type Any = any;

const mod = () =>
  require("../../front-end/lib/demo-mode/rejoin-mark") as {
    REJOIN_MARK_KEY: string;
    REJOIN_MARK_MS: number;
    markDemoRejoin(store: Any, now: number): void;
    clearDemoRejoin(store: Any): void;
    demoRejoinWanted(o: { store: Any; pathname: string; now: number }): boolean;
    demoRejoinTarget(o: { pathname: string; href: string }): string;
    startDemoRejoin(o: {
      store: Any;
      loc: { pathname: string; href: string };
      win: Any;
      doc: Any;
      signedIn: () => Promise<boolean>;
      go: (to: string) => void;
      reload: () => void;
      now?: () => number;
      clock?: () => number;
    }): (() => void) | null;
  };

function store(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    has: (k: string) => m.has(k),
  };
}

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

const T0 = 1_700_000_000_000;

describe("REQ-892 (dm6, m3) a stale logged-out tab on '/' (or any session-less page) rejoins the demo", () => {
  test("REQ-892 the mark: set by a sign-out that dropped a demo, fresh for REJOIN_MARK_MS, cleared on use; a refused store is no error", () => {
    const {
      REJOIN_MARK_KEY,
      REJOIN_MARK_MS,
      markDemoRejoin,
      clearDemoRejoin,
      demoRejoinWanted,
    } = mod();
    const s = store();
    expect(demoRejoinWanted({ store: s, pathname: "/", now: T0 })).toBe(false);
    markDemoRejoin(s, T0);
    expect(s.has(REJOIN_MARK_KEY)).toBe(true);
    expect(demoRejoinWanted({ store: s, pathname: "/", now: T0 + 1_000 })).toBe(
      true,
    );
    expect(
      demoRejoinWanted({
        store: s,
        pathname: "/",
        now: T0 + REJOIN_MARK_MS - 1,
      }),
    ).toBe(true);
    expect(
      demoRejoinWanted({
        store: s,
        pathname: "/",
        now: T0 + REJOIN_MARK_MS + 1,
      }),
    ).toBe(false);
    // a clock set back more than a second: not trusted
    expect(demoRejoinWanted({ store: s, pathname: "/", now: T0 - 5_000 })).toBe(
      false,
    );
    clearDemoRejoin(s);
    expect(demoRejoinWanted({ store: s, pathname: "/", now: T0 + 1_000 })).toBe(
      false,
    );
    // garbage in the slot, or no storage at all
    expect(
      demoRejoinWanted({
        store: store({ [REJOIN_MARK_KEY]: "{nope" }),
        pathname: "/",
        now: T0,
      }),
    )
      .toBe(false);
    expect(demoRejoinWanted({ store: null, pathname: "/", now: T0 })).toBe(
      false,
    );
    const refused = {
      getItem: () => {
        throw new Error("refused");
      },
      setItem: () => {
        throw new Error("refused");
      },
      removeItem: () => {
        throw new Error("refused");
      },
    };
    expect(() => markDemoRejoin(refused, T0)).not.toThrow();
    expect(() => clearDemoRejoin(refused)).not.toThrow();
    expect(demoRejoinWanted({ store: refused, pathname: "/", now: T0 })).toBe(
      false,
    );
  });

  test("REQ-892 not on the sign-in pages (REQ-879's LoginForm watches there) nor on the stage", () => {
    const { markDemoRejoin, demoRejoinWanted } = mod();
    const s = store();
    markDemoRejoin(s, T0);
    for (
      const p of [
        "/login",
        "/login/",
        "/verify",
        "/verify?phone=1",
        "/demo/stage",
      ]
    ) {
      expect(demoRejoinWanted({ store: s, pathname: p.split("?")[0], now: T0 }))
        .toBe(false);
    }
    for (const p of ["/", "/q/abc", "/pay/x", "/terms", "/quotes"]) {
      expect(demoRejoinWanted({ store: s, pathname: p, now: T0 })).toBe(true);
    }
  });

  test("REQ-892 the target: the landing goes to the dashboard; any other page comes back as itself", () => {
    const { demoRejoinTarget } = mod();
    expect(demoRejoinTarget({ pathname: "/", href: "http://app/" })).toBe(
      "/dashboard",
    );
    expect(demoRejoinTarget({ pathname: "/", href: "http://app/?lang=es" }))
      .toBe("/dashboard");
    expect(
      demoRejoinTarget({ pathname: "/q/abc", href: "http://app/q/abc?x=1#y" }),
    ).toBe(
      "http://app/q/abc?x=1#y",
    );
  });

  test("REQ-892 startDemoRejoin: with the mark, a focus after the re-login goes to the dashboard from '/' and the mark is cleared; without the mark nothing is installed", async () => {
    const { startDemoRejoin, markDemoRejoin, REJOIN_MARK_KEY } = mod();
    // no mark: an ordinary anonymous visitor — no listener, no ask
    {
      const win = target();
      const doc = target();
      const stop = startDemoRejoin({
        store: store(),
        loc: { pathname: "/", href: "http://app/" },
        win,
        doc,
        signedIn: () => Promise.resolve(true),
        go: () => {
          throw new Error("went");
        },
        reload: () => {
          throw new Error("reloaded");
        },
      });
      expect(stop).toBeNull();
      expect(win.count() + doc.count()).toBe(0);
    }
    // the mark: watched like /login
    const s = store();
    markDemoRejoin(s, T0);
    const win = target();
    const doc = target();
    const went: string[] = [];
    let reloads = 0;
    let signed = false;
    let asks = 0;
    let t = 0;
    const stop = startDemoRejoin({
      store: s,
      loc: { pathname: "/", href: "http://app/" },
      win,
      doc,
      now: () => T0 + 60_000,
      clock: () => (t += 5_000),
      signedIn: () => (asks++, Promise.resolve(signed)),
      go: (to) => went.push(to),
      reload: () => reloads++,
    });
    expect(typeof stop).toBe("function");
    win.fire("focus");
    await flush();
    expect(asks).toBe(1);
    expect(went).toEqual([]);
    expect(s.has(REJOIN_MARK_KEY)).toBe(true);
    signed = true;
    win.fire("pointerdown");
    await flush();
    expect(went).toEqual(["/dashboard"]);
    expect(reloads).toBe(0);
    expect(s.has(REJOIN_MARK_KEY)).toBe(false);
    stop!();
    expect(win.count() + doc.count()).toBe(0);
  });

  test("REQ-892 startDemoRejoin: any other session-less page reloads itself once signed in again", async () => {
    const { startDemoRejoin, markDemoRejoin } = mod();
    const s = store();
    markDemoRejoin(s, T0);
    const win = target();
    const doc = target();
    const went: string[] = [];
    let reloads = 0;
    let t = 0;
    startDemoRejoin({
      store: s,
      loc: { pathname: "/q/abc", href: "http://app/q/abc?x=1" },
      win,
      doc,
      now: () => T0 + 1_000,
      clock: () => (t += 5_000),
      signedIn: () => Promise.resolve(true),
      go: (to) => went.push(to),
      reload: () => reloads++,
    });
    win.fire("keydown");
    await flush();
    expect(went).toEqual([]);
    expect(reloads).toBe(1);
  });

  test("REQ-892 wiring: the overlay marks the tab when a sign-out drops its demo; the entry script starts the watch; _app links it on session-less pages only; the plugin serves it", () => {
    const overlay = read("front-end/islands/DemoModeOverlay.tsx");
    expect(overlay).toMatch(/markDemoRejoin\(/);
    expect(overlay).toMatch(/from "\.\.\/lib\/demo-mode\/rejoin-mark\.ts"/);
    const entry = read("front-end/lib/demo-mode/demo-rejoin.ts");
    expect(entry).toMatch(/startDemoRejoin\(/);
    expect(entry).toMatch(/signedIn:\s*\(\)\s*=>\s*signedInNow\(/);
    expect(entry).toMatch(/location\.replace\(/);
    expect(entry).toMatch(/location\.reload\(/);
    const app = read("front-end/routes/_app.tsx");
    expect(app).toMatch(
      /import \{[^}]*DEMO_REJOIN_SRC[^}]*\} from "\.\.\/lib\/demo-mode\/early-src\.ts"/,
    );
    expect(app).toMatch(
      /\{!hasSession && DEMO_REJOIN_SRC\s*\?\s*<script type="module" async src=\{DEMO_REJOIN_SRC\}/,
    );
    const standIn = read("front-end/lib/demo-mode/early-src.ts");
    expect(standIn).toMatch(
      /export const DEMO_REJOIN_SRC: string \| null = null;/,
    );
    // the plugin: a second entry (its own browser build) and the stand-in's second constant
    const { demoEarly } = require("../../front-end/vite-demo-early") as {
      demoEarly(): Any;
    };
    const dev = demoEarly();
    dev.config({ root: "/fe" }, { command: "serve" });
    const served = dev.load.call(
      { environment: { name: "ssr" } },
      "/fe/lib/demo-mode/early-src.ts",
    );
    expect(served).toContain(
      'export const DEMO_EARLY_SRC = "/@fs/fe/lib/demo-mode/demo-early.ts";',
    );
    expect(served).toContain(
      'export const DEMO_REJOIN_SRC = "/@fs/fe/lib/demo-mode/demo-rejoin.ts";',
    );
    const build = demoEarly();
    const cfg = build.config({ root: "/fe" }, { command: "build" });
    expect(cfg.environments.client.build.rollupOptions.input).toEqual({
      "pm-demo-early": "/fe/lib/demo-mode/demo-early.ts",
      "pm-demo-rejoin": "/fe/lib/demo-mode/demo-rejoin.ts",
    });
    build.generateBundle.call({ environment: { name: "client" } }, {}, {
      a: {
        type: "chunk",
        isEntry: true,
        name: "pm-demo-early",
        fileName: "assets/pm-demo-early-abc.js",
      },
      b: {
        type: "chunk",
        isEntry: true,
        name: "pm-demo-rejoin",
        fileName: "assets/pm-demo-rejoin-def.js",
      },
    });
    const built = build.load.call(
      { environment: { name: "ssr" } },
      "/fe/lib/demo-mode/early-src.ts",
    );
    expect(built).toContain(
      'export const DEMO_EARLY_SRC = "/assets/pm-demo-early-abc.js";',
    );
    expect(built).toContain(
      'export const DEMO_REJOIN_SRC = "/assets/pm-demo-rejoin-def.js";',
    );
  });
});
