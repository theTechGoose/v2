/**
 * REQ-370 — demo-loop cycle 2, issue m23: the stage's first frame drew the customer's sidebar
 * unstyled (default blue links, white boxes, a UA focus outline). The stage revealed the frame the
 * moment a snapshot was applied, before the replay's stylesheets had loaded in the staff browser.
 *
 * The frame is shown only once the replay is styled (`Replayer.styled()`, REQ-305) — or, so a
 * sheet that never answers cannot hold the stage dark, STYLE_WAIT_MS after the first snapshot.
 * Until then the "Connecting to {name}…" overlay stays up and the pill does not say Live.
 */
import * as fs from "fs";
import * as path from "path";
import { createRecorder } from "../../front-end/lib/demo-mode/mirror-record";
import { createReplayer } from "../../front-end/lib/demo-mode/mirror-replay";
import type { MirrorFrame } from "../../shared/demo-mode/mirror";
import * as stageFrame from "../../shared/demo-mode/stage-frame";
import {
  docWith,
  FakeMutationObserver,
  FDocument,
  FElement,
  find,
  h,
} from "./support/fake-dom";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

type Look = ReturnType<typeof stageFrame.stageFrameLook>;
const look = (a: {
  status: "direct" | "relay" | "waiting" | "connecting";
  mirrored: boolean;
  stale: boolean;
  styled: boolean;
}): Look => (stageFrame.stageFrameLook as unknown as (x: typeof a) => Look)(a);
// looked up at run time: a missing export fails its own tests, not the whole file
const frameReady = (a: { styled: boolean; waited: number }): boolean =>
  (stageFrame as unknown as {
    frameReady(x: typeof a): boolean;
  }).frameReady(a);
const STYLE_WAIT_MS = () =>
  (stageFrame as unknown as { STYLE_WAIT_MS: number }).STYLE_WAIT_MS;

describe("REQ-370 m23 — the frame is shown only once the replay is styled", () => {
  test("REQ-370 mirrored but not styled: hidden, no waiting overlay (the connecting overlay owns it)", () => {
    for (const status of ["direct", "relay", "waiting"] as const) {
      const l = look({ status, mirrored: true, stale: false, styled: false });
      expect(l.visibility).toBe("hidden");
      expect(l.waiting).toBe(false);
    }
  });

  test("REQ-370 mirrored and styled: visible", () => {
    expect(
      look({ status: "direct", mirrored: true, stale: false, styled: true }),
    )
      .toEqual({ visibility: "visible", filter: "none", waiting: false });
  });

  test("REQ-370 the reveal waits for the sheets, at most STYLE_WAIT_MS (~1.5 s)", () => {
    const wait = STYLE_WAIT_MS();
    expect(wait).toBeGreaterThanOrEqual(1000);
    expect(wait).toBeLessThanOrEqual(2000);
    expect(frameReady({ styled: false, waited: 0 })).toBe(false);
    expect(frameReady({ styled: false, waited: wait - 1 })).toBe(false);
    expect(frameReady({ styled: true, waited: 0 })).toBe(true);
    expect(frameReady({ styled: false, waited: wait })).toBe(true);
  });
});

/** the customer's page: the app's stylesheet and a sidebar link */
function customerPage(): FDocument {
  return docWith(
    (d) =>
      h(
        d,
        "html",
        {},
        h(
          d,
          "head",
          {},
          h(d, "link", {
            rel: "stylesheet",
            href: "/assets/client-entry.css?__frsh_c=abc",
          }),
        ),
        h(d, "body", {}, h(d, "nav", {}, h(d, "a", { href: "/quotes" }, "Q"))),
      ),
    "https://app.test/assistant",
    420,
    800,
  );
}
function stageDoc(): FDocument {
  const d = new FDocument("about:srcdoc", 1, 1);
  d.appendChild(h(d, "html", {}, h(d, "head"), h(d, "body")));
  return d;
}
function snapshotOf(doc: FDocument): MirrorFrame {
  const frames: MirrorFrame[] = [];
  const rec = createRecorder(doc as unknown as Document, {
    emit: (f) => frames.push(JSON.parse(JSON.stringify(f))),
    Observer: FakeMutationObserver as unknown as typeof MutationObserver,
    manual: true,
  });
  rec.snapshot();
  rec.stop();
  return frames[0];
}

