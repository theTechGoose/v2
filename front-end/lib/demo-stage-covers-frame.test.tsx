/**
 * REQ-848 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle dm3 (run r02524ccd), issues m4 + p9.
 *
 * On the stage every tag's placement was blind to the customer's page: `coverage(document)`
 * hit-tests the stage document, where the transparent click-capture layer
 * (div[data-cy=demo-stage-layer]) sits over the pointer-events:none iframe, so every candidate
 * scored 0 and the first (tail) slot always won — over 'Replace Kitchen Faucet' (m4) and over the
 * day '20' / 'Keep going' (p9). The stage now hands its pointers `frameCoverage`: the tag's
 * stage px mapped into the replay ((x - fit.left) / fit.s) and hit-tested in the iframe's own
 * document. m4: the absent marker no longer draws the white dashed 'You · not shown' pill in the
 * frame (the chrome-row demo-pointer-absent banner says it). p9: the stage's copy of the
 * customer's resting tag is see-through (STAGE_TAG_REST_OPACITY), the customer's screen keeps
 * REQ-633's opaque tag.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import { OwnMarker } from "../components/demo-mode/OwnPointer.tsx";
import PointerGhost from "../components/demo-mode/PointerGhost.tsx";
import {
  coverage,
  frameCoverage,
} from "../components/demo-mode/DemoPointer.tsx";
import {
  pointerLook,
  STAGE_TAG_REST_OPACITY,
  TAG_REST_OPACITY,
} from "../../shared/demo-mode/motion.ts";

const parse = (html: string) =>
  new DOMParser().parseFromString(`<body>${html}</body>`, "text/html")!;

/** the stage fits the customer's 390-wide screen at half size, its frame at 400,100 */
const fit = { left: 400, top: 100, width: 195, height: 422, s: 0.5 };

/** a fake replay document: a text block 'Replace Kitchen Faucet' at frame px x 0..390, y 300..360
 *  (stage px y 250..280), nothing elsewhere */
const text = {
  tagName: "P",
  childNodes: [{ nodeType: 3, textContent: "Replace Kitchen Faucet" }],
  matches: () => true,
  closest: () => null,
};
const replay = {
  elementFromPoint: (x: number, y: number) =>
    x >= 0 && x <= 390 && y >= 300 && y <= 360 ? text : null,
} as unknown as Document;

/** the stage document: the transparent click-capture layer over the whole frame */
const stage = {
  elementFromPoint: () => ({
    tagName: "DIV",
    childNodes: [],
    matches: () => false,
    closest: () => null,
  }),
} as unknown as Document;

/** his still mouse just above that text, on the stage */
const at = { x: 480, y: 240 };
const tailOver = { left: 492, top: 252, width: 40, height: 18 };

Deno.test("REQ-848 (demo dm3 m4+p9) unit: frameCoverage maps stage px into the replay and sees its text (the stage document only sees the layer)", () => {
  assertEquals(
    coverage(stage, tailOver, at),
    0,
    "baseline: the stage's own document is blind (the layer)",
  );
  assert(
    frameCoverage(replay, fit, tailOver, at) > 0,
    "the tail slot over 'Replace Kitchen Faucet' is covered in the replay",
  );
  assertEquals(
    frameCoverage(
      replay,
      fit,
      { left: 492, top: 200, width: 40, height: 18 },
      at,
    ),
    0,
    "a slot above the text is clean",
  );
  assertEquals(frameCoverage(null, fit, tailOver, at), 0, "no replay yet: 0");
});

Deno.test("REQ-848 (demo dm3 m4) unit: with text under the tail slot the stage's 'You' tag moves to a free slot", () => {
  const bounds = {
    left: fit.left,
    top: fit.top,
    width: fit.width,
    height: fit.height,
  };
  const blind = parse(renderToString(
    <OwnMarker
      color="#2a7"
      z={10}
      label="You"
      tagged
      look="live"
      pendingLabel="pointing…"
      at={at}
      bounds={bounds}
      covers={(r, p) => coverage(stage, r, p)}
    />,
  )).querySelector("[data-cy='demo-pointer-own-label']");
  assertEquals(blind?.getAttribute("data-tag-side"), "tail", "blind: the tail");
  const seen = parse(renderToString(
    <OwnMarker
      color="#2a7"
      z={10}
      label="You"
      tagged
      look="live"
      pendingLabel="pointing…"
      at={at}
      bounds={bounds}
      covers={(r, p) => frameCoverage(replay, fit, r, p)}
    />,
  )).querySelector("[data-cy='demo-pointer-own-label']");
  assert(
    seen?.getAttribute("data-tag-side") !== "tail",
    `the tag still sits over the frame's text (${
      seen?.getAttribute("data-tag-side")
    })`,
  );
});

