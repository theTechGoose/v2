import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import { NotFoundError } from "@core/data/repository/mod.ts";
import type { AgentConversation, AgentPhase } from "@agents/dto/conversation.ts";
import type { WizardState } from "@agents/dto/wizard.ts";
import type { AssistantDraft } from "#quote-flow/assistant-draft.ts";

const PREFIX = "agent_conversation";
const INDEX_PREFIX = "agent_conversation_by_user";       // [INDEX_PREFIX, userId, createdAt, id] → id
const WIZARD_PREFIX = "agent_wizard_state";              // [WIZARD_PREFIX, conversationId] → WizardState
const DRAFT_PREFIX = "agent_assistant_draft";            // [DRAFT_PREFIX, conversationId] → AssistantDraft (REQ-230)

const TTL_MS = 30 * 24 * 60 * 60 * 1_000;                // 30 days

/**
 * AgentConversationStore — owns:
 *   - the conversation record itself
 *   - a per-user index for cheap "list newest first" reads
 *   - the wizard state, scoped 1:1 to a conversation
 *   - the assistant's in-flight flow (REQ-230), scoped 1:1 to a conversation
 *     — its own key, so a draft save never races a conversation update
 *
 * 30-day TTL on everything; the dashboard's recency-grouping (Today /
 * Yesterday / This week) doesn't surface anything older anyway.
 *
 * Conversations are written atomically with their index so the listing
 * never shows ghosts after a delete.
 */
@Injectable()
export class AgentConversationStore {
  // --- conversation ---

  async create(input: {
    userId: string;
    customerId?: string;
    quoteId?: string;
    currentPhase?: AgentPhase;
  }): Promise<AgentConversation> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const conv: AgentConversation = {
      id,
      userId: input.userId,
      customerId: input.customerId,
      quoteId: input.quoteId,
      currentPhase: input.currentPhase ?? "quote",
      createdAt: now,
      updatedAt: now,
    };
    const kv = await getKv();
    await kv.atomic()
      .set([PREFIX, id], conv, { expireIn: TTL_MS })
      .set([INDEX_PREFIX, input.userId, now, id], id, { expireIn: TTL_MS })
      .commit();
    return conv;
  }

  async get(id: string): Promise<AgentConversation> {
    const kv = await getKv();
    const result = await kv.get<AgentConversation>([PREFIX, id]);
    if (!result.value) throw new NotFoundError("agent_conversation", id);
    return result.value;
  }

  async tryGet(id: string): Promise<AgentConversation | null> {
    const kv = await getKv();
    const result = await kv.get<AgentConversation>([PREFIX, id]);
    return result.value ?? null;
  }

  async listByUser(userId: string, options: { limit?: number } = {}): Promise<AgentConversation[]> {
    const kv = await getKv();
    const limit = options.limit ?? 50;
    const out: AgentConversation[] = [];
    const iter = kv.list<string>({ prefix: [INDEX_PREFIX, userId] }, { reverse: true });
    for await (const entry of iter) {
      const conv = await this.tryGet(entry.value);
      if (conv) out.push(conv);
      if (out.length >= limit) break;
    }
    return out;
  }

  async update(id: string, patch: Partial<Omit<AgentConversation, "id" | "userId" | "createdAt">>): Promise<AgentConversation> {
    const existing = await this.get(id);
    const definedPatch = Object.fromEntries(
      Object.entries(patch).filter(([_, v]) => v !== undefined),
    );
    // REQ-589 (cycle 4, M15): a preview written without a key replaces the
    // keyed one — the old key must not re-render over the new text.
    const base: AgentConversation = { ...existing };
    if (patch.preview !== undefined && patch.previewI18n === undefined) {
      delete base.previewI18n;
    }
    const next: AgentConversation = {
      ...base,
      ...definedPatch,
      id: existing.id,
      userId: existing.userId,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    const kv = await getKv();
    await kv.set([PREFIX, id], next, { expireIn: TTL_MS });
    return next;
  }

  /**
   * Clear hasUnreadEvent without touching `updatedAt`. Reading a thread
   * shouldn't push it back to the top of the sidebar — only real activity
   * (a customer accept, a user message) should reorder the list.
   */
  async clearUnreadEvent(id: string): Promise<AgentConversation> {
    const existing = await this.get(id);
    if (!existing.hasUnreadEvent) return existing;
    const next: AgentConversation = { ...existing, hasUnreadEvent: false };
    const kv = await getKv();
    await kv.set([PREFIX, id], next, { expireIn: TTL_MS });
    return next;
  }

  async delete(id: string): Promise<void> {
    const conv = await this.tryGet(id);
    if (!conv) return;
    const kv = await getKv();
    await kv.atomic()
      .delete([PREFIX, id])
      .delete([INDEX_PREFIX, conv.userId, conv.createdAt, id])
      .delete([WIZARD_PREFIX, id])
      .delete([DRAFT_PREFIX, id])
      .commit();
  }

  // --- wizard state (per-conversation, 1:1) ---

  async getWizardState(conversationId: string): Promise<WizardState | null> {
    const kv = await getKv();
    const result = await kv.get<WizardState>([WIZARD_PREFIX, conversationId]);
    return result.value ?? null;
  }

  async putWizardState(conversationId: string, state: WizardState): Promise<WizardState> {
    const kv = await getKv();
    await kv.set([WIZARD_PREFIX, conversationId], state, { expireIn: TTL_MS });
    return state;
  }

  /** REQ-005 (NW-19): leaving the terms phase drops the wizard state so a
   *  later transition-to-terms starts the wizard fresh. */
  async deleteWizardState(conversationId: string): Promise<void> {
    const kv = await getKv();
    await kv.delete([WIZARD_PREFIX, conversationId]);
  }

  // --- assistant draft (REQ-230, per-conversation, 1:1) ---

  async getDraft(conversationId: string): Promise<AssistantDraft | null> {
    const kv = await getKv();
    const result = await kv.get<AssistantDraft>([DRAFT_PREFIX, conversationId]);
    return result.value ?? null;
  }

  async putDraft(conversationId: string, draft: AssistantDraft): Promise<AssistantDraft> {
    const kv = await getKv();
    await kv.set([DRAFT_PREFIX, conversationId], draft, { expireIn: TTL_MS });
    return draft;
  }

  async deleteDraft(conversationId: string): Promise<void> {
    const kv = await getKv();
    await kv.delete([DRAFT_PREFIX, conversationId]);
  }
}
