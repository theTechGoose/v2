/**
 * REQ-830 — demo-loop cycle dm2, issue p6 "Customer pill flashes expanded at bottom-left on every
 * page load before folding". Every link is a full load (REQ-535): the overlay seeded the carried
 * demo before paint, but not where the pill was nor whether it was folded, and the placement that
 * folds it ran in a plain useEffect (after paint). So the first painted frame was the whole pill at
 * home (left 12, bottom-left) for ~60-70 ms, then it folded and jumped. Now the carry keeps the
 * last placement and the carried-demo layout effect seeds it, and the first place() runs in a
 * layout effect — the first frame matches the last page.
 *
 *   cd front-end && deno test -A lib/demo-pill-first-paint.test.tsx
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { options, render } from "preact";
import DemoModeOverlay from "../islands/DemoModeOverlay.tsx";
import { keepDemo } from "./demo-mode/pill-carry.ts";

const ROOT = new URL("../", import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, ROOT));

const demo = {
  id: "demo-1",
  role: "viewer" as const,
  presenterName: "Hans",
  targetName: "Ana Torres",
  targetUserId: "u-ana",
  presenters: [{ userId: "u-hans", name: "Hans", color: "#2563eb" }],
};

/** a browser-ish global scope for one mount: deno-dom's document, a page path, no network */
function browserish() {
  const doc = new DOMParser().parseFromString(
    "<!doctype html><html><body><div id=root></div></body></html>",
    "text/html",
  )!;
  const g = globalThis as Record<string, unknown>;
  const saved: Record<string, PropertyDescriptor | undefined> = {};
  const set = (k: string, v: unknown) => {
    saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    Object.defineProperty(globalThis, k, {
      value: v,
      configurable: true,
      writable: true,
    });
  };
  const noop = () => {};
  set("document", doc);
  set("window", globalThis);
  // not in a frame: the top window is this one (Deno has `self` but no `top`)
  set("top", globalThis);
  set("location", {
    pathname: "/quotes",
    search: "",
    hash: "",
    href: "http://localhost/quotes",
    origin: "http://localhost",
    host: "localhost",
    protocol: "http:",
  });
  set("innerWidth", 1280);
  set("innerHeight", 800);
  set("addEventListener", noop);
  set("removeEventListener", noop);
  set("fetch", () => new Promise(() => {}));
  set(
    "WebSocket",
    class {
      readyState = 0;
      addEventListener() {}
      removeEventListener() {}
      send() {}
      close() {}
    },
  );
  // effects after paint never run inside the test: what is checked is what reached the screen first
  set("requestAnimationFrame", () => 0);
  set("cancelAnimationFrame", noop);
  return {
    doc,
    restore() {
      for (const [k, d] of Object.entries(saved)) {
        if (d) Object.defineProperty(globalThis, k, d);
        else delete g[k];
      }
    },
  };
}

Deno.test({
  name:
    "REQ-830 (dm2 p6): a page loaded from one whose pill was folded commits the mini-pill first, never the whole pill at home",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const env = browserish();
    sessionStorage.clear();
    keepDemo(sessionStorage, demo, true, Date.now(), {
      tucked: true,
      tabAt: { x: 1172, y: 11 },
      dock: { x: 1060, y: 0 },
      full: { w: 340, h: 43 },
    });
    // the pill's style in each render, in order: the first is what the browser paints first. The
    // island is compiled with jsx "precompile": the pill is a template vnode ({tpl, exprs}) whose
    // style rides in exprs as a `style="…"` attribute string — read as the vnodes are made
    const styles: string[] = [];
    const prev = options.vnode;
    options.vnode = (vnode) => {
      const p = vnode.props as Record<string, unknown> | undefined;
      if (p && p["data-cy"] === "demo-pill" && typeof p.style === "string") {
        styles.push(p.style);
      } else if (
        p && Array.isArray(p.tpl) &&
        (p.tpl as string[]).join("").includes('data-cy="demo-pill"')
      ) {
        const attr = (p.exprs as unknown[]).find((e): e is string =>
          typeof e === "string" && e.startsWith('style="')
        );
        if (attr) styles.push(attr.slice('style="'.length, -1));
      }
      prev?.(vnode);
    };
    try {
      const root = env.doc.getElementById("root")!;
      render(<DemoModeOverlay />, root as unknown as Element);
      // the layout effects' renders flush in microtasks — still before the first paint
      for (let i = 0; i < 20; i++) await Promise.resolve();
      assert(styles.length > 0, "the carried demo draws the pill before paint");
      const first = styles[0];
      assert(
        first.startsWith("position:fixed;left:0;"),
        `first committed style is the mini-pill's (tabStyle), got: ${
          first.slice(0, 120)
        }`,
      );
      assert(
        first.includes("translate(1172px, 11px)"),
        `the mini-pill is where the last page had it: ${first.slice(0, 200)}`,
      );
      render(null, root as unknown as Element);
    } finally {
      options.vnode = prev;
      sessionStorage.clear();
      env.restore();
    }
  },
});

Deno.test("REQ-830 (dm2 p6): the first place() runs in a layout effect (before paint); the interval and listeners stay in the effect", () => {
  const src = read("islands/DemoModeOverlay.tsx");
  const firstPlace = src.indexOf("placeRef.current = place;");
  assert(firstPlace > 0, "place is published on placeRef");
  // the hook that defines place() and calls it the first time
  const hookAt = Math.max(
    src.lastIndexOf("useLayoutEffect(", firstPlace),
    src.lastIndexOf("useEffect(", firstPlace),
  );
  assertEquals(
    src.slice(hookAt, hookAt + "useLayoutEffect(".length),
    "useLayoutEffect(",
    "the effect that first calls place() is a layout effect",
  );
  const close = src.indexOf("}, [shown, demo?.role]);", firstPlace);
  const layoutBody = src.slice(firstPlace, close);
  assert(/\n\s*place\(\);/.test(layoutBody), "place() is called there");
  assert(
    !/setInterval\(/.test(layoutBody),
    "the interval is not set up before paint",
  );
  // the interval and listeners: a plain effect on the same keys
  const rest = src.slice(close + 10);
  const eff = rest.indexOf("useEffect(");
  const intervalAt = rest.indexOf("setInterval(", eff);
  assert(eff >= 0 && intervalAt > eff, "an effect sets the interval up");
  assert(
    rest.slice(eff, rest.indexOf("}, [shown, demo?.role]);", eff)).includes(
      "setInterval(",
    ),
    "the interval lives in the [shown, demo?.role] useEffect",
  );
});
