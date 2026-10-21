import { IsIn, IsOptional, IsString, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";

export type Language = "en" | "es";

/** REQ-113 — the paid plans a sign-up can name with the code (the landing's $99 and $199 cards);
 *  free is stored as the plan at once (REQ-104) */
export type SignupPlan = "monster" | "assist";

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
  /**
   * REQ-113 — the paid plan the sign-up named with the code: kept here from the code on (the
   * CRM's Signup Plan and the team's notice read it) and picked the moment the account has the
   * email a paid pick needs (ChoosePlan.pickNamed). A pick on record always wins over it.
   *
   * NEVER part of UpdateUserDto — written only by `UserStore.nameSignupPlan`. parseUpdateUser
   * passes every field it is given, so `UserStore.update` takes the three profile fields and
   * nothing else: this, the admin flag and the onboarding stamp cannot ride in on a PUT /me body.
   */
  signupPlan?: SignupPlan;
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
