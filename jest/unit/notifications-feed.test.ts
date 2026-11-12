/**
 * REQ-299 (demo cycle 1, issue p4 "heavy polling", RCA item b) — /dashboard fetched
 * `GET /notifications?limit=10` twice over: DashboardPage once on load for its Activity panel and
 * DashTopbar every 10 s for its ticker, each into its own state. One feed
 * (`front-end/lib/notifications-feed.ts`) now owns the list: a single-flight `refreshNotifications`,
 * `readNotifications` and `subscribeNotifications`. The topbar's poll refreshes it, the page reads
 * it — one request per period feeds both, and the Activity panel follows the ticker live.
 */
import * as fs from "fs";
import * as path from "path";
import {
  _resetNotificationsForTest,
  readNotifications,
  refreshNotifications,
  subscribeNotifications,
} from "../../front-end/lib/notifications-feed";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const item = (id: string) =>
  ({ id, title: id, body: "", createdAt: "2026-11-12T00:00:00Z" }) as never;

describe("REQ-299 one notifications feed", () => {
  afterEach(() => _resetNotificationsForTest());

  test("REQ-299 refresh fetches once and every subscriber gets the list", async () => {
    const fetcher = jest.fn(() => Promise.resolve([item("a"), item("b")]));
    _resetNotificationsForTest(fetcher);
    const seen: unknown[] = [];
    const off = subscribeNotifications((items) => seen.push(items));
    expect(readNotifications()).toEqual([]);
    await refreshNotifications();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(readNotifications().map((n) => n.id)).toEqual(["a", "b"]);
    expect(seen).toHaveLength(1);
    off();
    await refreshNotifications();
    expect(seen).toHaveLength(1);
  });

  test("REQ-299 two callers at once share one request (the page's load and the topbar's tick)", async () => {
    let release!: (v: unknown[]) => void;
    const fetcher = jest.fn(() =>
      // the first call waits for `release`; later ones answer at once
      fetcher.mock.calls.length === 1
        ? new Promise<never[]>((r) => (release = r as never))
        : Promise.resolve([] as never[])
    );
    _resetNotificationsForTest(fetcher);
    const a = refreshNotifications();
    const b = refreshNotifications();
    expect(fetcher).toHaveBeenCalledTimes(1);
    release([item("x")]);
    expect((await a).map((n) => n.id)).toEqual(["x"]);
    expect((await b).map((n) => n.id)).toEqual(["x"]);
    await refreshNotifications();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test("REQ-299 a failed fetch keeps the last list and rejects nobody's subscriber", async () => {
    _resetNotificationsForTest(() => Promise.resolve([item("keep")]));
    await refreshNotifications();
    _resetNotificationsForTest(() => Promise.reject(new Error("blip")), {
      keep: true,
    });
    await expect(refreshNotifications()).rejects.toThrow("blip");
    expect(readNotifications().map((n) => n.id)).toEqual(["keep"]);
  });

  test("REQ-299 DashboardPage reads the feed and makes no notifications request of its own", () => {
    const src = read("front-end/islands/DashboardPage.tsx");
    expect(src).not.toMatch(/dashboardClient\.notifications\(/);
    expect(src).toMatch(/from "\.\.\/lib\/notifications-feed\.ts"/);
    expect(src).toMatch(/subscribeNotifications\(/);
  });

  test("REQ-299 DashTopbar polls the feed and reads it, instead of its own copy of the list", () => {
    const src = read("front-end/islands/DashTopbar.tsx");
    expect(src).not.toMatch(/dashboardClient\.notifications\(/);
    expect(src).toMatch(
      /startPoll\(refreshNotifications, 10_000[,)]/, /* REQ-424: + idleMaxMs */
    );
    expect(src).toMatch(/subscribeNotifications\(/);
  });
});
