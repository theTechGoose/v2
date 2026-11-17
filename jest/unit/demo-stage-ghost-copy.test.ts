/**
 * REQ-540 — demo-loop cycle 4, issue m9: the stage's copy of the customer's pill differed from
 * the pill. The ghost said "Alex is guiding you · Connected" while the pill said "Demo mode ·
 * Alex is guiding you · Connected · End demo" (ghostWords carried no title and no End), and on
 * every page change of the customer the ghost went blank (onPeerOnline dropped the box and the
 * face) and came back saying "Connected" — the customer's "Connecting…" moment never reached the
 * stage (it can only be sent over the very link it describes).
 *
 * The ghost now draws the whole pill: the "Demo mode" title (when the pill shows it — not on the
 * compact phone pill), the line, the guide, the status and End as a disabled chip — the title and
 * End in the CUSTOMER's words when their pill sent them (REQ-430's rule for the status). After
 * each onPeerOnline it keeps the box and says "Connecting…" until the new page's pill speaks.
 */
import * as fs from "fs";
import * as path from "path";
import {
  ghostWords,
  PILL_LABEL_MAX,
  pillFaceAwaiting,
} from "../../shared/demo-mode/pill.ts";
import { parsePeerMessage } from "../../shared/demo-mode/protocol.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
/** the presenter's (English) dictionary, by key */
const t = (k: string) => `en:${k}`;

describe("REQ-540 (demo-loop cycle 4, m9) — the stage's ghost says the whole pill", () => {
  test("a desktop pill: title, line, status and End — in the customer's words", () => {
    const w = ghostWords(
      {
        status: "live",
        label: "Conectado",
        text: "Alex te está guiando",
        title: "Modo demo",
        end: "Terminar demo",
      },
      t,
    );
    expect(w.title).toBe("Modo demo");
    expect(w.text).toBe("Alex te está guiando");
    expect(w.status).toBe("Conectado");
    expect(w.end).toBe("Terminar demo");
  });

  test("an older page (no title / End words) still gets them, in the stage's words", () => {
    const w = ghostWords({ status: "live", text: "Alex is guiding you" }, t);
    expect(w.title).toBe("en:demoMode.title");
    expect(w.end).toBe("en:demoMode.end");
  });

  test("the compact phone pill shows no title (as on the phone), but End stays", () => {
    const closed = ghostWords(
      { compact: true, open: false, status: "live", guide: "Alex" },
      t,
    );
    expect(closed.title).toBeUndefined();
    expect(closed.end).toBe("en:demoMode.end");
    const open = ghostWords(
      {
        compact: true,
        open: true,
        status: "live",
        text: "Alex is guiding you",
      },
      t,
    );
    expect(open.title).toBeUndefined();
    expect(open.end).toBe("en:demoMode.end");
  });

  test("an ended pill has no End; a pill never heard says nothing", () => {
    expect(ghostWords({ status: "ended" }, t).end).toBeUndefined();
    expect(ghostWords({}, t)).toEqual({
      title: undefined,
      text: undefined,
      guide: undefined,
      status: undefined,
      end: undefined,
    });
  });

  test("a new page joined: the ghost says Connecting… until its pill speaks (never blank, never a stale Connected)", () => {
    const live = {
      status: "live" as const,
      label: "Conectado",
      text: "Alex te está guiando",
      title: "Modo demo",
      end: "Terminar demo",
    };
    const waiting = pillFaceAwaiting(live);
    expect(waiting.status).toBe("connecting");
    expect(waiting.label).toBeUndefined();
    expect(ghostWords(waiting, t).status).toBe("en:demoMode.connecting");
    // the rest of the pill is still drawn
    expect(ghostWords(waiting, t).title).toBe("Modo demo");
    expect(ghostWords(waiting, t).end).toBe("Terminar demo");
    // no pill heard yet: still a status, not a blank
    expect(pillFaceAwaiting({}).status).toBe("connecting");
    // a demo that ended stays ended
    expect(pillFaceAwaiting({ status: "ended" }).status).toBe("ended");
  });

  test("the pill message carries the title and End words, checked and capped", () => {
    const r = { left: 12, top: 790, width: 320, height: 40 };
    expect(
      parsePeerMessage({ k: "pill", r, title: "Modo demo", end: "Terminar" }),
    ).toEqual({ k: "pill", r, title: "Modo demo", end: "Terminar" });
    expect(parsePeerMessage({ k: "pill", r, title: 3, end: {} })).toEqual({
      k: "pill",
      r,
    });
    const long = parsePeerMessage({
      k: "pill",
      r,
      title: "x".repeat(500),
      end: "y".repeat(500),
    });
    expect(long && long.k === "pill" && long.title!.length).toBe(
      PILL_LABEL_MAX,
    );
    expect(long && long.k === "pill" && long.end!.length).toBe(PILL_LABEL_MAX);
  });

  test("the overlay sends its title and End words with the face", () => {
    const o = read("front-end/islands/DemoModeOverlay.tsx");
    const send = o.slice(o.indexOf("const sendPill = () => {"));
    const body = send.slice(0, send.indexOf("sendPillRef.current = sendPill;"));
    expect(body).toMatch(/\btitle: f\.title\b/);
    expect(body).toMatch(/\bend: f\.end\b/);
    expect(o).toMatch(/title: t\("demoMode\.title"\)/);
    expect(o).toMatch(/end: t\("demoMode\.end"\)/);
  });

  test("the stage draws the title and a disabled End chip, and keeps the ghost on a page change", () => {
    const s = read("front-end/islands/DemoStage.tsx");
    expect(s).toMatch(/data-cy="demo-pill-ghost-title"/);
    expect(s).toMatch(/data-cy="demo-pill-ghost-end"/);
    expect(s).toMatch(/aria-disabled="true"/);
    // REQ-645 AMENDMENT (demo-loop cycle 5, m36) — onPeerOnline also hears the browser tab's key
    const on = s.slice(s.indexOf("onPeerOnline: (cid"));
    const body = on.slice(0, on.indexOf("onPeer: (m"));
    expect(body).not.toMatch(/setPillBox\(null\)/);
    expect(body).not.toMatch(/setPillFace\(\{\}\)/);
    expect(body).toMatch(/setPillFace\(\(f\) => pillFaceAwaiting\(f\)\)/);
  });
});
