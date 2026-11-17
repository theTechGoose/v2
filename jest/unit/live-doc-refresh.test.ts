/**
 * REQ-396 (demo-loop cycle 2, issue M13) — the open staff panel and the
 * customer's /q page follow the server after a sign / publish.
 *
 * The demo (fleet-4 :294): the live toast said "Dana Price accepted" while
 * the open Q-001 panel on /quotes still read SENT / Version 2 · Revised / Out
 * for response and offered "Edit → Version 3". RCA: the panel's loader effect
 * depends on [openId, openTick] and openTick moved only on the panel's own
 * save/publish; REQ-321's 30 s re-read refreshed the cards only. /q fetched
 * its projection once (PublicQuoteView mount effect) and had no refresh.
 */
import * as fs from "fs";
import * as path from "path";
import { type PollEnv } from "../../front-end/lib/poll";
import {
  openQuoteMoved,
  publicQuoteMoved,
  QUOTE_REFRESH_MS,
  startPublicQuoteRefresh,
} from "../../front-end/lib/live-doc-refresh";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

function fakeEnv() {
  let nextId = 1;
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let clock = 0;
  let period = 0;
  const env: PollEnv = {
    now: () => clock,
    setInterval: (fn: () => void, ms: number) => {
      period = Math.max(period, ms);
      const id = nextId++;
      timers.set(id, { fn, ms });
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
  return {
    env,
    timers,
    tick() {
      clock += period;
      for (const t of [...timers.values()]) t.fn();
    },
  };
}

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

describe("REQ-396 M13 openQuoteMoved — did the open quote's card change under the panel?", () => {
  const open = {
    id: "q1",
    status: "sent",
    version: 2,
    publishedAt: "2026-11-12T10:00:00Z",
  };

  test("REQ-396 the same card (derived fields aside) is not a move", () => {
    expect(
      openQuoteMoved(open, { ...open, stage: "out", opens: 3, daysIn: 1 }),
    ).toBe(false);
  });

  test("REQ-396 the client signed (fleet-4 :294) is a move", () => {
    expect(
      openQuoteMoved(open, {
        ...open,
        status: "accepted",
        acceptedAt: "2026-11-12T10:05:00Z",
      }),
    ).toBe(true);
    expect(
      openQuoteMoved(open, { ...open, acceptedAt: "2026-11-12T10:05:00Z" }),
    ).toBe(true);
  });

  test("REQ-396 declined, viewed, and a new published version are moves", () => {
    expect(openQuoteMoved(open, { ...open, status: "lost" })).toBe(true);
    expect(openQuoteMoved(open, { ...open, status: "viewed" })).toBe(true);
    expect(
      openQuoteMoved(open, {
        ...open,
        version: 3,
        publishedAt: "2026-11-12T11:00:00Z",
      }),
    ).toBe(true);
  });

  test("REQ-396 nothing open, still loading, or the quote gone from the list is never a move", () => {
    expect(openQuoteMoved(null, { ...open, status: "accepted" })).toBe(false);
    expect(openQuoteMoved(open, undefined)).toBe(false);
  });
});

describe("REQ-396 M13 publicQuoteMoved — /q compares deriveQuoteView mode + version", () => {
  const shown = { id: "q1", status: "sent", state: "sent", version: 1 };

  test("REQ-396 the same view is not a move (viewed bookkeeping, opens)", () => {
    expect(publicQuoteMoved(shown, { ...shown })).toBe(false);
    expect(publicQuoteMoved(shown, { ...shown, status: "viewed" })).toBe(
      false,
    );
  });

  test("REQ-396 signed elsewhere, declined, a new version, issued from draft are moves", () => {
    expect(
      publicQuoteMoved(shown, {
        ...shown,
        status: "accepted",
        acceptedAt: "x",
      }),
    ).toBe(true);
    expect(publicQuoteMoved(shown, { ...shown, status: "lost" })).toBe(true);
    expect(
      publicQuoteMoved(shown, { ...shown, version: 2, state: "revised" }),
    ).toBe(true);
    expect(
      publicQuoteMoved({ ...shown, state: "draft" }, { ...shown }),
    ).toBe(true);
  });
});

describe("REQ-396 M13 startPublicQuoteRefresh — the open /q page re-reads its projection", () => {
  test("REQ-396 polls the public quote every 10 s WITHOUT recording an open, hands a moved projection over, keeps polling", async () => {
    const f = fakeEnv();
    const seen: string[] = [];
    let server: Record<string, unknown> = { id: "q1", status: "sent" };
    let shown: Record<string, unknown> = { id: "q1", status: "sent" };
    const onMoved = jest.fn((fresh: Record<string, unknown>) => {
      shown = fresh;
    });
    const stop = startPublicQuoteRefresh({
      quoteId: "q1",
      shown: () => shown as { id: string },
      onMoved,
      fetchJson: async (url) => {
        seen.push(url);
        return server;
      },
      env: f.env,
    });
    expect(QUOTE_REFRESH_MS).toBe(10_000);
    expect([...f.timers.values()][0]?.ms).toBe(10_000);
    f.tick();
    await flush();
    expect(seen).toEqual(["/api/quotes/q1/public?refresh=1"]);
    expect(onMoved).not.toHaveBeenCalled();

    server = { id: "q1", status: "accepted", acceptedAt: "x" };
    f.tick();
    await flush();
    expect(onMoved).toHaveBeenCalledTimes(1);
    expect(onMoved.mock.calls[0][0]).toEqual(server);
    // the baseline is read at every tick: the swap moved it, no repeat
    f.tick();
    await flush();
    expect(onMoved).toHaveBeenCalledTimes(1);
    stop();
    expect(f.timers.size).toBe(0);
  });

  test("REQ-396 nothing shown yet, or a failed read, hands nothing over", async () => {
    const f = fakeEnv();
    const onMoved = jest.fn();
    let fail = false;
    const stop = startPublicQuoteRefresh({
      quoteId: "q2",
      shown: () => null,
      onMoved,
      fetchJson: async () => {
        if (fail) throw new Error("502");
        return { id: "q2", status: "accepted" };
      },
      env: f.env,
    });
    f.tick();
    await flush();
    fail = true;
    f.tick();
    await flush();
    expect(onMoved).not.toHaveBeenCalled();
    stop();
  });
});

describe("REQ-396 M13 the views are wired to the refreshers", () => {
  test("REQ-396 QuotesPage's REQ-321 list re-read bumps openTick when the open quote's card moved", () => {
    const src = read("front-end/islands/QuotesPage.tsx");
    const at = src.indexOf("startListRefresh(");
    const effect = src.slice(src.lastIndexOf("useEffect(", at), at + 200);
    expect(effect).toMatch(/openQuoteMoved\(/);
    expect(effect).toMatch(/setOpenTick\(/);
    expect(src).toMatch(/from "\.\.\/lib\/live-doc-refresh\.ts"/);
  });

  test("REQ-396 PublicQuoteView starts the /q refresh in an effect and swaps the fresh projection in place", () => {
    const src = read("front-end/islands/PublicQuoteView.tsx");
    expect(src).toMatch(/from "\.\.\/lib\/live-doc-refresh\.ts"/);
    const at = src.search(/startPublicQuoteRefresh(<\w+>)?\(/);
    expect(at).toBeGreaterThan(-1);
    const effect = src.slice(src.lastIndexOf("useEffect(", at), at + 500);
    expect(effect).toMatch(/shown:/);
    expect(effect).toMatch(/onMoved:/);
    expect(src).not.toMatch(/setInterval\(/);
  });
});
