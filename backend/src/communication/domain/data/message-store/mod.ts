import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import { NotFoundError } from "@core/data/repository/mod.ts";
import type {
  CreateMessageDto,
  Message,
  UpdateMessageDto,
} from "@communication/dto/message.ts";

const PREFIX = "message";
const INDEX_PREFIX = "message_by_conversation";    // [INDEX_PREFIX, conversationId, createdAt, id] → id

/**
 * MessageStore — append-only-ish per-conversation message log.
 *
 * Ownership is NOT enforced here — that responsibility lives one level up
 * in the message-controller, which resolves the conversation through the
 * ConversationStore (with `getOwned`) before reading or writing messages.
 * Doing it that way keeps the message store ignorant of users + lets it be
 * reused by future modules (notification, agents) that already own their
 * own owner check.
 *
 * Storage:
 *   ["message", id]                                      → Message
 *   ["message_by_conversation", convId, createdAt, id]   → id (sortable scan)
 */
@Injectable()
export class MessageStore {
  async create(input: CreateMessageDto): Promise<Message> {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const msg: Message = { ...input, id, createdAt, updatedAt: createdAt };
    const kv = await getKv();
    await kv.atomic()
      .set([PREFIX, id], msg)
      .set([INDEX_PREFIX, input.conversationId, createdAt, id], id)
      .commit();
    return msg;
  }

  async get(id: string): Promise<Message> {
    const kv = await getKv();
    const r = await kv.get<Message>([PREFIX, id]);
    if (!r.value) throw new NotFoundError(PREFIX, id);
    return r.value;
  }

  async listByConversation(conversationId: string): Promise<Message[]> {
    const kv = await getKv();
    const out: Message[] = [];
    for await (const e of kv.list<string>({ prefix: [INDEX_PREFIX, conversationId] })) {
      const r = await kv.get<Message>([PREFIX, e.value]);
      if (r.value) out.push(r.value);
    }
    return out;
  }

  async update(id: string, patch: UpdateMessageDto): Promise<Message> {
    const existing = await this.get(id);
    const definedPatch = Object.fromEntries(
      Object.entries(patch).filter(([_, v]) => v !== undefined),
    );
    const updated: Message = {
      ...existing,
      ...definedPatch,
      id: existing.id,
      conversationId: existing.conversationId,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    const kv = await getKv();
    await kv.set([PREFIX, id], updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    const existing = await this.get(id);
    const kv = await getKv();
    await kv.atomic()
      .delete([PREFIX, id])
      .delete([INDEX_PREFIX, existing.conversationId, existing.createdAt, id])
      .commit();
  }
}
