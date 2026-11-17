/**
 * REQ-374 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle 2, issues m9 (presenter name tag invisible at rest, covering text when shown)
 * and p8 (pointer faint, hard to see on light cards). DemoPointer is rendered for real (SSR).
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser, type Element } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import DemoPointer from "../components/demo-mode/DemoPointer.tsx";

const bounds = { left: 0, top: 0, width: 1000, height: 800 };
function draw(outside: boolean) {
  const html = renderToString(
    <DemoPointer
      pointer={{ x: 500, y: 400 }}
      outside={outside}
      waves={[]}
      name="Rosa"
      color="#2f6d29"
      z={10}
      attach={() => {}}
      bounds={bounds}
    />,
  );
  const doc = new DOMParser().parseFromString(html, "text/html")!;
  return doc.querySelector('[data-cy="demo-pointer"]') as Element;
}
const opacityOf = (el: Element) =>
  Number((el.getAttribute("style") ?? "").match(/opacity:([\d.]+)/)?.[1] ?? 1);

for (const outside of [false, true]) {
  Deno.test(`REQ-374 (demo p8) the arrow is fully opaque, dark-outlined and white-haloed${outside ? " — also when it points outside" : ""}`, () => {
    const ptr = draw(outside);
    assert(ptr, "the pointer is drawn");
    const svg = ptr.querySelector("svg") as Element;
    assertEquals(opacityOf(svg), 1, "the arrow is never faint");
    const paths = Array.from(svg.querySelectorAll("path")) as Element[];
    const halo = paths.find((p) =>
      /^#fff(fff)?$/i.test(p.getAttribute("stroke") ?? "")
    );
    assert(halo, "a white halo path");
    assert(
      Number(halo.getAttribute("stroke-width")) >= 3,
      "the halo is wide enough to read on dark content",
    );
    const body = paths.find((p) => p.getAttribute("fill") === "#2f6d29");
    assert(body, "the arrow is filled in the side's colour");
    const outline = body.getAttribute("stroke") ?? "";
    assert(
      /^#[0-3][0-9a-f]{2}([0-9a-f]{3})?$/i.test(outline),
      `a dark outline, got ${outline}`,
    );
    assertEquals(
      paths.indexOf(halo) < paths.indexOf(body),
      true,
      "the halo is under the arrow",
    );
    // 'outside' is marked by the dashed ring alone
    assertEquals(ptr.hasAttribute("data-outside"), outside);
    const ring = Array.from(ptr.querySelectorAll("span")).find((s) =>
      /dashed/.test((s as Element).getAttribute("style") ?? "")
    );
    assertEquals(!!ring, outside);
  });
}

// REQ-437 REVISION (demo m3, cycle 3): above-left of the tip covered a control hovered at its
// centre; with no element known the tag now sits below-right past the arrow's tail
Deno.test("REQ-374 (demo m9) the name tag shows, sits off the arrow (REQ-437: past its tail) and is hidden from AT", () => {
  const ptr = draw(false);
  const tag = ptr.querySelector('[data-cy="demo-pointer-tag"]') as Element;
  assert(tag, "the tag is drawn");
  assertEquals(tag.textContent, "Rosa");
  assertEquals(tag.getAttribute("aria-hidden"), "true");
  const style = tag.getAttribute("style") ?? "";
  const top = Number(style.match(/(^|;)top:(-?[\d.]+)px/)?.[2] ?? NaN);
  assert(top >= 30 + 6, `below the arrow's tail: ${style}`);
  assertEquals(tag.getAttribute("data-tag-side"), "tail");
  assertEquals(opacityOf(tag), 1, "fully shown when placed");
});
