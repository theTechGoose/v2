import { IsOptional, IsString, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";

/**
 * TaxIdentity — W-9 + TIN handling.
 *
 * The raw TIN is NEVER stored. Only:
 *   - tinHashed (SHA-256 of `salt + tin`)
 *   - tinSalt   (per-user 32-byte hex)
 *   - tinMasked ("***-**-1234")
 *
 * The hashed+salted form supports W-9-verification flows where the
 * customer types their TIN and we compare against the hash; the masked
 * form is what the contractor sees in their own settings page.
 *
 * w9FileId points at the binary in the `files` module.
 */
export interface TaxIdentity {
  userId: string;
  w9FileId?: string;
  w9UploadedAt?: string;
  tinHashed?: string;
  tinSalt?: string;
  tinMasked?: string;
  createdAt: string;
  updatedAt: string;
}

export class UpdateTaxIdentityDto {
  @IsOptional() @IsString() w9FileId?: string;
  /** Raw TIN — server hashes + masks, never stores plain. */
  @IsOptional() @IsString() tin?: string;
}

export function parseUpdateTaxIdentity(input: unknown): UpdateTaxIdentityDto {
  const dto = plainToInstance(UpdateTaxIdentityDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid tax identity: ${JSON.stringify(errors)}`);
  return dto;
}
