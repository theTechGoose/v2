/**
 * REQ-055 — "upgrade to monster 99 ect should just be cards and open the payment page."
 *
 * A paid pick opens the CRM's pay page itself. The tab must be opened INSIDE the click —
 * synchronously, before the mint's await — because a tab opened after an await is a popup the
 * browser blocks; it is pointed at the minted link when that arrives. Free opens nothing; a mint
 * that fails, or that answers without a pay page, closes the tab it opened; a browser that
 * refused the tab leaves the pending card's link as the way to the page.
 */
import { pickPlan, type PayTab } from "../../front-end/lib/plan-pick";

type UserPlan = Awaited<ReturnType<typeof pickPlan>>;

function fakeTab() {
  const tab = { location: { href: "" }, closed: false, close() { tab.closed = true; } };
  return tab as PayTab & { closed: boolean };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const pending: UserPlan = {
  userId: "u1", planId: "monster", status: "pending", chosenAt: "2026-10-01T00:00:00.000Z",
  payUrl: "https://payments.fake/ui/payments/charge?customer=c1&due=d1", updatedAt: "2026-10-01T00:00:00.000Z",
};

describe("REQ-055 a paid pick opens the payment page itself", () => {
  it("REQ-055 opens the tab before the mint resolves, then points it at the pay page", async () => {
    const tab = fakeTab();
    const mint = deferred<UserPlan>();
    let opened = 0;
    const picked = pickPlan("monster", () => mint.promise, () => { opened++; return tab; });
    expect(opened).toBe(1); // synchronously, inside the click
    expect(tab.location.href).toBe("");
    mint.resolve(pending);
    const plan = await picked;
    expect(plan).toBe(pending);
    expect(tab.location.href).toBe(pending.payUrl);
    expect(tab.closed).toBe(false);
  });

  it("REQ-055 free opens no tab at all", async () => {
    let opened = 0;
    const free: UserPlan = { ...pending, planId: "free", status: "free", payUrl: undefined };
    const plan = await pickPlan("free", async (id) => ({ ...free, planId: id }), () => { opened++; return fakeTab(); });
    expect(opened).toBe(0);
    expect(plan.status).toBe("free");
  });

  it("REQ-055 a mint that fails closes the tab and rethrows", async () => {
    const tab = fakeTab();
    await expect(pickPlan("assist", () => Promise.reject(new Error("502")), () => tab)).rejects.toThrow("502");
    expect(tab.closed).toBe(true);
    expect(tab.location.href).toBe("");
  });

  it("REQ-055 a mint that answers without a pay page closes the tab", async () => {
    const tab = fakeTab();
    const active: UserPlan = { ...pending, status: "active", payUrl: undefined };
    const plan = await pickPlan("monster", async () => active, () => tab);
    expect(plan.status).toBe("active");
    expect(tab.closed).toBe(true);
  });

  it("REQ-055 a browser that refused the tab still returns the pending plan (the card's link is the way)", async () => {
    const plan = await pickPlan("monster", async () => pending, () => null);
    expect(plan.status).toBe("pending");
    expect(plan.payUrl).toBe(pending.payUrl);
  });
});
