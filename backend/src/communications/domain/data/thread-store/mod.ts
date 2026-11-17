/**
 * REQ-899 — one thread per (line, peer).
 *   ["comms_thread", id]                 → Thread
 *   ["comms_thread_by_peer", line, peer] → id
 */
import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import { NotFoundError } from "@core/data/repository/mod.ts";
import type { Thread } from "@communications/dto/mod.ts";

const PREFIX = "comms_thread";
const BY_PEER = "comms_thread_by_peer";

export interface TouchThreadInput {
  line: string;
  peer: string;
  at: string;
  preview: string;
  /** an inbound event bumps the unread count; an outbound one does not */
  unread: boolean;
}

@Injectable()
export class ThreadStore {
  async get(id: string): Promise<Thread> {
    const kv = await getKv();
    const r = await kv.get<Thread>([PREFIX, id]);
    if (!r.value) throw new NotFoundError(PREFIX, id);
    return r.value;
  }

  async findByPeer(line: string, peer: string): Promise<Thread | null> {
    const kv = await getKv();
    const idx = await kv.get<string>([BY_PEER, line, peer]);
    if (!idx.value) return null;
    const r = await kv.get<Thread>([PREFIX, idx.value]);
    return r.value ?? null;
  }

  /** create the thread if missing, then record the newest event on it */
  async touch(input: TouchThreadInput): Promise<Thread> {
    const kv = await getKv();
    const existing = await this.findByPeer(input.line, input.peer);
    const now = new Date().toISOString();
    const thread: Thread = existing
      ? {
        ...existing,
        lastMessageAt: input.at > existing.lastMessageAt
          ? input.at
          : existing.lastMessageAt,
        lastPreview: input.at >= existing.lastMessageAt
          ? input.preview
          : existing.lastPreview,
        unreadCount: existing.unreadCount + (input.unread ? 1 : 0),
        updatedAt: now,
      }
      : {
        id: crypto.randomUUID(),
        line: input.line,
        peer: input.peer,
        lastMessageAt: input.at,
        lastPreview: input.preview,
        unreadCount: input.unread ? 1 : 0,
        createdAt: now,
        updatedAt: now,
      };
    await kv.atomic().set([PREFIX, thread.id], thread).set([
      BY_PEER,
      thread.line,
      thread.peer,
    ], thread.id).commit();
    return thread;
  }

  async markRead(id: string): Promise<Thread> {
    const kv = await getKv();
    const t = await this.get(id);
    const updated = {
      ...t,
      unreadCount: 0,
      updatedAt: new Date().toISOString(),
    };
    await kv.set([PREFIX, id], updated);
    return updated;
  }

  /** every thread on the line, newest activity first */
  async list(line: string): Promise<Thread[]> {
    const kv = await getKv();
    const out: Thread[] = [];
    for await (const e of kv.list<Thread>({ prefix: [PREFIX] })) {
      if (e.value.line === line) out.push(e.value);
    }
    return out.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  }
}
