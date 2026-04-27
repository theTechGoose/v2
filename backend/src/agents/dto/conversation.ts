import { IsOptional, IsString, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";

/**
 * Two-phase agent flow:
 *   - 'quote' — free-form chat where Bossie figures out scope/pricing,
 *     emits an action_card when a quote is drafted, then offers to advance.
 *   - 'terms' — structured wizard where the user picks options to assemble
 *     contract terms (10 steps, see contract-terms-wizard-spec).
 *
 * "Send" is NOT a third conversational phase — once both phases are done,
 * sending the document to the customer is a single action that uses the
 * existing /quotes/:id/email or /contracts/:id/email endpoints.
 */
export type AgentPhase = "quote" | "terms";

export interface AgentConversation {
  id: string;
  userId: string;                 // owner — scopes all reads/writes
  customerId?: string;            // bound once the agent identifies the customer
  quoteId?: string;               // bound once a quote is locked (phase 1 → 2 trigger)
  contractId?: string;            // bound once contract terms are completed
  currentPhase: AgentPhase;
  title?: string;                 // first user message, truncated
  preview?: string;               // last meaningful message snippet
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

export function parseCreateAgentConversation(input: unknown): CreateAgentConversationDto {
  const dto = plainToInstance(CreateAgentConversationDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid agent conversation: ${JSON.stringify(errors)}`);
  return dto;
}
