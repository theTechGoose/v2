import { IsArray, IsNumber, IsOptional, IsString, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";
import type { ContractMood } from "@paperwork/domain/business/contract-mood/mod.ts";

/**
 * One row in the persisted wizard answers. The customer-facing contract
 * page reads these straight off the contract — no need to re-walk the
 * conversation to know the agreed payment / warranty / etc. terms.
 */
export interface ContractTerm {
  /** Step id from CONTRACT_TERMS_WIZARD_V1 (e.g. "payment_terms"). */
  stepId: string;
  /** Human label of the step (e.g. "Payment terms"). */
  label: string;
  /** Resolved value the customer agreed to (e.g. "30 / 30 / 40"). */
  value: string;
}

export class CreateContractDto {
  @IsString()
  quoteId!: string;

  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() effectiveDate?: string;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() estimatedCompletionDate?: string;
  /** Contract total in INTEGER CENTS. Audit1 #3. */
  @IsOptional() @IsNumber() totalAmount?: number;
  @IsOptional() @IsString() signedAt?: string;
  /** Captured wizard answers (config/payment/warranty/etc.). Persisted at
   *  finalizeContract time so the public contract page can render them. */
  @IsOptional() @IsArray() terms?: ContractTerm[];
}

export class UpdateContractDto {
  @IsOptional() @IsString() quoteId?: string;
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() effectiveDate?: string;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() estimatedCompletionDate?: string;
  /** Contract total in INTEGER CENTS. Audit1 #3. */
  @IsOptional() @IsNumber() totalAmount?: number;
  @IsOptional() @IsString() signedAt?: string;
  @IsOptional() @IsArray() terms?: ContractTerm[];
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
