/**
 * REQ-493 (demo-loop cycle 3, issue m7) — "Open pages don't refresh after
 * the client acts".
 *
 * The demo: the assistant chat kept its "sent" card and "GATHERING A LITTLE
 * MORE INFO" after the customer signed in another tab (pairs 1, 4, 7), the
 * open /quotes panel kept "Sent" with "Edit → Version 3" (pair 5), /invoices
 * kept a claimed invoice "Enviada" while the topbar chip already said the
 * client paid, and the owner's /q kept "paga los $450.00 pendientes" after the
 * payment (pair 9). RCA: no push channel; the chat polled its quote only while
 * the review was open, /invoices never re-read, /quotes every 30 s or on a
 * focus a switched-to tab never fires, and /q compared only the quote's own
 * view. The one thing every owner page polls is the topbar's notifications
 * feed — it becomes the change feed.
 */
import * as fs from "fs";
import * as path from "path";
import { CATCHUP_MIN_MS, type PollEnv } from "../../front-end/lib/poll";
import {
  _resetNotificationsForTest,
  refreshNotifications,
} from "../../front-end/lib/notifications-feed";
import {
  _setChangeChannelForTest,
  announceChange,
  CHANGE_CHANNEL,
  type EntityChange,
} from "../../front-end/lib/change-announce";
import {
  _resetChangeFeedForTest,
  changesBetween,
  followChanges,
  isDocChange,
  subscribeChanges,
} from "../../front-end/lib/change-feed";
import {
  boundQuoteMoved,
  publicQuoteMoved,
  startPublicQuoteRefresh,
} from "../../front-end/lib/live-doc-refresh";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};

/** a notification as GET /notifications returns it */
function note(
  id: string,
  type: string,
  entityType: string | undefined,
  entityId: string | undefined,
  createdAt: string,
) {
  return {
    id,
    userId: "u1",
    type,
    title: id,
    read: false,
    createdAt,
    ...(entityType ? { entityType } : {}),
    ...(entityId ? { entityId } : {}),
  };
}

const T0 = Date.parse("2026-11-12T12:00:00Z");
const BEFORE = "2026-11-12T11:00:00Z";
const AFTER = "2026-11-12T12:05:00Z";

/** BroadcastChannel stand-in: a message reaches every OTHER open channel of
 *  the same name, asynchronously, as a structured clone — the spec's shape. */
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
  return {
    open: (name: string) => new FakeChannel(name),
    openCount: () => open.size,
  };
}

/** a window stand-in that counts its listeners and fires events */
function fakeWin() {
  const ls = new Map<string, Set<() => void>>();
  return {
    addEventListener: (k: string, fn: () => void) => {
      if (!ls.has(k)) ls.set(k, new Set());
      ls.get(k)!.add(fn);
    },
    removeEventListener: (k: string, fn: () => void) => {
      ls.get(k)?.delete(fn);
    },
    fire: (k: string) => {
      for (const fn of [...(ls.get(k) ?? [])]) fn();
    },
    count: (k: string) => ls.get(k)?.size ?? 0,
  };
}

/** a notifications feed stand-in the test pushes lists through */
function fakeFeed() {
  const ls = new Set<(items: unknown[]) => void>();
  return {
    subscribe: (fn: (items: unknown[]) => void) => {
      ls.add(fn);
      return () => {
        ls.delete(fn);
      };
    },
    push: (items: unknown[]) => {
      for (const fn of [...ls]) fn(items);
    },
    listeners: () => ls.size,
  };
}

afterEach(() => {
  _resetChangeFeedForTest();
  _setChangeChannelForTest();
  _resetNotificationsForTest();
});

