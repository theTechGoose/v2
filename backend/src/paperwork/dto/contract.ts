import { IsNumber, IsOptional, IsString, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";
import type { ContractMood } from "@paperwork/domain/business/contract-mood/mod.ts";

export class CreateContractDto {
  @IsString()
  quoteId!: string;

  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() effectiveDate?: string;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() estimatedCompletionDate?: string;
  @IsOptional() @IsNumber() totalAmount?: number;
  @IsOptional() @IsString() signedAt?: string;
}

export class UpdateContractDto {
  @IsOptional() @IsString() quoteId?: string;
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() effectiveDate?: string;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() estimatedCompletionDate?: string;
  @IsOptional() @IsNumber() totalAmount?: number;
  @IsOptional() @IsString() signedAt?: string;
}

export interface Contract extends CreateContractDto {
  id: string;
  /** Owner. Populated server-side from the auth context — never accept from request body. */
  userId: string;
  createdAt: string;
  updatedAt: string;
  /** Computed read-only field: never accepted from request bodies; projected on read. */
  mood?: ContractMood;
}

export function parseCreateContract(input: unknown): CreateContractDto {
  const dto = plainToInstance(CreateContractDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid contract: ${JSON.stringify(errors)}`);
  return dto;
}

export function parseUpdateContract(input: unknown): UpdateContractDto {
  const dto = plainToInstance(UpdateContractDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid contract patch: ${JSON.stringify(errors)}`);
  return dto;
}
