import { IsNumber, IsOptional, IsString, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";
import type { InvoiceUrgency } from "@paperwork/domain/business/invoice-urgency/mod.ts";

export class CreateInvoiceDto {
  @IsString()
  contractId!: string;

  @IsString()
  dueDate!: string;

  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsNumber() amount?: number;
  @IsOptional() @IsString() issuedDate?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() paidAt?: string;
}

export class UpdateInvoiceDto {
  @IsOptional() @IsString() contractId?: string;
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsNumber() amount?: number;
  @IsOptional() @IsString() issuedDate?: string;
  @IsOptional() @IsString() dueDate?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() paidAt?: string;
}

export interface Invoice extends CreateInvoiceDto {
  id: string;
  /** Owner. Populated server-side from the auth context — never accept from request body. */
  userId: string;
  createdAt: string;
  updatedAt: string;
  /** Computed read-only field: never accepted from request bodies; projected on read. */
  urgency?: InvoiceUrgency;
}

export function parseCreateInvoice(input: unknown): CreateInvoiceDto {
  const dto = plainToInstance(CreateInvoiceDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid invoice: ${JSON.stringify(errors)}`);
  return dto;
}

export function parseUpdateInvoice(input: unknown): UpdateInvoiceDto {
  const dto = plainToInstance(UpdateInvoiceDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid invoice patch: ${JSON.stringify(errors)}`);
  return dto;
}
