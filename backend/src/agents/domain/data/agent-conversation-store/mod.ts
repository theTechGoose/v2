import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import { NotFoundError } from "@core/data/repository/mod.ts";
import type { AgentConversation, AgentPhase } from "@agents/dto/conversation.ts";
import type { WizardState } from "@agents/dto/wizard.ts";

const PREFIX = "agent_conversation";
const INDEX_PREFIX = "agent_conversation_by_user";       // [INDEX_PREFIX, userId, createdAt, id] → id
const WIZARD_PREFIX = "agent_wizard_state";              // [WIZARD_PREFIX, conversationId] → WizardState

const TTL_MS = 30 * 24 * 60 * 60 * 1_000;                // 30 days

/**
 * AgentConversationStore — owns:
 *   - the conversation record itself
 *   - a per-user index for cheap "list newest first" reads
 *   - the wizard state, scoped 1:1 to a conversation
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
    const next: AgentConversation = {
      ...existing,
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

  async delete(id: string): Promise<void> {
    const conv = await this.tryGet(id);
    if (!conv) return;
    const kv = await getKv();
    await kv.atomic()
      .delete([PREFIX, id])
      .delete([INDEX_PREFIX, conv.userId, conv.createdAt, id])
      .delete([WIZARD_PREFIX, id])
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
}
