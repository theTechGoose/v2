import { Injectable } from "#danet/core";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { TERMS_WIZARD_V1 } from "@agents/domain/business/terms-wizard-spec/mod.ts";
import type { AgentConversation } from "@agents/dto/conversation.ts";
import type { AgentMessage } from "@agents/dto/message.ts";
import type { WizardState } from "@agents/dto/wizard.ts";

export interface RewindWizardInput {
  userId: string;
  conversationId: string;
  /** Rewind TO this step index (0-based) so it is the active question
   *  again. Omitted → exactly one step back. The client keeps a snapshot
   *  stack of where it was; popping a snapshot restores the server to the
   *  snapshot's step with one call, however many steps that spans. */
  toStepIdx?: number;
}

export interface RewindWizardResult {
  conversation: AgentConversation;
  wizardState: WizardState;
  /** The step the user is now being asked again (null if already at start). */
  activeStepId: string | null;
  /** Messages dropped from the transcript so the target step is active. */
  removedMessageIds: string[];
  /** The answer that was popped for the step now being re-asked — so the
   *  UI can pre-highlight it (roadmap p.8: "Back restores the prior step's
   *  selections"). */
  previousAnswer?: { stepId: string; optionId: string; customValue?: string };
}

/**
 * RewindWizard — the server half of "back": pop the wizard to an earlier
 * step so it can be re-answered.
 *
 * The transcript is an append-only log, so restoring an earlier step means
 * deleting what came after it:
 *   - mid-wizard, the trailing (unanswered) question + the pick that led to
 *     it are dropped, leaving the previous question as the active one;
 *   - from the completed/review stage (the send preview IS the last step),
 *     the final question is KEPT (it becomes active again) and only what
 *     completion appended after it is dropped — the final pick and the
 *     "ready to send" CTA.
 * `toStepIdx` repeats that pop until the target step is active.
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
    // back before the wizard is the CLIENT'S concern (snapshot pop / exit to
    // dashboard), never a 500 (roadmap p.2/p.3).
    if (!state) {
      return {
        conversation: conv,
        wizardState: {
          specId: TERMS_WIZARD_V1.id,
          activeStepIdx: 0,
          answers: [],
        },
        activeStepId: null,
        removedMessageIds: [],
      };
    }

    const target = Math.max(
      0,
      Math.min(input.toStepIdx ?? state.activeStepIdx - 1, state.activeStepIdx),
    );
    let current = state;
    const removed: string[] = [];
    let popped: WizardState["answers"][number] | undefined;
    while (current.activeStepIdx > target) {
      const step = await this.stepBack(input.conversationId, current);
      current = step.state;
      removed.push(...step.removed);
      popped = step.popped ?? popped;
    }

    return {
      conversation: conv,
      wizardState: current,
      activeStepId: TERMS_WIZARD_V1.steps[current.activeStepIdx]?.id ?? null,
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

  /** Pop exactly one step: persist the shortened state and delete the
   *  transcript messages that no longer belong. */
  private async stepBack(
    conversationId: string,
    state: WizardState,
  ): Promise<{
    state: WizardState;
    removed: string[];
    popped?: WizardState["answers"][number];
  }> {
    const wasComplete = state.activeStepIdx >= TERMS_WIZARD_V1.steps.length;
    const popped = state.answers[state.answers.length - 1];
    const next: WizardState = {
      specId: state.specId,
      activeStepIdx: state.activeStepIdx - 1,
      answers: state.answers.slice(0, -1),
    };
    await this.conversations.putWizardState(conversationId, next);

    const msgs = await this.messages.listByConversation(conversationId);
    const removed: string[] = [];
    if (wasComplete) {
      const lastWizardAt = findLastIndex(msgs, (m) => m.kind === "wizard");
      for (const m of msgs.slice(lastWizardAt + 1)) {
        if (isWizardPick(m) || isSendCta(m)) removed.push(m.id);
      }
    } else {
      const lastWizardAt = findLastIndex(msgs, (m) => m.kind === "wizard");
      if (lastWizardAt >= 0) removed.push(msgs[lastWizardAt].id);
      const lastPickAt = findLastIndex(msgs, isWizardPick);
      if (lastPickAt >= 0) removed.push(msgs[lastPickAt].id);
    }
    await this.messages.deleteByIds(conversationId, removed);
    return { state: next, removed, popped };
  }
}

function findLastIndex(
  msgs: AgentMessage[],
  pred: (m: AgentMessage) => boolean,
): number {
  for (let i = msgs.length - 1; i >= 0; i--) if (pred(msgs[i])) return i;
  return -1;
}

function isWizardPick(m: AgentMessage): boolean {
  return m.role === "user" && m.kind === "text" && !!m.payload?.wizardStepId;
}

function isSendCta(m: AgentMessage): boolean {
  return m.kind === "continue_cta" &&
    (m.payload as { toPhase?: string } | undefined)?.toPhase === "send";
}
