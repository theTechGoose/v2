/**
 * REQ-837 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle dm2 (run r9c47ba57), issues m3 + p3.
 *
 * m3: the presenter's name tag sat in different places on the two screens. The customer's tag
 * moves (above, below, right of the arrow: `tagPlacement` + `coverage`), while the stage's own
 * marker pinned "Tú" at +18,+17 bottom-right (OwnMarker's hard-coded tagStyle), and the placed
 * report carried no tag placement the stage could copy. Now the customer's report carries where
 * its tag went (`t`: side, offset and size as fractions of its viewport), and OwnMarker and
 * PointerGhost draw their tag there (falling back to tagPlacement + coverage on the stage when no
 * `t` came). The wording stays "Tú"/"You" (owner design, REQ-642). Sub-point (c): a tag over a
 * sidebar/nav label ("Add a w[A]ker") — a nav label now counts as a control in `coverage`.
 *
 * p3: an out-of-view anchor showed the customer "DocuMonster is pointing below — scroll ↓" but
 * the stage only a chevron and "Tú". PointerGhost now renders the same words (`cueText`), and
 * DemoStage builds them with `cueKey(dir)` for its ghost and for colleagues' pointers.
 */
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { DOMParser, type Element } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import PointerGhost from "../components/demo-mode/PointerGhost.tsx";
import { OwnMarker } from "../components/demo-mode/OwnPointer.tsx";
import { coverage, placeTag } from "../components/demo-mode/DemoPointer.tsx";
import {
  alignTag,
  placedReport,
  placedReporter,
  reportedTag,
} from "../../shared/demo-mode/presenter-anchor.ts";
import {
  type Anchor,
  parsePeerMessage,
  type PlacedMessage,
} from "../../shared/demo-mode/protocol.ts";

const VIEW = { left: 0, top: 0, width: 1000, height: 800 };
const a: Anchor = { vx: 0.1, vy: 0.3 };
const parse = (html: string) =>
  new DOMParser().parseFromString(`<body>${html}</body>`, "text/html")!;
const px = (el: Element | null, k: string) =>
  Number(
    (el?.getAttribute("style") ?? "").match(
      new RegExp(`(?:^|;)${k}:(-?[\\d.]+)px`),
    )?.[1],
  );

const ownBase = {
  color: "#2a7",
  z: 10,
  label: "Tú",
  tagged: true,
  look: "live" as const,
  absentLabel: "Tú · no se ve",
  pendingLabel: "señalando…",
};

Deno.test("REQ-837 (demo dm2 m3) unit: placedReport carries the customer's tag placement as fractions of its viewport", () => {
  const m = placedReport(
    "pid",
    a,
    { at: { x: 100, y: 240 }, outside: false },
    VIEW,
    { side: "above", x: 0, y: -42, w: 22, h: 22 },
  );
  assertEquals(m.t, { s: "above", x: 0, y: -0.0525, w: 0.022, h: 0.0275 });
  // no tag known (yet): no t, as before
  const n = placedReport(
    "pid",
    a,
    { at: { x: 100, y: 240 }, outside: false },
    VIEW,
  );
  assertEquals(n.t, undefined);
});

Deno.test("REQ-837 (demo dm2 m3) unit: the reporter sends again when only the tag moved", () => {
  const sent: PlacedMessage[] = [];
  let now = 0;
  const r = placedReporter({
    send: (m) => sent.push(m),
    now: () => now,
    setTimer: (fn) => {
      fn();
      return 0;
    },
    clearTimer: () => {},
  });
  const at = { at: { x: 100, y: 240 }, outside: false };
  r.report(
    placedReport("pid", a, at, VIEW, {
      side: "tail",
      x: 6,
      y: 36,
      w: 22,
      h: 22,
    }),
  );
  now += 1000;
  r.report(
    placedReport("pid", a, at, VIEW, {
      side: "above",
      x: 0,
      y: -42,
      w: 22,
      h: 22,
    }),
  );
  assertEquals(sent.length, 2, "a tag that went above is a new report");
  assertEquals(sent[1].t?.s, "above");
});

