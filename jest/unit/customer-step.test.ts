/**
 * RED (TDD) — the assistant's customer step must let the user PICK AN
 * EXISTING CUSTOMER.
 *
 * Reported live (2026-08-19): "in the assistant flow I'm not sure it's
 * allowing me to pick an existing customer." Reproduced: with a saved
 * customer on the account, the terms wizard's "Who is this for?" step opens
 * on the CREATE form (AsstChat.tsx:6634 passes `preferCreate`, :7548 turns
 * that into view "form") and the pick list is only reachable through the
 * create form's footer "Atrás" — a control that reads as navigation, not as
 * "choose an existing customer" (and that the single-back rule removes).
 *
 * This unit pins the entry-view rule: when the account HAS customers (or a
 * chat-bound customer), the step opens on the pick LIST — pick-existing
 * first-class, "+ New customer" one tap away. Only an account with nobody
 * to pick jumps straight to the create form. The create form itself offers
 * a forward "choose an existing customer" affordance whenever there is
 * anyone to pick — never a back button.
 *
 * Target: shared/quote-flow/customer-step.ts
 */
import {
  customerStepEntryView,
  formOffersPickExisting,
} from "../../shared/quote-flow/customer-step";

describe("customerStepEntryView", () => {
  it("an account WITH saved customers lands on the pick list (the reported bug)", () => {
    expect(customerStepEntryView(3, false)).toBe("list");
  });

  it("even one saved customer is enough to offer the list", () => {
    expect(customerStepEntryView(1, false)).toBe("list");
  });

  it("a chat-bound customer lands on the list (the 'use from chat' option lives there)", () => {
    expect(customerStepEntryView(0, true)).toBe("list");
  });

  it("nobody to pick → straight to the create form (no empty dropdown)", () => {
    expect(customerStepEntryView(0, false)).toBe("form");
  });

  it("while the list is still loading (unknown count) stay on the list shell", () => {
    expect(customerStepEntryView(null, false)).toBe("list");
  });
});

describe("formOffersPickExisting — the form's forward affordance to the list", () => {
  it("offered whenever saved customers exist", () => {
    expect(formOffersPickExisting(2, false)).toBe(true);
  });

  it("offered when a chat-bound customer exists", () => {
    expect(formOffersPickExisting(0, true)).toBe(true);
  });

  it("hidden when there is nobody to pick (an empty list is noise)", () => {
    expect(formOffersPickExisting(0, false)).toBe(false);
  });

  it("hidden while the count is unknown", () => {
    expect(formOffersPickExisting(null, false)).toBe(false);
  });
});
