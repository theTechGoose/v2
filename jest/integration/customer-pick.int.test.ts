/**
 * RED (TDD) — picking an EXISTING customer in the assistant, integration
 * layer.
 *
 * Reported live (2026-08-19): the assistant's customer step doesn't appear
 * to allow picking an existing customer. The client-side entry-view rule is
 * pinned in shared/quote-flow/customer-step.ts (unit); this test drives the
 * REAL seams that rule and the picker depend on:
 *
 *  1. GET /customers — the list the panel offers (assistantClient
 *     .listCustomers) must return the saved customer;
 *  2. the shared entry rule, fed the REAL list, must land on the pick list;
 *  3. POST /agents/wizard/answer with optionId "pick_existing" and
 *     { customer: { id } } — the pick itself — must bind that customer to
 *     the conversation (the step summary names them).
 */
import { contractor, seedCustomer, type ApiSession } from "./helpers/api";
import { customerStepEntryView } from "../../shared/quote-flow/customer-step";

const PHONE = "+15125550932";
const PICK_NAME = "Existing Eddie";

describe("assistant customer step — pick an existing customer end to end", () => {
  let s: ApiSession;
  let customerId: string;

  beforeAll(async () => {
    s = await contractor(PHONE);
    customerId = await seedCustomer(s, {
      name: PICK_NAME,
      email: "existing.eddie@blackhole.postmarkapp.com",
      phoneNumber: "+15125550933",
    });
  });

  it("GET /customers returns the saved customer, and the entry rule lands on the pick list", async () => {
    const list = await s.get("/customers");
    expect(list.status).toBeLessThan(400);
    const customers = (Array.isArray(list.body) ? list.body : list.body?.items ?? []) as Array<{ id: string; name: string }>;
    expect(customers.some((c) => c.id === customerId)).toBe(true);

    // The panel, fed this real list, must open on the pick list — the
    // reported bug was the create form opening instead.
    expect(customerStepEntryView(customers.length, false)).toBe("list");
  });

  it("pick_existing binds the chosen customer to the conversation", async () => {
    // The UI's own phase-2 seed sequence (AsstChat.tsx seedPhase2).
    const quote = await s.post("/quotes", {
      summary: "Fence painting — 50 ft",
      lineItems: [{ description: "Paint 50ft fence", quantity: 1, unit: "ea", price: 50000 }],
      estimatedTotal: 50000,
      status: "sent",
    });
    expect(quote.body?.id).toBeTruthy();

    const conv = await s.post("/agents/conversations", { quoteId: quote.body.id });
    const convoId = conv.body?.id ?? conv.body?.conversation?.id;
    expect(convoId).toBeTruthy();

    const trans = await s.post(`/agents/conversations/${convoId}/transition-to-terms`, {});
    expect(trans.status).toBeLessThan(400);

    const answer = await s.post("/agents/wizard/answer", {
      conversationId: convoId,
      stepId: trans.body?.activeStepId ?? "customer",
      optionId: "pick_existing",
      customer: { id: customerId },
    });
    expect(answer.status).toBeLessThan(400);

    // The conversation now carries the picked customer — the step summary
    // (or the conversation snapshot) names Existing Eddie.
    const snap = await s.get(`/agents/conversations/${convoId}`);
    expect(snap.status).toBeLessThan(400);
    const snapText = JSON.stringify(snap.body);
    expect(snapText).toContain(PICK_NAME);
  });
});
