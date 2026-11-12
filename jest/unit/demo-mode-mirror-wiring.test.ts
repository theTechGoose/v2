/**
 * REQ-242 — the wiring of the DOM mirror: the stage replays into ONE sandboxed, script-less frame
 * with a CSP and never loads the app; the customer's overlay records and is inert in any nested
 * frame; the replica (REQ-187's second copy of the app) is gone from every file; the pointer's
 * lifecycle (re-sent on join, cleared on leave/new page/offline, bounded name tag, idle fade).
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));
const filesUnder = (rel: string): string[] => {
  const out: string[] = [];
  const go = (dir: string) => {
    for (
      const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
    ) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name !== "node_modules" && e.name !== "_fresh") go(p);
      } else if (/\.(tsx?|js)$/.test(e.name)) out.push(p);
    }
  };
  go(rel);
  return out;
};

describe("REQ-242 the replica is gone", () => {
  test("no file of the app, the shared code or the backend names the replica any more", () => {
    expect(exists("front-end/lib/demo-mode/replica.ts")).toBe(false);
    expect(exists("jest/unit/demo-mode-replica.test.ts")).toBe(false);
    const files = [
      ...filesUnder("front-end/islands"),
      ...filesUnder("front-end/components"),
      ...filesUnder("front-end/lib"),
      ...filesUnder("front-end/routes"),
      ...filesUnder("shared/demo-mode"),
      ...filesUnder("backend/src/demo-mode"),
    ];
    const gone = [
      "pm-demo-replica",
      "isReplicaFrame",
      "onReplicaView",
      "reportView",
      "onReportedView",
      "requestViews",
      "onViewRequest",
      "pushViewTo",
      "REPLICA_FRAME_NAME",
      "DEFAULT_VIEW",
      "mergeView",
      "parseView",
      "selectorFor",
      "walkSelector",
    ];
    // REQ-242 AMENDMENT (reconciled on demo-fixes): REQ-270's persistLang guard in
    // lib/lang.ts names the old frame, like REQ-229's pixel guard — the one allowed hit.
    const allowed = new Set(["front-end/lib/lang.ts: pm-demo-replica"]);
    const hits = files.flatMap((f) => {
      const src = read(f);
      return gone.filter((g) => src.includes(g)).map((g) => `${f}: ${g}`);
    }).filter((h) => !allowed.has(h));
    expect(hits).toEqual([]);
  });

  test("the sidebar, the map and the banner run the same everywhere (no frame-only branch)", () => {
    const sb = read("front-end/islands/DashSidebar.tsx");
    expect(sb).not.toMatch(/demo-mode\//);
    const map = read("front-end/islands/FieldAssignmentsPage.tsx");
    expect(map).not.toMatch(/demo-mode\//);
    expect(map).not.toMatch(/lastMapRef|mirrorRef/);
    const banner = read("front-end/islands/ImpersonationBanner.tsx");
    // REQ-232 — the banner may call the demo API (leave), never the demo-mode lib (no frame branch)
    expect(banner).not.toMatch(/lib\/demo-mode\//);
    // the stage still measures the banner by its marker, and the recorder never mirrors it
    expect(banner).toMatch(/data-demo-skip/);
  });
});

describe("REQ-242 the stage replays into a script-less frame", () => {
  const stage = read("front-end/islands/DemoStage.tsx");
  const frame = stage.slice(
    stage.indexOf("<iframe"),
    stage.indexOf("/>", stage.indexOf("<iframe")),
  );

  test("ONE frame, sandboxed with allow-same-origin and never allow-scripts, a srcdoc with a CSP that forbids scripts, frames, objects, media and connections", () => {
    expect(stage.match(/<iframe/g)?.length).toBe(1);
    expect(frame).toMatch(/sandbox="allow-same-origin"/);
    expect(stage).not.toMatch(/allow-scripts/);
    expect(frame).toMatch(/srcdoc=\{MIRROR_SRCDOC\}/i);
    expect(frame).toMatch(/data-cy="demo-frame"/);
    expect(frame).toMatch(/pointer-events:\s*none/);
    const lib = read("front-end/lib/demo-mode/mirror-replay.ts");
    const srcdoc = lib.slice(lib.indexOf("export const MIRROR_SRCDOC"));
    expect(srcdoc).toMatch(/Content-Security-Policy/);
    for (
      const d of [
        "script-src 'none'",
        "frame-src 'none'",
        "object-src 'none'",
        "media-src 'none'",
        "connect-src 'none'",
        "form-action 'none'",
        "base-uri 'none'",
      ]
    ) expect(srcdoc).toContain(d);
  });

  test("the frame is the customer's real viewport, scaled; before the first snapshot the stage says it is connecting (no invented phone, no page the customer is not on)", () => {
    expect(frame).toMatch(/width=\{screen\.w\}/);
    expect(frame).toMatch(/height=\{screen\.h\}/);
    expect(frame).toMatch(/scale\(\$\{fit\.s\}\)/);
    expect(stage).toMatch(/data-cy="demo-connecting"/);
    expect(stage).toContain('t("demoMode.connectingTo", { name })');
    expect(stage).not.toMatch(/targetPath/);
    expect(stage).not.toMatch(/location\.replace\(/);
    const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
    const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
    expect(en["demoMode.connectingTo"]).toContain("{name}");
    expect(es["demoMode.connectingTo"]).toContain("{name}");
    expect(en["demoMode.connectingTo"]).not.toBe(es["demoMode.connectingTo"]);
  });

  test("the stage takes dom chunks through the receiver into the replayer, asks for a snapshot when it stalls or desyncs, and anchors pointers to mirrored nodes", () => {
    expect(stage).toMatch(/createReplayer\(/);
    expect(stage).toMatch(/createMirrorReceiver\(/);
    expect(stage).toMatch(/case "dom":/);
    expect(stage).toMatch(/k: "resync"/);
    expect(stage).toMatch(/\.stalled\(\)/);
    expect(stage).toMatch(/\.anchorAt\(/);
    expect(stage).toMatch(/\.pointOf\(/);
    // point only: the capture layer still eats the presenter's clicks
    expect(stage).toMatch(
      /onPointerDown=\{\(e\) => \{\s*e\.preventDefault\(\);/,
    );
    expect(stage).toMatch(/adminClient\.stopImpersonating\(\)/);
  });

  test("pointer lifecycle on the stage: the presenter's resting pointer is sent again when the customer's page joins and after every snapshot; the customer's pointer goes on a new page and when their app drops; the tag is bounded by the frame", () => {
    expect(stage).toMatch(/lastMoveRef/);
    const online = stage.slice(stage.indexOf("onPeerOnline:"));
    expect(online.slice(0, online.indexOf("},") + 2)).toMatch(
      /resendPointer\(\)/,
    );
    expect(stage).toMatch(/f\.t === "snap"[\s\S]{0,400}glide\.hide\(\)/);
    expect(stage).toMatch(/!online[\s\S]{0,200}glide\.hide\(\)/);
    expect(stage).toMatch(/<DemoPointer[\s\S]{0,300}bounds=\{fit\}/);
  });

  test("REQ-292 M6/M8 — the stage starts its receiver over when the tab it follows changes, and a dropped snapshot is warned about and resynced, never swallowed", () => {
    const online = stage.slice(stage.indexOf("onPeerOnline:"));
    const body = online.slice(0, online.indexOf("},") + 2);
    expect(body).toMatch(/onPeerOnline:\s*\(cid/);
    expect(body).toMatch(/rx\.reset\(\)/);
    expect(body).toMatch(/loadRef\.current = null/);
    // the mirrored page stays until the new tab's snapshot: no setMirrored(null) on a switch
    expect(body).not.toMatch(/setMirrored\(null\)/);
    const rxMade = stage.slice(stage.indexOf("createMirrorReceiver("));
    const rxArgs = rxMade.slice(0, rxMade.indexOf("\n    });") + 8);
    expect(rxArgs).toMatch(/onDropped/);
    expect(rxArgs).toMatch(/console\.warn\(/);
    expect(rxArgs).toMatch(/askResync\(\)/);
  });

  test("after a snapshot the stage lets the replay settle its scrolls once the styles are in", () => {
    expect(stage).toMatch(/f\.t === "snap"[\s\S]{0,600}\.settle\(\)/);
  });
});

describe("REQ-242 a sender's move clock starts over with its page", () => {
  // a move carries the sender's performance.now(), which starts at 0 on every page load: a
  // receiver that kept the old page's clock dropped every move of the new page (pointer-m2)
  test("the stage forgets the customer's clock when their page joins, drops, or is mirrored afresh; both sides forget a presenter's when they come or go", () => {
    const stage = read("front-end/islands/DemoStage.tsx");
    expect(stage).toMatch(/const lastTRef = useRef\(0\)/);
    expect(stage).toMatch(/newerMove\(lastTRef\.current, m\.t\)/);
    const online = stage.slice(stage.indexOf("onPeerOnline:"));
    expect(online.slice(0, online.indexOf("},") + 2)).toMatch(
      /lastTRef\.current = 0/,
    );
    expect(stage).toMatch(/if \(!online\) \{[^}]*lastTRef\.current = 0/);
    expect(stage).toMatch(
      /load !== loadRef\.current[\s\S]{0,80}lastTRef\.current = 0/,
    );
    expect(stage).toMatch(
      /onPresence: \(pid, online\) => \{\s*lastTOf\.delete\(pid\);/,
    );
    const overlay = read("front-end/islands/DemoModeOverlay.tsx");
    expect(overlay).toMatch(
      /onPresence: \(pid, online\) => \{\s*lastT\.delete\(pid\);/,
    );
  });
});

describe("REQ-242 the customer's overlay records", () => {
  const overlay = read("front-end/islands/DemoModeOverlay.tsx");

  test("M5 — inert in any nested frame (the welcome preview never joins), and on the stage", () => {
    expect(overlay).toMatch(/globalThis\.top !== globalThis/);
    expect(overlay).toMatch(/STAGE_PATH/);
  });

  test("a snapshot when a presenter joins and when a stage asks; paused while nobody watches; stopped with the link", () => {
    expect(overlay).toMatch(/createRecorder\(/);
    expect(overlay).toMatch(/createMirrorSender\(/);
    const online = overlay.slice(overlay.indexOf("onPeerOnline:"));
    expect(online.slice(0, online.indexOf("},") + 2)).toMatch(
      /recorder\.snapshot\(\)/,
    );
    expect(overlay).toMatch(
      /case "resync":[\s\S]{0,120}recorder\.snapshot\(\)/,
    );
    expect(overlay).toMatch(/recorder\.pause\(\)/);
    expect(overlay).toMatch(/recorder\.stop\(\)/);
    // no view reporting left
    expect(overlay).not.toMatch(
      /k: "view"|wholeView|collectScroll|scrollPosOf/,
    );
  });

  test("pointer lifecycle on the customer's side: anchored moves, leave on pagehide, a departed presenter's pointer cleared, the tag bounded by the window", () => {
    expect(overlay).toMatch(/recorder\.idOf\(/);
    expect(overlay).toMatch(/recorder\.nodeOf\(/);
    expect(overlay).toMatch(/addEventListener\("pagehide"/);
    expect(overlay).toMatch(/onPresence: \(pid, online\)/);
    expect(overlay).toMatch(/kind: "leave"/);
    const peer = read("front-end/components/demo-mode/PeerPointer.tsx");
    expect(peer).toMatch(/bounds/);
    const pointer = read("front-end/components/demo-mode/DemoPointer.tsx");
    expect(pointer).toMatch(/tagPlacement\(/);
    expect(pointer).toMatch(/TAG_IDLE_MS/);
    expect(pointer).toMatch(/pointerLook\(/); // REQ-374: the arrow no longer dims
    expect(pointer).not.toMatch(/innerWidth \|\| 0\) - 180/);
  });
});

describe("REQ-242 the transport", () => {
  test("a presenter's resync goes to the customer only; colleagues get pointers only", () => {
    const t = read("front-end/lib/demo-mode/transport.ts");
    expect(t).toMatch(/isPointer\(m\)/);
    expect(t).not.toMatch(/m\.k !== "view"/);
  });
});

describe("REQ-309 (demo M19/m14/m26) — a gap is found while the customer is idle, the pill tells the frame's truth, the mirror is counted", () => {
  const stage = read("front-end/islands/DemoStage.tsx");
  const recorder = read("front-end/lib/demo-mode/mirror-record.ts");
  const mirror = read("shared/demo-mode/mirror.ts");

  test("the recorder's sweep beats: an empty frame when nothing went out for MIRROR_HEARTBEAT_MS", () => {
    expect(recorder).toMatch(/MIRROR_HEARTBEAT_MS/);
    expect(recorder).toMatch(
      /setInterval\(\(\) => \{\s*flush\(\);\s*beat\(\);\s*\}, sweepMs\)/,
    );
  });

  test("a frame that does not decode is told to the sequencer", () => {
    expect(mirror).toMatch(/order\.lost\(whole\.l, whole\.s\)/);
  });

  test("the stage pill says Live only once the followed tab's snapshot is in the frame — the fact the connecting overlay uses", () => {
    const label = stage.slice(
      stage.indexOf("const statusLabel ="),
      stage.indexOf("const pillStyle ="),
    );
    expect(label).toMatch(
      /status === "direct" \|\| status === "relay"\)?\s*\?\s*mirrored\s*\?\s*t\("demoMode\.live"\)\s*:\s*t\("demoMode\.connecting"\)/,
    );
  });

  test("a frame that does not fit marks the stage dirty, and it keeps asking (every MIRROR_GAP_MS) until a snapshot lands — a stall asks the same way", () => {
    expect(stage).toMatch(/const dirtyRef = useRef\(false\)/);
    expect(stage).toMatch(
      /if \(rx\.stalled\(\) \|\| dirtyRef\.current\) askResync\(\)/,
    );
    expect(stage).toMatch(/dirtyRef\.current = true;/);
    expect(stage).toMatch(/f\.t === "snap"\) \{\s*dirtyRef\.current = false;/);
  });

  test("following another of the customer's tabs starts the receiver over", () => {
    const online = stage.slice(stage.indexOf("onPeerOnline:"));
    expect(online.slice(0, online.indexOf("},") + 2)).toMatch(/rx\.reset\(\)/);
  });

  test("in dev the pill shows what the mirror counted", () => {
    expect(stage).toMatch(/data-cy="demo-mirror-stats"/);
    expect(stage).toMatch(/rx\.stats\(\)/);
    expect(stage).toMatch(/localhost\|127\\\.0\\\.0\\\.1/);
  });
});
