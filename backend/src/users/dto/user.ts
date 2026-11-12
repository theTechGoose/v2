import type { LeadOrigin } from "#lead-origin/mod.ts";
import { IsIn, IsOptional, IsString, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";
import type { Features } from "#features";
import { accountEmailError } from "#quote-flow/settings-fields.ts"; // REQ-501

export type Language = "en" | "es";

export interface User {
  id: string;
  phoneNumber: string;
  /**
   * REQ-211 — where the account came from: the landing page its signup was made on and the ad
   * that brought the person. Stamped once at creation from the OTP record; NEVER part of
   * UpdateUserDto — the CRM's lead source reads it on every sync.
   */
  origin?: LeadOrigin;
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
   * REQ-177: per-account feature flags (keys from shared/features.ts). NEVER part of
   * UpdateUserDto — the only write path is UserStore.setFeature, behind the super-admin route.
   */
  features?: Features;
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
  /**
   * REQ-227: question → ISO time the person pressed that step's Skip in the wizard. A deferred
   * question is still open (the next code asks it again), but the dashboard lets the person
   * through once every open question is deferred. NEVER part of UpdateUserDto — the only write
   * path is `UserStore.deferOnboarding` (POST /me/onboarding/deferred).
   */
  onboardingDeferred?: Partial<Record<string, string>>;
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

/**
 * A refused PUT /me body. Danet answers `error.status || 500`, so this is a 400; REQ-501 (demo
 * M35): a malformed email's message is the dictionary key (`customer.invalidEmail`) the client shows.
 */
export class UserInputError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "UserInputError";
  }
}

export function parseUpdateUser(input: unknown): UpdateUserDto {
  const dto = plainToInstance(UpdateUserDto, input);
  const errors = validateSync(dto);
  if (errors.length) {
    throw new UserInputError(`invalid user patch: ${JSON.stringify(errors)}`);
  }
  // REQ-501 (demo M35): "carl@@jensen" is not an address; "" still clears the email
  const emailErr = dto.email === undefined ? null : accountEmailError(dto.email);
  if (emailErr) throw new UserInputError(emailErr);
  if (dto.email !== undefined) dto.email = dto.email.trim();
  return dto;
}