describe("REQ-370 m23 — the real replay decides the reveal (recorder → wire → replayer → look)", () => {
  test("REQ-370 a fresh snapshot whose sheet has not loaded keeps the frame hidden; its load reveals it", () => {
    const stage = stageDoc();
    const rep = createReplayer(
      stage as unknown as Document,
      {
        schedule: () => {},
        Resize: null,
      } as Parameters<typeof createReplayer>[1],
    );
    expect(rep.apply(snapshotOf(customerPage()))).toBe(true);
    const lookNow = (waited: number) =>
      look({
        status: "direct",
        mirrored: rep.size() !== null,
        stale: false,
        styled: frameReady({ styled: rep.styled(), waited }),
      });
    expect(lookNow(0).visibility).toBe("hidden");
    expect(lookNow(500).visibility).toBe("hidden");
    const sheet = find(
      stage,
      (e: FElement) =>
        e.localName === "link" && e.getAttribute("rel") === "stylesheet",
    );
    if (!sheet) throw new Error("the replay has no stylesheet link");
    stage.fire("load", sheet);
    expect(lookNow(500).visibility).toBe("visible");
  });

  test("REQ-370 a sheet that never answers does not hold the stage dark past STYLE_WAIT_MS", () => {
    const stage = stageDoc();
    const rep = createReplayer(
      stage as unknown as Document,
      {
        schedule: () => {},
        Resize: null,
      } as Parameters<typeof createReplayer>[1],
    );
    rep.apply(snapshotOf(customerPage()));
    expect(rep.styled()).toBe(false);
    const l = look({
      status: "direct",
      mirrored: true,
      stale: false,
      styled: frameReady({ styled: rep.styled(), waited: STYLE_WAIT_MS() }),
    });
    expect(l.visibility).toBe("visible");
  });
});

describe("REQ-370 m23 — the stage is wired to it", () => {
  const src = read("front-end/islands/DemoStage.tsx");

  test("REQ-370 the look is fed whether the replay is styled", () => {
    expect(src).toMatch(
      /stageFrameLook\(\{[^}]*\bstyled\b[^}]*\}\)/,
    );
  });

  test("REQ-370 the styled flag comes from the replay's styled() through frameReady, with an STYLE_WAIT_MS fallback timer", () => {
    expect(src).toMatch(/frameReady\(\{\s*styled: rep\.styled\(\)/);
    // the fallback timer reveals it even when the clock rounds a hair short of STYLE_WAIT_MS
    expect(src).toMatch(/checkStyledRef\.current\(true\)/);
    expect(src).toMatch(/setTimeout\([\s\S]{0,120}?STYLE_WAIT_MS,?\s*\)/);
    expect(src).toMatch(/setStyled\(true\)/);
    // a fresh demo starts hidden again
    expect(src).toMatch(/setStyled\(false\)/);
  });

  test("REQ-370 the layout pass (a stylesheet loaded) and an applied snapshot re-check it", () => {
    const replace = src.slice(
      src.indexOf("const replace = () =>"),
      src.indexOf("const replaceRef = useRef(replace)"),
    );
    expect(replace).toMatch(/checkStyled\(\)/);
    const take = src.slice(
      src.indexOf("const take = ("),
      src.indexOf("const onFrameLoad = ("),
    );
    expect(take).toMatch(/checkStyled\(\)/);
  });

  test("REQ-370 'Connecting to {name}…' stays up and the pill is not Live while the frame is hidden", () => {
    expect(src).toMatch(
      /\{look\.visibility === "hidden" && \(\s*<div\s+data-cy="demo-connecting"/,
    );
    // REQ-391 words the pill through stageStatus: the frame counts as mirrored only once it is
    // styled, so "Live" waits for the same fact (reconciled on demo-fixes)
    expect(src).toMatch(
      /stageStatus\(\{[\s\S]{0,300}mirrored: !!mirrored && styled/,
    );
  });
});
