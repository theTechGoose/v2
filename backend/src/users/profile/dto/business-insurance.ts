import { IsInt, IsOptional, IsString, Min, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";

export interface BusinessInsurance {
  userId: string;
  provider?: string;
  policyNumber?: string;
  /** Coverage in cents. e.g. 100_000_000 = $1M. */
  coverageCents?: number;
  /** ISO date — drives renewal reminders. */
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export class UpdateBusinessInsuranceDto {
  @IsOptional() @IsString() provider?: string;
  @IsOptional() @IsString() policyNumber?: string;
  @IsOptional() @IsInt() @Min(0) coverageCents?: number;
  @IsOptional() @IsString() expiresAt?: string;
}

export function parseUpdateBusinessInsurance(input: unknown): UpdateBusinessInsuranceDto {
  const dto = plainToInstance(UpdateBusinessInsuranceDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid business insurance: ${JSON.stringify(errors)}`);
  return dto;
}