Deno.test("REQ-837 (demo dm2 m3) unit: the wire keeps a well-formed t and drops a malformed one", () => {
  const ok = parsePeerMessage(JSON.parse(JSON.stringify(placedReport(
    "pid",
    a,
    { at: { x: 100, y: 240 }, outside: false },
    VIEW,
    { side: "right", x: 30, y: 0, w: 22, h: 22 },
  )))) as PlacedMessage;
  assertEquals(ok.t, { s: "right", x: 0.03, y: 0, w: 0.022, h: 0.0275 });
  const bad = parsePeerMessage({
    k: "placed",
    pid: "pid",
    a,
    p: { vx: 0.1, vy: 0.3 },
    t: { s: "sideways", x: 0, y: 0, w: 0.1, h: 0.1 },
  }) as PlacedMessage;
  assert(bad, "the report itself survives");
  assertEquals(bad.t, undefined, "an unknown side is dropped");
});

Deno.test("REQ-837 (demo dm2 m3) unit: DemoPointer's placeTag returns where it put the tag (for the report)", () => {
  const style: Record<string, string> = {};
  const attrs: Record<string, string> = {};
  const el = {
    offsetWidth: 22,
    offsetHeight: 22,
    style,
    setAttribute: (k: string, v: string) => (attrs[k] = v),
  } as unknown as HTMLElement;
  const t = placeTag(el, { x: 500, y: 400 }, VIEW, null, { w: 22, h: 22 });
  assert(t, "placeTag returns the placement");
  assertEquals(t.side, attrs["data-tag-side"]);
  assertEquals(`${t.x}px`, style.left);
  assertEquals(`${t.y}px`, style.top);
  assertEquals([t.w, t.h], [22, 22]);
});

Deno.test("REQ-837 (demo dm2 m3) unit: OwnMarker draws its tag where the customer's went (above), not fixed bottom-right", () => {
  const doc = parse(renderToString(
    <OwnMarker
      {...ownBase}
      at={{ x: 100, y: 240 }}
      tag={{ side: "above", x: 0, y: -42, w: 22, h: 22 }}
    />,
  ));
  const tag = doc.querySelector("[data-cy='demo-pointer-own-label']");
  assert(tag, "tagged");
  assertEquals(tag!.getAttribute("data-tag-side"), "above");
  // its bottom where the customer's bottom is (-42 + 22 = -20), above the tip
  assert(
    px(tag, "top") < 0,
    `the tag is above the arrow (top ${px(tag, "top")})`,
  );
  assertAlmostEquals(px(tag, "top") + 18, -20, 0.01);
  assertEquals(px(tag, "left"), 0);
});

Deno.test("REQ-837 (demo dm2 m3) unit: OwnMarker with no report places its tag like DemoPointer (tagPlacement + covers), never the old +18,+17", () => {
  const bounds = { left: 0, top: 0, width: 1000, height: 800 };
  const free = parse(renderToString(
    <OwnMarker
      {...ownBase}
      at={{ x: 500, y: 400 }}
      bounds={bounds}
      covers={() => 0}
    />,
  )).querySelector("[data-cy='demo-pointer-own-label']");
  assertEquals(free?.getAttribute("data-tag-side"), "tail");
  // the tail spot covered (text under it): it moves, as the customer's does
  const moved = parse(renderToString(
    <OwnMarker
      {...ownBase}
      at={{ x: 500, y: 400 }}
      bounds={bounds}
      covers={(r) => r.top > 400 ? 3 : 0}
    />,
  )).querySelector("[data-cy='demo-pointer-own-label']");
  assert(
    moved?.getAttribute("data-tag-side") !== "tail",
    `still under the tail over the text (${
      moved?.getAttribute("data-tag-side")
    })`,
  );
});

Deno.test("REQ-837 (demo dm2 m3) unit: PointerGhost draws its tag at the reported placement", () => {
  const doc = parse(renderToString(
    <PointerGhost
      at={{ x: 500, y: 400 }}
      outside={false}
      color="#2a7"
      z={10}
      label="Tú"
      bounds={VIEW}
      tag={{ side: "right", x: 30, y: 0, w: 22, h: 22 }}
    />,
  ));
  const tag = doc.querySelector("[data-cy='demo-pointer-ghost-label']");
  assertEquals(tag?.getAttribute("data-tag-side"), "right");
  assertEquals(px(tag, "left"), 30);
  assertEquals(px(tag, "top"), 0);
});

