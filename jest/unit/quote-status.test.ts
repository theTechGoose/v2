/**
 * PDF p10 — quote status badge lifecycle:
 *   Draft → (send) → Sent → (customer opens) → Viewed → (customer signs) → Approved
 *
 * Target: shared/quote-flow/quote-status.ts
 */
import {
  badgeLabel,
  canTransition,
  QUOTE_STATUS_FLOW,
  statusOnEvent,
} from "../../shared/quote-flow/quote-status";

describe("QUOTE_STATUS_FLOW", () => {
  it("is exactly draft → sent → viewed → approved", () => {
    expect(QUOTE_STATUS_FLOW).toEqual(["draft", "sent", "viewed", "approved"]);
  });
});

describe("statusOnEvent", () => {
  it("send moves draft → sent", () => {
    expect(statusOnEvent("draft", "send")).toBe("sent");
  });

  it("customer view moves sent → viewed", () => {
    expect(statusOnEvent("sent", "customer_viewed")).toBe("viewed");
  });

  it("signing moves viewed → approved", () => {
    expect(statusOnEvent("viewed", "customer_signed")).toBe("approved");
  });

  it("signing straight from sent (view event lost) still lands on approved", () => {
    expect(statusOnEvent("sent", "customer_signed")).toBe("approved");
  });

  it("a later view event never demotes an approved quote", () => {
    expect(statusOnEvent("approved", "customer_viewed")).toBe("approved");
  });

  it("re-sending a viewed quote does not reset it to sent", () => {
    expect(statusOnEvent("viewed", "send")).toBe("viewed");
  });
});

describe("canTransition", () => {
  it("only permits forward movement along the flow", () => {
    expect(canTransition("draft", "sent")).toBe(true);
    expect(canTransition("sent", "viewed")).toBe(true);
    expect(canTransition("viewed", "approved")).toBe(true);
    expect(canTransition("sent", "approved")).toBe(true);
  });

  it("rejects any backwards movement", () => {
    expect(canTransition("sent", "draft")).toBe(false);
    expect(canTransition("viewed", "sent")).toBe(false);
    expect(canTransition("approved", "viewed")).toBe(false);
  });

  it("approved is terminal", () => {
    expect(canTransition("approved", "draft")).toBe(false);
    expect(canTransition("approved", "sent")).toBe(false);
  });
});

describe("badgeLabel", () => {
  it("maps each status to its display badge", () => {
    expect(badgeLabel("draft", "en")).toMatch(/draft/i);
    expect(badgeLabel("sent", "en")).toMatch(/sent/i);
    expect(badgeLabel("viewed", "en")).toMatch(/viewed/i);
    expect(badgeLabel("approved", "en")).toMatch(/approved/i);
  });

  it("localizes badges for the Spanish-first app", () => {
    expect(badgeLabel("draft", "es")).not.toMatch(/draft/i);
    expect(badgeLabel("approved", "es")).not.toMatch(/approved/i);
  });
});
