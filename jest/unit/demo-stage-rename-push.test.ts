/**
 * REQ-836 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle dm2 (run r9c47ba57), issue m1: "Stage names the customer by raw phone number
 * until well after the name is saved (REQ-817 re-check NOT_FIXED)".
 *
 * RCA (27db8c23): the stage learned a saved name only by asking GET /demo-mode/active again —
 * every ACTIVE_NAME_REFRESH_MS (15 s) while connected, or on the customer's next page. /welcome's
 * steps change inside one page, so a name saved on step 1 waited up to 15 s (13.1 s measured).
 * Nothing pushed it. And until then the label was the raw E.164 "+15125550400".
 *
 * Now: a saved name is announced on the customer's page (`pm:profile-updated`, which /welcome's
 * name step now fires too, as Settings and the staff name prompt already did); the overlay relays
 * it as a `renamed` frame on the open demo link; the stage asks /active the moment it hears one.
 * The phone formatter is shared, and the backend's placeholder label uses it.
 */
import * as fs from "fs";
import * as path from "path";
import * as protocol from "../../shared/demo-mode/protocol";
import { PROFILE_UPDATED } from "../../front-end/lib/profile-events";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

// looked up at run time: a missing module fails its own tests, not the whole file
type Relay = (
  send: (m: unknown) => void,
  win?: EventTarget,
) => () => void;
const relayRenames = (): Relay =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("../../front-end/lib/demo-mode/rename-signal").relayRenames as Relay;
const sharedFmtPhone = (): (raw: string) => string =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("../../shared/identity/phone").fmtPhone;

const profileEvent = (detail: Record<string, unknown>) =>
  new CustomEvent(PROFILE_UPDATED, { detail });

describe("REQ-836 (cycle dm2, m1) — a saved name reaches the stage at once, never a '+' label", () => {
  test("REQ-836 the wire carries a `renamed` peer frame (and the server's relay keeps it)", () => {
    expect(protocol.parsePeerMessage({ k: "renamed" })).toEqual({
      k: "renamed",
    });
    expect(
      protocol.parseClientMessage(
        JSON.stringify({ t: "relay", data: { k: "renamed", junk: 1 } }),
      ),
    ).toEqual({ t: "relay", data: { k: "renamed" } });
  });

  test("REQ-836 the overlay's relay: a saved name on this page sends `renamed` on the link", () => {
    const win = new EventTarget();
    const sent: unknown[] = [];
    const stop = relayRenames()((m) => sent.push(m), win);
    win.dispatchEvent(profileEvent({ name: "Maria Lopez" }));
    expect(sent).toEqual([{ k: "renamed" }]);
    // a business rename alone (REQ-737) is not the customer's name
    win.dispatchEvent(profileEvent({ businessName: "Lopez Roofing" }));
    expect(sent).toEqual([{ k: "renamed" }]);
    stop();
    win.dispatchEvent(profileEvent({ name: "Maria L." }));
    expect(sent).toEqual([{ k: "renamed" }]);
  });

  test("REQ-836 the phone formatter is shared: the app's fmtPhone is the shared one", () => {
    expect(exists("shared/identity/phone.ts")).toBe(true);
    const fmt = sharedFmtPhone();
    expect(fmt("+15125550400")).toBe("(512) 555-0400");
    expect(fmt("5125550400")).toBe("(512) 555-0400");
    expect(fmt("+442071234567")).toBe("+442071234567");
    const format = read("front-end/lib/format.ts");
    expect(format).toMatch(
      /import \{ fmtPhone \} from "\.\.\/\.\.\/shared\/identity\/phone\.ts";/,
    );
    expect(format).toMatch(/export \{ fmtPhone \};/);
    expect(format).not.toMatch(/export function fmtPhone/);
    expect(
      read("backend/src/demo-mode/domain/business/display-name/mod.ts"),
    ).toMatch(/fmtPhone\(u\.phoneNumber\)/);
  });

  test("REQ-836 wiring: /welcome's name step announces the saved name; the overlay relays on its link; the stage asks /active on `renamed`", () => {
    const wizard = read("front-end/islands/WelcomeWizard.tsx");
    const step = wizard.slice(
      wizard.indexOf("function NameStep("),
      wizard.indexOf("return (", wizard.indexOf("function NameStep(")),
    );
    expect(step).toMatch(
      /profileClient\.updateUser\(\{ name: value\.trim\(\) \}\)[\s\S]*announceProfile\(\{ name: /,
    );

    const overlay = read("front-end/islands/DemoModeOverlay.tsx");
    expect(overlay).toMatch(
      /\brelayRenames\b[\s\S]*from "\.\.\/lib\/demo-mode\/rename-signal\.ts"/,
    );
    expect(overlay).toMatch(/relayRenames\(\(m\) => link(\?)?\.send\(m\)\)/);

    const stage = read("front-end/islands/DemoStage.tsx");
    const onPeer = stage.slice(
      stage.indexOf("onPeer: (m: PeerMessage, from: PeerFrom) => {"),
      stage.indexOf("onEnded: (by, reason, pid) => {"),
    );
    expect(onPeer).toMatch(
      /case "renamed":[\s\S]{0,400}?pollRef\.current\?\.\(\)/,
    );
  });
});
