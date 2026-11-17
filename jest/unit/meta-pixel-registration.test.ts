/**
 * REQ-229 — "fix every issue the demo found": demo issues
 * test-setup-claims-pixel-staff-registration and demo-lifecycle-m4. /welcome
 * fired CompleteRegistration for a staff login and, through the demo stage's
 * replica frame, for the customer the staff member impersonated — from the
 * staff's browser. REQ-080 says the event is "a new account reached /welcome":
 * a person on their own account, never staff, never an impersonation.
 *
 * The pure half:
 *  - registrationEventFor(whoami) — the event for the account's own session,
 *    null for a super admin, an impersonation, or a session it cannot read;
 *  - pixelEventScript / pixelBootScript — nothing fires and nothing boots
 *    inside the demo stage's replica frame (window.name "pm-demo-replica").
 */
import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";
import {
  FAKE_PIXEL_ID,
  FAKE_PIXEL_LOADER,
  pixelBootScript,
  pixelEventScript,
  registrationEvent,
  registrationEventFor,
  REPLICA_FRAME_NAME,
} from "../../shared/meta-pixel/pixel";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** a window for the inline scripts: its own name, a parent (itself on a top page), storage, fbq */
function windowFor(name: string, framed: boolean) {
  const store = new Map<string, string>();
  const calls: unknown[][] = [];
  const ctx: Record<string, unknown> = {
    name,
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  };
  ctx.window = ctx;
  ctx.parent = framed ? { name: "stage" } : ctx;
  ctx.fbq = (...args: unknown[]) => void calls.push(args);
  vm.createContext(ctx);
  return { ctx, store, calls };
}

describe("REQ-229 CompleteRegistration is the account's own: never staff, never an impersonation, never the demo stage's frame", () => {
  it("REQ-229 registrationEventFor — the event for a person on their own account; null for a super admin, an impersonation, or an unreadable session", () => {
    const own = registrationEventFor({
      authenticated: true,
      user: { id: "u_1" },
      superAdmin: false,
      impersonating: false,
    });
    expect(own).toEqual(registrationEvent("u_1"));

    // Case A (pair 4): the staff login lands on /welcome
    expect(
      registrationEventFor({
        authenticated: true,
        user: { id: "staff_1" },
        superAdmin: true,
        impersonating: false,
      }),
    ).toBeNull();
    // Case B (pair 9/10, m4): the staff impersonating the customer (the stage frame)
    expect(
      registrationEventFor({
        authenticated: true,
        user: { id: "cust_1" },
        superAdmin: false,
        impersonating: true,
      }),
    ).toBeNull();
    // fail closed: a session that cannot be read is never counted
    expect(registrationEventFor(null)).toBeNull();
    expect(registrationEventFor(undefined)).toBeNull();
    expect(registrationEventFor({ authenticated: false })).toBeNull();
    expect(
      registrationEventFor({ authenticated: true, user: { id: "u_2" } }),
    ).toBeNull();
  });

  it("REQ-229 the conversion script fires on a top page and NOT inside the demo stage's replica frame (no call, no once-per-browser key spent)", () => {
    const script = pixelEventScript(registrationEvent("cust_1"));

    const top = windowFor("", false);
    vm.runInContext(script, top.ctx);
    expect(top.calls).toEqual([
      ["track", "CompleteRegistration", {}, { eventID: "reg:cust_1" }],
    ]);

    const frame = windowFor(REPLICA_FRAME_NAME, true);
    vm.runInContext(script, frame.ctx);
    expect(frame.calls).toEqual([]);
    expect(frame.ctx.__pmPxQ).toBeUndefined();
    expect(frame.store.size).toBe(0);

    // the name alone, on a top window, is not the frame
    const named = windowFor(REPLICA_FRAME_NAME, false);
    vm.runInContext(script, named.ctx);
    expect(named.calls.length).toBe(1);
  });

  it("REQ-229 the pixel does not boot inside the replica frame (no init, no PageView from the staff's browser)", () => {
    const boot = pixelBootScript({
      mode: "fake",
      id: FAKE_PIXEL_ID,
      loader: FAKE_PIXEL_LOADER,
    });
    const frame = windowFor(REPLICA_FRAME_NAME, true);
    delete frame.ctx.fbq;
    // no document in the context: a boot that went ahead would throw on it
    expect(() => vm.runInContext(boot, frame.ctx)).not.toThrow();
    expect(frame.ctx.fbq).toBeUndefined();
  });

  it("REQ-229 + REQ-242 the demo stage runs no script of the customer's page at all: its mirror frame is sandboxed without allow-scripts, so no pixel boots or fires there; the old replica name stays guarded", () => {
    const pixel = read("shared/meta-pixel/pixel.ts");
    expect(pixel).toContain(`"${REPLICA_FRAME_NAME}"`);
    const stage = read("front-end/islands/DemoStage.tsx");
    expect(stage).toMatch(/sandbox="allow-same-origin"/);
    expect(stage).not.toMatch(/allow-scripts/);
  });

  it("REQ-229 /welcome asks who the session is before it renders CompleteRegistration — no unconditional registrationEvent(user.id)", () => {
    const welcome = read("front-end/routes/welcome.tsx");
    expect(welcome).not.toMatch(
      /<MetaPixelEvent event=\{registrationEvent\(user\.id\)\} \/>/,
    );
    expect(welcome).toMatch(/registrationForRequest\(ctx\.req\)/);
    expect(welcome).toMatch(
      /\{registered \? <MetaPixelEvent event=\{registered\} \/> : null\}/,
    );
  });
});
