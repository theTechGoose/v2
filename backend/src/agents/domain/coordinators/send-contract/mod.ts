import { Injectable } from "#danet/core";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { ContractStore } from "@paperwork/domain/data/contract-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { SendPaperworkEmail } from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import { SendPaperworkSms } from "@paperwork/domain/coordinators/send-paperwork-sms/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import type { AgentConversation } from "@agents/dto/conversation.ts";
import type { AgentMessage } from "@agents/dto/message.ts";

export type SendChannel = "email" | "sms" | "both";

export interface SendContractInput {
  userId: string;
  conversationId: string;
  /** Must match conv.contractId — guarantees the user is sending the
   *  contract they think they're sending, not a stray draft. */
  contractId: string;
  /** Which channel to dispatch on. Defaults to 'email' for tests and
   *  any caller that hasn't been updated yet. */
  channel?: SendChannel;
}

export interface SendContractResult {
  conversation: AgentConversation;
  /** Status-update message confirming the dispatch (no popup needed). */
  newMessages: AgentMessage[];
}

/**
 * SendContract — fires the wizard's "Ready to send" CTA.
 *
 *   1. Verify ownership + that contractId matches conv.contractId
 *      (we don't allow sending an unrelated draft on this conversation).
 *   2. If the contract is already 'sent', short-circuit the *state flip*
 *      (idempotent; re-clicks don't double-emit events). Email/SMS
 *      dispatch is NOT idempotent — the user clicked Send, so we deliver.
 *   3. Flip contract.status = 'sent', emit `contract:sent` event.
 *   4. Dispatch via the requested channel(s). Failures don't abort the
 *      status flip — the user can retry from the contract surface.
 *   5. Append a system message so the chat shows what happened.
 */
@Injectable()
export class SendContract {
  constructor(
    private conversations: AgentConversationStore,
    private messages: AgentMessageStore,
    private contracts: ContractStore,
    private quotes: QuoteStore,
    private bus: EventBus,
    private emailer: SendPaperworkEmail,
    private smser: SendPaperworkSms,
  ) {}

  async run(input: SendContractInput): Promise<SendContractResult> {
    const conv = await this.conversations.get(input.conversationId);
    if (conv.userId !== input.userId) throw new Error("forbidden");
    if (conv.contractId !== input.contractId) {
      throw new Error("contractId does not match this conversation's contract");
    }

    const contract = await this.contracts.getOwned(input.contractId, input.userId);
    const wasAlreadySent = contract.status === "sent";
    const channel: SendChannel = input.channel ?? "email";
    const wantEmail = channel === "email" || channel === "both";
    const wantSms = channel === "sms" || channel === "both";

    let emailedTo: string | undefined;
    let emailFailureReason: string | undefined;
    let textedTo: string | undefined;
    let smsFailureReason: string | undefined;

    if (!wasAlreadySent) {
      await this.contracts.update(contract.id, input.userId, { status: "sent" });
      await this.bus.emit({
        userId: input.userId,
        entityType: "contract",
        entityId: contract.id,
        action: "sent",
      });
    }

    if (wantEmail) {
      try {
        const result = await this.emailer.run(input.userId, { kind: "contract", resourceId: contract.id });
        if (result.ok) emailedTo = result.to;
        else emailFailureReason = result.reason;
        console.log(`[send-contract] contract=${contract.id} email ok=${result.ok} to=${result.to ?? "<none>"} reason=${result.reason ?? "ok"}`);
      } catch (err) {
        emailFailureReason = (err as Error).message ?? "dispatch threw";
        console.error(`[send-contract] email dispatch failed for contract ${contract.id}:`, err);
      }
    }

    if (wantSms) {
      try {
        const result = await this.smser.run(input.userId, { kind: "contract", resourceId: contract.id });
        if (result.ok) textedTo = result.to;
        else smsFailureReason = result.reason;
        console.log(`[send-contract] contract=${contract.id} sms ok=${result.ok} to=${result.to ?? "<none>"} reason=${result.reason ?? "ok"}`);
      } catch (err) {
        smsFailureReason = (err as Error).message ?? "dispatch threw";
        console.error(`[send-contract] sms dispatch failed for contract ${contract.id}:`, err);
      }
    }

    // Also (re-)dispatch the linked quote if it was never actually
    // delivered. Email-only backfill: the customer-facing email and the
    // contract page link from it cover the gap when the LLM-drafted
    // quote was locked before a customer was bound.
    const quoteId = conv.quoteId ?? contract.quoteId;
    if (quoteId && wantEmail) {
      try {
        const quote = await this.quotes.getOwned(quoteId, input.userId);
        if (!quote.sentAt) {
          if (!quote.customerId && conv.customerId) {
            await this.quotes.update(quote.id, input.userId, { customerId: conv.customerId });
          }
          const r = await this.emailer.run(input.userId, { kind: "quote", resourceId: quote.id });
          console.log(`[send-contract] quote-backfill quote=${quote.id} email ok=${r.ok} to=${r.to ?? "<none>"} reason=${r.reason ?? "ok"}`);
        }
      } catch (err) {
        console.error(`[send-contract] quote backfill dispatch failed for quote ${quoteId}:`, err);
      }
    }

    const dividerContent = buildDivider({ channel, emailedTo, emailFailureReason, textedTo, smsFailureReason });
    const note = await this.messages.append({
      conversationId: conv.id,
      role: "system",
      kind: "phase_divider",
      content: dividerContent,
      payload: {
        phase: 3,
        label: dividerContent,
        contractId: contract.id,
        channel,
        ...(emailedTo ? { emailedTo } : {}),
        ...(emailFailureReason ? { emailFailureReason } : {}),
        ...(textedTo ? { textedTo } : {}),
        ...(smsFailureReason ? { smsFailureReason } : {}),
      },
    });

    const updatedConv = await this.conversations.update(conv.id, {
      contractStatus: "sent",
    });

    return { conversation: updatedConv, newMessages: [note] };
  }
}

function buildDivider(o: {
  channel: SendChannel;
  emailedTo?: string;
  emailFailureReason?: string;
  textedTo?: string;
  smsFailureReason?: string;
}): string {
  const { channel, emailedTo, emailFailureReason, textedTo, smsFailureReason } = o;
  const emailOk = !!emailedTo;
  const smsOk = !!textedTo;

  if (channel === "email") {
    if (emailOk) return `Contract emailed to ${emailedTo}`;
    if (emailFailureReason) return `Contract email failed — ${emailFailureReason}`;
    return "Contract drafted — no email on file for this customer. Add one to deliver.";
  }

  if (channel === "sms") {
    if (smsOk) return `Contract texted to ${textedTo}`;
    if (smsFailureReason) return `Contract text failed — ${smsFailureReason}`;
    return "Contract drafted — no phone on file for this customer. Add one to deliver.";
  }

  // both
  if (emailOk && smsOk) return `Contract emailed to ${emailedTo} and texted to ${textedTo}`;
  if (emailOk) return `Contract emailed to ${emailedTo} — text failed (${smsFailureReason ?? "no recipient"})`;
  if (smsOk) return `Contract texted to ${textedTo} — email failed (${emailFailureReason ?? "no recipient"})`;
  return `Contract not delivered — email: ${emailFailureReason ?? "no recipient"}; text: ${smsFailureReason ?? "no recipient"}`;
}
