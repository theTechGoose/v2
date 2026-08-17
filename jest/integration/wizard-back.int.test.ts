/**
 * PDF p2/p8 — the wizard must support stepping BACK server-side so any step
 * (especially Job Details) can be edited: POST /agents/wizard/back returns
 * the previous step WITH the previously entered answer preserved.
 *
 * Uses the shipped answer contract ({ conversationId, stepId, optionId,
 * customValue? } — wizard-controller): the current step and its options are
 * read from the conversation's wizardState first.
 */
import { contractor, type ApiSession } from "./helpers/api";

type WizardOption = { id: string };
type WizardState = {
  stepId?: string;
  currentStepId?: string;
  options?: WizardOption[];
  customOptionId?: string;
};

async function currentWizardState(s: ApiSession, conversationId: string): Promise<WizardState> {
  const { body } = await s.get(`/agents/conversations/${conversationId}`);
  return body.wizardState ?? body.conversation?.wizardState ?? {};
}

describe("POST /agents/wizard/back", () => {
  const TYPED = "Remove old toilet, install new toilet, test for leaks";
  let s: ApiSession;

  beforeAll(async () => {
    s = await contractor("+15125550917");
  });

  it("after answering a step, back returns to that step with the answer intact", async () => {
    const conv = await s.post("/agents/conversations", {});
    const conversationId = conv.body?.id;
    expect(conversationId).toBeTruthy();

    const wiz = await currentWizardState(s, conversationId);
    const stepId = wiz.stepId ?? wiz.currentStepId;
    expect(stepId).toBeTruthy();

    // Answer the current step with a typed custom value (the job details).
    const optionId = wiz.customOptionId ?? wiz.options?.[0]?.id ?? "custom";
    const answer = await s.post("/agents/wizard/answer", {
      conversationId,
      stepId,
      optionId,
      customValue: TYPED,
    });
    expect(answer.status).toBeLessThan(400);

    // Step back: the previous step must come back editable, seeded with what
    // was typed.
    const back = await s.post("/agents/wizard/back", { conversationId });
    expect(back.status).toBeLessThan(400);
    expect(JSON.stringify(back.body)).toMatch(/Remove old toilet/);
  });

  it("back at the first step is a clean no-op/exit, not a 500", async () => {
    const conv = await s.post("/agents/conversations", {});
    const back = await s.post("/agents/wizard/back", { conversationId: conv.body?.id });
    expect(back.status).toBeLessThan(500);
  });
});
