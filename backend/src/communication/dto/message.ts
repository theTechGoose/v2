import { IsIn, IsString, IsOptional, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";

export type MessageRole = "user" | "assistant" | "system";
export type MessageChannel = "text" | "email" | "web" | "phone" | "in_person";

export const MESSAGE_ROLES: MessageRole[] = ["user", "assistant", "system"];
export const MESSAGE_CHANNELS: MessageChannel[] = ["text", "email", "web", "phone", "in_person"];

export class CreateMessageDto {
  @IsString()
  conversationId!: string;

  @IsIn(MESSAGE_ROLES)
  role!: MessageRole;

  @IsIn(MESSAGE_CHANNELS)
  channel!: MessageChannel;

  @IsString()
  content!: string;

  @IsOptional() @IsString() subject?: string;
  @IsOptional() @IsString() fromAddress?: string;
  @IsOptional() @IsString() toAddress?: string;

  /** When the message is an outbound paperwork dispatch (quote/contract/
   *  invoice email or text), the paperwork row it references — powers the
   *  per-document comms trail (roadmap p.8 completion notifications). */
  @IsOptional() @IsString() paperworkId?: string;
  @IsOptional() @IsString() paperworkType?: string;
}

export class UpdateMessageDto {
  @IsOptional() @IsIn(MESSAGE_ROLES) role?: MessageRole;
  @IsOptional() @IsIn(MESSAGE_CHANNELS) channel?: MessageChannel;
  @IsOptional() @IsString() content?: string;
  @IsOptional() @IsString() subject?: string;
  @IsOptional() @IsString() fromAddress?: string;
  @IsOptional() @IsString() toAddress?: string;
}

export interface Message extends CreateMessageDto {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export function parseCreateMessage(input: unknown): CreateMessageDto {
  const dto = plainToInstance(CreateMessageDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid message: ${JSON.stringify(errors)}`);
  return dto;
}

export function parseUpdateMessage(input: unknown): UpdateMessageDto {
  const dto = plainToInstance(UpdateMessageDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid message patch: ${JSON.stringify(errors)}`);
  return dto;
}
