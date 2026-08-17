import { Injectable } from "#danet/core";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { CONTRACT_TERMS_WIZARD_V1 } from "@agents/domain/business/contract-terms-wizard-spec/mod.ts";
import type { AgentConversation } from "@agents/dto/conversation.ts";
import type { WizardState } from "@agents/dto/wizard.ts";

export interface RewindWizardInput {
  userId: string;
  conversationId: string;
}

export interface RewindWizardResult {
  conversation: AgentConversation;
  wizardState: WizardState;
  /** The step the user is now being asked again (null if already at start). */
  activeStepId: string | null;
  /** Messages dropped from the transcript so the previous step is active. */
  removedMessageIds: string[];
  /** The answer that was popped — the user's previous pick for the step now
   *  being re-asked, so the UI can pre-highlight it (roadmap p.8: "Back
   *  restores the prior step's selections"). */
  previousAnswer?: { stepId: string; optionId: string; customValue?: string };
}

/**
 * RewindWizard — phase-2 "Back" handler (roadmap p.2: a back button through
 * the steps so they can be edited).
 *
 * Steps:
 *   1. Validate ownership + that the conversation is in 'terms'.
 *   2. If already on the first step, no-op (nothing to rewind to).
 *   3. Otherwise pop the last answer and step the cursor back one.
 *   4. Delete the trailing wizard step message (the question being asked)
 *      and the user "pick" message that advanced us here — leaving the
 *      previous step's wizard message (already in the append-only log) as
 *      the new active step. The user can then re-answer it.
 */
@Injectable()
export class RewindWizard {
  constructor(
    private conversations: AgentConversationStore,
    private messages: AgentMessageStore,
  ) {}

  async run(input: RewindWizardInput): Promise<RewindWizardResult> {
    const conv = await this.conversations.get(input.conversationId);
    if (conv.userId !== input.userId) throw new Error("forbidden");

    const state = conv.currentPhase === "terms"
      ? await this.conversations.getWizardState(input.conversationId)
      : undefined;
    // No active wizard (wrong phase, or terms never started) → clean no-op:
    // back before the wizard is the CLIENT'S concern (history pop / exit to
    // dashboard), never a 500 (roadmap p.2/p.3).
    if (!state) {
      return {
        conversation: conv,
        wizardState: { specId: CONTRACT_TERMS_WIZARD_V1.id, activeStepIdx: 0, answers: [] },
        activeStepId: null,
        removedMessageIds: [],
      };
    }

    if (state.activeStepIdx <= 0) {
      return {
        conversation: conv,
        wizardState: state,
        activeStepId: CONTRACT_TERMS_WIZARD_V1.steps[0]?.id ?? null,
        removedMessageIds: [],
      };
    }

    const prevIdx = state.activeStepIdx - 1;
    const popped = state.answers[state.answers.length - 1];
    const nextState: WizardState = {
      specId: state.specId,
      activeStepIdx: prevIdx,
      answers: state.answers.slice(0, -1),
    };
    await this.conversations.putWizardState(input.conversationId, nextState);

    // Find the trailing wizard step message + the last user wizard-pick so
    // the prior step's wizard message becomes the active one again.
    const msgs = await this.messages.listByConversation(input.conversationId);
    const removed: string[] = [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].kind === "wizard") {
        removed.push(msgs[i].id);
        break;
      }
    }
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role === "user" && m.kind === "text" && m.payload?.wizardStepId) {
        removed.push(m.id);
        break;
      }
    }
    await this.messages.deleteByIds(input.conversationId, removed);

    return {
      conversation: conv,
      wizardState: nextState,
      activeStepId: CONTRACT_TERMS_WIZARD_V1.steps[prevIdx]?.id ?? null,
      removedMessageIds: removed,
      ...(popped
        ? {
          previousAnswer: {
            stepId: popped.stepId,
            optionId: popped.optionId,
            ...(popped.customValue ? { customValue: popped.customValue } : {}),
          },
        }
        : {}),
    };
  }
}
