/**
 * REQ-327 (demo-loop cycle 1, issue p7) — Raphael: "fix every issue the demo
 * found, loop until there are none."
 *
 * The chat header said "Not delivered" next to a green pulsing dot. The
 * island now takes a tone with its status and paints the dot and the
 * sub-line red when the tone is bad. Renders the real island server side.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import ChatHeaderLive from "../islands/ChatHeaderLive.tsx";

function render(tone: "ok" | "bad" | undefined) {
  const html = renderToString(
    <ChatHeaderLive
      initialClient="Ana Ruiz"
      initialStatus={tone === "bad" ? "Not delivered" : "Out for signature"}
      initialTone={tone}
    />,
  );
  const doc = new DOMParser().parseFromString(html, "text/html");
  return {
    dot: doc.querySelector(".chat__head-dot"),
    sub: doc.querySelector(".chat__head-sub"),
  };
}

Deno.test("REQ-327 tone bad: the dot and the sub-line carry the --bad class", () => {
  const { dot, sub } = render("bad");
  assert(dot, "the dot renders");
  assert(sub, "the sub-line renders");
  assert(dot.classList.contains("chat__head-dot--bad"), dot.className);
  assert(sub.classList.contains("chat__head-sub--bad"), sub.className);
  assertEquals(sub.textContent.trim(), "Not delivered");
});

Deno.test("REQ-327 tone ok (or unset): no --bad class", () => {
  for (const tone of ["ok", undefined] as const) {
    const { dot, sub } = render(tone);
    assert(dot && sub);
    assert(!dot.classList.contains("chat__head-dot--bad"), dot.className);
    assert(!sub.classList.contains("chat__head-sub--bad"), sub.className);
  }
});
