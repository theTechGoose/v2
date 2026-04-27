import { IsIn, IsOptional, IsString, MinLength, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";

/**
 * Each AgentMessage carries a `kind` that drives how the chat-viewport
 * renders it. The kind decides which `payload` shape (if any) is attached.
 *
 *   text         → plain text bubble (role = 'user' or 'assistant')
 *   voice        → user voice memo (payload = { fileId, durationSec, transcript? })
 *   action_card  → assistant has produced a quote/contract/invoice (payload = ActionPayload)
 *   wizard       → assistant is presenting an inline wizard step (payload = WizardStepRender)
 *   continue_cta → assistant offers to advance phase (payload = { toPhase, summary })
 *   phase_divider→ visual marker between phases (payload = { phase, label })
 *
 * `phase_divider` is generated server-side at the moment of phase transition;
 * the client renders it in-line as a separator without rendering an avatar.
 */
export type MessageKind =
  | "text"
  | "voice"
  | "action_card"
  | "wizard"
  | "continue_cta"
  | "phase_divider";

export type MessageRole = "user" | "assistant" | "system";

export interface AgentMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  kind: MessageKind;
  content: string;                // plain summary; payload carries the structured data
  payload?: Record<string, unknown>;
  createdAt: string;
}

export class ChatInputDto {
  @IsOptional()
  @IsString()
  conversationId?: string;        // omitted on the very first message; server creates one

  @IsString()
  @MinLength(1)
  content!: string;

  @IsOptional()
  @IsIn(["text", "voice"])
  kind?: "text" | "voice";        // 'voice' carries an attached fileId in payload
}

export function parseChatInput(input: unknown): ChatInputDto {
  const dto = plainToInstance(ChatInputDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid chat input: ${JSON.stringify(errors)}`);
  return dto;
}
