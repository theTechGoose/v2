/**
 * REQ-153 — demo mode's pure protocol, and the wiring the pages need: the wire and peer
 * messages parse and reject junk; a pointer is a viewport fraction (REQ-188); a reported page is
 * followed only when it is a different same-origin path; a selector is
 * built from an id, a data-cy or a positional path; both dictionaries carry the demoMode strings;
 * the overlay is mounted in the shell; the admin row has the Demo button; the Vite proxy
 * forwards the socket unchanged.
 */
import * as fs from "fs";
import * as path from "path";
import {
  type ElLike,
  parseClientMessage,
  parsePeerMessage,
  parseSelector,
  parseServerMessage,
  selectorFor,
  shouldFollow,
  walkSelector,
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

  test("peer messages: move/click carry a clamped viewport fraction (REQ-188), a view's page is a same-origin path (REQ-187), leave is bare", () => {
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
      .toEqual({
        k: "view",
        v: { path: "/customers?x=1" },
      });
    expect(
      parsePeerMessage({ k: "view", v: { path: "https://evil.example/" } }),
    )
      .toBeNull();
    expect(parsePeerMessage({ k: "view", v: { path: "//evil.example/" } }))
      .toBeNull();
    expect(parsePeerMessage({ k: "leave" })).toEqual({ k: "leave" });
    expect(parsePeerMessage({ k: "move" })).toBeNull();
    expect(parsePeerMessage(null)).toBeNull();
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

  test("the presenter follows a different same-origin path only", () => {
    expect(shouldFollow("/dashboard", "/customers")).toBe(true);
    expect(shouldFollow("/dashboard", "/dashboard")).toBe(false);
    expect(shouldFollow("/dashboard?x=1", "/dashboard")).toBe(true);
    expect(shouldFollow("/dashboard", "//evil.example/x")).toBe(false);
    expect(shouldFollow("/dashboard", "https://evil.example/x")).toBe(false);
    expect(shouldFollow("/dashboard", "")).toBe(false);
  });

  test("a selector is the id, the data-cy, or a positional path from the nearest of those", () => {
    const node = (
      tagName: string,
      attrs: Record<string, string>,
      parent: ElLike | null,
    ): ElLike & { kids: ElLike[] } => {
      const n = {
        tagName,
        id: attrs.id ?? "",
        getAttribute: (k: string) => attrs[k] ?? null,
        parentElement: parent,
        kids: [] as ElLike[],
        get children() {
          return n.kids;
        },
      };
      if (parent) (parent as ElLike & { kids: ElLike[] }).kids.push(n);
      return n;
    };
    const body = node("BODY", {}, null);
    const app = node("DIV", { id: "app" }, body);
    const ul = node("UL", {}, app);
    node("LI", {}, ul);
    const li2 = node("LI", {}, ul);
    const save = node("BUTTON", { "data-cy": "save" }, li2);
    expect(selectorFor(li2)).toBe(
      "#app > ul:nth-of-type(1) > li:nth-of-type(2)",
    );
    expect(selectorFor(save)).toBe('[data-cy="save"]');
    expect(selectorFor(ul)).toBe("#app > ul:nth-of-type(1)");
    const loose = node("P", {}, body);
    expect(selectorFor(loose)).toBe("body > p:nth-of-type(1)");
  });
});

describe("REQ-153 demo mode wiring", () => {
  const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
  const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
  const KEYS = [
    "title",
    "guiding",
    "presenting",
    "waiting",
    "direct",
    "relay",
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
    expect(shell).toMatch(/hasSession \? <DemoModeOverlay \/> : null/);
    const island = read("front-end/islands/DemoModeOverlay.tsx");
    expect(island).toContain(`t("demoMode.waiting")`);
    // REQ-235: End is one component both pills draw, and it asks first
    const endDemo = read("front-end/components/demo-mode/EndDemo.tsx");
    expect(endDemo).toContain(`t("demoMode.end")`);
    expect(island).toMatch(/<EndDemo\b/);
    // REQ-153 AMENDMENT (2026-11-05): the presenter's pill lives on the stage now
    const stage = read("front-end/islands/DemoStage.tsx");
    expect(stage).toContain(`t("demoMode.waitingFor", { name`);
    // AMENDMENT — auto-join: the customer is never asked; no prompt, no accept, no decline, nothing remembered
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

  test("the overlay reports its page on every poll; the presenter goes to the stage, which shows targetPath before the customer accepts (AMENDMENT 2026-11-05)", () => {
    const island = read2("front-end/islands/DemoModeOverlay.tsx");
    expect(island).toMatch(/demoModeClient\.active\(\{\s*path:/);
    expect(island).toMatch(/adminClient\.impersonate\(/);
    expect(island).toMatch(/location\.assign\(STAGE_PATH\)/);
    const stage = read2("front-end/islands/DemoStage.tsx");
    expect(stage).toMatch(/targetPath/);
    // the pending invitation keeps polling, so End from the presenter clears it and the presenter follows the customer's page
    expect(island).toMatch(/peerOnlineRef/);
  });
});

describe("REQ-179 instant feedback on Demo", () => {
  const read3 = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

  test("the Demo button reads Opening… at once and the pill is told before the server answers", () => {
    const admin = read3("front-end/islands/AdminPage.tsx");
    expect(admin).toMatch(/busyId === u\.id \? "Opening…" : "Demo"/);
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

describe("REQ-153 AMENDMENT — the same element on both screens", () => {
  type Node = ElLike & { kids: Node[] };
  const node = (
    tagName: string,
    attrs: Record<string, string>,
    parent: Node | null,
  ): Node => {
    const n: Node = {
      tagName,
      id: attrs.id ?? "",
      getAttribute: (k: string) => attrs[k] ?? null,
      parentElement: parent,
      kids: [],
      get children() {
        return n.kids;
      },
    };
    if (parent) parent.kids.push(n);
    return n;
  };

  test("a segment carries the element's first class and counts only siblings of the same tag and class; overlay and skip-marked siblings never count", () => {
    const body = node("BODY", {}, null);
    node("DIV", { "data-demo-skip": "" }, body); // the impersonation banner — the staff side only
    node("DIV", { "data-demo-overlay": "" }, body); // the demo overlay itself
    const app = node("DIV", { class: "app-shell app-shell--wide" }, body);
    const main = node("MAIN", {}, app);
    node("DIV", { class: "card" }, main);
    const composer = node("DIV", { class: "asst__composer" }, main);
    node("BUTTON", { class: "asst__mic" }, composer);
    const send = node("BUTTON", { class: "asst__send" }, composer);
    expect(selectorFor(send)).toBe(
      "body > div.app-shell:nth-of-type(1) > main:nth-of-type(1) > div.asst__composer:nth-of-type(1) > button.asst__send:nth-of-type(1)",
    );
    // the same tree without the banner and the overlay — the customer's side — gives the SAME selector
    const body2 = node("BODY", {}, null);
    const app2 = node("DIV", { class: "app-shell" }, body2);
    const main2 = node("MAIN", {}, app2);
    node("DIV", { class: "card" }, main2);
    const composer2 = node("DIV", { class: "asst__composer" }, main2);
    node("BUTTON", { class: "asst__mic" }, composer2);
    const send2 = node("BUTTON", { class: "asst__send" }, composer2);
    expect(selectorFor(send2)).toBe(selectorFor(send));
    // a modifier class (second token) does not enter the segment — a collapsed sidebar is still the sidebar
    expect(selectorFor(app)).toBe("body > div.app-shell:nth-of-type(1)");
  });

  test("parseSelector and walkSelector resolve the path with the same counting on a tree that has the banner", () => {
    const body = node("BODY", {}, null);
    node("DIV", { "data-demo-skip": "" }, body);
    const app = node("DIV", { class: "app-shell" }, body);
    const footer = node("FOOTER", { class: "site-footer" }, app);
    const nav = node("NAV", {}, footer);
    node("A", {}, nav);
    const privacy = node("A", {}, nav);
    const sel = selectorFor(privacy);
    expect(sel).toBe(
      "body > div.app-shell:nth-of-type(1) > footer.site-footer:nth-of-type(1) > nav:nth-of-type(1) > a:nth-of-type(2)",
    );
    const parsed = parseSelector(sel);
    expect(parsed).toEqual({
      root: "body",
      segs: [
        { tag: "div", cls: "app-shell", n: 1 },
        { tag: "footer", cls: "site-footer", n: 1 },
        { tag: "nav", cls: null, n: 1 },
        { tag: "a", cls: null, n: 2 },
      ],
    });
    expect(walkSelector(body, parsed!.segs)).toBe(privacy);
    expect(parseSelector("#app > ul:nth-of-type(1)")).toEqual({
      root: "#app",
      segs: [{ tag: "ul", cls: null, n: 1 }],
    });
    expect(parseSelector('[data-cy="save"]')).toEqual({
      root: '[data-cy="save"]',
      segs: [],
    });
    expect(parseSelector("div[onclick=x]")).toBeNull();
    // a path that leads nowhere is null, not a wrong element
    expect(walkSelector(body, [{ tag: "div", cls: "app-shell", n: 2 }]))
      .toBeNull();
  });

  test("the banner is marked so it never counts, and the resolver walks the path before trusting querySelector", () => {
    const banner = read("front-end/islands/ImpersonationBanner.tsx");
    expect(banner).toMatch(/data-demo-skip/);
    // REQ-188: the selector names scrolled elements now; the resolver lives in the replica lib
    const lib = read("front-end/lib/demo-mode/replica.ts");
    expect(lib).toMatch(/parseSelector\(/);
    expect(lib).toMatch(/walkSelector\(/);
    // the pointer's name tag flips to the left near the right edge, so it is never cut off
    const pointer = read("front-end/components/demo-mode/DemoPointer.tsx");
    expect(pointer).toMatch(/const flip = /);
  });
});
