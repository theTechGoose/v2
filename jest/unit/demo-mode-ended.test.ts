/**
 * REQ-235 — the end of a demo is said on both sides and stays; End asks first (the 20-agent
 * demo's issue demo-lifecycle-m2: "No lasting 'demo ended' message on either side, and End has
 * no confirmation"). Who ended it rides the wire; each side says it in its own words; a stage's
 * notice rides the hop to /admin and leaves the address once read; End's question arms after a
 * beat; both dictionaries carry the lines; the islands are wired.
 *
 * REQ-300 (demo cycle 1, M4 + M20) — the question no longer cancels itself: it stays up until
 * answered, Escape, or a click outside the pill; the pill's box is frozen while it is up; an open
 * dialog's backdrop blocks every slot; the New customer dialog keeps a dirty draft on a backdrop
 * click.
 */
import * as fs from "fs";
import * as path from "path";
import {
  ADMIN_PATH,
  END_ARM_MS,
  type EndAsk,
  endConfirm,
  endedHref,
  type EndedNotice,
  endedText,
  NAME_MAX,
  readEndedNotice,
  whoEnded,
} from "../../shared/demo-mode/ended.ts";
import { parseServerMessage } from "../../shared/demo-mode/protocol.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

const hans = { userId: "u-hans", name: "Hans", color: "#2f6d29" };
const lia = { userId: "u-lia", name: "Lia", color: "#1f5fa8" };

describe("REQ-235 who ended it rides the wire", () => {
  test("an end a presenter caused carries their pid; the customer's never does", () => {
    expect(
      parseServerMessage('{"t":"ended","by":"presenter","pid":"u-hans"}'),
    ).toStrictEqual({ t: "ended", by: "presenter", pid: "u-hans" });
    expect(
      parseServerMessage('{"t":"ended","by":"viewer","pid":"u-hans"}'),
    ).toStrictEqual({ t: "ended", by: "viewer" });
    expect(parseServerMessage('{"t":"ended","by":"presenter"}'))
      .toStrictEqual({ t: "ended", by: "presenter" });
    expect(parseServerMessage('{"t":"ended","by":"presenter","pid":""}'))
      .toStrictEqual({ t: "ended", by: "presenter" });
    // the earlier forms still parse as they did
    expect(
      parseServerMessage('{"t":"ended","by":"viewer","reason":"declined"}'),
    ).toStrictEqual({ t: "ended", by: "viewer", reason: "declined" });
  });
});

