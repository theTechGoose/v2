/**
 * REQ-187 — the customer's screen is the truth: the staff side shows a scaled replica of it (a
 * frame at the customer's exact viewport, scaled to fit), the customer reports its view (size,
 * page, scrolls, sidebar, map) and the stage applies it; inside the frame the app runs as the
 * customer sees it (no banner, no demo of its own); point only.
 * REQ-188 — the pointer is the viewport fraction both ways; the anchoring is gone.
 */
import * as fs from "fs";
import * as path from "path";
import {
  fitScale,
  fracToPoint,
  parsePeerMessage,
  pointToFrac,
} from "../../shared/demo-mode/protocol";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

describe("REQ-187 the view patch on the wire", () => {
  test("a view patch carries size, page, scrolls, sidebar flags and the map; junk is dropped; an empty patch is null", () => {
    expect(
      parsePeerMessage({
        k: "view",
        v: {
          w: 420,
          h: 800,
          path: "/customers?x=1",
          sb: true,
          drawer: false,
          scroll: [{ sel: null, x: 0, y: 120 }, {
            sel:
              "body > div.app:nth-of-type(1) > main.main:nth-of-type(1) > div.content:nth-of-type(1)",
            x: 0,
            y: 340,
          }],
          map: { c: [33.69, -78.93], z: 11 },
        },
      }),
    ).toEqual({
      k: "view",
      v: {
        w: 420,
        h: 800,
        path: "/customers?x=1",
        sb: true,
        drawer: false,
        scroll: [{ sel: null, x: 0, y: 120 }, {
          sel:
            "body > div.app:nth-of-type(1) > main.main:nth-of-type(1) > div.content:nth-of-type(1)",
          x: 0,
          y: 340,
        }],
        map: { c: [33.69, -78.93], z: 11 },
      },
    });
    // a patch: only the fields that changed
    expect(parsePeerMessage({ k: "view", v: { path: "/dashboard" } })).toEqual({
      k: "view",
      v: { path: "/dashboard" },
    });
    // junk fields are dropped, bad values make the field absent
    expect(
      parsePeerMessage({
        k: "view",
        v: {
          w: -5,
          h: "800",
          path: "https://evil.example/",
          sb: "yes",
          scroll: [{ sel: 7, x: 0, y: 0 }, { sel: null, x: -1, y: 10 }, {
            sel: null,
            x: 0,
            y: 10,
          }],
          map: { c: [91, 0], z: 3 },
          extra: 1,
        },
      }),
    ).toEqual({ k: "view", v: { scroll: [{ sel: null, x: 0, y: 10 }] } });
    expect(parsePeerMessage({ k: "view", v: {} })).toBeNull();
    expect(parsePeerMessage({ k: "view", v: { extra: 1 } })).toBeNull();
    expect(parsePeerMessage({ k: "view" })).toBeNull();
    // the old route message is gone
    expect(parsePeerMessage({ k: "route", path: "/customers" })).toBeNull();
  });

  test("fitScale fits the customer's viewport inside the stage, keeping aspect, centred in the room left", () => {
    // a 420 × 800 phone on a 1280 × 800 stage with 16 px sides and 72 px kept for the pill
    const f = fitScale({ w: 1280, h: 800 }, { w: 420, h: 800 }, {
      top: 16,
      right: 16,
      bottom: 72,
      left: 16,
    });
    const s = (800 - 16 - 72) / 800; // 0.89 — the height binds
    expect(f.s).toBeCloseTo(s, 6);
    expect(f.width).toBeCloseTo(420 * s, 6);
    expect(f.height).toBeCloseTo(800 * s, 6);
    expect(f.left).toBeCloseTo(16 + (1280 - 32 - 420 * s) / 2, 6);
    expect(f.top).toBeCloseTo(16, 6);
    // a wide customer on a narrow stage: the width binds, and the frame is vertically centred
    const g = fitScale({ w: 800, h: 1000 }, { w: 1600, h: 900 }, {
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
    expect(g.s).toBeCloseTo(0.5, 6);
    expect(g.top).toBeCloseTo((1000 - 450) / 2, 6);
    expect(g.left).toBeCloseTo(0, 6);
    // a small customer on a big stage is enlarged (the pixel grid is the same at any scale)
    expect(
      fitScale({ w: 2560, h: 1300 }, { w: 390, h: 844 }, {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      }).s,
    ).toBeGreaterThan(1);
    // a degenerate stage never yields NaN or a negative scale
    expect(
      fitScale({ w: 0, h: 0 }, { w: 390, h: 844 }, {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      }).s,
    ).toBeGreaterThan(0);
  });
});

describe("REQ-187 AMENDMENT — the sidebar's open folder is part of the view", () => {
  test("parseView keeps a folder of short ids, drops junk, and the sidebar reports and applies it", () => {
    expect(parsePeerMessage({ k: "view", v: { folder: ["manage"] } })).toEqual({
      k: "view",
      v: { folder: ["manage"] },
    });
    expect(parsePeerMessage({ k: "view", v: { folder: [] } })).toEqual({
      k: "view",
      v: { folder: [] },
    });
    expect(parsePeerMessage({ k: "view", v: { folder: ["ok", 7] } }))
      .toBeNull();
    expect(parsePeerMessage({ k: "view", v: { folder: "manage" } })).toBeNull();
    expect(parsePeerMessage({ k: "view", v: { folder: ["x".repeat(65)] } }))
      .toBeNull();
    const sb = read("front-end/islands/DashSidebar.tsx");
    expect(sb).toMatch(
      /reportView\(\{ sb: collapsed, drawer: mobileOpen, folder: path \}\)/,
    );
    expect(sb).toMatch(/setPath\(v\.folder\)/);
    const proto = read("shared/demo-mode/protocol.ts");
    expect(proto).toMatch(/folder: string\[\];/);
  });
});

describe("REQ-188 the pointer is the viewport fraction, both ways", () => {
  test("a move/click anchor parses to {vx, vy} only — clamped — whatever else rides along", () => {
    expect(
      parsePeerMessage({
        k: "move",
        a: { vx: 0.25, vy: 1.7, sel: "#save", fx: 0.5, fy: 0.5, ti: 0, ci: 3 },
        t: 12,
      }),
    ).toEqual({ k: "move", a: { vx: 0.25, vy: 1 }, t: 12 });
    expect(parsePeerMessage({ k: "click", a: { vx: -1, vy: 0.5 } })).toEqual({
      k: "click",
      a: { vx: 0, vy: 0.5 },
    });
    expect(parsePeerMessage({ k: "move", a: { vx: "0.2", vy: 0.5 } }))
      .toBeNull();
  });

  test("fracToPoint / pointToFrac round-trip inside a box and clamp outside it", () => {
    const box = { left: 100, top: 50, width: 400, height: 800 };
    expect(fracToPoint({ vx: 0.5, vy: 0.25 }, box)).toEqual({ x: 300, y: 250 });
    expect(pointToFrac({ x: 300, y: 250 }, box)).toEqual({ vx: 0.5, vy: 0.25 });
    expect(pointToFrac({ x: 0, y: 2000 }, box)).toEqual({ vx: 0, vy: 1 });
    const a = { vx: 0.123, vy: 0.987 };
    const back = pointToFrac(fracToPoint(a, box), box);
    expect(back.vx).toBeCloseTo(a.vx, 9);
    expect(back.vy).toBeCloseTo(a.vy, 9);
    // a zero-size box answers the origin, never NaN
    expect(
      pointToFrac({ x: 5, y: 5 }, { left: 0, top: 0, width: 0, height: 0 }),
    )
      .toEqual({ vx: 0, vy: 0 });
  });

  test("the anchoring modules and their tests are gone; the protocol keeps no anchor fields", () => {
    for (
      const gone of [
        "front-end/lib/demo-mode/anchor.ts",
        "front-end/lib/demo-mode/geo.ts",
        "jest/unit/demo-mode-text-anchor.test.ts",
        "jest/unit/demo-mode-geo-anchor.test.ts",
        "jest/unit/demo-mode-gap-anchor.test.ts",
      ]
    ) expect({ [gone]: exists(gone) }).toEqual({ [gone]: false });
    const proto = read("shared/demo-mode/protocol.ts");
    for (const f of ["fx?:", "fy?:", "ti?:", "ci?:", "g?:", "ox?:", "oy?:"]) {
      expect(proto).not.toContain(f);
    }
    expect(proto).not.toMatch(
      /export function (placeAnchor|nearestRect|outsideFrac|clampPoint|nearLine|caretPoint)\b/,
    );
    expect(proto).not.toMatch(/k: "route"/);
    // the positional selector stays — it names scrolled elements now
    expect(proto).toMatch(/export function selectorFor\(/);
    expect(proto).toMatch(/export function walkSelector\(/);
  });

  test("the customer places a move by its viewport box; the stage by the frame's fitted box", () => {
    const overlay = read("front-end/islands/DemoModeOverlay.tsx");
    expect(overlay).toMatch(/fracToPoint\(m\.a, viewportBox\(\)\)/);
    expect(overlay).toMatch(/pointToFrac\(\{ x, y \}, viewportBox\(\)\)/);
    expect(overlay).not.toMatch(/anchorAt|resolveAnchor/);
    const stage = read("front-end/islands/DemoStage.tsx");
    expect(stage).toMatch(/fracToPoint\(m\.a, fitBox\(\)\)/);
    expect(stage).toMatch(/pointToFrac\(\{ x, y \}, fitBox\(\)\)/);
  });
});

describe("REQ-187 the stage and the replica frame — wiring", () => {
  test("the stage route is session-gated and mounts the island; the island shows ONE frame named pm-demo-replica, pointer events off, under the capture layer, scaled to fit", () => {
    expect(exists("front-end/routes/demo/_middleware.ts")).toBe(true);
    expect(read("front-end/routes/demo/_middleware.ts")).toMatch(/loadUser\(/);
    const route = read("front-end/routes/demo/stage.tsx");
    expect(route).toMatch(
      /import DemoStage from "\.\.\/\.\.\/islands\/DemoStage\.tsx"/,
    );
    expect(route).toMatch(/<DemoStage \/>/);
    const stage = read("front-end/islands/DemoStage.tsx");
    expect(stage).toMatch(/<iframe/);
    expect(stage).toMatch(/name=\{REPLICA_FRAME_NAME\}/);
    expect(stage).toMatch(/data-cy="demo-frame"/);
    expect(stage).toMatch(/data-cy="demo-stage-layer"/);
    // the frame takes no pointer events; its size is the customer's viewport and its transform the fit
    const frame = stage.slice(
      stage.indexOf("<iframe"),
      stage.indexOf("/>", stage.indexOf("<iframe")),
    );
    expect(frame).toMatch(/pointer-events:\s*none/);
    expect(frame).toMatch(/width=\{view\.w\}/);
    expect(frame).toMatch(/height=\{view\.h\}/);
    expect(frame).toMatch(/scale\(\$\{fit\.s\}\)/);
    expect(stage).toMatch(/fitScale\(/);
    // the layer's moves go out as fractions, its clicks are waves there, never actions here
    expect(stage).toMatch(
      /onPointerDown=\{\(e\) => \{\s*e\.preventDefault\(\);/,
    );
    expect(stage).not.toMatch(/setPointOnly|setFollow|demoMode\.interact/);
    // the stage ends like the overlay did: the presenter gets their own account back
    expect(stage).toMatch(/adminClient\.stopImpersonating\(\)/);
    expect(stage).toMatch(/location\.href = "\/admin"/);
    // the pill: the customer's name, the status, the frame size, End
    for (
      const k of ["presenting", "waitingFor", "theirScreen", "end", "ended"]
    ) {
      expect(stage).toContain(`t("demoMode.${k}"`);
    }
    for (const cy of ["demo-pill", "demo-status", "demo-end"]) {
      expect(stage).toContain(`data-cy="${cy}"`);
    }
    // the pointer and the waves are the shared component (the overlay draws the same)
    expect(stage).toMatch(/<DemoPointer/);
    const pointer = read("front-end/components/demo-mode/DemoPointer.tsx");
    for (const cy of ["demo-pointer", "demo-wave"]) {
      expect(pointer).toContain(`data-cy="${cy}"`);
    }
  });

  test("the stage applies the customer's view: navigates the frame, scrolls the same elements, hands sidebar and map state into the frame; a default phone before the first report", () => {
    const stage = read("front-end/islands/DemoStage.tsx");
    expect(stage).toMatch(/case "view":/);
    expect(stage).toMatch(/mergeView\(/);
    expect(stage).toMatch(/applyScroll\(/);
    expect(stage).toMatch(/pushViewTo\(/);
    expect(stage).toMatch(/location\.replace\(/);
    expect(stage).toMatch(/DEFAULT_VIEW/);
    expect(stage).toMatch(/targetPath/);
    const lib = read("front-end/lib/demo-mode/replica.ts");
    expect(lib).toMatch(/export const REPLICA_FRAME_NAME = "pm-demo-replica";/);
    expect(lib).toMatch(/export function isReplicaFrame\(/);
    expect(lib).toMatch(/export function reportView\(/);
    expect(lib).toMatch(/export function onReportedView\(/);
    expect(lib).toMatch(/export function requestViews\(/);
    expect(lib).toMatch(/export function onViewRequest\(/);
    expect(lib).toMatch(/export function pushViewTo\(/);
    expect(lib).toMatch(/export function onReplicaView\(/);
    expect(lib).toMatch(/export function applyScroll\(/);
    expect(lib).toMatch(/export function collectScroll\(/);
    expect(lib).toMatch(/export function findBySelector\(/);
    // the selector is resolved with the protocol's own counting before trusting querySelector
    const find = lib.slice(lib.indexOf("export function findBySelector("));
    expect(find.indexOf("walkSelector(")).toBeGreaterThan(-1);
    expect(find.indexOf("walkSelector(")).toBeLessThan(
      find.indexOf("doc.querySelector(sel)"),
    );
    // a message from anything but the parent, or another origin, is ignored
    expect(lib).toMatch(/e\.source !== (globalThis|window)\.parent/);
    expect(lib).toMatch(/e\.origin !== (globalThis|window)\.location\.origin/);
  });

  test("the customer's overlay reports the view (whole on join, patches after), sends the presenter to the stage, and is inert inside the frame and on the stage", () => {
    const overlay = read("front-end/islands/DemoModeOverlay.tsx");
    expect(overlay).toMatch(/STAGE_PATH/);
    expect(overlay).toMatch(/location\.assign\(STAGE_PATH\)/);
    expect(overlay).toMatch(/isReplicaFrame\(\)/);
    expect(overlay).toMatch(/k: "view"/);
    expect(overlay).toMatch(/wholeView\(/);
    expect(overlay).toMatch(/requestViews\(\)/);
    expect(overlay).toMatch(/onReportedView\(/);
    expect(overlay).toMatch(/addEventListener\("scroll"/);
    expect(overlay).toMatch(/addEventListener\("resize"/);
    expect(overlay).toMatch(/collectScroll\(/);
    // no presenter link, no capture layer, no toggles in the overlay any more
    expect(overlay).not.toMatch(
      /captured|setPointOnly|setFollow|placeAnchor|k: "route"/,
    );
    expect(overlay).not.toContain('t("demoMode.follow")');
  });

  test("inside the frame: no banner, the sidebar takes its flags from the stage, the map mirrors centre and zoom; both report their state to the overlay", () => {
    const banner = read("front-end/islands/ImpersonationBanner.tsx");
    expect(banner).toMatch(/isReplicaFrame\(\)/);
    const sb = read("front-end/islands/DashSidebar.tsx");
    expect(sb).toMatch(/isReplicaFrame\(\)/);
    expect(sb).toMatch(/onReplicaView\(/);
    // AMENDMENT 2026-11-05: the open folder rides along
    expect(sb).toMatch(
      /reportView\(\{ sb: collapsed, drawer: mobileOpen, folder: path \}\)/,
    );
    expect(sb).toMatch(/onViewRequest\(/);
    // the pre-paint script never collapses the replica from the staff's local storage
    expect(sb).toMatch(/window\.name==="pm-demo-replica"/);
    const map = read("front-end/islands/FieldAssignmentsPage.tsx");
    expect(map).not.toMatch(/leafletGeoHook|geo\.ts/);
    expect(map).toMatch(/isReplicaFrame\(\)/);
    expect(map).toMatch(/onReplicaView\(/);
    expect(map).toMatch(/map\.on\("moveend"/);
    expect(map).toMatch(/reportView\(\{ map: \{ c: \[/);
    expect(map).toMatch(/onViewRequest\(/);
    // the replica's own fit (or, REQ-288, its business-centre view) never wins over the customer's view
    const at = map.indexOf("map.fitBounds(view.fit");
    expect(at).toBeGreaterThan(-1);
    const after = map.slice(at);
    expect(after).toMatch(/lastMapRef\.current/);
  });

  test("both dictionaries carry the stage strings and no longer the toggles", () => {
    const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
    const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
    for (const k of ["theirScreen", "pointOnlyHint", "noDemo", "backToAdmin"]) {
      expect(typeof en[`demoMode.${k}`]).toBe("string");
      expect(typeof es[`demoMode.${k}`]).toBe("string");
      expect(en[`demoMode.${k}`]).not.toBe(es[`demoMode.${k}`]);
    }
    for (const v of ["{name}", "{w}", "{h}"]) {
      expect(en["demoMode.theirScreen"]).toContain(v);
      expect(es["demoMode.theirScreen"]).toContain(v);
    }
    for (const k of ["follow", "pointOnly", "interact"]) {
      expect(en[`demoMode.${k}`]).toBeUndefined();
      expect(es[`demoMode.${k}`]).toBeUndefined();
    }
  });
});