describe("REQ-493 m7 changesBetween — a notifications refresh, read as the documents it moved", () => {
  test("REQ-493 the entries a refresh adds that name a document are changes; the ones already seen are not", () => {
    const signed = note("n1", "quote_accepted", "quote", "q1", AFTER);
    const claimed = note("n2", "invoice_claimed", "invoice", "i1", AFTER);
    expect(changesBetween([signed], [claimed, signed], T0)).toEqual([
      { entityType: "invoice", entityId: "i1", type: "invoice_claimed" },
    ]);
    expect(changesBetween([claimed, signed], [claimed, signed], T0)).toEqual(
      [],
    );
  });

  test("REQ-493 an entry naming no document (a payment, a message) is no change; one document named twice in a batch is one change", () => {
    const prev = [note("n0", "quote_sent", "quote", "q1", BEFORE)];
    const next = [
      note("n3", "customer_replied", undefined, undefined, AFTER),
      note("n4", "generic", "quote", "q1", AFTER),
      note("n5", "quote_accepted", "quote", "q1", AFTER),
      note("n6", "generic", "payment", "p1", AFTER),
      ...prev,
    ];
    expect(changesBetween(prev, next, T0)).toEqual([
      { entityType: "quote", entityId: "q1", type: "generic" },
    ]);
  });

  test("REQ-493 the first list a page sees: only what was created after the page started is a change (an event between the page's load and the topbar's first tick still counts)", () => {
    const old = note("n7", "quote_sent", "quote", "q2", BEFORE);
    const fresh = note("n8", "invoice_paid", "invoice", "i2", AFTER);
    expect(changesBetween(null, [fresh, old], T0)).toEqual([
      { entityType: "invoice", entityId: "i2", type: "invoice_paid" },
    ]);
    expect(changesBetween(null, [old], T0)).toEqual([]);
    expect(
      changesBetween(null, [{ ...fresh, createdAt: "not a date" }], T0),
    ).toEqual([]);
  });

  test("REQ-493 isDocChange: a quote or an invoice — what the owner's document pages show", () => {
    expect(isDocChange({ entityType: "quote", entityId: "q" })).toBe(true);
    expect(isDocChange({ entityType: "invoice", entityId: "i" })).toBe(true);
    expect(isDocChange({ entityType: "customer", entityId: "c" })).toBe(false);
  });
});

describe("REQ-493 m7 subscribeChanges — the topbar's notifications feed is the owner pages' change feed", () => {
  test("REQ-493 the feed refresh that adds the client's signature hands the page ONE batch naming the quote; the baseline, a repeat, and a refresh after the last follower left hand nothing", async () => {
    let list: unknown[] = [note("n-old", "quote_sent", "quote", "q1", BEFORE)];
    _resetNotificationsForTest(() => Promise.resolve(list as never));
    _setChangeChannelForTest(() => null);
    _resetChangeFeedForTest({ since: T0, win: null });
    const batches: EntityChange[][] = [];
    const off = subscribeChanges((cs) => batches.push(cs));

    await refreshNotifications(); // the page's first list: older than the page
    expect(batches).toEqual([]);

    list = [note("n-acc", "quote_accepted", "quote", "q1", AFTER), ...list];
    await refreshNotifications();
    expect(batches).toEqual([[
      { entityType: "quote", entityId: "q1", type: "quote_accepted" },
    ]]);

    await refreshNotifications(); // nothing new
    expect(batches).toHaveLength(1);

    off();
    list = [note("n-cl", "invoice_claimed", "invoice", "i1", AFTER), ...list];
    await refreshNotifications();
    expect(batches).toHaveLength(1);
  });

  test("REQ-493 a client action in another tab of this browser reaches the page at once — announceChange posts on the pm:changes channel; junk on it is no change; the page's channel closes with its last follower", async () => {
    const bus = fakeBroadcast();
    _setChangeChannelForTest((name) => bus.open(name));
    const feed = fakeFeed();
    _resetChangeFeedForTest({ subscribeFeed: feed.subscribe, win: null });
    const batches: EntityChange[][] = [];
    const off = subscribeChanges((cs) => batches.push(cs));
    expect(CHANGE_CHANNEL).toBe("pm:changes");
    expect(bus.openCount()).toBe(1); // the page listens

    // the /q tab: the customer signed in person on the owner's device
    announceChange({ entityType: "quote", entityId: "q7" });
    await flush();
    expect(batches).toEqual([[{ entityType: "quote", entityId: "q7" }]]);
    expect(bus.openCount()).toBe(1); // the announcing side closed its own

    const other = bus.open(CHANGE_CHANNEL);
    other.postMessage({ entityType: "payment", entityId: "p1" });
    other.postMessage("hello");
    other.postMessage({ entityType: "invoice" });
    other.postMessage({ entityType: "invoice", entityId: 42 });
    await flush();
    expect(batches).toHaveLength(1);
    other.close();

    off();
    expect(bus.openCount()).toBe(0);
    expect(feed.listeners()).toBe(0);
  });

  test("REQ-493 announceChange where there is no BroadcastChannel (SSR, an old browser) does nothing and never throws", () => {
    _setChangeChannelForTest(() => null);
    expect(() => announceChange({ entityType: "invoice", entityId: "i1" }))
      .not.toThrow();
    _setChangeChannelForTest(() => {
      throw new Error("blocked");
    });
    expect(() => announceChange({ entityType: "invoice", entityId: "i1" }))
      .not.toThrow();
  });

  test("REQ-493 coming back to the window asks the feed at once — but not within CATCHUP_MIN_MS of the last list or the last ask, and not once nobody follows", () => {
    let clock = 100_000;
    const win = fakeWin();
    const feed = fakeFeed();
    const refreshFeed = jest.fn(() => Promise.resolve([] as never[]));
    _setChangeChannelForTest(() => null);
    _resetChangeFeedForTest({
      now: () => clock,
      win,
      refreshFeed,
      subscribeFeed: feed.subscribe,
    });
    const off = subscribeChanges(() => {});
    win.fire("focus");
    expect(refreshFeed).toHaveBeenCalledTimes(1);
    clock += 500;
    win.fire("focus");
    expect(refreshFeed).toHaveBeenCalledTimes(1); // a focus right after an ask
    clock += CATCHUP_MIN_MS;
    feed.push([]); // the topbar's tick resolved a list
    clock += 1_000;
    win.fire("focus");
    expect(refreshFeed).toHaveBeenCalledTimes(1); // a list landed 1 s ago
    clock += CATCHUP_MIN_MS;
    win.fire("focus");
    expect(refreshFeed).toHaveBeenCalledTimes(2);
    off();
    expect(win.count("focus")).toBe(0);
    clock += 60_000;
    win.fire("focus");
    expect(refreshFeed).toHaveBeenCalledTimes(2);
  });
});

