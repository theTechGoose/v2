import { Injectable } from "#danet/core";
import { ConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore } from "@communication/domain/data/message-store/mod.ts";
import type { Message, MessageChannel } from "@communication/dto/message.ts";

export interface LogPaperworkMessageInput {
  userId: string;
  /** Customer the dispatch went to; groups the message into their thread. */
  customerId?: string;
  channel: MessageChannel;
  content: string;
  subject?: string;
  toAddress?: string;
  paperworkId?: string;
  paperworkType?: string;
}

/**
 * LogPaperworkMessage — record an outbound paperwork dispatch (quote /
 * contract / invoice email or text) in the customer's communication
 * thread, so the comms trail is queryable (roadmap p.8: completion Text +
 * Email after quotes/signed quotes).
 *
 * Finds the customer's conversation (or creates one) and appends a
 * system-role message carrying channel + subject + the paperwork ref.
 * Best-effort by design: callers fire-and-forget — a logging failure must
 * never fail the send itself.
 */
@Injectable()
export class LogPaperworkMessage {
  constructor(
    private conversations: ConversationStore,
    private messages: MessageStore,
  ) {}

  async run(input: LogPaperworkMessageInput): Promise<Message | undefined> {
    try {
      const conversationId = await this.resolveConversation(
        input.userId,
        input.customerId,
      );
      return await this.messages.create({
        conversationId,
        role: "system",
        channel: input.channel,
        content: input.content,
        ...(input.subject ? { subject: input.subject } : {}),
        ...(input.toAddress ? { toAddress: input.toAddress } : {}),
        ...(input.paperworkId ? { paperworkId: input.paperworkId } : {}),
        ...(input.paperworkType ? { paperworkType: input.paperworkType } : {}),
      });
    } catch (err) {
      console.error("[log-paperwork-message] failed:", err);
      return undefined;
    }
  }

  private async resolveConversation(
    userId: string,
    customerId?: string,
  ): Promise<string> {
    const all = await this.conversations.listByUser(userId);
    const existing = customerId
      ? all.find((c) => c.customerId === customerId)
      : all.find((c) => c.title === "Outbound paperwork");
    if (existing) return existing.id;
    const created = await this.conversations.create(userId, {
      title: customerId ? "Paperwork" : "Outbound paperwork",
      ...(customerId ? { customerId } : {}),
    });
    return created.id;
  }
}
