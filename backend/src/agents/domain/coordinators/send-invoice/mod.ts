import { Injectable } from "#danet/core";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { ContractStore } from "@paperwork/domain/data/contract-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { SendPaperworkEmail } from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import type { AgentConversation } from "@agents/dto/conversation.ts";
import type { AgentMessage } from "@agents/dto/message.ts";

export interface SendInvoiceInput {
  userId: string;
  conversationId: string;
}

export interface SendInvoiceResult {
  conversation: AgentConversation;
  /** action_card describing the invoice + status=sent. */
  newMessages: AgentMessage[];
}

const DEFAULT_DUE_DAYS = 30;

/**
 * SendInvoice — closes the chain: quote → contract → INVOICE.
 *
 * Fires when the user clicks the post-contract-acceptance "Continue to
 * invoice" CTA. Either materializes the conversation's first invoice
 * from the bound contract (totalAmount, customerId, default 30-day
 * due date) or re-uses an existing one bound by `conv.invoiceId`.
 *
 *   1. Verify ownership + that conv.contractId is bound.
 *   2. Reuse conv.invoiceId if already created; otherwise create one
 *      from the contract.
 *   3. If invoice.status !== 'sent', flip it and emit `invoice:sent`.
 *   4. Best-effort dispatch the customer email (failure logs but does
 *      not abort — user can retry from the invoice surface).
 *   5. Append an action_card the chat can render with the invoice
 *      summary + total.
 *   6. Bind conv.invoiceId so the threads sidebar / next reads know.
 */
@Injectable()
export class SendInvoice {
  constructor(
    private conversations: AgentConversationStore,
    private messages: AgentMessageStore,
    private contracts: ContractStore,
    private invoices: InvoiceStore,
    private bus: EventBus,
    private emailer: SendPaperworkEmail,
  ) {}

  async run(input: SendInvoiceInput): Promise<SendInvoiceResult> {
    const conv = await this.conversations.get(input.conversationId);
    if (conv.userId !== input.userId) throw new Error("forbidden");
    if (!conv.contractId) {
      throw new Error("conversation has no bound contract — accept the contract first");
    }

    const contract = await this.contracts.getOwned(conv.contractId, input.userId);

    let invoiceId = conv.invoiceId;
    if (!invoiceId) {
      const dueDate = new Date(Date.now() + DEFAULT_DUE_DAYS * 86_400_000)
        .toISOString().slice(0, 10);
      const created = await this.invoices.create(input.userId, {
        contractId: contract.id,
        ...(contract.customerId ? { customerId: contract.customerId } : {}),
        ...(typeof contract.totalAmount === "number" ? { amount: contract.totalAmount } : {}),
        issuedDate: new Date().toISOString().slice(0, 10),
        dueDate,
        status: "draft",
      });
      invoiceId = created.id;
    }

    const invoice = await this.invoices.getOwned(invoiceId, input.userId);
    const wasAlreadySent = invoice.status === "sent";

    let emailedTo: string | undefined;
    let emailFailureReason: string | undefined;

    // State flip + bus emit are idempotent — only on first send. Email
    // dispatch retries every click so a previously-failed delivery
    // (e.g., POSTMARK_FROM unset on first try) doesn't leave the
    // invoice stuck in "sent" status without ever reaching the customer.
    if (!wasAlreadySent) {
      await this.invoices.update(invoice.id, input.userId, { status: "sent" });
      await this.bus.emit({
        userId: input.userId,
        entityType: "invoice",
        entityId: invoice.id,
        action: "sent",
      });
    }
    try {
      const result = await this.emailer.run(input.userId, { kind: "invoice", resourceId: invoice.id });
      if (result.ok) emailedTo = result.to;
      else emailFailureReason = result.reason;
      console.log(`[send-invoice] invoice=${invoice.id} email ok=${result.ok} to=${result.to ?? "<none>"} reason=${result.reason ?? "ok"}`);
    } catch (err) {
      emailFailureReason = (err as Error).message ?? "dispatch threw";
      console.error(`[send-invoice] email dispatch failed for invoice ${invoice.id}:`, err);
    }

    const fresh = await this.invoices.getOwned(invoice.id, input.userId);
    // Audit1 #3 — invoice.amount is INTEGER CENTS already.
    const totalCents = fresh.amount ?? 0;

    const card = await this.messages.append({
      conversationId: conv.id,
      role: "assistant",
      kind: "action_card",
      content: emailedTo
        ? `Invoice · due ${fresh.dueDate} · sent to ${emailedTo}`
        : `Invoice · due ${fresh.dueDate} · no email on file`,
      payload: {
        actionType: "invoice",
        status: "sent",
        invoiceId: fresh.id,
        contractId: contract.id,
        ...(fresh.customerId ? { customerId: fresh.customerId } : {}),
        lineItems: [{
          description: `Job total (contract ${contract.id.slice(0, 8)})`,
          amountCents: totalCents,
        }],
        totalCents,
        dueDate: fresh.dueDate,
        ...(emailedTo ? { emailedTo } : {}),
        ...(emailFailureReason ? { emailFailureReason } : {}),
      },
    });

    const updatedConv = await this.conversations.update(conv.id, {
      invoiceId: fresh.id,
      invoiceStatus: "sent",
      preview: `Invoice sent · due ${fresh.dueDate}`,
    });

    return { conversation: updatedConv, newMessages: [card] };
  }
}
