import { IsNumber, IsOptional, IsString, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";

export class CreateEntryDto {
  @IsString()
  accountId!: string;

  @IsNumber()
  amount!: number;

  @IsString()
  occurredAt!: string;

  @IsOptional() @IsString() transactionId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() reference?: string;
}

export class UpdateEntryDto {
  @IsOptional() @IsString() accountId?: string;
  @IsOptional() @IsNumber() amount?: number;
  @IsOptional() @IsString() occurredAt?: string;
  @IsOptional() @IsString() transactionId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() reference?: string;
}

export interface Entry extends CreateEntryDto {
  id: string;
  /** Owner. Populated server-side from the auth context — never accept from request body. */
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export function parseCreateEntry(input: unknown): CreateEntryDto {
  const dto = plainToInstance(CreateEntryDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid entry: ${JSON.stringify(errors)}`);
  return dto;
}

export function parseUpdateEntry(input: unknown): UpdateEntryDto {
  const dto = plainToInstance(UpdateEntryDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid entry patch: ${JSON.stringify(errors)}`);
  return dto;
}
