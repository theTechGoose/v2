import { Injectable } from "#danet/core";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { SendPaperworkEmail } from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import { SendPaperworkSms } from "@paperwork/domain/coordinators/send-paperwork-sms/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { t } from "@core/i18n/mod.ts";
import type { AgentConversation } from "@agents/dto/conversation.ts";
import type { AgentMessage } from "@agents/dto/message.ts";

export type SendChannel = "email" | "sms" | "both";

export interface SendQuoteInput {
  userId: string;
  conversationId: string;
  /** Must match conv.quoteId — guarantees the user is sending the
   *  document they think they're sending, not a stray draft. */
  quoteId: string;
  /** Which channel to dispatch on. Defaults to 'email' for tests and
   *  any caller that hasn't been updated yet. */
  channel?: SendChannel;
  /** Which language to send the paperwork in (the "Send in <lang>" button).
   *  Overrides the contractor's stored default for THIS dispatch only. */
  language?: "en" | "es";
}

export interface SendQuoteResult {
  conversation: AgentConversation;
  /** Status-update message confirming the dispatch (no popup needed). */
  newMessages: AgentMessage[];
}

/**
 * SendQuote — fires the wizard's "Ready to send" CTA. The quote IS the
 * Quote + Agreement document, so this is the one customer dispatch.
 *
 *   1. Verify ownership + that quoteId matches conv.quoteId
 *      (we don't allow sending an unrelated draft on this conversation).
 *   2. Backfill quote.customerId from the conversation so the recipient
 *      resolves (UX-02 — without it the freshly won job vanished from
 *      /jobs and every dashboard number).
 *   3. If the quote is already 'sent', short-circuit the *state flip*
 *      (idempotent; re-clicks don't double-emit events). Email/SMS
 *      dispatch is NOT idempotent — the user clicked Send, so we deliver.
 *   4. Flip quote.status = 'sent' + stamp sentAt, emit `quote:sent`.
 *   5. Dispatch via the requested channel(s). Failures don't abort the
 *      status flip — the user can retry from the quote surface.
 *   6. Append a system message so the chat shows what happened.
 */
@Injectable()
export class SendQuote {
  constructor(
    private conversations: AgentConversationStore,
    private messages: AgentMessageStore,
    private quotes: QuoteStore,
    private bus: EventBus,
    private emailer: SendPaperworkEmail,
    private smser: SendPaperworkSms,
  ) {}

