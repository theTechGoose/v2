import { IsIn, IsOptional, IsString, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";

export type Language = "en" | "es";

export interface User {
  id: string;
  phoneNumber: string;
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
   * First-sign-in onboarding completion. `onboardedAt` is the server ISO
   * timestamp of the FIRST time the user finished or skipped the /welcome
   * wizard; once set it never changes (skip is permanent). `onboardingSkipped`
   * records whether that first completion was a skip vs. a real finish.
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
