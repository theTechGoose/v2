/**
 * REQ-646 — demo-loop cycle 5, issue m63: after a second window of the same staff account takes
 * the demo over, the first (inactive) window contradicted its own "This demo moved to another
 * window" banner:
 *  - the presenter's pointer ghost still said "Your pointer on {name}'s screen" (the `replaced`
 *    branch never dropped it, and PointerGhost / pointer-off / pointer-absent had no elsewhere guard);
 *  - the customer-pill ghost froze on "Connecting…" (pillFaceOffline mapped `replaced` to
 *    connecting);
 *  - the status chip said "Open in another window" in the same chip style as a button, next to
 *    the real "Use this window" button.
 */
import * as fs from "fs";
import * as path from "path";
import { ghostWords, pillFaceOffline } from "../../shared/demo-mode/pill.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const t = (k: string) => `en:${k}`;
const stage = read("front-end/islands/DemoStage.tsx");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

/** the JSX block a `{cond && (` opener starts, up to its data-cy */
const guardOf = (dataCyOrTag: string) => {
  const at = stage.indexOf(dataCyOrTag);
  expect(at).toBeGreaterThan(-1);
  const open = stage.lastIndexOf("{mirrored", at);
  return stage.slice(open, stage.indexOf("(", open));
};

describe("REQ-646 (demo-loop cycle 5, m63) — an inactive stage window says only that it is elsewhere", () => {
  test("REQ-646 the replaced branch of onStatus drops the presenter's pointer (ghost + absent)", () => {
    const on = stage.slice(stage.indexOf("onStatus: (s) => {"));
    const body = on.slice(0, on.indexOf("onPeerOnline:"));
    const replaced = body.slice(body.indexOf('if (s === "replaced") {'));
    const branch = replaced.slice(0, replaced.indexOf("\n        }"));
    expect(branch).toMatch(/\bdrop\(\);/);
  });

  test("REQ-646 PointerGhost, pointer-off and pointer-absent are not drawn while elsewhere", () => {
    expect(guardOf("<PointerGhost")).toMatch(/!look\.elsewhere/);
    expect(guardOf('data-cy="demo-pointer-off"')).toMatch(/!look\.elsewhere/);
    expect(guardOf('data-cy="demo-pointer-absent"')).toMatch(
      /!look\.elsewhere/,
    );
  });

  test("REQ-646 the customer-pill ghost (open and tucked) is not drawn while elsewhere", () => {
    let from = 0;
    let n = 0;
    for (;;) {
      const at = stage.indexOf('data-cy="demo-pill-ghost"', from);
      if (at < 0) break;
      const open = stage.lastIndexOf("{mirrored", at);
      expect(stage.slice(open, stage.indexOf("(", open))).toMatch(
        /\bpillShown &&/,
      );
      from = at + 1;
      n++;
    }
    expect(n).toBe(2);
    // pillShown is the customer's pill box, or nothing while another window has the demo
    expect(stage).toMatch(
      /const pillShown = look\.elsewhere \? null : pillBox;/,
    );
  });

  test("REQ-646 pillFaceOffline on 'replaced' never says Connecting", () => {
    const live = {
      status: "live" as const,
      label: "Conectado",
      text: "Hans te está guiando",
    };
    const face = pillFaceOffline(live, "replaced");
    expect(face.status).not.toBe("connecting");
    expect(ghostWords(face, t).status).not.toBe("en:demoMode.connecting");
    // the other drops keep REQ-430's words
    expect(pillFaceOffline(live, "waiting").status).toBe("connecting");
    expect(pillFaceOffline(live, "ended").status).toBe("ended");
  });

  test("REQ-646 the elsewhere status is plain wording, en and es — never 'Open …' (reads like a button)", () => {
    expect(en["demoMode.elsewhere"]).toBe("In another window");
    expect(es["demoMode.elsewhere"]).toBe("En otra ventana");
  });

  test("REQ-646 the elsewhere status is drawn as plain text, not in the chip style", () => {
    const at = stage.indexOf('data-cy="demo-status"');
    const tag = stage.slice(at, stage.indexOf(">", at));
    expect(tag).toMatch(/live\.key === "elsewhere"/);
  });
});
