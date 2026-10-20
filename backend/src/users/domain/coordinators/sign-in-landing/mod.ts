import { Injectable } from "#danet/core";
import { LoadProfile } from "@profile/domain/coordinators/load-profile/mod.ts";
import { signInLanding } from "#quote-flow/onboarding-questions.ts";

/**
 * REQ-091 — where a verified code lands: the wizard while any of the nine
 * onboarding questions is open, the dashboard (as a returning user) once
 * every one is answered. Read off the profile the wizard saves into — the
 * same snapshot /welcome and the dashboard's gate read — never off the
 * one-shot "new user" flag (a first sign-in whose onboarding page bounced
 * burned that flag for good) and never off the skip stamp.
 */
@Injectable()
export class SignInLanding {
  constructor(private profile: LoadProfile) {}

  async run(userId: string): Promise<string> {
    return signInLanding(await this.profile.load(userId));
  }
}
