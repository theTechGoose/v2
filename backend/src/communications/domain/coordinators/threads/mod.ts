/** REQ-899 — the inbox reads. */
import { Injectable } from "#danet/core";
import { NotFoundError } from "@core/data/repository/mod.ts";
import type { Thread, ThreadDetail } from "@communications/dto/mod.ts";
import { safePhone } from "@communications/dto/mod.ts";
import { CommsConfigSource } from "@communications/domain/data/config/mod.ts";
import {
  envLine,
  type ResolvedLine,
} from "@communications/domain/business/line-resolution/mod.ts";
import { ThreadStore } from "@communications/domain/data/thread-store/mod.ts";
import { TextMessageStore } from "@communications/domain/data/text-message-store/mod.ts";
import { CallStore } from "@communications/domain/data/call-store/mod.ts";

@Injectable()
export class Threads {
  constructor(
    private threads: ThreadStore,
    private texts: TextMessageStore,
    private calls: CallStore,
    private cfgSource: CommsConfigSource,
  ) {}

  private line(on?: ResolvedLine): string {
    return (on ?? envLine(this.cfgSource.get())).number || "dev";
  }

  /** `on`: the line whose inbox this is; the env line when absent */
  list(on?: ResolvedLine): Promise<Thread[]> {
    return this.threads.list(this.line(on));
  }

  /** the thread with that peer: its texts and calls, and it is read now */
  async get(peerInput: string, on?: ResolvedLine): Promise<ThreadDetail> {
    const peer = safePhone(peerInput);
    const found = await this.threads.findByPeer(this.line(on), peer);
    if (!found) throw new NotFoundError("comms_thread", peer);
    const [texts, calls] = await Promise.all([
      this.texts.listByThread(found.id),
      this.calls.listByPeer(peer),
    ]);
    const thread = found.unreadCount
      ? await this.threads.markRead(found.id)
      : found;
    return { thread, texts, calls };
  }
}
