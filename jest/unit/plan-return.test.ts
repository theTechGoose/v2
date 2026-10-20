/**
 * REQ-059 — a plan card posts to /plan/pick and the answer is a redirect: the pay page in the
 * same tab for a paid pick, back to the page for free; the stand-in page's way back is the
 * address the link carried, with charge and due on it like the CRM's receipt.
 */
import { backOf, fakeReturnHref, merchantOf, pageAfterPick, payPageOf, pickErrorOf, pickErrorQuery, resumesAfterPlan } from "../../front-end/lib/plan-return";
import { afterPickOf, handoffNext, handoffOf, handoffPage, planViewOf } from "../../front-end/lib/plan-return";

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

describe("REQ-061 plan-return — a past-due month", () => {
  test("REQ-061 a past-due month goes to its pay page the way a pending pick does", () => {
    expect(payPageOf({ status: "past_due", payUrl: "http://crm/ui/payments/charge?customer=c&due=d-dec" })).toBe("http://crm/ui/payments/charge?customer=c&due=d-dec");
    expect(payPageOf({ status: "past_due" })).toBeNull();
  });
});

// REQ-064 — the merchant account named on /plan/test?merchant=<name> rides on the card's form
describe("REQ-064 merchant", () => {
  test("REQ-064 a merchant name is a slug or nothing", () => {
    expect(merchantOf("")).toBe("");
    expect(merchantOf("  Alpha-1 ")).toBe("alpha-1");
    expect(merchantOf("bad key")).toBe("");
    expect(merchantOf("x".repeat(41))).toBe("");
  });
});

// REQ-101 — a pick naming an account the CRM has no record of is refused (422): the page the pick
// came from says so by name, instead of the generic "could not update the plan"
describe("REQ-101 merchant-unknown", () => {
  test("REQ-101 the CRM's 422 comes back as ?plan=merchant-unknown, and the page reads it", () => {
    expect(pickErrorQuery(422)).toBe("?plan=merchant-unknown");
    expect(pickErrorOf("?plan=merchant-unknown")).toBe("merchant-unknown");
    expect(pickErrorQuery(409)).toBe("?plan=email-required");
    expect(pickErrorQuery(502)).toBe("?plan=error");
  });
});

// REQ-106 — Raphael, 2026-10-20: "when i click a plan in the onboarding flow the payment link takes
// FOREVER to load … i dont care if it happens asyncronously … what i care about is that the user
// experience is good." The pick answers at once with a pending pick and no page yet; the browser
// goes to the hand-off page, which polls the plan and moves on the moment the page is there.
describe("REQ-106 pay hand-off", () => {
  const preparing = { status: "pending" as const };
  const ready = { status: "pending" as const, payUrl: "http://crm/ui/payments/charge?customer=c&due=d" };
  const refused = { status: "pending" as const, payLinkError: "merchant-unknown" as const };
  const slow = { status: "pending" as const, payLinkError: "payments-unavailable" as const };

  test("REQ-106 what a pending pick is: being prepared, ready, refused by name, or the link builder not answering yet", () => {
    expect(handoffOf(preparing)).toBe("preparing");
    expect(handoffOf(ready)).toBe("ready");
    expect(handoffOf(refused)).toBe("merchant-unknown");
    expect(handoffOf(slow)).toBe("unavailable");
    expect(handoffOf({ status: "free" })).toBe("none");
    expect(handoffOf({ status: "active", payUrl: "http://crm/x" })).toBe("none");
    expect(handoffOf(null)).toBe("none");
  });

  test("REQ-106 a pick goes to the hand-off page while its page is being prepared, straight to the page when it is already there, back with the reason when refused", () => {
    expect(handoffPage("/welcome")).toBe("/plan/pay?back=%2Fwelcome");
    expect(afterPickOf(preparing, "/welcome")).toBe("/plan/pay?back=%2Fwelcome");
    expect(afterPickOf(slow, "/settings")).toBe("/plan/pay?back=%2Fsettings");
    expect(afterPickOf(ready, "/welcome")).toBe(ready.payUrl);
    expect(afterPickOf(refused, "/settings")).toBe("/settings?plan=merchant-unknown");
    expect(afterPickOf({ status: "free" }, "/welcome")).toBe("/welcome?after=plan");
  });

  test("REQ-106 the hand-off page waits while the page is being prepared and moves the moment it is there; a refusal goes back saying why; a plan no longer pending goes on", () => {
    expect(handoffNext(preparing, "/welcome")).toBeNull();
    expect(handoffNext(slow, "/welcome")).toBeNull();
    expect(handoffNext(ready, "/welcome")).toBe(ready.payUrl);
    expect(handoffNext(refused, "/welcome")).toBe("/welcome?plan=merchant-unknown");
    expect(handoffNext({ status: "free" }, "/welcome")).toBe("/welcome?after=plan");
    expect(handoffNext({ status: "active" }, "/settings")).toBe("/settings");
    expect(handoffNext(null, "/settings")).toBe("/settings");
  });

  test("REQ-106 the cards pages show a pending pick as its page, as being prepared, or as the cards again after a refusal", () => {
    expect(planViewOf({ status: "active" })).toBe("active");
    expect(planViewOf(ready)).toBe("pay");
    expect(planViewOf(preparing)).toBe("preparing");
    expect(planViewOf(slow)).toBe("preparing");
    expect(planViewOf(refused)).toBe("cards");
    expect(planViewOf({ status: "free" })).toBe("cards");
    expect(planViewOf(null)).toBe("cards");
  });
});
