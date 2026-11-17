/**
 * REQ-644 (demo-loop cycle 5, m32) — a signature drawn on /q's pad is SHOWN on the stage, not only
 * held in its canvas's bitmap. The stage's frame is sandboxed without `allow-scripts`; there a
 * canvas represents its fallback content, never its bitmap (HTML: scripting disabled for its
 * document — measured in Chromium: 2,792 inked pixels in the stage canvas's bitmap, 0 on screen,
 * the dev chip at cv10/10/0). So the replay shows every bitmap as the canvas's own background
 * image (the frame's CSP allows `data:` images), again after an op replaces the canvas's inline
 * style, and counts the bitmaps it drew (`painted`, on the dev chip).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createReplayer } from "../../front-end/lib/demo-mode/mirror-replay";
import type { MirrorFrame } from "../../shared/demo-mode/mirror";
import { FDocument, FElement, h } from "./support/fake-dom";

const INK = "data:image/png;base64,SIGNATURE";
const INK2 = "data:image/png;base64,SIGNATURE2";

/** the stage's srcdoc frame */
function stageDoc(): FDocument {
  const d = new FDocument("about:srcdoc", 1, 1);
  d.appendChild(h(d, "html", {}, h(d, "head"), h(d, "body")));
  return d;
}

const snap: MirrorFrame = {
  t: "snap",
  w: 420,
  h: 800,
  u: "/q/abc",
  root: {
    i: 1,
    t: "html",
    c: [{
      i: 2,
      t: "body",
      c: [{
        i: 3,
        t: "div",
        a: { class: "pad" },
        c: [{
          i: 4,
          t: "canvas",
          a: {
            width: "640",
            height: "400",
            style: "display:block;width:100%;height:200px",
          },
        }],
      }],
    }],
  },
  ops: [],
};

/** the canvas the replay built */
function canvasIn(doc: FDocument): FElement {
  const stack: FElement[] = [doc.documentElement!];
  while (stack.length) {
    const e = stack.pop()!;
    if (e.localName === "canvas") return e;
    for (const c of e.childNodes) {
      if (c.nodeType === 1) stack.push(c as FElement);
    }
  }
  throw new Error("no canvas");
}

/** the bitmap the canvas shows, as its background image (what a scriptless frame paints) */
const shown = (c: FElement) => ({
  image: c.style.getPropertyValue("background-image"),
  imagePriority: c.style.getPropertyPriority("background-image"),
  size: c.style.getPropertyValue("background-size"),
  repeat: c.style.getPropertyValue("background-repeat"),
});

/** a decoded image: loads on the next microtask, like a data URL does */
class FakeImage {
  onload: (() => void) | null = null;
  #src = "";
  get src() {
    return this.#src;
  }
  set src(v: string) {
    this.#src = v;
    queueMicrotask(() => this.onload?.());
  }
}

describe("REQ-644 (demo-loop cycle 5, m32) — the stage SHOWS a drawn signature", () => {
  const realImage = (globalThis as { Image?: unknown }).Image;
  beforeEach(() => {
    (globalThis as { Image?: unknown }).Image = FakeImage;
  });
  afterEach(() => {
    (globalThis as { Image?: unknown }).Image = realImage;
  });

  test("a bitmap that arrives is shown as the canvas's own background, at once, filling its box (a canvas in the scriptless frame never shows its bitmap)", () => {
    const doc = stageDoc();
    const rep = createReplayer(doc as unknown as Document);
    expect(rep.apply(snap)).toBe(true);
    expect(rep.apply({ t: "ops", ops: [{ o: "cv", i: 4, u: INK }] })).toBe(
      true,
    );
    expect(shown(canvasIn(doc))).toEqual({
      image: `url("${INK}")`,
      imagePriority: "important",
      size: "100% 100%",
      repeat: "no-repeat",
    });
    // a newer bitmap replaces it
    rep.apply({ t: "ops", ops: [{ o: "cv", i: 4, u: INK2 }] });
    expect(shown(canvasIn(doc)).image).toBe(`url("${INK2}")`);
  });

  test("an op that replaces the canvas's inline style (or removes it) shows the bitmap again", () => {
    const doc = stageDoc();
    const rep = createReplayer(doc as unknown as Document);
    rep.apply(snap);
    rep.apply({ t: "ops", ops: [{ o: "cv", i: 4, u: INK }] });
    const c = canvasIn(doc);
    expect(
      rep.apply({
        t: "ops",
        ops: [{
          o: "a",
          i: 4,
          n: "style",
          v: "display:block;width:100%;height:220px",
        }],
      }),
    ).toBe(true);
    expect(c.getAttribute("style")).toBe(
      "display:block;width:100%;height:220px",
    );
    expect(shown(c).image).toBe(`url("${INK}")`);
    rep.apply({ t: "ops", ops: [{ o: "a", i: 4, n: "style", v: null }] });
    expect(shown(c).image).toBe(`url("${INK}")`);
  });

  test("the replay counts the bitmaps it drew (`painted`), once their decode is in", async () => {
    const doc = stageDoc();
    const rep = createReplayer(doc as unknown as Document);
    rep.apply(snap);
    const drawn: string[] = [];
    const c = canvasIn(doc) as FElement & { getContext?: unknown };
    c.getContext = () => ({
      clearRect() {},
      drawImage(img: FakeImage) {
        drawn.push(img.src);
      },
    });
    rep.apply({ t: "ops", ops: [{ o: "cv", i: 4, u: INK }] });
    expect(rep.stats()).toEqual({ seen: 1, cv: 1, painted: 0, repaints: 0 });
    await Promise.resolve();
    await Promise.resolve();
    expect(drawn).toEqual([INK]);
    expect(rep.stats()).toEqual({ seen: 1, cv: 1, painted: 1, repaints: 0 });
  });

  test("the stage's dev chip shows the bitmaps painted: cv arrived/applied/painted/repainted", () => {
    const stage = readFileSync(
      resolve(__dirname, "../../front-end/islands/DemoStage.tsx"),
      "utf8",
    );
    expect(stage).toMatch(
      /cv\$\{c\.seen\}\/\$\{c\.cv\}\/\$\{c\.painted\}\/\$\{c\.repaints\}/,
    );
    expect(stage).toMatch(/arrived\/applied\/painted\/repainted/);
  });
});