Deno.test("REQ-837 (demo dm2 p3) unit: PointerGhost out of view shows the customer's cue words, not only 'Tú'", () => {
  const doc = parse(renderToString(
    <PointerGhost
      at={{ x: 372, y: 725 }}
      outside={false}
      dir={{ dx: 0, dy: 1 }}
      color="#2a7"
      z={10}
      label="Tú"
      bounds={VIEW}
      cueText="DocuMonster is pointing below — scroll ↓"
      cueBox={{ left: 0, top: 56, width: 1000, height: 700 }}
    />,
  ));
  const cue = doc.querySelector("[data-cy='demo-pointer-ghost-cue']");
  assert(cue, "the cue words are drawn");
  assertEquals(
    cue!.textContent,
    "Tú · DocuMonster is pointing below — scroll ↓",
  );
  // inside where the element can be seen
  const top = px(cue, "top") + 725;
  assert(top >= 56 && top + 20 <= 756, `cue at y ${top}, outside the box`);
  assert(doc.querySelector("[data-cue]"), "still the chevron");
});

Deno.test("REQ-837 (demo dm2 m3c) unit: a sidebar/nav label counts as a control, so a tag is steered off it", () => {
  // a fake page: the point lands on the label of the sidebar link the arrow is on
  const link = {
    tagName: "A",
    getBoundingClientRect: () => ({
      left: 0,
      top: 690,
      width: 240,
      height: 40,
    }),
  };
  const label = {
    tagName: "SPAN",
    childNodes: [{ nodeType: 3, textContent: "Add a worker" }],
    matches: () => false,
    closest: (sel: string) =>
      sel.includes("a[href]") ? link : /nav|aside/.test(sel) ? {} : null,
  };
  const doc = {
    elementFromPoint: () => label,
  } as unknown as Document;
  const score = coverage(
    doc,
    { left: 104, top: 700, width: 22, height: 22 },
    { x: 100, y: 705 },
  );
  assertEquals(score, 27, "every sample over a nav label scores as a control");
});

Deno.test("REQ-837 (demo dm2 m3) integration: customer tag → report → wire → stage → OwnMarker and PointerGhost draw it on the same side, scaled", () => {
  // the customer's tag went above its arrow at 99,234 (fleet-1: 'D' at 99,192)
  const report = parsePeerMessage(JSON.parse(JSON.stringify(placedReport(
    "pid",
    a,
    { at: { x: 99, y: 234 }, outside: false },
    { left: 0, top: 0, width: 390, height: 844 },
    { side: "above", x: 0, y: -42, w: 22, h: 22 },
  )))) as PlacedMessage;
  // the stage shows their screen at half size
  const frame = { left: 400, top: 100, width: 195, height: 422 };
  const held = { a, load: null, at: { x: 449.5, y: 217 }, provisional: false };
  const t = reportedTag(held, report, frame);
  assert(t, "the stage reads the tag from the report");
  assertEquals(t.side, "above");
  assertAlmostEquals(t.y, -21, 0.05);
  assertAlmostEquals(t.h, 11, 0.05);
  const own = alignTag(t, { w: 30, h: 16 });
  assertAlmostEquals(own.top + 16, t.y + t.h, 0.01); // bottoms aligned: above the tip
  // a report of another anchor: keep what was drawn (undefined), never a stale side
  assertEquals(
    reportedTag({ ...held, a: { vx: 0.5, vy: 0.5 } }, report, frame),
    undefined,
  );
  const html = renderToString(
    <OwnMarker {...ownBase} at={held.at} tag={t} />,
  );
  assertEquals(
    parse(html).querySelector("[data-cy='demo-pointer-own-label']")
      ?.getAttribute("data-tag-side"),
    "above",
  );
});

Deno.test("REQ-837 (demo dm2 p3) integration: DemoStage hands its ghost and colleagues' pointers the cue words (cueKey), never an empty cue text", async () => {
  const src = await Deno.readTextFile(
    new URL("../islands/DemoStage.tsx", import.meta.url),
  );
  assert(
    !/text:\s*""\s*,\s*dir:\s*p\.dir/.test(src),
    "a colleague's out-of-view pointer still gets an empty cue text",
  );
  assert(/cueText=\{/.test(src), "PointerGhost is not given cueText");
  assert(/cueKey\(/.test(src), "the stage does not word the cue with cueKey");
  assert(/tag=\{/.test(src), "the stage does not hand the reported tag on");
});
