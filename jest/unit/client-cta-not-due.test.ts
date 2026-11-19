/**
 * REQ-1066 — LOOP-007 cycle 2, QA issue q2-56 [BUG_POLISH]: right after the
 * batch send, the /customers card read "$85 outstanding · INV-001 · due in 30
 * days." beside "Send a kind reminder →". The CTA chooser looked only at the
 * open balance (front-end/lib/client-actions.ts ctaKindFor, and the same rule
 * in shared/card-actions clientCtaAction / clientCtaMessageKind, REQ-277 /
 * REQ-626) and never at the card's balanceSubParts.kind.
 *
 * A reminder is the headline nudge only for money that is due: an invoice that
 * is overdue or due today. An invoice due in 30 days does not headline
 * "Send a kind reminder".
 */
import { ctaKindFor } from "../../front-end/lib/client-actions";
import { ctaFor } from "../../front-end/lib/clients-display";
import { clientCtaMessageKind } from "../../shared/card-actions/mod";

// deno-lint-ignore no-explicit-any
type Card = any;

const card = (kind: string, days?: number): Card => ({
  id: "c1",
  name: "Ana Torres",
  status: "active",
  balanceCents: 8500,
  phoneNumber: "(512) 555-0101",
  balanceSubParts: { kind, ref: "INV-001", ...(days === undefined ? {} : { days }) },
});

describe("REQ-1066 (LOOP-007 q2-56): the customer card does not push a reminder for an invoice that is not yet due", () => {
  it("REQ-1066 ctaKindFor: $85 due in 30 days is not 'reminder'", () => {
    expect(ctaKindFor(card("dueIn", 30))).not.toBe("reminder");
  });

  it("REQ-1066 clientCtaMessageKind: $85 due in 30 days does not pre-fill a reminder", () => {
    expect(clientCtaMessageKind(card("dueIn", 30))).not.toBe("reminder");
  });

  it("REQ-1066 ctaFor (the label on the card): $85 due in 30 days does not read 'Send a kind reminder'", () => {
    expect(ctaFor(card("dueIn", 30), "en")).not.toBe("Send a kind reminder");
  });

  it("REQ-1066 an overdue invoice and one due today still headline the reminder (label + message)", () => {
    for (const c of [card("overdue"), card("dueToday")]) {
      expect(ctaKindFor(c)).toBe("reminder");
      expect(clientCtaMessageKind(c)).toBe("reminder");
      expect(ctaFor(c, "en")).toBe("Send a kind reminder");
    }
  });
});
