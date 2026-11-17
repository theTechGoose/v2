/**
 * REQ-549 (demo-loop cycle 4, issue S4) — the stage follows the tab the customer is using, even
 * where every page looks "in front" (headless Playwright emulates focus on every page).
 *
 * The demo: (pair 9) the background /i/ tab's poll saw the invoice paid and reloaded itself; the
 * reloaded page found itself visible + focused and took the stage. (pair 8) on a demo restart
 * every open tab ran its load-time claim, the later one won — the tab the customer was NOT using.
 * Two rules now: a reload the app starts on its own leaves a mark and the next page skips its
 * load-time claim; and a page's load-time claim only goes ahead when no OTHER tab has had user
 * input since this page loaded.
 */
import * as fs from "fs";
import * as path from "path";
import {
  INPUT_STORAGE,
  loadClaim,
  markSelfReload,
  newestInput,
  noteInput,
  SELF_RELOAD_STORAGE,
  takeSelfReload,
} from "../../front-end/lib/demo-mode/tab-claim";
import { startInvoiceRefresh } from "../../front-end/lib/public-invoice-refresh";
import { startChangeOrderRefresh } from "../../front-end/lib/public-change-order-refresh";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

function memStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    map: m,
  };
}

describe("REQ-549 (cycle 4, S4) a reload the app starts itself never claims the stage", () => {
  it("REQ-549 the mark is taken once, then gone", () => {
    const s = memStore();
    markSelfReload(s, 1_000);
    expect(s.map.has(SELF_RELOAD_STORAGE)).toBe(true);
    expect(takeSelfReload(s, 2_000)).toBe(true);
    expect(takeSelfReload(s, 2_100)).toBe(false);
  });

  it("REQ-549 a stale mark (the reload never happened) does not silence a later page", () => {
    const s = memStore();
    markSelfReload(s, 1_000);
    expect(takeSelfReload(s, 1_000 + 60_000)).toBe(false);
    expect(s.map.has(SELF_RELOAD_STORAGE)).toBe(false);
  });

  it("REQ-549 refused storage never throws", () => {
    const bad = {
      getItem: () => {
        throw new Error("no");
      },
      setItem: () => {
        throw new Error("no");
      },
      removeItem: () => {
        throw new Error("no");
      },
    };
    expect(() => markSelfReload(bad, 1)).not.toThrow();
    expect(takeSelfReload(bad, 1)).toBe(false);
    expect(takeSelfReload(null, 1)).toBe(false);
  });

  it("REQ-549 the self-reloaded page skips its load-time claim even when it looks in front", () => {
    expect(
      loadClaim({
        inFront: true,
        selfReload: true,
        tab: "a",
        loadedAt: 10,
        newest: null,
      }),
    ).toBe(false);
  });

  it("REQ-549 the public invoice and change-order pages mark their own reload", async () => {
    const s = memStore();
    const g = globalThis as unknown as Record<string, unknown>;
    const had = { location: g.location, sessionStorage: g.sessionStorage };
    let reloads = 0;
    Object.defineProperty(g, "location", {
      value: { reload: () => reloads++ },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(g, "sessionStorage", {
      value: s,
      configurable: true,
      writable: true,
    });
    try {
      const env = {
        now: () => Date.now(),
        setInterval: (fn: () => void) => {
          setTimeout(fn, 0);
          return 1;
        },
        clearInterval: () => {},
        doc: null,
        activity: null,
      };
      const tick = () => new Promise((r) => setTimeout(r, 5));
      startInvoiceRefresh({
        invoiceId: "i1",
        shown: () => ({ status: "claimed" }),
        fetchJson: async () => ({ status: "paid" }),
        ms: 1,
        env: env as never,
      });
      await tick();
      expect(reloads).toBe(1);
      expect(takeSelfReload(s, Date.now())).toBe(true);
      startChangeOrderRefresh({
        changeOrderId: "c1",
        shown: () => ({ status: "pending" }),
        fetchJson: async () => ({ status: "approved" }),
        ms: 1,
        env: env as never,
      });
      await tick();
      expect(reloads).toBe(2);
      expect(takeSelfReload(s, Date.now())).toBe(true);
    } finally {
      Object.defineProperty(g, "location", {
        value: had.location,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(g, "sessionStorage", {
        value: had.sessionStorage,
        configurable: true,
        writable: true,
      });
    }
  });
});

describe("REQ-549 (cycle 4, S4) at demo start only the tab with the newest user input claims", () => {
  it("REQ-549 input is kept per tab key, newest wins", () => {
    const shared = memStore();
    noteInput(shared, "tab1", 100);
    noteInput(shared, "tab2", 200);
    expect(newestInput(shared)).toEqual({ k: "tab2", at: 200 });
    expect(shared.map.has(INPUT_STORAGE)).toBe(true);
    noteInput(shared, "tab1", 300);
    expect(newestInput(shared)).toEqual({ k: "tab1", at: 300 });
    expect(newestInput(memStore())).toBeNull();
  });

  it("REQ-549 pair 8 restart: tab 1 (loaded earlier) does not claim when the customer clicked tab 2 since", () => {
    const newest = { k: "tab2", at: 2_000 };
    expect(
      loadClaim({
        inFront: true,
        selfReload: false,
        tab: "tab1",
        loadedAt: 1_000,
        newest,
      }),
    )
      .toBe(false);
    expect(
      loadClaim({
        inFront: true,
        selfReload: false,
        tab: "tab2",
        loadedAt: 500,
        newest,
      }),
    )
      .toBe(true);
  });

  it("REQ-549 a page loaded after the other tab's last input (a new tab, a navigation) still claims", () => {
    const newest = { k: "tab1", at: 1_000 };
    expect(
      loadClaim({
        inFront: true,
        selfReload: false,
        tab: "tab2",
        loadedAt: 1_500,
        newest,
      }),
    )
      .toBe(true);
  });

  it("REQ-549 no input anywhere yet: in front claims, behind does not", () => {
    expect(
      loadClaim({
        inFront: true,
        selfReload: false,
        tab: "a",
        loadedAt: 1,
        newest: null,
      }),
    )
      .toBe(true);
    expect(
      loadClaim({
        inFront: false,
        selfReload: false,
        tab: "a",
        loadedAt: 1,
        newest: null,
      }),
    )
      .toBe(false);
  });

  it("REQ-549 the overlay decides its load-time claim through loadClaim and records input", () => {
    const src = read("front-end/islands/DemoModeOverlay.tsx");
    expect(src).toMatch(/from "\.\.\/lib\/demo-mode\/tab-claim\.ts"/);
    expect(src).toMatch(/loadClaim\(/);
    expect(src).toMatch(/takeSelfReload\(/);
    expect(src).toMatch(/noteInput\(/);
    // pageshow only re-claims for a page restored from the back-forward cache (the first
    // pageshow of a load is the load itself, decided by loadClaim)
    expect(src).toMatch(/persisted/);
  });
});