Deno.test("REQ-848 (demo dm3 m4) unit: PointerGhost takes the stage's frame covers (r, at) and moves off the text", () => {
  const ghost = parse(renderToString(
    <PointerGhost
      at={at}
      outside={false}
      color="#2a7"
      z={10}
      label="You"
      bounds={fit}
      covers={(r, p) => frameCoverage(replay, fit, r, p)}
    />,
  )).querySelector("[data-tag-side]");
  assert(ghost, "the ghost's tag is drawn");
  assert(
    ghost.getAttribute("data-tag-side") !== "tail",
    `the ghost's tag sits over the frame's text (${
      ghost.getAttribute("data-tag-side")
    })`,
  );
});

Deno.test("REQ-848 (demo dm3 m4) unit: absent renders no in-frame label, only the faint hollow arrow", () => {
  const doc = parse(renderToString(
    <OwnMarker
      color="#2a7"
      z={10}
      label="You"
      tagged
      look="absent"
      pendingLabel="pointing…"
      at={at}
    />,
  ));
  const el = doc.querySelector("[data-cy='demo-pointer-own']");
  assert(el?.hasAttribute("data-absent"), "still data-absent");
  assertEquals(
    doc.querySelector("[data-cy='demo-pointer-own-label']"),
    null,
    "no 'not shown' pill in the frame",
  );
  assert(!/not shown/.test(doc.body.textContent ?? ""), "no 'not shown' words");
  assert(
    el!.querySelector("path[fill='none'][stroke-dasharray]"),
    "the hollow arrow",
  );
});

Deno.test("REQ-848 (demo dm3 p9) unit: a per-instance resting tag opacity; the default stays REQ-633's opaque tag", () => {
  assertEquals(pointerLook(true).tag, TAG_REST_OPACITY);
  assertEquals(TAG_REST_OPACITY, 1);
  assert(STAGE_TAG_REST_OPACITY >= 0.5 && STAGE_TAG_REST_OPACITY <= 0.7);
  assertEquals(
    pointerLook(true, STAGE_TAG_REST_OPACITY).tag,
    STAGE_TAG_REST_OPACITY,
  );
  assertEquals(
    pointerLook(false, STAGE_TAG_REST_OPACITY).tag,
    1,
    "moving: full",
  );
});

Deno.test("REQ-848 (demo dm3 m4+p9) integration: DemoStage hands frameCoverage to the customer's DemoPointer, OwnPointer and PointerGhost, and the customer's copy rests see-through", async () => {
  const src = await Deno.readTextFile(
    new URL("../islands/DemoStage.tsx", import.meta.url),
  );
  assert(/frameCoverage\(/.test(src), "the stage does not use frameCoverage");
  for (const tag of ["<DemoPointer", "<OwnPointer", "<PointerGhost"]) {
    const i = src.indexOf(tag);
    assert(i > -1, `${tag} is rendered`);
    const end = src.indexOf("/>", i);
    assert(
      /covers=\{coversFrame\}/.test(src.slice(i, end)),
      `${tag} is not given covers={coversFrame}`,
    );
  }
  const i = src.indexOf("<DemoPointer");
  assert(
    /restTagOpacity=\{STAGE_TAG_REST_OPACITY\}/.test(
      src.slice(i, src.indexOf("/>", i)),
    ),
    "the customer's pointer on the stage keeps the opaque resting tag",
  );
  assert(
    !/absentLabel=/.test(src),
    "the stage still asks for the in-frame 'not shown' pill",
  );
});

Deno.test("REQ-848 (demo dm3 p9) integration: DemoPointer's painter scores with the covers it is given (never the stage document alone)", async () => {
  const src = await Deno.readTextFile(
    new URL("../components/demo-mode/DemoPointer.tsx", import.meta.url),
  );
  const at = src.indexOf("const paintTag = useCallback(");
  const body = src.slice(at, src.indexOf("}, []);", at));
  assert(/l\.covers/.test(body), "paintTag ignores the covers prop");
  assert(
    /pointerLook\(idle,\s*restTagOpacity\)/.test(src),
    "no per-instance rest opacity",
  );
});
