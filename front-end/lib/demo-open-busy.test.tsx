/**
 * REQ-864 — demo-loop cycle dm4, issue p8: "'Opening…' on the /admin Demo button lasts ~28 ms,
 * then reverts to 'Demo' before the stage opens". AdminPage.demo() cleared its busy row in a
 * `finally` the moment `start()` answered, while the overlay's placePresenter was still asking
 * whoami + impersonate before it moved the page. The row now stays busy (Opening…) until the page
 * moves; it is released only when start fails or the overlay says placing failed
 * (DEMO_PLACE_FAILED_EVENT).
 *
 *   cd front-end && deno test -A lib/demo-open-busy.test.tsx
 */
import { assert, assertEquals } from "@std/assert";
import { openDemo } from "./demo-mode/open-demo.ts";
import {
  DEMO_OPENING_EVENT,
  DEMO_PLACE_FAILED_EVENT,
  DEMO_STARTED_EVENT,
} from "../clients/demo-mode.ts";

const ROOT = new URL("../", import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, ROOT));

function harness(start: () => Promise<unknown>) {
  const win = new EventTarget();
  const busy: (string | null)[] = [];
  const seen: string[] = [];
  const failed: unknown[] = [];
  for (const k of [DEMO_OPENING_EVENT, DEMO_STARTED_EVENT]) {
    win.addEventListener(k, () => seen.push(k));
  }
  const run = () =>
    openDemo("u1", "Ana Torres", {
      start: () => start() as never,
      setBusy: (id) => busy.push(id),
      fail: (err) => {
        failed.push(err);
        return Promise.resolve();
      },
      refresh: () => {},
      win,
    });
  return { win, busy, seen, failed, run };
}

const demo = {
  id: "d1",
  targetUserId: "u1",
  targetPath: null,
  createdAt: "2026-11-16T00:00:00Z",
};

Deno.test("REQ-864 (dm4 p8): start answering does NOT clear the busy row — Opening… stays until the page moves", async () => {
  const h = harness(() => Promise.resolve(demo));
  await h.run();
  assertEquals(h.busy, ["u1"], "busy set once, never cleared on success");
  assertEquals(h.seen, [DEMO_OPENING_EVENT, DEMO_STARTED_EVENT]);
  assertEquals(h.failed.length, 0);
});

Deno.test("REQ-864 (dm4 p8): the overlay's place-failed releases the row (Demo again)", async () => {
  const h = harness(() => Promise.resolve(demo));
  await h.run();
  h.win.dispatchEvent(new Event(DEMO_PLACE_FAILED_EVENT));
  assertEquals(h.busy, ["u1", null]);
  // heard once: a later failure (another demo) is not this click's business
  h.win.dispatchEvent(new Event(DEMO_PLACE_FAILED_EVENT));
  assertEquals(h.busy, ["u1", null]);
});

Deno.test("REQ-864 (dm4 p8): start failing releases the row and still tells the overlay (no detail)", async () => {
  const boom = new Error("403");
  const h = harness(() => Promise.reject(boom));
  await h.run();
  assertEquals(h.busy, ["u1", null]);
  assertEquals(h.failed, [boom]);
  assertEquals(h.seen, [DEMO_OPENING_EVENT, DEMO_STARTED_EVENT]);
  // the listener is gone: a stray place-failed does nothing more
  h.win.dispatchEvent(new Event(DEMO_PLACE_FAILED_EVENT));
  assertEquals(h.busy, ["u1", null]);
});

Deno.test("REQ-864 (dm4 p8): AdminPage opens through openDemo (no finally clearing busy); the overlay says when placing ended without moving", () => {
  const admin = read("islands/AdminPage.tsx");
  const demoFn = admin.slice(
    admin.indexOf("async function demo("),
    admin.indexOf("async function impersonate("),
  );
  assert(/openDemo\(/.test(demoFn), demoFn);
  assert(!/finally\s*\{\s*setBusyId\(null\)/.test(demoFn), demoFn);
  const overlay = read("islands/DemoModeOverlay.tsx");
  const place = overlay.slice(
    overlay.indexOf("async function placePresenter("),
    overlay.indexOf("REQ-393 — where this page's mouse is, for the stage"),
  );
  assert(
    /if \(!moving\) \{[\s\S]*?DEMO_PLACE_FAILED_EVENT/.test(place),
    place,
  );
});