describe("REQ-235 who ended it, as each side says it", () => {
  const customer = (presenters = [hans, lia], presenterName = "") => ({
    role: "viewer" as const,
    presenters,
    presenterName,
  });
  const stage = {
    role: "presenter" as const,
    pid: "u-hans",
    presenters: [hans, lia],
    targetName: "Ana Torres",
  };

  test("the customer: the presenter by name, their own End as you, nobody nameable as the plain line", () => {
    expect(whoEnded({ by: "presenter", pid: "u-lia" }, customer()))
      .toEqual({ by: "other", name: "Lia" });
    expect(whoEnded({ by: "viewer" }, customer())).toEqual({ by: "you" });
    // no pid (a server before REQ-235): the one presenter is the one who ended it
    expect(whoEnded({ by: "presenter" }, customer([hans])))
      .toEqual({ by: "other", name: "Hans" });
    // … two presenters and no pid: nobody can be named
    expect(whoEnded({ by: "presenter" }, customer()))
      .toEqual({ by: "unknown" });
    // a demo written before the presenter list (REQ-214) names its opener
    expect(whoEnded({ by: "presenter" }, customer([], "Hans")))
      .toEqual({ by: "other", name: "Hans" });
    // a pid the roster does not know
    expect(whoEnded({ by: "presenter", pid: "u-zed" }, customer()))
      .toEqual({ by: "unknown" });
  });

  test("a stage: the customer by name, a colleague by name, this presenter (any window) as you", () => {
    expect(whoEnded({ by: "viewer" }, stage))
      .toEqual({ by: "other", name: "Ana Torres" });
    expect(whoEnded({ by: "presenter", pid: "u-lia" }, stage))
      .toEqual({ by: "other", name: "Lia" });
    expect(whoEnded({ by: "presenter", pid: "u-hans" }, stage))
      .toEqual({ by: "you" });
    // alone on the demo and no pid: it was this presenter
    expect(whoEnded({ by: "presenter" }, { ...stage, presenters: [hans] }))
      .toEqual({ by: "you" });
    expect(whoEnded({ by: "presenter" }, stage)).toEqual({ by: "unknown" });
    expect(whoEnded({ by: "viewer" }, { ...stage, targetName: "  " }))
      .toEqual({ by: "unknown" });
  });

  test("the line each says, from the dictionaries, in both languages", () => {
    expect(endedText({ by: "you" })).toEqual({ key: "demoMode.endedByYou" });
    expect(endedText({ by: "other", name: "Lia" })).toEqual({
      key: "demoMode.endedBy",
      vars: { name: "Lia" },
    });
    expect(endedText({ by: "unknown" })).toEqual({ key: "demoMode.ended" });
    const keys = [
      "endedBy",
      "endedByYou",
      "ended",
      "endAsk",
      "endYes",
      "endNo",
      "dismiss",
    ];
    for (const k of keys) {
      expect(typeof en[`demoMode.${k}`]).toBe("string");
      expect(typeof es[`demoMode.${k}`]).toBe("string");
      expect(en[`demoMode.${k}`]).not.toBe(es[`demoMode.${k}`]);
    }
    expect(en["demoMode.endedBy"]).toBe("{name} ended the demo");
    expect(es["demoMode.endedBy"]).toContain("{name}");
    expect(en["demoMode.endedByYou"]).toBe("You ended the demo");
    expect(en["demoMode.endAsk"]).toBe("End for everyone?");
  });
});

describe("REQ-235 a stage's notice rides the hop to /admin, read once", () => {
  test("each notice makes an /admin address that reads back the same, nothing left over", () => {
    const notices: EndedNotice[] = [
      { by: "you" },
      { by: "other", name: "Ana Torres" },
      { by: "other", name: "José Ñañez & Hijos / ?#=+" },
      { by: "unknown" },
    ];
    for (const n of notices) {
      const href = endedHref(n);
      const url = new URL(href, "https://documonster.test");
      expect(href.startsWith(`${ADMIN_PATH}?`)).toBe(true);
      expect(url.pathname).toBe("/admin");
      expect(readEndedNotice(url.search)).toEqual({ notice: n, rest: "" });
    }
  });

  test("the page's own parameters stay; a page without the notice says nothing; junk is the plain line; a name is cut", () => {
    expect(readEndedNotice("?q=ana&demo=ended&by=you")).toEqual({
      notice: { by: "you" },
      rest: "?q=ana",
    });
    expect(readEndedNotice("")).toBeNull();
    expect(readEndedNotice("?q=ana")).toBeNull();
    expect(readEndedNotice("?demo=started&by=you")).toBeNull();
    expect(readEndedNotice("?demo=ended&by=nobody")).toEqual({
      notice: { by: "unknown" },
      rest: "",
    });
    expect(readEndedNotice("?demo=ended&by=other&name=%20%20")).toEqual({
      notice: { by: "unknown" },
      rest: "",
    });
    const long = "A".repeat(200);
    expect(readEndedNotice(`?demo=ended&by=other&name=${long}`)).toEqual({
      notice: { by: "other", name: "A".repeat(NAME_MAX) },
      rest: "",
    });
    expect(NAME_MAX).toBe(80);
    expect(
      new URL(
        endedHref({ by: "other", name: long }),
        "https://documonster.test",
      ).searchParams.get("name"),
    ).toBe("A".repeat(NAME_MAX));
  });
});