  async run(input: SendQuoteInput): Promise<SendQuoteResult> {
    const conv = await this.conversations.get(input.conversationId);
    if (conv.userId !== input.userId) throw new Error("forbidden");
    if (conv.quoteId !== input.quoteId) {
      throw new Error("quoteId does not match this conversation's quote");
    }

    let quote = await this.quotes.getOwned(input.quoteId, input.userId);
    // Bind the conversation's customer before dispatch so the recipient
    // (email/phone) resolves from the customer on file.
    if (!quote.customerId && conv.customerId) {
      quote = await this.quotes.update(quote.id, input.userId, {
        customerId: conv.customerId,
      });
    }

    const channel: SendChannel = input.channel ?? "email";
    const wantEmail = channel === "email" || channel === "both";
    const wantSms = channel === "sms" || channel === "both";

    let emailedTo: string | undefined;
    let emailFailureReason: string | undefined;
    let textedTo: string | undefined;
    let smsFailureReason: string | undefined;

    // Stamp the send state on the FIRST dispatch. sentAt (not status) is the
    // guard: lock-quote flips status to "sent" without a timestamp, and the
    // SMS-only path used to skip the stamp entirely — which hid the freshly
    // won job from /jobs and every dashboard number (UX-02).
    if (!quote.sentAt) {
      const statusFlip = !quote.status || quote.status === "draft";
      await this.quotes.update(quote.id, input.userId, {
        ...(statusFlip ? { status: "sent" } : {}),
        sentAt: new Date().toISOString(),
      });
      // Emit only on the actual draft→sent transition — lock-quote already
      // emitted `quote sent` when it flipped the status ahead of us.
      if (statusFlip) {
        await this.bus.emit({
          userId: input.userId,
          entityType: "quote",
          entityId: quote.id,
          action: "sent",
        });
      }
    }

    if (wantEmail) {
      try {
        const result = await this.emailer.run(input.userId, {
          kind: "quote",
          resourceId: quote.id,
          language: input.language,
        });
        if (result.ok) emailedTo = result.to;
        else emailFailureReason = result.reason;
        console.log(
          `[send-quote] quote=${quote.id} email ok=${result.ok} to=${
            result.to ?? "<none>"
          } reason=${result.reason ?? "ok"}`,
        );
      } catch (err) {
        emailFailureReason = (err as Error).message ?? "dispatch threw";
        console.error(
          `[send-quote] email dispatch failed for quote ${quote.id}:`,
          err,
        );
      }
    }

    if (wantSms) {
      try {
        const result = await this.smser.run(input.userId, {
          kind: "quote",
          resourceId: quote.id,
          language: input.language,
        });
        if (result.ok) textedTo = result.to;
        else smsFailureReason = result.reason;
        console.log(
          `[send-quote] quote=${quote.id} sms ok=${result.ok} to=${
            result.to ?? "<none>"
          } reason=${result.reason ?? "ok"}`,
        );
      } catch (err) {
        smsFailureReason = (err as Error).message ?? "dispatch threw";
        console.error(
          `[send-quote] sms dispatch failed for quote ${quote.id}:`,
          err,
        );
      }
    }

    const dividerContent = buildDivider({
      channel,
      emailedTo,
      emailFailureReason,
      textedTo,
      smsFailureReason,
      lang: input.language ?? "en",
    });
    const note = await this.messages.append({
      conversationId: conv.id,
      role: "system",
      kind: "phase_divider",
      content: dividerContent,
      payload: {
        phase: 3,
        label: dividerContent,
        quoteId: quote.id,
        channel,
        ...(emailedTo ? { emailedTo } : {}),
        ...(emailFailureReason ? { emailFailureReason } : {}),
        ...(textedTo ? { textedTo } : {}),
        ...(smsFailureReason ? { smsFailureReason } : {}),
      },
    });

    const updatedConv = await this.conversations.update(conv.id, {
      quoteStatus: "sent",
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
  lang: "en" | "es";
}): string {
  const {
    channel,
    emailedTo,
    emailFailureReason,
    textedTo,
    smsFailureReason,
    lang,
  } = o;
  const emailOk = !!emailedTo;
  const smsOk = !!textedTo;

  if (channel === "email") {
    if (emailOk) {
      return t(lang, "sendQuote.divider.emailed", { emailedTo: emailedTo! });
    }
    if (emailFailureReason) {
      return t(lang, "sendQuote.divider.emailFailed", {
        reason: emailFailureReason,
      });
    }
    return t(lang, "sendQuote.divider.noEmail");
  }

  if (channel === "sms") {
    if (smsOk) {
      return t(lang, "sendQuote.divider.texted", { textedTo: textedTo! });
    }
    if (smsFailureReason) {
      return t(lang, "sendQuote.divider.textFailed", {
        reason: smsFailureReason,
      });
    }
    return t(lang, "sendQuote.divider.noPhone");
  }

  // both
  if (emailOk && smsOk) {
    return t(lang, "sendQuote.divider.emailedAndTexted", {
      emailedTo: emailedTo!,
      textedTo: textedTo!,
    });
  }
  if (emailOk) {
    return t(lang, "sendQuote.divider.emailedTextFailed", {
      emailedTo: emailedTo!,
      reason: smsFailureReason ?? t(lang, "sendQuote.divider.noRecipient"),
    });
  }
  if (smsOk) {
    return t(lang, "sendQuote.divider.textedEmailFailed", {
      textedTo: textedTo!,
      reason: emailFailureReason ?? t(lang, "sendQuote.divider.noRecipient"),
    });
  }
  return t(lang, "sendQuote.divider.notDelivered", {
    emailReason: emailFailureReason ?? t(lang, "sendQuote.divider.noRecipient"),
    smsReason: smsFailureReason ?? t(lang, "sendQuote.divider.noRecipient"),
  });
}
