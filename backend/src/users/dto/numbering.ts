import { IsInt, IsOptional, Max, Min, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";
import {
  type DocKind,
  MAX_START,
  type NumberingStarts,
} from "#documents/numbering.ts";

/** KV key family shared with the counters: ["profile_numbering", userId]. */
export const NUMBERING_PREFIX = "profile_numbering";

/**
 * REQ-199 — the account's chosen starting numbers. Each one can be set only
 * while no document of that kind has been issued; after the first issue the
 * sequence is locked and only advances.
 */
export interface NumberingSettings extends NumberingStarts {
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export class UpdateNumberingDto {
  @IsOptional() @IsInt() @Min(1) @Max(MAX_START)
  customerStart?: number;
  @IsOptional() @IsInt() @Min(1) @Max(MAX_START)
  quoteStart?: number;
  @IsOptional() @IsInt() @Min(1) @Max(MAX_START)
  invoiceStart?: number;
  @IsOptional() @IsInt() @Min(1) @Max(MAX_START)
  changeOrderStart?: number;
  @IsOptional() @IsInt() @Min(1) @Max(MAX_START)
  workOrderStart?: number;
}

export function parseUpdateNumbering(input: unknown): UpdateNumberingDto {
  const dto = plainToInstance(UpdateNumberingDto, input);
  const errors = validateSync(dto);
  if (errors.length) {
    throw new Error(`invalid numbering: ${JSON.stringify(errors)}`);
  }
  return dto;
}

/** What GET /profile/numbering answers: the settings plus where each sequence stands. */
export interface NumberingView {
  accountNumber: string;
  settings: NumberingStarts;
  /** per kind: the next number that will be issued */
  next: Record<DocKind, string>;
  /** per kind: true once the first number was issued — the start is locked */
  issued: Record<DocKind, boolean>;
  /** true once any kind has issued */
  locked: boolean;
}
