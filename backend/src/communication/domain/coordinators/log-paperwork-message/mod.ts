import { Injectable } from "#danet/core";
import { ConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore } from "@communication/domain/data/message-store/mod.ts";
import { OutboxStore } from "@communication/domain/data/outbox-store/mod.ts";
import { outboxPreview } from "@communication/domain/business/outbox-entry/mod.ts";
import type {
  Message,
  MessageChannel,
  MessageRole,
} from "@communication/dto/message.ts";
import type {
  OutboxChannel,
  OutboxEntry,
  OutboxKind,
} from "@communication/dto/outbox.ts";

export interface LogPaperworkMessageInput {
  userId: string;
  /** Customer the dispatch went to; groups the message into their thread. */
  customerId?: string;
  channel: MessageChannel;
  content: string;
  subject?: string;
  /** Rendered HTML copy of an email dispatch (auditable outbound wording). */
  htmlBody?: string;
  toAddress?: string;
  paperworkId?: string;
  paperworkType?: string;
  /** REQ-175: an inbound reply is logged as the customer's own words ("user"); outbound logs stay "system" */
  role?: MessageRole;
  fromAddress?: string;
}

/** REQ-784: one email or text to a customer, as the sender knows it. */
export interface OutboxRecordInput {
  userId: string;
  channel: OutboxChannel;
  /** what it carried: the quote, the invoice, the change order… */
  kind: OutboxKind;
  /** the language it went out in */
  language: string;
  /** whether the provider took it */
  ok: boolean;
  /** why it didn't go: a text's SmsFailureCode, or "missing" / "other" */
  reasonCode?: string;
  /** …as the sender worded it */
  reason?: string;
  customerId?: string;
  /** the customer as the document names them */
  customerName?: string;
  /** the address or number it went (or would have gone) to */
  to?: string;
  docId?: string;
  /** the document's number: Q-001, INV-001, CO-001… */
  docRef?: string;
  subject?: string;
  /** what the provider was handed: the email's HTML / the text's words —
   *  kept only when it went */
  body?: string;
}

/**
 * LogPaperworkMessage — record an outbound paperwork dispatch (quote /
 * invoice email or text) in the customer's communication
 * thread, so the comms trail is queryable (roadmap p.8: completion Text +
 * Email after quotes/signed quotes).
 *
 * Finds the customer's conversation (or creates one) and appends a
 * system-role message carrying channel + subject + the paperwork ref.
 * Best-effort by design: callers fire-and-forget — a logging failure must
 * never fail the send itself.
 *
 * REQ-784 (demo-loop cycle dv1, d12): `outbox` records every email and text
 * to a customer in the business's outbox — sent, or not and why — with the
 * content as sent. The thread above keeps real deliveries only (it is the
 * receipts strip's source, REQ-403); the outbox keeps every attempt.
 */
@Injectable()
export class LogPaperworkMessage {
  constructor(
    private conversations: ConversationStore,
    private messages: MessageStore,
    /** REQ-784 — the business's outbox (defaulted for direct construction) */
    private outboxStore: OutboxStore = new OutboxStore(),
  ) {}

  /** REQ-784: record one customer email or text in the outbox. Best-effort:
   *  never throws, never fails the send. */
  async outbox(input: OutboxRecordInput): Promise<OutboxEntry | undefined> {
    try {
      const { ok, body, reasonCode, reason, language, ...facts } = input;
      return await this.outboxStore.record({
        ...facts,
        status: ok ? "sent" : "not_sent",
        ...(ok ? {} : {
          reasonCode: reasonCode || "other",
          ...(reason ? { reason } : {}),
        }),
        language: language === "es" ? "es" : "en",
        // the list's line names what was composed, sent or not …
        preview: outboxPreview({
          channel: input.channel,
          subject: input.subject,
          body,
        }),
        // … but only what went is content "as sent"
        body: ok ? body ?? "" : "",
      });
    } catch (err) {
      console.error("[log-paperwork-message] outbox record failed:", err);
      return undefined;
    }
  }

  async run(input: LogPaperworkMessageInput): Promise<Message | undefined> {
    try {
      const conversationId = await this.resolveConversation(
        input.userId,
        input.customerId,
      );
      return await this.messages.create({
        conversationId,
        role: input.role ?? "system",
        channel: input.channel,
        content: input.content,
        ...(input.fromAddress ? { fromAddress: input.fromAddress } : {}),
        ...(input.subject ? { subject: input.subject } : {}),
        ...(input.htmlBody ? { htmlBody: input.htmlBody } : {}),
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
