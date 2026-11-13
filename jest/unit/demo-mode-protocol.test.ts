/**
 * REQ-153 — demo mode's pure protocol, and the wiring the pages need: the wire and peer
 * messages parse and reject junk; a pointer is a viewport fraction (REQ-188); both dictionaries
 * carry the demoMode strings; the overlay is mounted in the shell; the admin row has the Demo
 * button; the Vite proxy forwards the socket unchanged.
 *
 * REQ-242 (2026-11-11): the stage mirrors the customer's DOM, so the reported view (`view`), the
 * followed path (`shouldFollow`) and the element selectors (`selectorFor`, `parseSelector`,
 * `walkSelector`) are gone; their tests went with them (jest/unit/demo-mode-mirror*.test.ts).
 */
import * as fs from "fs";
import * as path from "path";
import {
  parseClientMessage,
  parsePeerMessage,
  parseServerMessage,
  PILL_TEXT_MAX,
} from "../../shared/demo-mode/protocol";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-153 demo mode protocol", () => {
  test("client messages: signal, relay and end parse; junk and unknown types are null", () => {
    expect(parseClientMessage('{"t":"signal","data":{"sdp":"v=0"}}')).toEqual({
      t: "signal",
      data: { sdp: "v=0" },
    });
    expect(
      parseClientMessage(
        '{"t":"relay","data":{"k":"move","a":{"vx":0.5,"vy":0.25}}}',
      ),
    ).toEqual({
      t: "relay",
      data: { k: "move", a: { vx: 0.5, vy: 0.25 } },
    });
    expect(parseClientMessage('{"t":"end"}')).toEqual({ t: "end" });
    expect(parseClientMessage("nope")).toBeNull();
    expect(parseClientMessage('{"t":"bogus"}')).toBeNull();
    expect(
      parseClientMessage(
        '{"t":"relay","data":{"k":"move","a":{"vx":"x","vy":0}}}',
      ),
    ).toBeNull();
    expect(parseClientMessage('{"t":"signal"}')).toBeNull();
  });

  test("peer messages: move/click carry a clamped viewport fraction (REQ-188), leave is bare; the reported view is gone (REQ-242)", () => {
    expect(
      parsePeerMessage({
        k: "click",
        a: { sel: "#save", fx: 0.5, fy: 1.7, vx: -1, vy: 0.2 },
      }),
    ).toEqual({
      k: "click",
      a: { vx: 0, vy: 0.2 },
    });
    expect(parsePeerMessage({ k: "view", v: { path: "/customers?x=1" } }))
      .toBeNull();
    expect(parsePeerMessage({ k: "leave" })).toEqual({ k: "leave" });
    expect(parsePeerMessage({ k: "move" })).toBeNull();
    expect(parsePeerMessage(null)).toBeNull();
  });

  test("REQ-295: the customer's pill box rides to the stage — a rect or null, junk dropped", () => {
    const r = { left: 12, top: 790, width: 320, height: 40 };
    expect(parsePeerMessage({ k: "pill", r })).toEqual({ k: "pill", r });
    expect(parsePeerMessage({ k: "pill", r: null })).toEqual({
      k: "pill",
      r: null,
    });
    expect(parsePeerMessage({ k: "pill", r: { left: "x" } })).toBeNull();
    expect(parsePeerMessage({ k: "pill" })).toBeNull();
  });

  test("REQ-372 (cycle 2, m1): the pill message carries what the pill says — compact, open, status, text, clipped", () => {
    const r = { left: 12, top: 790, width: 320, height: 40 };
    expect(
      parsePeerMessage({
        k: "pill",
        r,
        compact: true,
        open: false,
        status: "live",
        text: "Hans is guiding you",
        clipped: true,
      }),
    ).toEqual({
      k: "pill",
      r,
      compact: true,
      open: false,
      status: "live",
      text: "Hans is guiding you",
      clipped: true,
    });
    // junk fields are dropped, the box still rides
    expect(
      parsePeerMessage({
        k: "pill",
        r,
        compact: "yes",
        status: "hacked",
        text: 42,
        clipped: 1,
      }),
    ).toEqual({ k: "pill", r });
    // a long text is cut
    const long = parsePeerMessage({ k: "pill", r, text: "x".repeat(5000) });
    expect(long && long.k === "pill" && long.text!.length).toBeLessThanOrEqual(
      PILL_TEXT_MAX,
    );
    // and it survives the socket's own parse (the server re-parses every relay)
    const wire = parseClientMessage(
      JSON.stringify({
        t: "relay",
        data: { k: "pill", r, status: "connecting", text: "Hi", open: true },
      }),
    );
    expect(wire).toEqual({
      t: "relay",
      data: { k: "pill", r, status: "connecting", text: "Hi", open: true },
    });
  });

  test("server messages parse and carry who they are from", () => {
    expect(
      parseServerMessage(
        '{"t":"welcome","role":"viewer","sessionId":"s1","peerOnline":true}',
      ),
    ).toEqual({
      t: "welcome",
      role: "viewer",
      sessionId: "s1",
      peerOnline: true,
    });
    expect(
      parseServerMessage(
        '{"t":"relay","from":"presenter","data":{"k":"leave"}}',
      ),
    ).toEqual({
      t: "relay",
      from: "presenter",
      data: { k: "leave" },
    });
    expect(parseServerMessage('{"t":"ended","by":"viewer"}')).toEqual({
      t: "ended",
      by: "viewer",
    });
    expect(
      parseServerMessage('{"t":"ended","by":"viewer","reason":"declined"}'),
    ).toEqual({ t: "ended", by: "viewer", reason: "declined" });
    expect(parseServerMessage('{"t":"peer","online":false}')).toEqual({
      t: "peer",
      online: false,
    });
    expect(
      parseServerMessage('{"t":"relay","from":"nobody","data":{"k":"leave"}}'),
    ).toBeNull();
  });
});

