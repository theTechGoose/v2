/**
 * REQ-899 — the texts, append-only with status patches.
 *   ["comms_text", id]                              → TextMessage
 *   ["comms_text_by_thread", threadId, createdAt, id] → id (sortable scan)
 *   ["comms_text_by_sid", providerSid]              → id (status callbacks)
 */
import { Injectable } from "#danet/core";
import { getKv, indexedIds, readMany } from "@core/data/kv/mod.ts";
import { NotFoundError } from "@core/data/repository/mod.ts";
import type { TextMessage, TextStatus } from "@communications/dto/mod.ts";

const PREFIX = "comms_text";
const BY_THREAD = "comms_text_by_thread";
const BY_SID = "comms_text_by_sid";

export type CreateTextInput = Omit<
  TextMessage,
  "id" | "createdAt" | "updatedAt"
>;

@Injectable()
export class TextMessageStore {
  async create(input: CreateTextInput): Promise<TextMessage> {
    const kv = await getKv();
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const msg: TextMessage = { ...input, id, createdAt, updatedAt: createdAt };
    const tx = kv.atomic().set([PREFIX, id], msg).set([
      BY_THREAD,
      input.threadId,
      createdAt,
      id,
    ], id);
    if (input.providerSid) tx.set([BY_SID, input.providerSid], id);
    await tx.commit();
    return msg;
  }

  async get(id: string): Promise<TextMessage> {
    const kv = await getKv();
    const r = await kv.get<TextMessage>([PREFIX, id]);
    if (!r.value) throw new NotFoundError(PREFIX, id);
    return r.value;
  }

  async findBySid(providerSid: string): Promise<TextMessage | null> {
    const kv = await getKv();
    const idx = await kv.get<string>([BY_SID, providerSid]);
    if (!idx.value) return null;
    return (await kv.get<TextMessage>([PREFIX, idx.value])).value ?? null;
  }

  async listByThread(threadId: string): Promise<TextMessage[]> {
    const kv = await getKv();
    const ids = await indexedIds(kv, [BY_THREAD, threadId]);
    const recs = await readMany<TextMessage>(kv, ids.map((id) => [PREFIX, id]));
    return recs.filter((m): m is TextMessage => !!m);
  }

  async patchStatus(
    id: string,
    patch: { status: TextStatus; errorCode?: number; providerSid?: string },
  ): Promise<TextMessage> {
    const kv = await getKv();
    const existing = await this.get(id);
    const updated: TextMessage = {
      ...existing,
      status: patch.status,
      ...(patch.errorCode !== undefined ? { errorCode: patch.errorCode } : {}),
      ...(patch.providerSid ? { providerSid: patch.providerSid } : {}),
      updatedAt: new Date().toISOString(),
    };
    const tx = kv.atomic().set([PREFIX, id], updated);
    if (patch.providerSid) tx.set([BY_SID, patch.providerSid], id);
    await tx.commit();
    return updated;
  }
}
