import { IsOptional, IsString, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";

export class CreateConversationDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() customerId?: string;
}

export class UpdateConversationDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() customerId?: string;
}

export interface Conversation extends CreateConversationDto {
  id: string;
  /** Owner. Populated server-side from the auth context — never accept from request body. */
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export function parseCreateConversation(input: unknown): CreateConversationDto {
  const dto = plainToInstance(CreateConversationDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid conversation: ${JSON.stringify(errors)}`);
  return dto;
}

export function parseUpdateConversation(input: unknown): UpdateConversationDto {
  const dto = plainToInstance(UpdateConversationDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid conversation patch: ${JSON.stringify(errors)}`);
  return dto;
}