describe("REQ-235 End asks first", () => {
  /** a hand-driven clock, as REQ-180's throttle test */
  function harness() {
    let now = 0;
    const timers: Array<{ fn: () => void; due: number; live: boolean }> = [];
    const states: EndAsk[] = [];
    let ended = 0;
    const ask = endConfirm({
      onChange: (s) => states.push(s),
      onEnd: () => void ended++,
      setTimer: (fn, ms) => {
        const h = { fn, due: now + ms, live: true };
        timers.push(h);
        return h;
      },
      clearTimer: (h) => {
        (h as { live: boolean }).live = false;
      },
    });
    const tick = (to: number) => {
      now = to;
      for (const t of timers) {
        if (t.live && t.due <= now) {
          t.live = false;
          t.fn();
        }
      }
    };
    return {
      ask,
      tick,
      last: () => states[states.length - 1],
      ended: () => ended,
      live: () => timers.filter((t) => t.live).length,
    };
  }

  test("the first click asks; Yes counts only once armed, ends once, and End comes back", () => {
    const h = harness();
    h.ask.ask();
    expect(h.last()).toEqual({ asking: true, armed: false });
    // the second click of a double click lands on a Yes that is not armed yet
    h.ask.confirm();
    expect(h.ended()).toBe(0);
    h.tick(END_ARM_MS - 1);
    h.ask.confirm();
    expect(h.ended()).toBe(0);
    h.tick(END_ARM_MS);
    expect(h.last()).toEqual({ asking: true, armed: true });
    h.ask.confirm();
    expect(h.ended()).toBe(1);
    expect(h.last()).toEqual({ asking: false, armed: false });
    h.ask.confirm();
    expect(h.ended()).toBe(1);
    // nothing left ticking: the question never comes back on its own
    h.tick(END_ARM_MS * 100);
    expect(h.last()).toEqual({ asking: false, armed: false });
    expect(h.live()).toBe(0);
  });

  test("Keep going puts End back and ends nothing", () => {
    const h = harness();
    h.ask.ask();
    h.tick(END_ARM_MS);
    h.ask.cancel();
    expect(h.last()).toEqual({ asking: false, armed: false });
    h.ask.confirm();
    expect(h.ended()).toBe(0);
    expect(h.live()).toBe(0);
  });

  // REQ-300 (demo cycle 1, M4): the agents and a reading human took longer than the 4 s the
  // question used to wait — Yes then found the question gone and End did nothing
  test("REQ-300 left unanswered, the question stays up (no clock) until Keep going", () => {
    const h = harness();
    h.ask.ask();
    h.tick(END_ARM_MS * 100);
    expect(h.last()).toEqual({ asking: true, armed: true });
    expect(h.ended()).toBe(0);
    // only the arm was ever ticking
    expect(h.live()).toBe(0);
    h.ask.confirm();
    expect(h.ended()).toBe(1);
    expect(h.last()).toEqual({ asking: false, armed: false });
  });

  test("REQ-300 no self-cancel is exported; the arm is shorter than a deliberate click, longer than a double click's second", () => {
    const mod = require("../../shared/demo-mode/ended.ts") as Record<
      string,
      unknown
    >;
    expect(mod.END_ASK_MS).toBeUndefined();
    expect(END_ARM_MS).toBeGreaterThanOrEqual(300);
    expect(END_ARM_MS).toBeLessThanOrEqual(600);
  });
});