describe("REQ-493 m7 followChanges — re-read what the page shows, one read at a time", () => {
  function deferred() {
    let resolve!: () => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  test("REQ-493 a batch naming what the page shows re-reads it; a batch about other documents does not; stop() ends it", async () => {
    const feed = fakeFeed();
    _setChangeChannelForTest(() => null);
    _resetChangeFeedForTest({
      since: 0,
      subscribeFeed: feed.subscribe,
      win: null,
    });
    const reread = jest.fn(() => Promise.resolve());
    const stop = followChanges(
      (c) => c.entityType === "quote" && c.entityId === "q1",
      reread,
    );
    const claimed = note("1", "invoice_claimed", "invoice", "i9", AFTER);
    feed.push([claimed]);
    await flush();
    expect(reread).not.toHaveBeenCalled();
    const signed = note("2", "quote_accepted", "quote", "q1", AFTER);
    feed.push([signed, claimed]);
    await flush();
    expect(reread).toHaveBeenCalledTimes(1);
    stop();
    feed.push([note("3", "generic", "quote", "q1", AFTER), signed, claimed]);
    await flush();
    expect(reread).toHaveBeenCalledTimes(1);
    expect(feed.listeners()).toBe(0);
  });

  test("REQ-493 one read at a time: changes that land during a read re-read ONCE more after it (the last answer is never older than the last change); a failed read does not stop following", async () => {
    const feed = fakeFeed();
    _setChangeChannelForTest(() => null);
    _resetChangeFeedForTest({
      since: 0,
      subscribeFeed: feed.subscribe,
      win: null,
    });
    const reads: ReturnType<typeof deferred>[] = [];
    const reread = jest.fn(() => {
      const d = deferred();
      reads.push(d);
      return d.promise;
    });
    const stop = followChanges(isDocChange, reread);
    const seen: ReturnType<typeof note>[] = [];
    const push = (id: string) => {
      seen.unshift(note(id, "invoice_claimed", "invoice", `i-${id}`, AFTER));
      feed.push([...seen]);
    };
    push("a");
    await flush();
    expect(reread).toHaveBeenCalledTimes(1);
    push("b");
    push("c");
    await flush();
    expect(reread).toHaveBeenCalledTimes(1); // still the first read
    reads[0].resolve();
    await flush();
    expect(reread).toHaveBeenCalledTimes(2); // one trailing read for b + c
    reads[1].reject(new Error("502"));
    await flush();
    expect(reread).toHaveBeenCalledTimes(2);
    push("d");
    await flush();
    expect(reread).toHaveBeenCalledTimes(3);
    reads[2].resolve();
    stop();
  });
});

describe("REQ-493 m7 boundQuoteMoved — the chat takes its quote row when its lifecycle moved", () => {
  // the row as AsstChat holds it: loaded from GET /quotes/:id without
  // publishedAt / lostAt
  const held = {
    id: "q1",
    status: "sent",
    acceptedAt: undefined,
    sentAt: "2026-11-12T12:00:00Z",
    version: 1,
  };
  const row = {
    ...held,
    publishedAt: "2026-11-12T12:00:00Z",
    lostAt: null,
    viewedAt: "2026-11-12T12:01:00Z",
  };

  test("REQ-493 signed (pairs 1, 4, 7), declined, or a new version published is a move", () => {
    expect(
      boundQuoteMoved(held, {
        ...row,
        status: "accepted",
        acceptedAt: "2026-11-12T12:10:00Z",
      }),
    ).toBe(true);
    expect(
      boundQuoteMoved(held, {
        ...row,
        status: "lost",
        lostAt: "2026-11-12T12:10:00Z",
      }),
    ).toBe(true);
    expect(boundQuoteMoved(held, { ...row, version: 2 })).toBe(true);
  });

  test("REQ-493 a re-read with nothing new is no move — fields the chat never loaded (publishedAt, lostAt) don't count", () => {
    expect(boundQuoteMoved(held, row)).toBe(false);
    expect(boundQuoteMoved(null, row)).toBe(false);
    expect(boundQuoteMoved(held, undefined)).toBe(false);
  });
});

describe("REQ-493 m7 /q follows its linked invoices (pair 9: 'paga los $450.00 pendientes' after the payment)", () => {
  const deposit = {
    id: "i1",
    number: "INV-001",
    url: "/i/i1",
    status: "sent",
    state: "sent",
    version: 1,
    amountCents: 45000,
    paidCents: 0,
    balanceCents: 45000,
  };
  const signed = {
    id: "q1",
    status: "accepted",
    state: "accepted",
    acceptedAt: "2026-11-12T12:10:00Z",
    version: 1,
    invoices: [deposit],
    changeOrders: [] as Record<string, unknown>[],
  };
  const paid = {
    ...signed,
    invoices: [{
      ...deposit,
      status: "paid",
      state: "paid",
      paidCents: 45000,
      balanceCents: 0,
      paidAt: "2026-11-12T12:20:00Z",
    }],
  };

  test("REQ-493 the deposit paid under the signed /q page is a move — while the quote's own view did not change", () => {
    expect(publicQuoteMoved(signed, paid)).toBe(true);
    expect(publicQuoteMoved(signed, { ...signed, invoices: [{ ...deposit }] }))
      .toBe(false);
  });

  test("REQ-493 a claim, a partial payment, a new invoice, a republished invoice, or a change order decided is a move; no related documents on either side is not", () => {
    const withDeposit = (over: Record<string, unknown>) => ({
      ...signed,
      invoices: [{ ...deposit, ...over }],
    });
    expect(publicQuoteMoved(signed, withDeposit({ status: "claimed" })))
      .toBe(true);
    expect(
      publicQuoteMoved(
        signed,
        withDeposit({ paidCents: 20000, balanceCents: 25000 }),
      ),
    ).toBe(true);
    expect(publicQuoteMoved(signed, withDeposit({ version: 2 }))).toBe(true);
    expect(
      publicQuoteMoved(signed, {
        ...signed,
        invoices: [deposit, { ...deposit, id: "i2", number: "INV-002" }],
      }),
    ).toBe(true);
    const co = {
      id: "co1",
      number: "CO-001",
      status: "pending",
      deltaAmountCents: 12000,
    };
    expect(
      publicQuoteMoved(
        { ...signed, changeOrders: [co] },
        { ...signed, changeOrders: [{ ...co, status: "approved" }] },
      ),
    ).toBe(true);
    const bare = { id: "q2", status: "sent", state: "sent", version: 1 };
    expect(publicQuoteMoved(bare, { ...bare, invoices: [] })).toBe(false);
  });

  test("REQ-493 the open /q page's re-read hands over the paid projection (startPublicQuoteRefresh)", async () => {
    let shown: Record<string, unknown> = signed;
    let server: Record<string, unknown> = signed;
    let clock = 0;
    const timers = new Map<number, () => void>();
    let nextId = 1;
    const env: PollEnv = {
      now: () => clock,
      setInterval: (fn: () => void) => {
        const id = nextId++;
        timers.set(id, fn);
        return id;
      },
      clearInterval: (id: number) => {
        timers.delete(id);
      },
      doc: {
        hidden: false,
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    };
    const tick = () => {
      clock += 10_000;
      for (const fn of [...timers.values()]) fn();
    };
    const onMoved = jest.fn((fresh: Record<string, unknown>) => {
      shown = fresh;
    });
    const stop = startPublicQuoteRefresh({
      quoteId: "q1",
      shown: () => shown as never,
      onMoved: onMoved as never,
      fetchJson: () => Promise.resolve(server),
      env,
    });
    tick();
    await flush();
    expect(onMoved).not.toHaveBeenCalled();
    server = paid; // the owner confirmed the Zelle payment in another tab
    tick();
    await flush();
    expect(onMoved).toHaveBeenCalledTimes(1);
    expect(onMoved.mock.calls[0][0]).toEqual(paid);
    tick();
    await flush();
    expect(onMoved).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe("REQ-493 m7 the owner's pages follow the change feed; the public pages announce (wiring)", () => {
  /** the source of the effect around the `at`-th match of `needle` */
  function effectAround(src: string, needle: string | RegExp) {
    const at = typeof needle === "string"
      ? src.indexOf(needle)
      : src.search(needle);
    expect(at).toBeGreaterThan(-1);
    const start = src.lastIndexOf("useEffect(", at);
    const end = src.indexOf("\n  }, [", at);
    return src.slice(start, end > -1 ? end + 40 : at + 1500);
  }

  test("REQ-493 /invoices re-reads its list and forecast (refreshInvoices) on a quote or invoice change", () => {
    const src = read("front-end/islands/InvoicesPage.tsx");
    expect(src).toMatch(/from "\.\.\/lib\/change-feed\.ts"/);
    expect(src).toMatch(
      /useEffect\(\s*\(\)\s*=>\s*followChanges\(\s*isDocChange,\s*refreshInvoices,?\s*\),\s*\[\],?\s*\)/,
    );
  });

  test("REQ-493 /quotes runs its REQ-321 list re-read at once on a quote or invoice change, and an invoice change re-reads an open panel", () => {
    const src = read("front-end/islands/QuotesPage.tsx");
    expect(src).toMatch(/from "\.\.\/lib\/change-feed\.ts"/);
    const effect = effectAround(src, "startListRefresh(");
    expect(effect).toMatch(/followChanges\(\s*isDocChange,\s*refresh\s*\)/);
    expect(effect).toMatch(
      /followChanges\(\s*\(c\)\s*=>\s*c\.entityType === "invoice" && !!openIdRef\.current,\s*\(\)\s*=>\s*setOpenTick\(/,
    );
    expect(effect).toMatch(/unfollow\(\);/);
    expect(effect).toMatch(/unfollowLedger\(\);/);
  });

  test("REQ-493 the assistant chat re-reads its bound quote on a change naming it — review open or not — and takes the row when its lifecycle moved", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    expect(src).toMatch(/from "\.\.\/lib\/change-feed\.ts"/);
    expect(src).toMatch(
      /import \{ boundQuoteMoved \} from "\.\.\/lib\/live-doc-refresh\.ts"/,
    );
    const effect = effectAround(src, "followChanges(");
    expect(effect).toMatch(
      /c\.entityType === "quote" && c\.entityId === rowId/,
    );
    expect(effect).toMatch(/quotesClient\.get\(rowId\)/);
    expect(effect).toMatch(/boundQuoteMoved\(cur, fresh\)/);
    expect(effect).not.toMatch(/previewCtaId/);
    expect(effect).toMatch(/\}, \[quote\?\.id\]\);/);
  });

  test("REQ-493 the public pages announce the client's action to the owner's other tabs — and pull in nothing of the owner's feed", () => {
    const sign = read("front-end/islands/PublicSignQuote.tsx");
    expect(sign).toMatch(/from "\.\.\/lib\/change-announce\.ts"/);
    const ok = sign.indexOf('setStatus("ok");');
    expect(ok).toBeGreaterThan(-1);
    const afterOk = sign.slice(ok, sign.indexOf("onSigned?.(", ok));
    expect(afterOk).toMatch(
      /announceChange\(\{ entityType: "quote", entityId: quoteId \}\)/,
    );

    const decline = read("front-end/islands/PublicQuoteActions.tsx");
    expect(decline).toMatch(/from "\.\.\/lib\/change-announce\.ts"/);
    const declined = decline.indexOf("onDeclined();");
    expect(
      decline.slice(
        decline.lastIndexOf('setStatus("ok");', declined),
        declined,
      ),
    ).toMatch(/announceChange\(\{ entityType: "quote", entityId: quoteId \}\)/);

    const claim = read("front-end/islands/PublicInvoiceClaim.tsx");
    expect(claim).toMatch(/from "\.\.\/lib\/change-announce\.ts"/);
    const done = claim.indexOf("setDone(true);");
    expect(done).toBeGreaterThan(-1);
    expect(claim.slice(done, claim.indexOf("} catch (err)", done))).toMatch(
      /announceChange\(\{ entityType: "invoice", entityId: invoiceId \}\)/,
    );

    for (const f of [sign, decline, claim]) {
      expect(f).not.toMatch(/lib\/change-feed\.ts/);
      expect(f).not.toMatch(/lib\/notifications-feed\.ts/);
    }
    const announce = read("front-end/lib/change-announce.ts");
    expect(announce).not.toMatch(/^import /m);
  });
});
