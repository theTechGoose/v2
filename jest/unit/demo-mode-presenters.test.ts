/**
 * REQ-214 — several staff present at once, each with a name and a colour of their own: the
 * palette is distinct and never the customer's orange, `nextColor` hands out the first free one,
 * every presenter message is stamped `pid`, a presenter can address colleagues only, the
 * viewer's signal can address one presenter, the dictionaries carry the plural strings, and the
 * two islands draw one pointer per presenter.
 */
import * as fs from "fs";
import * as path from "path";
import {
  CUSTOMER_COLOR,
  nextColor,
  parseClientMessage,
  parseServerMessage,
  PRESENTER_COLORS,
} from "../../shared/demo-mode/protocol";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-214 presenter colours", () => {
  test("the palette has at least six distinct hex colours, none the customer's orange, the first the demo's green", () => {
    expect(PRESENTER_COLORS.length).toBeGreaterThanOrEqual(6);
    expect(new Set(PRESENTER_COLORS).size).toBe(PRESENTER_COLORS.length);
    for (const c of PRESENTER_COLORS) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    expect(PRESENTER_COLORS).not.toContain(CUSTOMER_COLOR);
    expect(PRESENTER_COLORS[0]).toBe("#2f6d29");
  });

  test("nextColor hands out the first colour nobody in the demo has; all taken, it starts over", () => {
    const [c0, c1, c2] = PRESENTER_COLORS;
    expect(nextColor([])).toBe(c0);
    expect(nextColor([c0])).toBe(c1);
    expect(nextColor([c1])).toBe(c0);
    expect(nextColor([c0, c1])).toBe(c2);
    expect(nextColor([...PRESENTER_COLORS])).toBe(c0);
    expect(nextColor([...PRESENTER_COLORS, c0])).toBe(c1);
  });
});

describe("REQ-214 stamped messages", () => {
  test("a client signal may address one presenter; a client relay may address the presenters only", () => {
    expect(
      parseClientMessage('{"t":"signal","data":{"sdp":"v=0"},"to":"lia"}'),
    ).toEqual({ t: "signal", data: { sdp: "v=0" }, to: "lia" });
    expect(parseClientMessage('{"t":"signal","data":{"sdp":"v=0"},"to":7}'))
      .toEqual({ t: "signal", data: { sdp: "v=0" } });
    expect(
      parseClientMessage(
        '{"t":"relay","data":{"k":"leave"},"to":"presenters"}',
      ),
    ).toEqual({ t: "relay", data: { k: "leave" }, to: "presenters" });
    expect(
      parseClientMessage('{"t":"relay","data":{"k":"leave"},"to":"viewer"}'),
    ).toEqual({ t: "relay", data: { k: "leave" } });
  });

  test("server messages carry the presenter's pid when there is one; a pid that is not a string is dropped", () => {
    expect(
      parseServerMessage(
        '{"t":"welcome","role":"presenter","sessionId":"s1","peerOnline":false,"pid":"hans"}',
      ),
    ).toEqual({
      t: "welcome",
      role: "presenter",
      sessionId: "s1",
      peerOnline: false,
      pid: "hans",
    });
    expect(parseServerMessage('{"t":"peer","online":true,"pid":"lia"}'))
      .toEqual({ t: "peer", online: true, pid: "lia" });
    expect(parseServerMessage('{"t":"peer","online":true,"pid":3}'))
      .toEqual({ t: "peer", online: true });
    expect(
      parseServerMessage(
        '{"t":"relay","from":"presenter","pid":"lia","data":{"k":"leave"}}',
      ),
    ).toEqual({
      t: "relay",
      from: "presenter",
      pid: "lia",
      data: { k: "leave" },
    });
    expect(
      parseServerMessage(
        '{"t":"signal","from":"presenter","pid":"lia","data":{"sdp":"x"}}',
      ),
    ).toEqual({
      t: "signal",
      from: "presenter",
      pid: "lia",
      data: { sdp: "x" },
    });
    // the viewer's messages are never stamped
    expect(
      parseServerMessage('{"t":"relay","from":"viewer","data":{"k":"leave"}}'),
    ).toEqual({ t: "relay", from: "viewer", data: { k: "leave" } });
  });
});

describe("REQ-214 wiring", () => {
  const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
  const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

  test("both dictionaries name several presenters and say which chip is you", () => {
    for (const k of ["guidingMany", "you"]) {
      expect(typeof en[`demoMode.${k}`]).toBe("string");
      expect(typeof es[`demoMode.${k}`]).toBe("string");
    }
    expect(en["demoMode.guidingMany"]).toContain("{names}");
    expect(es["demoMode.guidingMany"]).toContain("{names}");
    expect(en["demoMode.guidingMany"]).not.toBe(es["demoMode.guidingMany"]);
  });

  test("the customer's overlay draws one pointer per presenter in their colour, no hardcoded colour; the stage draws colleagues and lists the presenters", () => {
    const overlay = read("front-end/islands/DemoModeOverlay.tsx");
    expect(overlay).toContain("<PeerPointer");
    expect(overlay).not.toContain('color="#2f6d29"');
    expect(overlay).toContain("<PresenterChips");
    const stage = read("front-end/islands/DemoStage.tsx");
    expect(stage).toContain("<PeerPointer");
    expect(stage).toContain("CUSTOMER_COLOR");
    expect(stage).toContain("<PresenterChips");
    const chips = read("front-end/components/demo-mode/PresenterChips.tsx");
    expect(chips).toContain('data-cy="demo-presenter"');
    expect(chips).toContain("data-color={p.color}");
    const pointer = read("front-end/components/demo-mode/DemoPointer.tsx");
    expect(pointer).toContain("data-presenter=");
  });
});
