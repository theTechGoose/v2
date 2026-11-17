/**
 * REQ-875 — demo-loop cycle dm5 (run r38fa8936), issue p4: the customer closed her only tab and
 * the stage's copy of her pill said "Connecting…" for the whole SILENT_GRACE_MS hold (REQ-838 m5)
 * before "Waiting for {name}'s app…", while the stage's own chrome said "Loading their next
 * page…". Nothing was connecting: pillFaceOffline mapped the link's "between" to "connecting".
 * During "between" the ghost keeps its last face (title, line, End) and says no status word —
 * neither a stale "Connected" (REQ-430) nor a "Connecting…" that is not happening.
 */
import * as fs from "fs";
import * as path from "path";
import {
  ghostWords,
  pillFaceAwaiting,
  pillFaceOffline,
} from "../../shared/demo-mode/pill.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
/** the presenter's dictionary, by key */
const t = (k: string) => `stage:${k}`;

/** the customer's English pill as her overlay sends it */
const live = {
  status: "live" as const,
  label: "Connected",
  text: "DocuMonster is guiding you",
  title: "Demo mode",
  end: "End demo",
  connectingLabel: "Connecting…",
  endedLabel: "The demo ended",
};

describe("REQ-875 (demo-loop cycle dm5, p4) — her page is between (the 2 s hold): the ghost never says 'Connecting…'", () => {
  test("pillFaceOffline(face, 'between') never gives 'connecting'", () => {
    const held = pillFaceOffline(live, "between");
    expect(held.status).not.toBe("connecting");
    const w = ghostWords(held, t);
    expect(w.status).toBeUndefined();
    expect(JSON.stringify(w)).not.toMatch(/Connecting|connecting/);
    // nor the stale "Connected" (REQ-430)
    expect(JSON.stringify(w)).not.toContain("Connected");
  });

  test("the rest of her pill stays as it was (title, line, End) — the ghost is not blanked", () => {
    const w = ghostWords(pillFaceOffline(live, "between"), t);
    expect(w).toMatchObject({
      title: "Demo mode",
      text: "DocuMonster is guiding you",
      end: "End demo",
    });
  });

  test("a face the stage was already guessing as connecting (a page joining) also goes quiet when that page goes", () => {
    const joining = pillFaceAwaiting(live);
    expect(ghostWords(joining, t).status).toBe("Connecting…");
    const held = pillFaceOffline(joining, "between");
    // the guess is not turned into a new "connecting": it is held, and says no word
    expect(held.held).toBe(true);
    expect(ghostWords(held, t).status).toBeUndefined();
  });

  test("a page from before (no carried words) is quiet too — never the stage's 'Connecting'", () => {
    const old = { status: "live" as const, label: "Conectado", text: "Hans" };
    expect(ghostWords(pillFaceOffline(old, "between"), t).status)
      .toBeUndefined();
  });

  test("the hold runs out (waiting): 'Connecting…' in her words, as before (REQ-430 / REQ-838)", () => {
    const held = pillFaceOffline(live, "between");
    const down = pillFaceOffline(held, "waiting");
    expect(down.status).toBe("connecting");
    expect(ghostWords(down, t).status).toBe("Connecting…");
    // her next page joins instead: its own guess, in her words
    expect(ghostWords(pillFaceAwaiting(held), t).status).toBe("Connecting…");
  });

  test("an ended demo stays ended through a hold; no pill heard: nothing changes", () => {
    const ended = pillFaceOffline(live, "ended");
    expect(ghostWords(pillFaceOffline(ended, "between"), t).status).toBe(
      "The demo ended",
    );
    expect(pillFaceOffline({}, "between")).toEqual({});
  });

  test("the folded-tab ghost's dot is not the live green while held", () => {
    const src = read("front-end/islands/DemoStage.tsx");
    expect(src).toMatch(
      /pillFace\.status === "live" && !pillFace\.held\s*\?\s*"#7ee081"/,
    );
  });
});
