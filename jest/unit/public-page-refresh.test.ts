/**
 * REQ-321 (demo-loop cycle 1, issue M14) — an open page re-reads the server.
 *
 * The demo: the customer's /i/:id tab stayed "EN CONFIRMACIÓN · Pagado $0.00"
 * after the owner confirmed the payment, and /quotes still read "Out for
 * response · 0 opens" after the customer signed — until a manual reload.
 * Neither page re-read the server after first paint (RCA: PublicInvoiceClaim
 * patched the SSR badge in place and never fetched again; QuotesPage listed
 * once in a mount-time effect). Both now go through REQ-221's scheduler.
 */
import * as fs from "fs";
import * as path from "path";
import { type PollEnv } from "../../front-end/lib/poll";
import {
  invoiceMoved,
  startInvoiceRefresh,
} from "../../front-end/lib/public-invoice-refresh";
import { startListRefresh } from "../../front-end/lib/list-refresh";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** a hand-driven clock + document + window (same shape as polling.test.ts) */
function fakeEnv(opts: { hidden?: boolean } = {}) {
  let nextId = 1;
  const timers = new Map<number, { fn: () => void; ms: number }>();
  const docListeners = new Set<() => void>();
  const winListeners = new Map<string, Set<() => void>>();
  const doc = {
    hidden: opts.hidden ?? false,
    addEventListener: (_t: string, fn: () => void) => docListeners.add(fn),
    removeEventListener: (_t: string, fn: () => void) =>
      docListeners.delete(fn),
  };
  const win = {
    addEventListener: (t: string, fn: () => void) => {
      if (!winListeners.has(t)) winListeners.set(t, new Set());
      winListeners.get(t)!.add(fn);
    },
    removeEventListener: (t: string, fn: () => void) => {
      winListeners.get(t)?.delete(fn);
    },
  };
  const env: PollEnv = {
    setInterval: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearInterval: (id: number) => {
      timers.delete(id);
    },
    doc,
  };
  return {
    env,
    win,
    timers,
    winListeners,
    /** one period elapses */
    tick() {
      for (const t of [...timers.values()]) t.fn();
    },
    focus() {
      for (const l of [...(winListeners.get("focus") ?? [])]) l();
    },
    setHidden(h: boolean) {
      doc.hidden = h;
      for (const l of [...docListeners]) l();
    },
  };
}

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

describe("REQ-321 M14 invoiceMoved — did the server's invoice leave the state this page shows?", () => {
  test("REQ-321 the same state is not a move", () => {
    expect(invoiceMoved({ status: "sent" }, { status: "sent" })).toBe(false);
    expect(invoiceMoved({ status: "sent" }, { status: "viewed" })).toBe(false);
    expect(
      invoiceMoved({ status: "claimed" }, {
        status: "claimed",
        paymentIntent: { method: "zelle", amount: 1, claimedAt: "x" },
      }),
    ).toBe(false);
    expect(invoiceMoved({ status: "paid" }, { status: "paid" })).toBe(false);
  });

  test("REQ-321 claimed → paid is the demo's move (paidAt counts as paid)", () => {
    expect(invoiceMoved({ status: "claimed" }, { status: "paid" })).toBe(true);
    expect(
      invoiceMoved({ status: "claimed" }, {
        status: "claimed",
        paidAt: "2026-11-12T00:00:00Z",
      }),
    ).toBe(true);
  });

  test("REQ-321 sent → claimed (another device claimed) and claimed → sent (the owner said 'didn't get it') are moves", () => {
    expect(
      invoiceMoved({ status: "sent" }, {
        status: "claimed",
        paymentIntent: { method: "zelle", amount: 1, claimedAt: "x" },
      }),
    ).toBe(true);
    expect(invoiceMoved({ status: "claimed" }, { status: "sent" })).toBe(true);
  });

  test("REQ-321 a republished version is a move; a missing version is not", () => {
    expect(
      invoiceMoved({ status: "sent", version: 1 }, {
        status: "sent",
        version: 2,
      }),
    ).toBe(true);
    expect(
      invoiceMoved({ status: "sent", version: 1 }, { status: "sent" }),
    ).toBe(false);
    expect(
      invoiceMoved({ status: "sent" }, { status: "sent", version: 3 }),
    ).toBe(false);
  });
});

