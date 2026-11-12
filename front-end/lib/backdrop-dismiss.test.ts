import { assert, assertEquals } from "@std/assert";
import {
  BACKDROP_OPEN_GRACE_MS,
  createBackdropGuard,
} from "./backdrop-dismiss.ts";

/**
 * REQ-354 (demo issue M39, cycle 1): a double-click on a button that opens a
 * dialog opened it and closed it again — the dialog's full-screen backdrop
 * is painted over the button, so the double-click's second click lands on
 * the backdrop and "click on backdrop = close" fired. The shared guard only
 * lets a backdrop click close when it is a deliberate, single click whose
 * pointer gesture started AND ended on the backdrop itself, after the
 * dialog has been open for a moment.
 */

const backdrop = { id: "backdrop" };
const card = { id: "card" };

function clock(start = 1_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

function setup() {
  const c = clock();
  let closed = 0;
  const guard = createBackdropGuard(() => closed++, c.now);
  const down = (target: unknown) =>
    guard.onPointerDown({ target, currentTarget: backdrop });
  const click = (target: unknown, detail = 1) =>
    guard.onClick({ target, currentTarget: backdrop, detail });
  return { c, guard, down, click, closed: () => closed };
}

Deno.test("REQ-354 M39: the second click of a double-click (detail 2, right after open) does not close", () => {
  const s = setup();
  s.c.advance(110);
  s.down(backdrop);
  s.click(backdrop, 2);
  assertEquals(s.closed(), 0);
});

Deno.test("REQ-354 M39: a click on the backdrop inside the open grace window does not close, even with detail 1", () => {
  const s = setup();
  s.c.advance(BACKDROP_OPEN_GRACE_MS - 1);
  s.down(backdrop);
  s.click(backdrop, 1);
  assertEquals(s.closed(), 0);
});

Deno.test("REQ-354 M39: a deliberate single click on the backdrop after the grace window closes", () => {
  const s = setup();
  s.c.advance(BACKDROP_OPEN_GRACE_MS + 1);
  s.down(backdrop);
  s.click(backdrop, 1);
  assertEquals(s.closed(), 1);
});

Deno.test("REQ-354 M39: a press inside the dialog dragged out onto the backdrop does not close", () => {
  const s = setup();
  s.c.advance(2_000);
  s.down(card);
  // the browser targets the click at the common ancestor: the backdrop
  s.click(backdrop, 1);
  assertEquals(s.closed(), 0);
  // the next real backdrop click is judged on its own gesture
  s.down(backdrop);
  s.click(backdrop, 1);
  assertEquals(s.closed(), 1);
});

Deno.test("REQ-354 M39: a click that bubbles up from inside the dialog never closes", () => {
  const s = setup();
  s.c.advance(2_000);
  s.down(card);
  s.click(card, 1);
  assertEquals(s.closed(), 0);
});

Deno.test("REQ-354 M39: a programmatic click (no pointerdown, detail 0) on the backdrop closes after the grace window", () => {
  const s = setup();
  s.c.advance(BACKDROP_OPEN_GRACE_MS + 1);
  s.click(backdrop, 0);
  assertEquals(s.closed(), 1);
});

Deno.test("REQ-354 M39: the grace window is about 300 ms — long enough for a double-click, short enough not to be felt", () => {
  assert(BACKDROP_OPEN_GRACE_MS >= 250 && BACKDROP_OPEN_GRACE_MS <= 500);
});
