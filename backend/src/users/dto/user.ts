import { IsIn, IsOptional, IsString, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";

export type Language = "en" | "es";

export interface User {
  id: string;
  phoneNumber: string;
  /** REQ-039 (NW-52): set when the account was closed — the row and the
   *  phone index stay so the person can recover it later. */
  deletedAt?: string;
  name?: string;
  email?: string;
  language?: Language;
  /**
   * Platform super-admin flag. Gates the /admin surface (user search,
   * grant/revoke, impersonation). NEVER part of UpdateUserDto — it can only
   * be flipped through the guarded grant/revoke endpoints or the bootstrap,
   * so it can never be set from an arbitrary PUT /me body.
   */
  superAdmin?: boolean;
  /**
   * `onboardedAt` is the server ISO timestamp of the FIRST time the user
   * reached the end of the /welcome wizard or left it; once set it never
   * changes. `onboardingSkipped` records whether that first time was a skip.
   * A record, not a gate (REQ-091): where a code lands and when the wizard
   * lets go are read off the questions still open on the profile.
   *
   * NEVER part of UpdateUserDto — they are stamped only through the dedicated
   * `UserStore.markOnboarded` write path (POST /me/onboarded), so they can't
   * ride in on an arbitrary PUT /me body.
   */
  onboardedAt?: string;
  onboardingSkipped?: boolean;
  createdAt: string;
  updatedAt: string;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsIn(["en", "es"])
  language?: Language;
}

export function parseUpdateUser(input: unknown): UpdateUserDto {
  const dto = plainToInstance(UpdateUserDto, input);
  const errors = validateSync(dto);
  if (errors.length) {
    throw new Error(`invalid user patch: ${JSON.stringify(errors)}`);
  }
  return dto;
}
