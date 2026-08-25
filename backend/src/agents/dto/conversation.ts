import { IsOptional, IsString, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";

/**
 * Two-phase agent flow:
 *   - 'quote' — free-form chat where Bossie figures out job details and pricing,
 *     emits an action_card when a quote is drafted, then offers to advance.
 *   - 'terms' — structured wizard where the user picks options to assemble
 *     the agreement terms (see terms-wizard-spec) that land on the quote.
 *
 * "Send" is NOT a third conversational phase — once both phases are done,
 * sending the document to the customer is a single action that uses the
 * existing /quotes/:id/email endpoint.
 */
export type AgentPhase = "quote" | "terms";

export interface AgentConversation {
  id: string;
  userId: string; // owner — scopes all reads/writes
  customerId?: string; // bound once the agent identifies the customer
  quoteId?: string; // bound once a quote is locked (phase 1 → 2 trigger)
  invoiceId?: string; // bound once the post-acceptance invoice is created/sent
  currentPhase: AgentPhase;
  title?: string; // first user message, truncated
  preview?: string; // last meaningful message snippet
  /** Threads-sidebar badge. Set by accept-quote; cleared by load-conversation on next read. */
  hasUnreadEvent?: boolean;
  /** Denormalized quote.status so the sidebar chip can show sent/accepted without N+1. */
  quoteStatus?: string;
  /** Denormalized invoice.status (sent/paid) for the sidebar chip. */
  invoiceStatus?: string;
  createdAt: string;
  updatedAt: string;
}

export class CreateAgentConversationDto {
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  quoteId?: string;
}

export function parseCreateAgentConversation(
  input: unknown,
): CreateAgentConversationDto {
  const dto = plainToInstance(CreateAgentConversationDto, input);
  const errors = validateSync(dto);
  if (errors.length) {
    throw new Error(`invalid agent conversation: ${JSON.stringify(errors)}`);
  }
  return dto;
}