describe("REQ-153 demo mode wiring", () => {
  const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
  const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
  const KEYS = [
    "title",
    "guiding",
    "presenting",
    // REQ-232 (demo-lifecycle-p1): plain words — "waiting", "direct" and "relay" are gone
    "connecting",
    "connected",
    "live",
    "end",
    "ended",
    // the staff side waits for the customer's app to join (AMENDMENT — auto-join, no prompt)
    "waitingFor",
  ];

  test("both dictionaries carry every demoMode string, and the two languages differ", () => {
    for (const k of KEYS) {
      expect(typeof en[`demoMode.${k}`]).toBe("string");
      expect(typeof es[`demoMode.${k}`]).toBe("string");
      expect(en[`demoMode.${k}`].length).toBeGreaterThan(0);
    }
    expect(en["demoMode.guiding"]).toContain("{name}");
    expect(es["demoMode.guiding"]).toContain("{name}");
    expect(en["demoMode.end"]).not.toBe(es["demoMode.end"]);
  });

  test("the customer's app asks every 5 seconds", () => {
    const proto = read("shared/demo-mode/protocol.ts");
    expect(proto).toMatch(/export const ACTIVE_POLL_MS = 5_000;/);
  });

  test("the overlay island is mounted in the shell for sessions and reads the strings", () => {
    const shell = read("front-end/routes/_app.tsx");
    expect(shell).toMatch(
      /import DemoModeOverlay from "\.\.\/islands\/DemoModeOverlay\.tsx"/,
    );
    // REQ-647 (cycle 5, c2-p13-r): with /admin's handover notice read on the server
    expect(shell).toMatch(
      /hasSession\s*\?\s*\(\s*<DemoModeOverlay\s+endedNotice=\{adminEndedNotice\(url\.pathname, url\.search\)\}\s*\/>\s*\)\s*:\s*null/,
    );
    const island = read("front-end/islands/DemoModeOverlay.tsx");
    // REQ-232 (demo-lifecycle-p1): the customer's pill says Connected / Connecting…, not "waiting"
    expect(island).toContain(`t("demoMode.connecting")`);
    // REQ-235: End is one component both pills draw, and it asks first
    const endDemo = read("front-end/components/demo-mode/EndDemo.tsx");
    expect(endDemo).toContain(`t("demoMode.end")`);
    expect(island).toMatch(/<EndDemo\b/);
    // REQ-153 AMENDMENT (2026-11-05): the presenter's pill lives on the stage now
    const stage = read("front-end/islands/DemoStage.tsx");
    expect(stage).toContain(`t("demoMode.waitingFor", { name`);
    // AMENDMENT — auto-join: the customer is never asked; no prompt, no accept, no decline, nothing remembered
    // (REQ-295 remembers the pill's PLACE per path through shared/demo-mode/pill.ts `pillStore`, not here)
    for (
      const gone of [
        "demo-accept",
        "demo-decline",
        "demoMode.invite",
        "demoMode.accept",
        "demoMode.decline",
        "demoMode.declined",
        "sessionStorage",
        "accepted",
      ]
    ) {
      expect(island).not.toContain(gone);
    }
    for (
      const gone of [
        "demoMode.invite",
        "demoMode.accept",
        "demoMode.decline",
        "demoMode.declined",
      ]
    ) {
      expect(en[gone]).toBeUndefined();
      expect(es[gone]).toBeUndefined();
    }
    for (const cy of ["demo-pill", "demo-status"]) {
      expect(island).toContain(`data-cy="${cy}"`);
    }
    expect(endDemo).toContain(`data-cy="demo-end"`);
    // the pointer and the wave are one component, drawn by both the overlay and the stage
    const pointer = read("front-end/components/demo-mode/DemoPointer.tsx");
    for (const cy of ["demo-pointer", "demo-wave"]) {
      expect(pointer).toContain(`data-cy="${cy}"`);
    }
    // REQ-214 (2026-11-06): the overlay draws a PeerPointer per presenter (a DemoPointer each)
    expect(island).toMatch(/<PeerPointer/);
    expect(stage).toMatch(/<DemoPointer/);
  });

  test("the admin row has a Demo button that opens the session and then impersonates", () => {
    const admin = read("front-end/islands/AdminPage.tsx");
    expect(admin).toContain('data-cy="adm-demo"');
    expect(admin).toMatch(/demoModeClient\.start\(/);
    // AMENDMENT: Demo opens the invitation and stays on /admin — the impersonation comes when the customer accepts
    const demoFn = admin.slice(
      admin.indexOf("async function demo("),
      admin.indexOf("async function impersonate("),
    );
    expect(demoFn).not.toMatch(/impersonate\(/);
    expect(demoFn).not.toMatch(/location\.href/);
    expect(demoFn).toMatch(/DEMO_STARTED_EVENT/);
  });

  test("the Vite dev proxy forwards the demo socket to the backend unchanged (no rewrite)", () => {
    const vite = read("front-end/vite.config.ts");
    const entry = vite.match(/"\/api\/demo-mode\/ws":\s*\{([^}]*)\}/);
    expect(entry).not.toBeNull();
    expect(entry![1]).toMatch(/ws:\s*true/);
    expect(entry![1]).not.toMatch(/rewrite/);
  });
});

describe("REQ-153 AMENDMENT — same screen at once", () => {
  const read2 = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

  test("the customer's page is kept 20 s; the poll carries it and the answer carries targetPath", () => {
    expect(read2("shared/demo-mode/protocol.ts")).toMatch(
      /export const WHERE_TTL_MS = 20_000;/,
    );
    const client = read2("front-end/clients/demo-mode.ts");
    expect(client).toMatch(/targetPath: string \| null/);
    expect(client).toMatch(/\?path=\$\{encodeURIComponent\(/);
    const store = read2(
      "backend/src/demo-mode/domain/data/demo-session-store/mod.ts",
    );
    expect(store).toMatch(/\["demo-mode", "where", userId\]/);
    expect(store).toMatch(/WHERE_TTL_MS/);
    const controller = read2(
      "backend/src/demo-mode/entrypoints/demo-mode-controller/mod.ts",
    );
    expect(controller).toMatch(/@Query\("path"\)/);
    expect(controller).toMatch(/impersonatorId/);
  });

  test("the overlay reports its page on every poll; the presenter goes to the stage, which shows the customer's own screen only — never targetPath's page (REQ-242 M10, superseding AMENDMENT 2026-11-05)", () => {
    const island = read2("front-end/islands/DemoModeOverlay.tsx");
    expect(island).toMatch(/demoModeClient\.active\(\{\s*path:/);
    expect(island).toMatch(/adminClient\.impersonate\(/);
    expect(island).toMatch(/location\.assign\(STAGE_PATH\)/);
    const stage = read2("front-end/islands/DemoStage.tsx");
    expect(stage).not.toMatch(/targetPath/);
    // the pending invitation keeps polling, so End from the presenter clears it and the presenter follows the customer's page
    expect(island).toMatch(/peerOnlineRef/);
  });
});

describe("REQ-179 instant feedback on Demo", () => {
  const read3 = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

  test("the Demo button reads Opening… at once and the pill is told before the server answers", () => {
    const admin = read3("front-end/islands/AdminPage.tsx");
    // REQ-269: the labels come from the dictionaries (adminPage.opening / adminPage.demo)
    expect(admin).toMatch(
      /busyId === u\.id\s*\?\s*t\("adminPage\.opening"\)\s*:\s*t\("adminPage\.demo"\)/,
    );
    const en3 = JSON.parse(read3("lang/en.json")) as Record<string, string>;
    expect(en3["adminPage.opening"]).toBe("Opening…");
    expect(en3["adminPage.demo"]).toBe("Demo");
    const demoFn = admin.slice(
      admin.indexOf("async function demo("),
      admin.indexOf("async function impersonate("),
    );
    const opening = demoFn.indexOf("DEMO_OPENING_EVENT");
    const start = demoFn.indexOf("demoModeClient.start(");
    const started = demoFn.indexOf("DEMO_STARTED_EVENT");
    expect(opening).toBeGreaterThan(-1);
    expect(opening).toBeLessThan(start);
    expect(started).toBeGreaterThan(start);
    // the started event carries the demo, so the overlay needs no second ask
    expect(demoFn).toMatch(/new CustomEvent\(DEMO_STARTED_EVENT, \{\s*detail:/);
    const client = read3("front-end/clients/demo-mode.ts");
    expect(client).toMatch(
      /export const DEMO_OPENING_EVENT = "pm:demo-opening";/,
    );
    expect(client).toMatch(/targetPath: string \| null;\s*createdAt/);
  });

  test("the overlay shows Opening… on the opening event, prefetches whoami, and takes the started event's demo straight", () => {
    const island = read3("front-end/islands/DemoModeOverlay.tsx");
    expect(island).toMatch(/DEMO_OPENING_EVENT/);
    expect(island).toContain('t("demoMode.opening")');
    expect(island).toMatch(/data-cy="demo-opening"/);
    expect(island).toMatch(/\(e as CustomEvent\)\.detail/);
    const en = JSON.parse(read3("lang/en.json")) as Record<string, string>;
    const es = JSON.parse(read3("lang/es.json")) as Record<string, string>;
    expect(en["demoMode.opening"]).toBe("Opening…");
    expect(es["demoMode.opening"]).toBe("Abriendo…");
  });
});

describe("REQ-153 AMENDMENT — the same element on both screens (REQ-242: by mirror id now)", () => {
  test("the banner is marked so the mirror never records it, and the pointer's name tag stays inside its box", () => {
    // REQ-269: the bar's markup lives in its (translated) view component
    const banner = read("front-end/islands/ImpersonationBanner.tsx") +
      read("front-end/components/ImpersonationBannerView.tsx");
    expect(banner).toMatch(/data-demo-skip/);
    // REQ-242: the element under a pointer is named by its mirror id (demo-mode-mirror-dom.test.ts)
    expect(fs.existsSync(path.join(ROOT, "front-end/lib/demo-mode/replica.ts")))
      .toBe(false);
    const pointer = read("front-end/components/demo-mode/DemoPointer.tsx");
    expect(pointer).toMatch(/tagPlacement\(/);
  });
});
