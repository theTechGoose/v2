import { IsIn, IsNumber, IsOptional, IsString, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";

export const PAYMENT_METHODS = ["cash", "check", "ach", "card", "other"] as const;
export type PaymentMethod = typeof PAYMENT_METHODS[number];

export class CreatePaymentDto {
  @IsString()
  invoiceId!: string;

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
