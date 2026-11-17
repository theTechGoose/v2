/**
 * REQ-398 — demo-loop cycle 2, issues M15 / m25 / p13-j: the public change
 * order page (/co/:id).
 *
 *  - M15: the contractor's own browser was offered "Approve this change" on
 *    their own change order. Like /q (REQ-306), the business's own viewer of
 *    a pending order sees a preview banner, not the approve form, unless the
 *    in-person override `?as=customer&confirm=1` is on.
 *  - m25: the page read "Current total $9,600 → New total $10,450" — the
 *    invoice's totals, read as the job's. The headline is now the JOB total
 *    (the quote's agreed total before and after the change); the invoice
 *    numbers sit under it, labelled "This invoice".
 *  - p13-j: /co had no EN | ES toggle and ignored ?lang=. It now reads ?lang=
 *    first and mounts PublicLangToggle, like /i (REQ-272).
 *  - the page re-reads the order while it is open (M13's /co part) and
 *    reloads when the decision lands, so the headline follows.
 */
import * as fs from "fs";
import * as path from "path";
import { type PollEnv } from "../../front-end/lib/poll";
import {
  changeOrderJobTotals,
  changeOrderPreview,
} from "../../shared/quote-flow/change-order-view";
import {
  changeOrderMoved,
  startChangeOrderRefresh,
} from "../../front-end/lib/public-change-order-refresh";

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

// The demo's job: a $19,200 quote billed 50/50; an +$850 order on INV-002.
const QUOTE = { id: "q1", estimatedTotal: 1_920_000 };

describe("REQ-398 m25 changeOrderJobTotals — the job's agreed total before and after the change", () => {
  test("REQ-398 a pending +$850 on a $19,200 job reads $19,200 → $20,050", () => {
    expect(
      changeOrderJobTotals(QUOTE, [
        { id: "co1", status: "pending", deltaAmountCents: 85_000 },
      ], "co1"),
    ).toEqual({ beforeCents: 1_920_000, afterCents: 2_005_000 });
  });

  test("REQ-398 an APPROVED order is not counted twice — before excludes itself", () => {
    expect(
      changeOrderJobTotals(QUOTE, [
        { id: "co1", status: "approved", deltaAmountCents: 85_000 },
      ], "co1"),
    ).toEqual({ beforeCents: 1_920_000, afterCents: 2_005_000 });
  });

  test("REQ-398 other approved orders are part of the agreement; pending and declined ones are not", () => {
    expect(
      changeOrderJobTotals(QUOTE, [
        { id: "co0", status: "approved", deltaAmountCents: 10_000 },
        { id: "coX", status: "pending", deltaAmountCents: 99_999 },
        { id: "coY", status: "declined", deltaAmountCents: 77_777 },
        { id: "co1", status: "pending", deltaAmountCents: -30_000 },
      ], "co1"),
    ).toEqual({ beforeCents: 1_930_000, afterCents: 1_900_000 });
  });

  test("REQ-398 a quote with no estimatedTotal sums its lines; a credit never drives the job below zero", () => {
    expect(
      changeOrderJobTotals(
        { id: "q2", lineItems: [{ price: 5_000, quantity: 2 }] },
        [{ id: "co1", status: "pending", deltaAmountCents: -50_000 }],
        "co1",
      ),
    ).toEqual({ beforeCents: 10_000, afterCents: 0 });
  });
});

describe("REQ-398 M15 changeOrderPreview — the business's own viewer previews, never approves", () => {
  test("REQ-398 internal + pending + no override → preview", () => {
    expect(changeOrderPreview({ internal: true, status: "pending" }, "")).toBe(
      true,
    );
    expect(
      changeOrderPreview({ internal: true, status: "pending" }, "?lang=es"),
    ).toBe(true);
  });

  test("REQ-398 the in-person override (?as=customer&confirm=1) shows the form; half an override does not", () => {
    expect(
      changeOrderPreview(
        { internal: true, status: "pending" },
        "?as=customer&confirm=1",
      ),
    ).toBe(false);
    expect(
      changeOrderPreview({ internal: true, status: "pending" }, "?as=customer"),
    ).toBe(true);
  });

  test("REQ-398 the customer (no flag) and a decided order are never a preview", () => {
    expect(changeOrderPreview({ status: "pending" }, "")).toBe(false);
    expect(changeOrderPreview({ internal: true, status: "approved" }, ""))
      .toBe(false);
    expect(changeOrderPreview({ internal: true, status: "declined" }, ""))
      .toBe(false);
  });
});