describe("REQ-300 the question stays put and the pill under it stays still", () => {
  test("End's question cancels on a click outside the pill, not on a clock", () => {
    const comp = read("front-end/components/demo-mode/EndDemo.tsx");
    expect(comp).not.toMatch(/END_ASK_MS/);
    // a pointerdown anywhere outside the group puts End back
    expect(comp).toMatch(
      /document\.addEventListener\(\s*"pointerdown"/,
    );
    expect(comp).toMatch(/data-cy="demo-end-ask"/);
  });

  test("the overlay never re-places the pill while the question is up", () => {
    const island = read("front-end/islands/DemoModeOverlay.tsx");
    // place() bails when the ask group is drawn in the pill
    expect(island).toMatch(
      /querySelector\(\s*['"]\[data-cy=["']?demo-end-ask["']?\]['"]\s*\)/,
    );
  });

  test("an open dialog's backdrop under a slot counts as blocking", () => {
    const { coversView } = require("../../shared/demo-mode/pill.ts") as {
      coversView: (
        r: { left: number; top: number; width: number; height: number },
        view: { w: number; h: number },
      ) => boolean;
    };
    const view = { w: 1280, h: 800 };
    expect(coversView({ left: 0, top: 0, width: 1280, height: 800 }, view))
      .toBe(true);
    // a hair of rounding still covers
    expect(coversView({ left: 0.4, top: 0, width: 1279.5, height: 800 }, view))
      .toBe(true);
    // a card, a sidebar, a header: not a backdrop
    expect(coversView({ left: 0, top: 0, width: 1280, height: 64 }, view))
      .toBe(false);
    expect(coversView({ left: 0, top: 0, width: 280, height: 800 }, view))
      .toBe(false);
    const island = read("front-end/islands/DemoModeOverlay.tsx");
    expect(island).toMatch(/coversView\(/);
  });
});

describe("REQ-235 the islands are wired", () => {
  test("the transport hands onEnded who ended it", () => {
    const tr = read("front-end/lib/demo-mode/transport.ts");
    expect(tr).toMatch(
      /onEnded\(by: Role, reason\?: "declined" \| "expired", pid\?: string\): void/,
    );
    expect(tr).toMatch(/o\.onEnded\(m\.by, m\.reason, m\.pid\)/);
  });

  test("one End component asks first; both pills draw it and none ends on one click", () => {
    const comp = read("front-end/components/demo-mode/EndDemo.tsx");
    for (
      const cy of [
        "demo-end",
        "demo-end-ask",
        "demo-end-confirm",
        "demo-end-cancel",
      ]
    ) {
      expect(comp).toContain(`data-cy="${cy}"`);
    }
    for (const k of ["end", "endYes", "endNo"]) {
      expect(comp).toContain(`t("demoMode.${k}")`);
    }
    // REQ-649 — the question is the caller's; the stage's default stays "End for everyone?"
    expect(comp).toContain('askKey = "demoMode.endAsk"');
    expect(comp).toContain("t(askKey, askVars)");
    expect(comp).toMatch(/endConfirm\(/);
    expect(comp).toMatch(/disabled=\{!s\.armed\}/);
    for (
      const island of [
        read("front-end/islands/DemoModeOverlay.tsx"),
        read("front-end/islands/DemoStage.tsx"),
      ]
    ) {
      expect(island).toMatch(
        /import EndDemo from "\.\.\/components\/demo-mode\/EndDemo\.tsx"/,
      );
      expect(island).toMatch(/<EndDemo\b/);
      expect(island).not.toMatch(/onClick=\{end\}/);
    }
  });

  test("the customer's pill turns into the notice: who ended it, dismissible; /admin reads a stage's notice once", () => {
    const overlay = read("front-end/islands/DemoModeOverlay.tsx");
    expect(overlay).toContain('data-cy="demo-ended"');
    expect(overlay).toContain('data-cy="demo-ended-dismiss"');
    expect(overlay).toContain('t("demoMode.dismiss")');
    expect(overlay).toMatch(/whoEnded\(/);
    expect(overlay).toMatch(/endedText\(/);
    expect(overlay).toMatch(/readEndedNotice\(/);
    expect(overlay).toMatch(/history\.replaceState\(/);
    expect(overlay).toMatch(/ADMIN_PATH/);
  });

  test("a stage says who ended it on its hop to /admin", () => {
    const stage = read("front-end/islands/DemoStage.tsx");
    expect(stage).toMatch(/whoEnded\(/);
    expect(stage).toMatch(/location\.href = endedHref\(/);
  });
});
