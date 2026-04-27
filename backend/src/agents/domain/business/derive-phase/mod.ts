import type { AgentConversation, AgentPhase } from "@agents/dto/conversation.ts";

/**
 * Pure rule for whether the conversation should auto-advance from
 * 'quote' → 'terms'. The trigger is: the assistant has produced a
 * locked quote (i.e. `conversation.quoteId` is set) AND we're still
 * in the 'quote' phase.
 *
 * The agent module never auto-flips back from 'terms' → 'quote' — that
 * has to be an explicit user action (e.g. clicking "Re-open the quote"
 * suggestion chip), and is handled by a separate coordinator.
 */
export function shouldTransitionToTerms(conv: AgentConversation): boolean {
  return conv.currentPhase === "quote" && Boolean(conv.quoteId);
}

/** Identity for the inverse — explicit, so callers don't reach for !shouldTransition. */
export function isInQuotePhase(conv: AgentConversation): boolean {
  return conv.currentPhase === "quote";
}

export function isInTermsPhase(conv: AgentConversation): boolean {
  return conv.currentPhase === "terms";
}

/**
 * Apply a phase transition. Only forward transitions are valid (quote→terms).
 * Returns a new conversation object; never mutates input.
 */
export function transitionPhase(conv: AgentConversation, to: AgentPhase): AgentConversation {
  if (conv.currentPhase === to) return conv;        // no-op
  if (conv.currentPhase === "quote" && to === "terms") {
    return { ...conv, currentPhase: "terms", updatedAt: new Date().toISOString() };
  }
  throw new Error(`invalid phase transition: ${conv.currentPhase} → ${to}`);
}
