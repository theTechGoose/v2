/**
 * Quote status badge lifecycle (post Quote+Contract merge):
 *   Draft → (send) → Sent → (customer opens) → Viewed → (customer signs) → Accepted
 *
 * "accepted" is the single canonical terminal status — the legacy "approved"
 * value is dead (nothing writes or reads it anymore).
 *
 * Target: shared/quote-flow/quote-status.ts
 */
import {
  badgeLabel,
  canTransition,
  isAccepted,
  QUOTE_STATUS_FLOW,
  statusOnEvent,
} from "../../shared/quote-flow/quote-status";

describe("QUOTE_STATUS_FLOW", () => {
  it("is exactly draft → sent → viewed → accepted", () => {
    expect(QUOTE_STATUS_FLOW).toEqual(["draft", "sent", "viewed", "accepted"]);
  });
});

describe("statusOnEvent", () => {
  it("send moves draft → sent", () => {
    expect(statusOnEvent("draft", "send")).toBe("sent");
  });

  it("customer view moves sent → viewed", () => {
    expect(statusOnEvent("sent", "customer_viewed")).toBe("viewed");
  });

  it("signing moves viewed → accepted", () => {
    expect(statusOnEvent("viewed", "customer_signed")).toBe("accepted");
  });

  it("signing straight from sent (view event lost) still lands on accepted", () => {
    expect(statusOnEvent("sent", "customer_signed")).toBe("accepted");
  });

  it("a later view event never demotes an accepted quote", () => {
    expect(statusOnEvent("accepted", "customer_viewed")).toBe("accepted");
  });

  it("re-sending a viewed quote does not reset it to sent", () => {
    expect(statusOnEvent("viewed", "send")).toBe("viewed");
  });
});

describe("canTransition", () => {
  it("only permits forward movement along the flow", () => {
    expect(canTransition("draft", "sent")).toBe(true);
    expect(canTransition("sent", "viewed")).toBe(true);
    expect(canTransition("viewed", "accepted")).toBe(true);
    expect(canTransition("sent", "accepted")).toBe(true);
  });

  it("rejects any backwards movement", () => {
    expect(canTransition("sent", "draft")).toBe(false);
    expect(canTransition("viewed", "sent")).toBe(false);
    expect(canTransition("accepted", "viewed")).toBe(false);
  });

  it("accepted is terminal", () => {
    expect(canTransition("accepted", "draft")).toBe(false);
    expect(canTransition("accepted", "sent")).toBe(false);
  });
});

describe("isAccepted — the one 'customer signed' predicate", () => {
  it("true on the canonical terminal status", () => {
    expect(isAccepted({ status: "accepted" })).toBe(true);
  });

  it("true on a persisted acceptance stamp even if the status lags", () => {
    expect(
      isAccepted({ status: "sent", acceptedAt: "2026-08-18T11:12:14.000Z" }),
    )
      .toBe(true);
  });

  it("false for every open state — and the dead legacy 'approved' value", () => {
    expect(isAccepted({ status: "draft" })).toBe(false);
    expect(isAccepted({ status: "sent" })).toBe(false);
    expect(isAccepted({ status: "viewed" })).toBe(false);
    // "approved" was retired by the merge; nothing writes it, nothing reads it.
    expect(isAccepted({ status: "approved" })).toBe(false);
  });
});

describe("badgeLabel", () => {
  it("maps each status to its display badge", () => {
    expect(badgeLabel("draft", "en")).toMatch(/draft/i);
    expect(badgeLabel("sent", "en")).toMatch(/sent/i);
    expect(badgeLabel("viewed", "en")).toMatch(/viewed/i);
    expect(badgeLabel("accepted", "en")).toBe("Accepted");
  });

  it("localizes badges for the Spanish-first app", () => {
    expect(badgeLabel("draft", "es")).not.toMatch(/draft/i);
    expect(badgeLabel("accepted", "es")).toBe("Aceptada");
  });
});
