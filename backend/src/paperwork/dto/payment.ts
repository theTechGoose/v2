import { IsIn, IsNumber, IsOptional, IsString, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";

// Includes the peer-to-peer wallets so a confirmed payment preserves HOW the
// customer actually paid (Zelle/Venmo/Cash App/PayPal) instead of collapsing
// to "other" — the /payments dashboard, receipts, and CSV all read this.
export const PAYMENT_METHODS = [
  "cash",
  "check",
  "ach",
  "card",
  "venmo",
  "zelle",
  "cashapp",
  "paypal",
  "other",
] as const;
export type PaymentMethod = typeof PAYMENT_METHODS[number];

export class CreatePaymentDto {
  @IsString()
  invoiceId!: string;

  /** Payment amount in INTEGER CENTS. Audit1 #3. */
  @IsNumber()
  amount!: number;

  @IsString()
  @IsIn(PAYMENT_METHODS as unknown as string[])
  method!: PaymentMethod;

  @IsString()
  receivedAt!: string;

  @IsOptional() @IsString() reference?: string;
}

export class UpdatePaymentDto {
  /** INTEGER CENTS. */
  @IsOptional() @IsNumber() amount?: number;
  @IsOptional() @IsString() @IsIn(PAYMENT_METHODS as unknown as string[]) method?: PaymentMethod;
  @IsOptional() @IsString() receivedAt?: string;
  @IsOptional() @IsString() reference?: string;
}

export interface Payment extends CreatePaymentDto {
  id: string;
  /** Owner. Populated server-side from the auth context — never accept from request body. */
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export function parseCreatePayment(input: unknown): CreatePaymentDto {
  const dto = plainToInstance(CreatePaymentDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid payment: ${JSON.stringify(errors)}`);
  return dto;
}

export function parseUpdatePayment(input: unknown): UpdatePaymentDto {
  const dto = plainToInstance(UpdatePaymentDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid payment patch: ${JSON.stringify(errors)}`);
  return dto;
}