describe("REQ-321 M14 startInvoiceRefresh — the public invoice page polls and reloads when the state moves", () => {
  test("REQ-321 polls GET /api/invoices/:id/public every 10 s and reloads once the owner confirms", async () => {
    const f = fakeEnv();
    const seen: string[] = [];
    let server: Record<string, unknown> = { status: "claimed" };
    const reload = jest.fn();
    const stop = startInvoiceRefresh({
      invoiceId: "inv-1",
      shown: () => ({ status: "claimed", version: 1 }),
      fetchJson: async (url) => {
        seen.push(url);
        return server;
      },
      reload,
      env: f.env,
    });
    expect([...f.timers.values()][0]?.ms).toBe(10_000);
    f.tick();
    await flush();
    expect(seen).toEqual(["/api/invoices/inv-1/public"]);
    expect(reload).not.toHaveBeenCalled();

    server = { status: "paid", paidAt: "2026-11-12T05:36:00Z", version: 1 };
    f.tick();
    await flush();
    expect(reload).toHaveBeenCalledTimes(1);
    // after the reload is asked for, the poll is stopped (no double reload)
    f.tick();
    await flush();
    expect(reload).toHaveBeenCalledTimes(1);
    stop();
  });

  test("REQ-321 the state this page shows is read at every tick (a claim made in this tab moves the baseline)", async () => {
    const f = fakeEnv();
    let shownStatus = "sent";
    const reload = jest.fn();
    const stop = startInvoiceRefresh({
      invoiceId: "inv-2",
      shown: () => ({ status: shownStatus }),
      fetchJson: async () => ({
        status: "claimed",
        paymentIntent: { method: "zelle", amount: 1, claimedAt: "x" },
      }),
      reload,
      env: f.env,
    });
    shownStatus = "claimed"; // the island's own claim POST succeeded
    f.tick();
    await flush();
    expect(reload).not.toHaveBeenCalled();
    stop();
  });

  test("REQ-321 a failed or non-JSON read never reloads; stop() ends the poll", async () => {
    const f = fakeEnv();
    const reload = jest.fn();
    let calls = 0;
    const stop = startInvoiceRefresh({
      invoiceId: "inv-3",
      shown: () => ({ status: "claimed" }),
      fetchJson: async () => {
        calls++;
        throw new Error("502");
      },
      reload,
      env: f.env,
    });
    f.tick();
    await flush();
    expect(calls).toBe(1);
    expect(reload).not.toHaveBeenCalled();
    stop();
    f.tick();
    await flush();
    expect(calls).toBe(1);
    expect(f.timers.size).toBe(0);
  });
});

describe("REQ-321 M14 startListRefresh — a list re-reads on a period, on return to the tab, and on window focus", () => {
  test("REQ-321 the period and the focus event both re-run the fetch; a hidden tab waits and catches up once", async () => {
    const f = fakeEnv();
    const fn = jest.fn(() => Promise.resolve());
    const stop = startListRefresh(fn, 30_000, { env: f.env, win: f.win });
    expect([...f.timers.values()][0]?.ms).toBe(30_000);
    expect(fn).toHaveBeenCalledTimes(0); // the mount fetch is the island's own
    f.tick();
    await flush();
    expect(fn).toHaveBeenCalledTimes(1);
    f.focus();
    await flush();
    expect(fn).toHaveBeenCalledTimes(2);
    f.setHidden(true);
    f.tick();
    await flush();
    expect(fn).toHaveBeenCalledTimes(2);
    f.setHidden(false); // one catch-up
    await flush();
    expect(fn).toHaveBeenCalledTimes(3);
    stop();
    f.tick();
    f.focus();
    await flush();
    expect(fn).toHaveBeenCalledTimes(3);
    expect(f.winListeners.get("focus")?.size ?? 0).toBe(0);
  });

  test("REQ-321 a focus while a fetch is in flight does not stack a second one", async () => {
    const f = fakeEnv();
    let release: () => void = () => {};
    const fn = jest.fn(() => new Promise<void>((r) => (release = r)));
    const stop = startListRefresh(fn, 30_000, { env: f.env, win: f.win });
    f.tick();
    f.focus();
    f.focus();
    expect(fn).toHaveBeenCalledTimes(1);
    release();
    await flush();
    f.focus();
    expect(fn).toHaveBeenCalledTimes(2);
    stop();
  });
});

describe("REQ-321 M14 the pages are wired to the refreshers", () => {
  test("REQ-321 PublicInvoiceClaim starts the invoice refresh in an effect, against the state it shows", () => {
    const src = read("front-end/islands/PublicInvoiceClaim.tsx");
    expect(src).toMatch(/from "\.\.\/lib\/public-invoice-refresh\.ts"/);
    const at = src.indexOf("startInvoiceRefresh(");
    expect(at).toBeGreaterThan(-1);
    const effect = src.slice(src.lastIndexOf("useEffect(", at), at + 400);
    expect(effect).toMatch(/invoiceId/);
    expect(effect).toMatch(/shown:/);
    expect(src).not.toMatch(/setInterval\(/);
  });

  test("REQ-321 the SSR'd claimed page (no claim island) mounts PublicInvoiceRefresh so the owner's confirm reaches it too", () => {
    const route = read("front-end/routes/i/[id].tsx");
    expect(route).toMatch(
      /import PublicInvoiceRefresh from "\.\.\/\.\.\/islands\/PublicInvoiceRefresh\.tsx"/,
    );
    const at = route.indexOf("<ClaimedNote");
    expect(at).toBeGreaterThan(-1);
    const branch = route.slice(at - 200, at + 500);
    expect(branch).toMatch(/<PublicInvoiceRefresh/);
    const island = read("front-end/islands/PublicInvoiceRefresh.tsx");
    expect(island).toMatch(/startInvoiceRefresh\(/);
    expect(island).toMatch(/from "\.\.\/lib\/public-invoice-refresh\.ts"/);
  });

  test("REQ-321 QuotesPage re-runs quotesClient.list() through startListRefresh (30 s + focus), not a bare setInterval", () => {
    const src = read("front-end/islands/QuotesPage.tsx");
    expect(src).toMatch(/from "\.\.\/lib\/list-refresh\.ts"/);
    const at = src.indexOf("startListRefresh(");
    expect(at).toBeGreaterThan(-1);
    const effect = src.slice(src.lastIndexOf("useEffect(", at), at + 200);
    expect(effect).toMatch(/quotesClient\.list\(\)/);
    expect(effect).toMatch(/startListRefresh\([\s\S]*30_000/);
    expect(src).not.toMatch(/setInterval\(/);
  });
});
