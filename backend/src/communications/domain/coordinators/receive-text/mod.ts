/** REQ-899 — an inbound text (Twilio's message webhook) lands on its thread, unread. Idempotent on MessageSid. */
import { Injectable } from "#danet/core";
import type { TextMessage } from "@communications/dto/mod.ts";
import { safePhone } from "@communications/dto/mod.ts";
import { mediaUrls } from "@communications/domain/business/webhook-request/mod.ts";
import { ThreadStore } from "@communications/domain/data/thread-store/mod.ts";
import { TextMessageStore } from "@communications/domain/data/text-message-store/mod.ts";

@Injectable()
export class ReceiveText {
  constructor(private threads: ThreadStore, private texts: TextMessageStore) {}

  async receive(params: Record<string, string>): Promise<TextMessage> {
    const sid = params.MessageSid ?? params.SmsSid ?? "";
    if (sid) {
      const dup = await this.texts.findBySid(sid);
      if (dup) return dup;
    }
    const peer = safePhone(params.From ?? "");
    const line = safePhone(params.To ?? "");
    const body = params.Body ?? "";
    const media = mediaUrls(params);
    const at = new Date().toISOString();
    const preview = body || (media.length ? "📷 Photo" : "");
    const thread = await this.threads.touch({ line, peer, at, preview: preview.slice(0, 140), unread: true });
    return await this.texts.create({
      threadId: thread.id,
      line,
      peer,
      direction: "inbound",
      body,
      mediaUrls: media,
      ...(sid ? { providerSid: sid } : {}),
      status: "received",
    });
  }
}
