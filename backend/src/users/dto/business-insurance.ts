import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  validateSync,
} from "#class-validator";
import { plainToInstance } from "#class-transformer";
// REQ-503 (demo-loop cycle 3, m62): the same insurer / policy-number rules the
// wizard and Settings show — "!!!" and a 120-character policy are refused.
import {
  INSURER_MAX,
  INSURER_PATTERN,
  POLICY_NUMBER_MAX,
  POLICY_NUMBER_PATTERN,
} from "#quote-flow/business-fields.ts";

export interface BusinessInsurance {
  userId: string;
  provider?: string;
  policyNumber?: string;
  /** Coverage in cents. e.g. 100_000_000 = $1M. */
  coverageCents?: number;
  /** ISO date — drives renewal reminders. */
  expiresAt?: string;
  /** Pointer to the uploaded COI / proof-of-insurance blob in the files module. */
  insuranceFileId?: string;
  /** Stamped server-side when insuranceFileId is (re)set. */
  insuranceUploadedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export class UpdateBusinessInsuranceDto {
  @IsOptional() @IsString() @MaxLength(INSURER_MAX) @Matches(INSURER_PATTERN)
  provider?: string;
  @IsOptional() @IsString() @MaxLength(POLICY_NUMBER_MAX) @Matches(POLICY_NUMBER_PATTERN)
  policyNumber?: string;
  @IsOptional() @IsInt() @Min(0) coverageCents?: number;
  @IsOptional() @IsString() expiresAt?: string;
  @IsOptional() @IsString() insuranceFileId?: string;
}

export function parseUpdateBusinessInsurance(input: unknown): UpdateBusinessInsuranceDto {
  const dto = plainToInstance(UpdateBusinessInsuranceDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid business insurance: ${JSON.stringify(errors)}`);
  return dto;
}
