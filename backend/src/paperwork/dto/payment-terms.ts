import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
  ValidateNested,
} from "#class-validator";
import { plainToInstance, Type } from "#class-transformer";

export class InstallmentDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  percent!: number;

  @IsString()
  dueDate!: string;

  @IsOptional() @IsString() label?: string;
  @IsOptional() @IsString() note?: string;
}

export class CreatePaymentTermsDto {
  @IsString()
  name!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InstallmentDto)
  installments!: InstallmentDto[];

  @IsOptional() @IsString() description?: string;
}

export class UpdatePaymentTermsDto {
  @IsOptional() @IsString() name?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InstallmentDto)
  installments?: InstallmentDto[];

  @IsOptional() @IsString() description?: string;
}

export interface Installment extends InstallmentDto {}

export interface PaymentTerms extends CreatePaymentTermsDto {
  id: string;
  /** Owner. Populated server-side from the auth context — never accept from request body. */
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export function parseCreatePaymentTerms(input: unknown): CreatePaymentTermsDto {
  const dto = plainToInstance(CreatePaymentTermsDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid payment terms: ${JSON.stringify(errors)}`);
  return dto;
}

export function parseUpdatePaymentTerms(input: unknown): UpdatePaymentTermsDto {
  const dto = plainToInstance(UpdatePaymentTermsDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid payment terms patch: ${JSON.stringify(errors)}`);
  return dto;
}
