/**
 * REQ-819 — Raphael: "fix every issue the demo found, loop until there are none." Demo-loop
 * cycle dm1, issue M3: the send dialog's email preview scrolled inside its own frame, which the
 * demo mirror never sees. `fitFrameToContent` sizes the frame to its email so nothing scrolls
 * inside it — the dialog's own (mirrored) scroll is what moves.
 */
import { assertEquals } from "@std/assert";
import { fitFrameToContent } from "./email-frame-fit.ts";

/** a frame whose email lays out `content` px tall (but never shorter than its own viewport) */
function fakeFrame(
  content: number | null,
  opts: { height?: string; border?: number; sizing?: string } = {},
) {
  const style = { height: opts.height ?? "" } as CSSStyleDeclaration;
  const border = opts.border ?? 0;
  const viewport = () => parseFloat(style.height || "150") - border;
  const html = {
    get scrollHeight() {
      return Math.max(content ?? 0, viewport());
    },
  };
  const frame = {
    style,
    get clientHeight() {
      return viewport();
    },
    get offsetHeight() {
      return viewport() + border;
    },
    contentDocument: content === null ? null : { documentElement: html },
    ownerDocument: {
      defaultView: {
        getComputedStyle: () => ({ boxSizing: opts.sizing ?? "content-box" }),
      },
    },
  };
  return frame as unknown as HTMLIFrameElement;
}

Deno.test("REQ-819 (dm1, M3): the frame takes its email's full height — nothing left to scroll inside it", () => {
  const f = fakeFrame(1660);
  assertEquals(fitFrameToContent(f), 1660);
  assertEquals(f.style.height, "1660px");
});

Deno.test("REQ-819 (dm1, M3): a shorter email (the language switch) shrinks the frame, not just grows it", () => {
  const f = fakeFrame(400, { height: "1660px" });
  assertEquals(fitFrameToContent(f), 400);
  assertEquals(f.style.height, "400px");
});

Deno.test("REQ-819 (dm1, M3): under border-box the frame's borders are added, so its viewport is the email's height", () => {
  const f = fakeFrame(900, { border: 2, sizing: "border-box" });
  fitFrameToContent(f);
  assertEquals(f.style.height, "902px");
  assertEquals(f.clientHeight, 900);
});

Deno.test("REQ-819 (dm1, M3): an email the page can't read (not loaded, or cross-origin) leaves the frame alone", () => {
  const f = fakeFrame(null, { height: "320px" });
  assertEquals(fitFrameToContent(f), null);
  assertEquals(f.style.height, "320px");
});
