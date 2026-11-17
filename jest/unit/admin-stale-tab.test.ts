/**
 * REQ-301 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 1, issues M18 ("Stale admin tab shows raw 403 API
 * errors") and m35 ("/admin users table stale after onboarding").
 *
 * RCA: Demo in tab A impersonates the customer for the whole browser; a
 * /admin tab B opened earlier printed api.ts's raw `GET /admin/users failed:
 * 403` and kept its buttons live. The users list loaded exactly once at mount
 * and showed the sign-up placeholder ("New user") as if it were a name.
 *
 * Pure rules (front-end/lib/admin-console.ts, lib/demo-mode/impersonation-
 * signal.ts) + source/dictionary pins. The browser proof is
 * e2e/admin-stale-tab/admin-stale-tab.e2e.test.ts.
 */
import * as fs from "fs";
import * as path from "path";
import { ApiError } from "../../front-end/lib/api";
import {
  ADMIN_REFRESH_MS,
  displayName,
  lockFor,
  refreshWhileVisible,
} from "../../front-end/lib/admin-console";
import {
  announceImpersonation,
  DEMO_IMPERSONATING_EVENT,
  onImpersonation,
} from "../../front-end/lib/demo-mode/impersonation-signal";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const en: Record<string, string> = require("../../lang/en.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const es: Record<string, string> = require("../../lang/es.json");

const refused = (status: number) =>
  new ApiError(status, "", `GET /admin/users failed: ${status}`);
const asCustomer = {
  authenticated: true,
  impersonating: true,
  user: {
    id: "u1",
    name: "Luis Ortega",
    phoneNumber: "+15125550100",
    superAdmin: false,
  },
  impersonator: {
    id: "a1",
    name: "Hans",
    phoneNumber: "+18435550100",
    superAdmin: true,
  },
};

describe("REQ-301 (M18) lockFor — a refused admin call becomes a plain notice, never a raw error", () => {
  test("403 while the session is an impersonation → the demo lock, naming the customer", () => {
    expect(lockFor(refused(403), asCustomer)).toEqual({
      kind: "demo",
      customer: "Luis Ortega",
    });
  });
  test("401 while impersonating → the demo lock too", () => {
    expect(lockFor(refused(401), asCustomer)).toEqual({
      kind: "demo",
      customer: "Luis Ortega",
    });
  });
  test("any failure while impersonating → the demo lock (the page is not the admin's any more)", () => {
    expect(lockFor(new TypeError("Failed to fetch"), asCustomer)?.kind).toBe(
      "demo",
    );
  });
  test("the customer label skips a placeholder name: business, then phone", () => {
    const placeholder = {
      ...asCustomer,
      user: {
        ...asCustomer.user,
        name: "New user",
        businessName: "Ortega Plumbing",
      },
    };
    expect(lockFor(refused(403), placeholder)).toEqual({
      kind: "demo",
      customer: "Ortega Plumbing",
    });
    const bare = {
      ...asCustomer,
      user: { ...asCustomer.user, name: "Nuevo usuario" },
    };
    expect(lockFor(refused(403), bare)).toEqual({
      kind: "demo",
      customer: "+15125550100",
    });
  });
  test("403 and NOT impersonating (or whoami unknown) → the session lock", () => {
    expect(lockFor(refused(403), { authenticated: true, impersonating: false }))
      .toEqual({ kind: "session" });
    expect(lockFor(refused(401), null)).toEqual({ kind: "session" });
  });
  test("a 500 or a network error while the admin is themselves → no lock (an ordinary error)", () => {
    expect(lockFor(refused(500), { authenticated: true, superAdmin: true }))
      .toBeNull();
    expect(lockFor(new TypeError("Failed to fetch"), null)).toBeNull();
  });
});

describe("REQ-301 (m35) displayName — a placeholder is never shown as a name", () => {
  test.each(["", "  ", "New user", "Nuevo usuario", undefined])(
    "%p → (no name yet)",
    (n) => {
      expect(displayName(n as string | undefined, "(no name yet)")).toBe(
        "(no name yet)",
      );
    },
  );
  test("a real name stays", () => {
    expect(displayName("Luis Ortega", "(no name yet)")).toBe("Luis Ortega");
  });
});

type Listener = (e?: unknown) => void;
function fakeTarget() {
  const ls = new Map<string, Listener[]>();
  return {
    addEventListener: (k: string, f: Listener) =>
      ls.set(k, [...(ls.get(k) ?? []), f]),
    removeEventListener: (k: string, f: Listener) =>
      ls.set(k, (ls.get(k) ?? []).filter((x) => x !== f)),
    fire: (k: string, e?: unknown) => (ls.get(k) ?? []).forEach((f) => f(e)),
    count: (k: string) => (ls.get(k) ?? []).length,
  };
}

describe("REQ-301 (m35) refreshWhileVisible — the users list stays live", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  // REQ-424 AMENDMENT (cycle 2, p2): a focus / visibilitychange refresh is debounced like the
  // scheduler's catch-up — none when the last refresh is under CATCHUP_MIN_MS (2 s) old, so a
  // tab switch (both events at once) is one refresh, not two.
  test("runs on focus, on becoming visible, and every ADMIN_REFRESH_MS while visible", async () => {
    const doc = {
      ...fakeTarget(),
      visibilityState: "visible" as DocumentVisibilityState,
    };
    const win = fakeTarget();
    const run = jest.fn();
    const stop = refreshWhileVisible(run, { doc, win });
    expect(ADMIN_REFRESH_MS).toBeLessThanOrEqual(5_000);
    expect(run).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(ADMIN_REFRESH_MS);
    expect(run).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(2_000);
    win.fire("focus");
    expect(run).toHaveBeenCalledTimes(2);
    doc.fire("visibilitychange"); // same tab switch: no second refresh
    expect(run).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(2_000);
    doc.fire("visibilitychange");
    expect(run).toHaveBeenCalledTimes(3);
    stop();
    jest.advanceTimersByTime(ADMIN_REFRESH_MS * 3);
    win.fire("focus");
    expect(run).toHaveBeenCalledTimes(3);
    expect(win.count("focus")).toBe(0);
    expect(doc.count("visibilitychange")).toBe(0);
  });

  test("a hidden tab never refreshes; coming back refreshes at once", () => {
    const doc = {
      ...fakeTarget(),
      visibilityState: "hidden" as DocumentVisibilityState,
    };
    const win = fakeTarget();
    const run = jest.fn();
    const stop = refreshWhileVisible(run, { doc, win });
    jest.advanceTimersByTime(ADMIN_REFRESH_MS * 3);
    doc.fire("visibilitychange");
    expect(run).not.toHaveBeenCalled();
    doc.visibilityState = "visible";
    doc.fire("visibilitychange");
    expect(run).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe("REQ-301 (M18) the impersonation signal reaches this tab and the browser's other tabs", () => {
  test("announce dispatches the window event and posts on the channel; on() hears both and unsubscribes", () => {
    const win = fakeTarget();
    const posted: unknown[] = [];
    const chan = {
      postMessage: (m: unknown) => posted.push(m),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      close: jest.fn(),
    };
    const dispatched: unknown[] = [];
    const target = {
      ...win,
      dispatchEvent: (e: { type: string; detail?: unknown }) => {
        dispatched.push(e);
        win.fire(e.type, e);
        return true;
      },
    };
    const heard: unknown[] = [];
    const off = onImpersonation((d) => heard.push(d), {
      win: target,
      channel: () => chan,
    });
    announceImpersonation({ targetUserId: "u1", targetName: "Luis Ortega" }, {
      win: target,
      channel: () => chan,
    });
    expect((dispatched[0] as { type: string }).type).toBe(
      DEMO_IMPERSONATING_EVENT,
    );
    expect(posted).toEqual([{
      k: "impersonating",
      targetUserId: "u1",
      targetName: "Luis Ortega",
    }]);
    expect(heard).toEqual([{ targetUserId: "u1", targetName: "Luis Ortega" }]);
    // the channel side: a message from another tab
    const onMsg = (chan.addEventListener as jest.Mock).mock.calls.find((c) =>
      c[0] === "message"
    )?.[1];
    expect(typeof onMsg).toBe("function");
    onMsg({
      data: { k: "impersonating", targetUserId: "u2", targetName: "Ana" },
    });
    expect(heard).toHaveLength(2);
    off();
    expect(chan.close).toHaveBeenCalled();
    expect(win.count(DEMO_IMPERSONATING_EVENT)).toBe(0);
  });
});

describe("REQ-301 the island and the overlay are wired to the rules", () => {
  const admin = read("front-end/islands/AdminPage.tsx");
  const overlay = read("front-end/islands/DemoModeOverlay.tsx");
  test("AdminPage never renders err.message (api.ts's `GET /admin/users failed: 403`)", () => {
    expect(admin).not.toMatch(/err\.message/);
  });
  test("AdminPage locks on the impersonation signal and shows the lock notice with its buttons", () => {
    expect(admin).toMatch(/onImpersonation\(/);
    expect(admin).toMatch(/lockFor\(/);
    expect(admin).toMatch(/data-cy="adm-lock"/);
    expect(admin).toMatch(/data-cy="adm-lock-back"/);
    expect(admin).toMatch(/data-cy="adm-lock-reload"/);
  });
  test("AdminPage refreshes while visible and after a demo opens", () => {
    expect(admin).toMatch(/refreshWhileVisible\(/);
    expect(admin).not.toMatch(
      /useEffect\(\(\) => \{\s*search\(\);\s*\}, \[\]\);/,
    );
  });
  test('AdminPage renders names through displayName, never `u.name || "—"`', () => {
    expect(admin).toMatch(/displayName\(/);
    expect(admin).not.toMatch(/\{u\.name \|\| "—"\}/);
  });
  test("the overlay announces the impersonation right after it impersonates", () => {
    expect(overlay).toMatch(/announceImpersonation\(/);
    const at = overlay.indexOf("await adminClient.impersonate(d.targetUserId)");
    expect(at).toBeGreaterThan(0);
    expect(overlay.slice(at, at + 400)).toMatch(/announceImpersonation\(/);
  });
  test.each([
    "adminPage.lock.demo",
    "adminPage.lock.session",
    "adminPage.lock.reload",
    "adminPage.lock.back",
    "adminPage.noNameYet",
  ])("%s is in en and es, and differs", (k) => {
    expect(typeof en[k]).toBe("string");
    expect(typeof es[k]).toBe("string");
    expect(en[k]).not.toBe(es[k]);
  });
  test("the demo lock names the customer and both ways out", () => {
    expect(en["adminPage.lock.demo"]).toMatch(/\{customer\}/);
    expect(es["adminPage.lock.demo"]).toMatch(/\{customer\}/);
    expect(en["adminPage.noNameYet"]).toBe("(no name yet)");
  });
});
