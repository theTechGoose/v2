/**
 * REQ-754 — demo-loop cycle 5v1, issue M5 (re-opened by the verifier after
 * REQ-696): "Customers page says nothing signed or owed while money is owed;
 * the list doesn't update until a reload".
 *
 * The verifier: an open /customers tab stayed at "$100 currently owed", with
 * no Jorge card, 15 s after INV-002 was issued (BILL TO "Jorge Ramirez") in
 * another tab; only a reload updated it. REQ-696 wired ClientsPage to
 * REQ-493's change feed, but that feed only hears (a) the notifications feed
 * — which names CLIENT actions (a signature, a claim), never the owner's own
 * writes — and (b) the `pm:changes` channel, which only the public pages
 * posted on. The owner issuing an invoice in another tab reached neither, so
 * nothing told the /customers tab to re-read.
 *
 * The fix: every successful owner write of a quote, invoice or customer
 * (lib/api's request, and InvoicesPage's own fetches) is announced on
 * `pm:changes`, marked with the writing tab so that tab does not re-read its
 * own write.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};

/** BroadcastChannel stand-in shared by every "tab": a message reaches every
 *  OTHER open channel of the same name, asynchronously, as a clone. */
function fakeBroadcast() {
  const open = new Set<FakeChannel>();
  class FakeChannel {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    constructor(readonly name: string) {
      open.add(this);
    }
    postMessage(data: unknown) {
      for (const c of [...open]) {
        if (c === this || c.name !== this.name) continue;
        const copy = JSON.parse(JSON.stringify(data));
        queueMicrotask(() => c.onmessage?.({ data: copy }));
      }
    }
    close() {
      open.delete(this);
    }
  }
  return { open: (name: string) => new FakeChannel(name) };
}

type AnnounceMod = typeof import("../../front-end/lib/change-announce");
type FeedMod = typeof import("../../front-end/lib/change-feed");
type ApiMod = typeof import("../../front-end/lib/api");
type WritesMod = typeof import("../../front-end/lib/owner-writes");

/** one browser tab: its own copy of every module (its own JS realm) on the
 *  shared channel bus */
function openTab(bus: ReturnType<typeof fakeBroadcast>) {
  let tab!: {
    announce: AnnounceMod;
    feed: FeedMod;
    api: ApiMod;
    writes: WritesMod;
  };
  jest.isolateModules(() => {
    tab = {
      announce: require("../../front-end/lib/change-announce"),
      feed: require("../../front-end/lib/change-feed"),
      api: require("../../front-end/lib/api"),
      writes: require("../../front-end/lib/owner-writes"),
    };
  });
  tab.announce._setChangeChannelForTest((name) => bus.open(name));
  tab.feed._resetChangeFeedForTest({
    subscribeFeed: () => () => {},
    refreshFeed: () => Promise.resolve([]),
    win: null,
  });
  return tab;
}

const g = globalThis as Record<string, unknown>;
const saved = {
  window: g.window,
  location: g.location,
  fetch: g.fetch,
  dispatchEvent: g.dispatchEvent,
};

beforeEach(() => {
  // a browser realm as lib/api sees it
  g.window = globalThis;
  g.location = { origin: "http://app.test" };
  g.dispatchEvent = () => true;
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete g[k];
    else g[k] = v;
  }
});

