import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import { ForbiddenError, NotFoundError } from "@core/data/repository/mod.ts";
import type {
  Conversation,
  CreateConversationDto,
  UpdateConversationDto,
} from "@communication/dto/conversation.ts";

const PREFIX = "conversation";
const INDEX_PREFIX = "conversation_by_user";

@Injectable()
export class ConversationStore {
  async create(userId: string, input: CreateConversationDto): Promise<Conversation> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const conv: Conversation = { ...input, id, userId, createdAt: now, updatedAt: now };
    const kv = await getKv();
    await kv.atomic()
      .set([PREFIX, id], conv)
      .set([INDEX_PREFIX, userId, id], id)
      .commit();
    return conv;
  }

  async get(id: string): Promise<Conversation> {
    const kv = await getKv();
    const r = await kv.get<Conversation>([PREFIX, id]);
    if (!r.value) throw new NotFoundError(PREFIX, id);
    return r.value;
  }

  async getOwned(id: string, userId: string): Promise<Conversation> {
    const c = await this.get(id);
    if (c.userId !== userId) throw new ForbiddenError(PREFIX, id);
    return c;
  }

  async listByUser(userId: string): Promise<Conversation[]> {
    const kv = await getKv();
    const out: Conversation[] = [];
    for await (const e of kv.list<string>({ prefix: [INDEX_PREFIX, userId] })) {
      const r = await kv.get<Conversation>([PREFIX, e.value]);
      if (r.value) out.push(r.value);
    }
    return out;
  }

  async update(id: string, userId: string, patch: UpdateConversationDto): Promise<Conversation> {
    const existing = await this.getOwned(id, userId);
    const definedPatch = Object.fromEntries(
      Object.entries(patch).filter(([_, v]) => v !== undefined),
    );
    const updated: Conversation = {
      ...existing,
      ...definedPatch,
      id: existing.id,
      userId: existing.userId,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    const kv = await getKv();
    await kv.set([PREFIX, id], updated);
    return updated;
  }

  async delete(id: string, userId: string): Promise<void> {
    const existing = await this.getOwned(id, userId);
    const kv = await getKv();
    await kv.atomic()
      .delete([PREFIX, id])
      .delete([INDEX_PREFIX, existing.userId, id])
      .commit();
  }
}