describe("REQ-398 the open /co page re-reads the order and reloads when the decision lands", () => {
  test("REQ-398 changeOrderMoved: status or version change is a move", () => {
    expect(changeOrderMoved({ status: "pending" }, { status: "pending" }))
      .toBe(false);
    expect(changeOrderMoved({ status: "pending" }, { status: "approved" }))
      .toBe(true);
    expect(
      changeOrderMoved({ status: "pending", version: 1 }, {
        status: "pending",
        version: 2,
      }),
    ).toBe(true);
  });

  test("REQ-398 polls GET /api/change-orders/:id/public and reloads once when the customer approves elsewhere", async () => {
    const f = fakeEnv();
    const seen: string[] = [];
    let server: Record<string, unknown> = { status: "pending", version: 1 };
    const reload = jest.fn();
    const stop = startChangeOrderRefresh({
      changeOrderId: "co-1",
      shown: () => ({ status: "pending", version: 1 }),
      fetchJson: (url) => {
        seen.push(url);
        return Promise.resolve(server);
      },
      reload,
      env: f.env,
    });
    f.tick();
    await flush();
    expect(seen).toEqual(["/api/change-orders/co-1/public"]);
    expect(reload).not.toHaveBeenCalled();
    server = { status: "approved", version: 1 };
    f.tick();
    await flush();
    expect(reload).toHaveBeenCalledTimes(1);
    f.tick();
    await flush();
    expect(reload).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe("REQ-398 wiring — /co reads ?lang=, mounts the EN | ES toggle, forwards the session, and shows job totals", () => {
  const route = read("front-end/routes/co/[id].tsx");
  const island = read("front-end/islands/PublicChangeOrderActions.tsx");

  test("REQ-398 p13-j: ?lang= is read first and PublicLangToggle is mounted", () => {
    expect(route).toMatch(/query:\s*url\.searchParams\.get\("lang"\)/);
    expect(route).toContain("<PublicLangToggle");
    expect(route).toContain('langToggleHref(url.href, "es")');
    expect(route).toContain("ctx.state.lang = lang");
  });

  test("REQ-398 M15: the SSR read carries the viewer's session so the backend can say `internal`", () => {
    expect(route).toMatch(/ssrBackendGetAuthed<ChangeOrderPublic>/);
    expect(route).toMatch(/internal=\{co\.internal === true\}/);
    expect(island).toContain('data-cy="co-internal-preview"');
    expect(island).toContain("owner_cannot_approve");
    expect(island).toContain("startChangeOrderRefresh");
  });

  test("REQ-398 m25: the headline is the job total; invoice rows are labelled 'This invoice'", () => {
    expect(route).toContain('data-cy="co-job-total"');
    expect(route).toContain("changeOrderPublic.jobTotal");
    expect(route).toContain("changeOrderPublic.thisInvoiceNow");
  });

  test("REQ-398 en and es carry the same new keys", () => {
    const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
    const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
    const keys = [
      "changeOrderPublic.jobTotal",
      "changeOrderPublic.addedToInvoice",
      "changeOrderPublic.creditedOnInvoice",
      "changeOrderPublic.thisInvoiceNow",
      "changeOrderPublic.thisInvoiceBefore",
      "changeOrderPublic.thisInvoiceAfter",
      "changeOrderPublic.thisInvoiceProposed",
      "changeOrderPublic.internalPreview",
      "changeOrderPublic.internalPreviewBody",
      "changeOrderPublic.internalPreviewInPerson",
    ];
    for (const k of keys) {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
      expect(es[k]).not.toBe(en[k]);
    }
    expect(en["changeOrderPublic.jobTotal"]).toBe("Job total");
    expect(en["changeOrderPublic.thisInvoiceNow"]).toMatch(/^This invoice/);
  });
});
