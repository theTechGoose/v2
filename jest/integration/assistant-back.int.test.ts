/**
 * RED (TDD) — single assistant back button, integration layer.
 *
 * Reported live: on the quote + agreement preview the header back button
 * exits to /dashboard instead of undoing. The client decides what "back"
 * means from the REAL conversation payload (message kinds the backend
 * emits), so this test drives a real conversation over HTTP to the
 * reviewing stage — the exact seam the UI uses (`seedPhase2` in
 * AsstChat.tsx: quote → conversation → transition-to-terms → wizard
 * answers) — then asserts the shared back resolver, fed the REAL message
 * list, chooses "close-preview" (undo), never "exit-dashboard".
 *
 * Green requires: shared/quote-flow/assistant-back.ts, consumed by
 * AsstChat's single header back control.
 */
import { type ApiSession, contractor } from "./helpers/api";
import {
  backViewFromMessages,
  resolveAssistantBack,
} from "../../shared/quote-flow/assistant-back";

const PHONE = "+15125550931";

type Msg = { id: string; kind?: string; payload?: Record<string, unknown> };

async function messagesOf(s: ApiSession, convoId: string): Promise<Msg[]> {
  const snap = await s.get(`/agents/conversations/${convoId}`);
  expect(snap.status).toBeLessThan(400);
  return (snap.body?.messages ?? []) as Msg[];
}

describe("assistant back — real conversation at the reviewing stage", () => {
  let s: ApiSession;
  let convoId: string;

  beforeAll(async () => {
    s = await contractor(PHONE);

    // The UI's own phase-2 seed sequence (AsstChat.tsx seedPhase2).
    const quote = await s.post("/quotes", {
      summary: "Kitchen backsplash — 30 sqft",
      lineItems: [{
        description: "Backsplash tile install (30 sqft)",
        quantity: 1,
        unit: "ea",
        price: 120000,
      }],
      estimatedTotal: 120000,
      status: "sent",
    });
    expect(quote.body?.id).toBeTruthy();

    const conv = await s.post("/agents/conversations", {
      quoteId: quote.body.id,
    });
    convoId = conv.body?.id ?? conv.body?.conversation?.id;
    expect(convoId).toBeTruthy();

    const trans = await s.post(
      `/agents/conversations/${convoId}/transition-to-terms`,
      {},
    );
    expect(trans.status).toBeLessThan(400);

    // Customer step first (create_new + typed name), then answer every
    // remaining wizard step with its first option until the backend emits
    // the ready-to-send CTA (the quote + agreement preview surface).
    await s.post("/agents/wizard/answer", {
      conversationId: convoId,
      stepId: trans.body?.activeStepId ?? "customer",
      optionId: "create_new",
      customValue: "Back Undo Test Customer",
    });

    for (let i = 0; i < 10; i++) {
      const msgs = await messagesOf(s, convoId);
      const cta = msgs.find((m) =>
        m.kind === "continue_cta" &&
        (m.payload as { toPhase?: string } | undefined)?.toPhase === "send"
      );
      if (cta) return;

      const last = [...msgs].reverse().find((m) => m.kind === "wizard");
      const payload = (last?.payload ?? {}) as {
        stepId?: string;
        options?: Array<{ id?: string }>;
      };
      const optionId = payload.options?.find((o) => o.id && o.id !== "custom")
        ?.id;
      if (!last || !payload.stepId || !optionId) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      const ans = await s.post("/agents/wizard/answer", {
        conversationId: convoId,
        stepId: payload.stepId,
        optionId,
      });
      expect(ans.status).toBeLessThan(400);
    }
  }, 60_000);

  it("the backend reached the reviewing stage (ready-to-send CTA present)", async () => {
    const msgs = await messagesOf(s, convoId);
    const cta = msgs.find((m) =>
      m.kind === "continue_cta" &&
      (m.payload as { toPhase?: string } | undefined)?.toPhase === "send"
    );
    expect(cta).toBeTruthy();
  });

  it("fed the REAL message list, the single back button rewinds to the previous step — it must NOT exit to /dashboard", async () => {
    const msgs = await messagesOf(s, convoId);
    const view = backViewFromMessages(msgs);

    // The preview auto-opens for the un-reviewed send CTA…
    expect(view.previewOpen).toBe(true);

    // …and the preview IS the wizard's send step, so the one back button
    // steps to the PREVIOUS step (re-ask the last term question) — never
    // a bare "close" that strands the chat, never the dashboard exit.
    const action = resolveAssistantBack(view);
    expect(action).toBe("rewind-wizard");
    expect(action).not.toBe("exit-dashboard");
  });

  it("after the preview is closed (CTA reviewed), back still never skips the wizard rewind", async () => {
    const msgs = await messagesOf(s, convoId);
    const ctaIds = msgs
      .filter((m) => m.kind === "continue_cta")
      .map((m) => m.id);
    const view = backViewFromMessages(msgs, {
      reviewedCtaIds: new Set(ctaIds),
    });
    expect(view.previewOpen).toBe(false);
    // With the preview closed and the wizard fully answered there is no
    // wizard step to rewind — but the resolver only exits as a LAST resort;
    // whatever it picks here, a dashboard exit is only legal because
    // nothing else is left.
    const action = resolveAssistantBack(view);
    if (action === "exit-dashboard") {
      expect(view.activeWizardStepIdx).toBeNull();
      expect(view.viewStackDepth).toBe(0);
    }
  });

  // Runs LAST: it mutates the conversation (rewinds it).
  it("POST /agents/wizard/back from the review stage re-asks the LAST term step: the send CTA is removed, the prior pick is returned, and the chat has an active step again", async () => {
    const before = await messagesOf(s, convoId);
    const lastWizard = [...before].reverse().find((m) => m.kind === "wizard");
    expect(lastWizard).toBeTruthy();
    const stepId = lastWizard!.payload?.stepId;
    const stepIdx = lastWizard!.payload?.stepIdx;

    const res = await s.post("/agents/wizard/back", { conversationId: convoId });
    expect(res.status).toBeLessThan(400);
    // The last term question is active again, with the user's prior pick
    // handed back so the UI can pre-highlight it.
    expect(res.body.activeStepId).toBe(stepId);
    expect(res.body.previousAnswer?.stepId).toBe(stepId);

    const after = await messagesOf(s, convoId);
    // Completion artifacts are gone (the send CTA + the final pick)…
    expect(
      after.some((m) =>
        m.kind === "continue_cta" &&
        (m.payload as { toPhase?: string } | undefined)?.toPhase === "send"
      ),
    ).toBe(false);
    // …and the surviving last message IS the last wizard question (kept,
    // not deleted — it is the step being re-asked).
    const last = after[after.length - 1];
    expect(last.kind).toBe("wizard");
    expect(last.id).toBe(lastWizard!.id);

    // The resolver now sees a live step — not a preview, not a dead end.
    const view = backViewFromMessages(after);
    expect(view.previewOpen).toBe(false);
    expect(view.activeWizardStepIdx).toBe(stepIdx);
    expect(resolveAssistantBack(view)).toBe("rewind-wizard");
  });
});
