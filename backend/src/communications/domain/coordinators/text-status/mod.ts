/** REQ-899 — Twilio's delivery status callback onto the text it belongs to. */
import { Injectable } from "#danet/core";
import type { TextMessage, TextStatus as Status } from "@communications/dto/mod.ts";
import { TextMessageStore } from "@communications/domain/data/text-message-store/mod.ts";

const KNOWN: Set<string> = new Set(["queued", "sending", "sent", "delivered", "undelivered", "failed", "received"]);

@Injectable()
export class TextStatus {
  constructor(private texts: TextMessageStore) {}

  /** null when the SID is not one of ours */
  async apply(params: Record<string, string>): Promise<TextMessage | null> {
    const sid = params.MessageSid ?? params.SmsSid ?? "";
    const status = params.MessageStatus ?? params.SmsStatus ?? "";
    if (!sid || !KNOWN.has(status)) return null;
    const existing = await this.texts.findBySid(sid);
    if (!existing) return null;
    const errorCode = params.ErrorCode ? Number(params.ErrorCode) : undefined;
    return await this.texts.patchStatus(existing.id, { status: status as Status, ...(errorCode ? { errorCode } : {}) });
  }
}
