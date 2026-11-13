/**
 * REQ-469 — demo-loop cycle 3, issue m39 ("'Lock it in' / 'Edit' half hidden
 * behind the message box at 1280×720"): the chat pinned itself to the bottom
 * only when its CONTENT grew. A demo starting reserves the pill's band
 * (REQ-379, --demo-pill-h) and the shell — so the chat's scroller — gets
 * shorter while the content stays the same; nothing re-pinned and the last
 * card's buttons sat under the composer. The scroller's own size is watched
 * now: a scroller that shrinks while the person was at the bottom stays at the
 * bottom.
 */
import { assert, assertEquals } from "@std/assert";
import { attachBottomPin } from "./chat-bottom-pin.ts";

/** a ResizeObserver the test fires by hand, per observed element */
class FakeRO {
  static all: FakeRO[] = [];
  targets: unknown[] = [];
  constructor(public cb: () => void) {
    FakeRO.all.push(this);
  }
  observe(t: unknown) {
    this.targets.push(t);
  }
  disconnect() {
    this.targets = [];
  }
  static fire(target: unknown) {
    for (const ro of FakeRO.all) {
      if (ro.targets.includes(target)) ro.cb();
    }
  }
}

/** a scroller box: content `content` px tall inside a `height` px viewport */
function fakeScroller(content: number, height: number) {
  const inner = { id: "inner" };
  const listeners: Array<() => void> = [];
  const el = {
    firstElementChild: inner,
    scrollHeight: content,
    clientHeight: height,
    _top: 0,
    get scrollTop() {
      return this._top;
    },
    // like a browser: any change of scrollTop (programmatic too) fires "scroll"
    set scrollTop(v: number) {
      const next = Math.max(
        0,
        Math.min(v, this.scrollHeight - this.clientHeight),
      );
      if (next === this._top) return;
      this._top = next;
      listeners.forEach((f) => f());
    },
    scrollTo(o: { top: number }) {
      this.scrollTop = o.top;
    },
    addEventListener(_: string, fn: () => void) {
      listeners.push(fn);
    },
    removeEventListener() {},
    /** the person scrolls (fires the scroll event) */
    userScroll(top: number) {
      this.scrollTop = top;
    },
    /** the visible bottom edge is at the content's bottom (within 1 px) */
    atBottom() {
      return this.scrollHeight - this.scrollTop - this.clientHeight <= 1;
    },
  };
  return { el, inner };
}

function attach(el: unknown, welcome = false) {
  FakeRO.all = [];
  return attachBottomPin(el as HTMLElement, {
    isWelcome: () => welcome,
    ResizeObserver: FakeRO,
    requestAnimationFrame: (cb) => cb(),
  });
}

Deno.test("REQ-469 m39: the chat's scroller shrinks (a demo's pill band) while at the bottom → it stays pinned to the bottom", () => {
  // 1280×720: a conversation ending in a draft card, opened at the bottom
  const { el } = fakeScroller(1400, 560);
  attach(el);
  assert(el.atBottom(), "opened at the bottom");
  // the demo starts: --demo-pill-h takes ~56 px off the shell, so off the
  // scroller; the content is unchanged and the browser keeps scrollTop
  el.clientHeight = 504;
  assert(
    !el.atBottom(),
    "precondition: the shrink alone leaves the bottom clipped",
  );
  FakeRO.fire(el);
  assert(
    el.atBottom(),
    `the last card's buttons are back in view (scrollTop ${el.scrollTop}, max ${
      el.scrollHeight - el.clientHeight
    })`,
  );
});

Deno.test("REQ-469 m39: a person reading history is not yanked down when the scroller shrinks", () => {
  const { el } = fakeScroller(2000, 560);
  attach(el);
  el.userScroll(200); // reading far up
  el.clientHeight = 504;
  FakeRO.fire(el);
  assertEquals(el.scrollTop, 200, "left where they were reading");
});

Deno.test("REQ-469 m39: the welcome state is not pinned when the scroller shrinks (REQ-425 p13-b)", () => {
  const { el } = fakeScroller(900, 560);
  attach(el, true);
  assertEquals(el.scrollTop, 0, "the welcome opens at its top");
  el.clientHeight = 504;
  FakeRO.fire(el);
  assertEquals(el.scrollTop, 0, "still at its top");
});

Deno.test("REQ-469: content growth near the bottom still pins (the existing behaviour)", () => {
  const { el, inner } = fakeScroller(1400, 560);
  attach(el);
  el.scrollHeight = 1700;
  FakeRO.fire(inner);
  assert(el.atBottom(), "pinned after the content grew");
});
