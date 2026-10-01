/**
 * REQ-059 — a plan card posts to /plan/pick and the answer is a redirect: the pay page in the
 * same tab for a paid pick, back to the page for free; the stand-in page's way back is the
 * address the link carried, with charge and due on it like the CRM's receipt.
 */
import { backOf, fakeReturnHref, pageAfterPick, payPageOf, pickErrorOf, pickErrorQuery, resumesAfterPlan } from "../../front-end/lib/plan-return";

describe("REQ-059 plan-return", () => {
  test("REQ-059 a pending paid pick goes to its pay page; free and active go nowhere", () => {
    expect(payPageOf({ status: "pending", payUrl: "http://crm/ui/payments/charge?customer=c&due=d" })).toBe("http://crm/ui/payments/charge?customer=c&due=d");
    expect(payPageOf({ status: "free" })).toBeNull();
    expect(payPageOf({ status: "active", payUrl: "http://crm/x" })).toBeNull();
    expect(payPageOf({ status: "pending" })).toBeNull();
  });

  test("REQ-059 a pick goes back only to the pages that show the cards; anything else is settings", () => {
    expect(backOf("/welcome")).toBe("/welcome");
    expect(backOf("/settings")).toBe("/settings");
    expect(backOf("https://evil.example/")).toBe("/settings");
    expect(backOf("")).toBe("/settings");
  });

  test("REQ-059 after a pick the wizard resumes past the plan step, settings is just settings", () => {
    expect(pageAfterPick("/welcome")).toBe("/welcome?after=plan");
    expect(pageAfterPick("/settings")).toBe("/settings");
    expect(resumesAfterPlan("?after=plan")).toBe(true);
    expect(resumesAfterPlan("?after=plan&charge=x")).toBe(true);
    expect(resumesAfterPlan("")).toBe(false);
  });

  test("REQ-059 a failed pick comes back saying why: no email on the account, or the CRM did not answer", () => {
    expect(pickErrorQuery(409)).toBe("?plan=email-required");
    expect(pickErrorQuery(502)).toBe("?plan=error");
    expect(pickErrorOf("?plan=email-required")).toBe("email-required");
    expect(pickErrorOf("?plan=error&x=1")).toBe("error");
    expect(pickErrorOf("?plan=whatever")).toBeNull();
    expect(pickErrorOf("")).toBeNull();
  });

  test("REQ-059 the stand-in page goes back to the link's return address carrying charge and due; settings when the link carried none", () => {
    expect(fakeReturnHref("http://localhost:5280/plan/return?due=d-1", "d-1")).toBe("http://localhost:5280/plan/return?due=d-1&charge=fake");
    expect(fakeReturnHref("http://localhost:5280/plan/return", "d-2")).toBe("http://localhost:5280/plan/return?charge=fake&due=d-2");
    expect(fakeReturnHref("", "d-3")).toBe("/settings");
  });
});
