import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import type { AgentMessage, MessageKind, MessageRole } from "@agents/dto/message.ts";

const PREFIX = "agent_message";                     // [PREFIX, conversationId, createdAt, id] → AgentMessage
const TTL_MS = 30 * 24 * 60 * 60 * 1_000;           // 30 days, matches conversation TTL

/**
 * AgentMessageStore — append-only log of messages per conversation.
 *
 * Storage uses a composite key `[PREFIX, conversationId, createdAt, id]`
 * so `listByConversation` is a sorted scan (oldest → newest by default,
 * reverse for newest-first cursors).
 *
 * Messages are *append-only*: there's no update endpoint. To "edit" a
 * wizard answer, the agent appends a new message reflecting the change.
 */
@Injectable()
export class AgentMessageStore {
  async append(input: {
    conversationId: string;
    role: MessageRole;
    kind: MessageKind;
    content: string;
    payload?: Record<string, unknown>;
  }): Promise<AgentMessage> {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const msg: AgentMessage = {
      id,
      conversationId: input.conversationId,
      role: input.role,
      kind: input.kind,
      content: input.content,
      payload: input.payload,
      createdAt,
    };
    const kv = await getKv();
    await kv.set([PREFIX, input.conversationId, createdAt, id], msg, { expireIn: TTL_MS });
    return msg;
  }

  async listByConversation(conversationId: string): Promise<AgentMessage[]> {
    const kv = await getKv();
    const out: AgentMessage[] = [];
    const iter = kv.list<AgentMessage>({ prefix: [PREFIX, conversationId] });    // ascending = oldest-first
    for await (const entry of iter) out.push(entry.value);
    return out;
  }

  async deleteByConversation(conversationId: string): Promise<void> {
    const kv = await getKv();
    const iter = kv.list<AgentMessage>({ prefix: [PREFIX, conversationId] });
    for await (const entry of iter) {
      await kv.delete(entry.key);
    }
  }

  /** Most-recent meaningful message (skips system + phase_divider) — for thread previews. */
  async latestPreviewable(conversationId: string): Promise<AgentMessage | null> {
    const kv = await getKv();
    const iter = kv.list<AgentMessage>({ prefix: [PREFIX, conversationId] }, { reverse: true });
    for await (const entry of iter) {
      const m = entry.value;
      if (m.role === "system") continue;
      if (m.kind === "phase_divider") continue;
      return m;
    }
    return null;
  }
}
