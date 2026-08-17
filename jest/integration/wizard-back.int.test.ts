/**
 * PDF p2/p8 — the wizard must support stepping BACK server-side so any step
 * can be re-edited: POST /agents/wizard/back rewinds one terms step and
 * returns the popped answer (so the UI pre-fills what was entered).
 *
 * Shipped contract: the wizard is the TERMS wizard — activated via
 * POST /agents/conversations/:id/transition-to-terms; answers are
 * { conversationId, stepId, optionId, customValue? }; back returns
 * { conversation, wizardState, activeStepId, removedMessageIds,
 *   previousAnswer? }.
 */
import { contractor, type ApiSession } from "./helpers/api";

type WizardStateShape = {
  activeStepIdx?: number;
  answers?: Array<{ stepId: string; optionId: string; customValue?: string }>;
};

describe("POST /agents/wizard/back", () => {
  let s: ApiSession;

  beforeAll(async () => {
    s = await contractor("+15125550917");
  });

  it("after answering a step, back rewinds to it with the previous answer preserved", async () => {
    const conv = await s.post("/agents/conversations", {});
    const conversationId = conv.body?.id ?? conv.body?.conversation?.id;
    expect(conversationId).toBeTruthy();

    // Enter the terms wizard.
    const trans = await s.post(
      `/agents/conversations/${conversationId}/transition-to-terms`,
      {},
    );
    expect(trans.status).toBeLessThan(400);
    const stepId: string = trans.body?.wizardState
      ? trans.body.activeStepId ?? "customer"
      : "customer";

    // Answer the first step (customer → create_new with a typed name).
    const answer = await s.post("/agents/wizard/answer", {
      conversationId,
      stepId,
      optionId: "create_new",
      customValue: "Back Button Test Customer",
    });
    expect(answer.status).toBeLessThan(400);
    const advanced = (answer.body?.wizardState ?? {}) as WizardStateShape;
    expect(advanced.answers?.length).toBeGreaterThanOrEqual(1);

    // Step back: the same step is active again and the popped answer comes
    // back so the UI can restore what was entered (editable, not lost).
    const back = await s.post("/agents/wizard/back", { conversationId });
    expect(back.status).toBeLessThan(400);
    expect(back.body?.activeStepId).toBe(stepId);
    expect(back.body?.previousAnswer?.optionId).toBe("create_new");
    expect(back.body?.previousAnswer?.customValue).toBe("Back Button Test Customer");
  });

  it("back with no active wizard is a clean no-op, not a 500", async () => {
    const conv = await s.post("/agents/conversations", {});
    const back = await s.post("/agents/wizard/back", {
      conversationId: conv.body?.id ?? conv.body?.conversation?.id,
    });
    expect(back.status).toBeLessThan(400);
    expect(back.body?.removedMessageIds).toEqual([]);
  });
});