function stubFetch(answer: (url: string, init?: RequestInit) => unknown) {
  const calls: { url: string; method: string }[] = [];
  g.fetch = (input: string, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? "GET" });
    const body = answer(String(input), init);
    return Promise.resolve(
      new Response(body === undefined ? "" : JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  return calls;
}

describe("REQ-754 (cycle 5v1, M5) changeFromWrite — which document an owner write moved", () => {
  let writes: WritesMod;
  beforeAll(() => {
    writes = require("../../front-end/lib/owner-writes");
  });

  test("REQ-754 a write names the quote, invoice or customer in its path (lib/api paths and raw /api paths alike)", () => {
    expect(writes.changeFromWrite("PUT", "/invoices/inv1")).toEqual({
      entityType: "invoice",
      entityId: "inv1",
    });
    expect(writes.changeFromWrite("POST", "/api/invoices/inv1/confirm-payment"))
      .toEqual({ entityType: "invoice", entityId: "inv1" });
    expect(writes.changeFromWrite("DELETE", "/api/quotes/q9?x=1")).toEqual({
      entityType: "quote",
      entityId: "q9",
    });
    expect(
      writes.changeFromWrite("PUT", "http://app.test/api/customers/c3"),
    ).toEqual({ entityType: "customer", entityId: "c3" });
  });

  test("REQ-754 a create names the new document from the answer's id", () => {
    expect(writes.changeFromWrite("POST", "/invoices", { id: "inv2" }))
      .toEqual({ entityType: "invoice", entityId: "inv2" });
    expect(writes.changeFromWrite("POST", "/api/customers", { id: "c4" }))
      .toEqual({ entityType: "customer", entityId: "c4" });
    expect(writes.changeFromWrite("POST", "/invoices", null)).toBeNull();
  });

  test("REQ-754 reads, chat posts and anything else are no change", () => {
    expect(writes.changeFromWrite("GET", "/invoices/inv1")).toBeNull();
    expect(writes.changeFromWrite("POST", "/agents/conversations/x"))
      .toBeNull();
    expect(writes.changeFromWrite("POST", "/api/cron/invoice-reminder"))
      .toBeNull();
    expect(writes.changeFromWrite("PUT", "/settings")).toBeNull();
  });
});

describe("REQ-754 (cycle 5v1, M5) the verifier's situation — an invoice issued in one tab reaches the open /customers tab", () => {
  test("REQ-754 Nueva factura's POST /invoices (lib/api) in tab A makes the /customers tab B re-read at once — no reload", async () => {
    const bus = fakeBroadcast();
    const customersTab = openTab(bus);
    const invoicesTab = openTab(bus);

    // tab B: ClientsPage's wiring — followChanges(isDocChange, refreshClients)
    const rereads: number[] = [];
    const stop = customersTab.feed.followChanges(
      customersTab.feed.isDocChange,
      () => {
        rereads.push(Date.now());
      },
    );

    // tab A: dashboardClient.createInvoice → api.post("/invoices", …)
    stubFetch(() => ({
      id: "inv-002",
      number: "INV-002",
      customerId: "c-jorge",
    }));
    await invoicesTab.api.api.post("/invoices", {
      billTo: { name: "Jorge Ramirez" },
      dueDate: "2026-11-30",
    });
    await flush();

    expect(rereads).toHaveLength(1);
    stop();
  });

  test("REQ-754 an InvoicesPage write that bypasses lib/api (mark paid, confirm a claim, delete) reaches the /customers tab too", async () => {
    const bus = fakeBroadcast();
    const customersTab = openTab(bus);
    const invoicesTab = openTab(bus);
    const seen: unknown[] = [];
    const stop = customersTab.feed.subscribeChanges((cs) => seen.push(...cs));

    stubFetch(() => ({ ok: true }));
    await invoicesTab.writes.announcingFetch(
      "/api/invoices/inv-002/confirm-payment",
      { method: "POST", credentials: "include" },
    );
    // a read announces nothing
    await invoicesTab.writes.announcingFetch(
      "/api/invoices/forecast/this-week",
    );
    await flush();

    expect(seen).toEqual([
      expect.objectContaining({ entityType: "invoice", entityId: "inv-002" }),
    ]);
    stop();
  });

  test("REQ-754 a failed write announces nothing", async () => {
    const bus = fakeBroadcast();
    const customersTab = openTab(bus);
    const invoicesTab = openTab(bus);
    const seen: unknown[] = [];
    const stop = customersTab.feed.subscribeChanges((cs) => seen.push(...cs));
    g.fetch = () =>
      Promise.resolve(new Response('{"message":"nope"}', { status: 422 }));
    await invoicesTab.api.api.put("/invoices/inv-002", {}).catch(() => {});
    await invoicesTab.writes.announcingFetch("/api/invoices/inv-002", {
      method: "PUT",
    });
    await flush();
    expect(seen).toEqual([]);
    stop();
  });

  test("REQ-754 the writing tab does not re-read on its own write (it already has the answer)", async () => {
    const bus = fakeBroadcast();
    const tab = openTab(bus);
    const rereads: number[] = [];
    const stop = tab.feed.followChanges(tab.feed.isDocChange, () => {
      rereads.push(1);
    });
    stubFetch(() => ({ id: "inv-002" }));
    await tab.api.api.post("/invoices", { dueDate: "2026-11-30" });
    await flush();
    expect(rereads).toEqual([]);
    stop();
  });

  test("REQ-754 a public page's announcement (the customer signing on /q) still reaches the owner's tabs (REQ-493)", async () => {
    const bus = fakeBroadcast();
    const ownerTab = openTab(bus);
    const publicTab = openTab(bus);
    const seen: unknown[] = [];
    const stop = ownerTab.feed.subscribeChanges((cs) => seen.push(...cs));
    publicTab.announce.announceChange({ entityType: "quote", entityId: "q7" });
    await flush();
    expect(seen).toEqual([{ entityType: "quote", entityId: "q7" }]);
    stop();
  });
});

describe("REQ-754 (cycle 5v1, M5) wiring", () => {
  test("REQ-754 lib/api announces a successful write; InvoicesPage's fetches go through announcingFetch", () => {
    expect(read("front-end/lib/api.ts")).toMatch(
      /announceWrite\(\s*method,\s*path,\s*parsed\s*\)/,
    );
    expect(read("front-end/islands/InvoicesPage.tsx")).toMatch(
      /import \{ announcingFetch as fetch \} from "\.\.\/lib\/owner-writes\.ts";/,
    );
  });
});
