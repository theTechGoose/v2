/**
 * REQ-430 — demo-loop cycle 3, issue m4: the stage's copy of the customer's pill said an English
 * "Connected" next to the customer's Spanish line (the status was the PRESENTER's words), it kept
 * saying "Connected" while the customer's app was gone (the frozen frame), and a compact, closed
 * phone pill showed only a status on the stage — not the guide's short name the phone shows. The
 * ghost now says the status in the CUSTOMER's words (the overlay sends its translated label, like
 * `text`), drops to "Connecting" (the stage's words) the moment the link is down, and on a compact
 * closed phone pill shows the guide's short name.
 */
import * as fs from "fs";
import * as path from "path";
import {
  ghostWords,
  PILL_LABEL_MAX,
  pillFaceOffline,
} from "../../shared/demo-mode/pill.ts";
import { parsePeerMessage } from "../../shared/demo-mode/protocol.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
/** the presenter's (English) dictionary, by key */
const t = (k: string) => `en:${k}`;

describe("REQ-430 (demo-loop cycle 3, m4) — the stage's pill ghost says what the customer's pill says", () => {
  test("the status is the customer's own label when the pill sent one (never the stage's English)", () => {
    const w = ghostWords(
      {
        status: "live",
        label: "Conectado",
        text: "Hans te está guiando",
      },
      t,
    );
    expect(w.status).toBe("Conectado");
    expect(w.text).toBe("Hans te está guiando");
    expect(w.guide).toBeUndefined();
  });

  test("an older page (no label) still gets a status, in the stage's words", () => {
    expect(ghostWords({ status: "live" }, t).status).toBe(
      "en:demoMode.connected",
    );
    expect(ghostWords({}, t).status).toBeUndefined();
  });

  test("a compact, closed phone pill: no line, the guide's short name instead (as on the phone)", () => {
    const closed = ghostWords(
      {
        compact: true,
        open: false,
        status: "live",
        label: "Conectado",
        text: "Hans te está guiando",
        guide: "Hans",
      },
      t,
    );
    expect(closed.text).toBeUndefined();
    expect(closed.guide).toBe("Hans");
    const open = ghostWords(
      {
        compact: true,
        open: true,
        status: "live",
        label: "Conectado",
        text: "Hans te está guiando",
        guide: "Hans",
      },
      t,
    );
    expect(open.text).toBe("Hans te está guiando");
    expect(open.guide).toBeUndefined();
  });

  test("the customer's app dropped: the frozen ghost no longer says Connected", () => {
    const live = {
      compact: true,
      open: false,
      status: "live" as const,
      label: "Conectado",
      text: "Hans te está guiando",
      guide: "Hans",
    };
    const down = pillFaceOffline(live, "waiting");
    expect(down.status).toBe("connecting");
    expect(down.label).toBeUndefined();
    expect(ghostWords(down, t).status).toBe("en:demoMode.connecting");
    expect(down.guide).toBe("Hans");
    expect(pillFaceOffline(live, "ended").status).toBe("ended");
    // no pill heard yet: nothing to say
    expect(pillFaceOffline({}, "waiting")).toEqual({});
  });

  test("the pill message carries the label and the guide's short name, checked and capped", () => {
    const r = { left: 12, top: 790, width: 320, height: 40 };
    expect(
      parsePeerMessage({
        k: "pill",
        r,
        status: "live",
        label: "Conectado",
        guide: "Hans",
      }),
    ).toEqual({
      k: "pill",
      r,
      status: "live",
      label: "Conectado",
      guide: "Hans",
    });
    expect(parsePeerMessage({ k: "pill", r, label: 3, guide: {} })).toEqual({
      k: "pill",
      r,
    });
    const long = parsePeerMessage({
      k: "pill",
      r,
      label: "x".repeat(500),
      guide: "y".repeat(500),
    });
    expect(long && long.k === "pill" && long.label!.length).toBe(
      PILL_LABEL_MAX,
    );
    expect(long && long.k === "pill" && long.guide!.length).toBe(
      PILL_LABEL_MAX,
    );
  });

  test("the overlay sends its translated status and the guide's short name with the face", () => {
    const o = read("front-end/islands/DemoModeOverlay.tsx");
    const send = o.slice(o.indexOf("const sendPill = () => {"));
    const body = send.slice(0, send.indexOf("sendPillRef.current = sendPill;"));
    expect(body).toMatch(/\blabel: f\.label\b/);
    expect(body).toMatch(/\bguide: f\.guide\b/);
    expect(o).toMatch(/label: statusLabel/);
    expect(o).toMatch(/guide: showGuide \? copy\.shortName : undefined/);
  });

  test("the stage words the ghost with ghostWords and resets the face when the link drops", () => {
    const s = read("front-end/islands/DemoStage.tsx");
    expect(s).toMatch(/ghostWords\(pillFace, t\)/);
    expect(s).toMatch(/data-cy="demo-pill-ghost-guide"/);
    const on = s.slice(s.indexOf("onStatus: (s) => {"));
    const body = on.slice(0, on.indexOf("onPeerOnline:"));
    expect(body).toMatch(/setPillFace\(\(f\) => pillFaceOffline\(f, s\)\)/);
  });
});
