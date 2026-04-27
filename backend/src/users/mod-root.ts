import { Module } from "#danet/core";

// --- auth + identity ---
import { AuthController } from "@users/entrypoints/auth-controller/mod.ts";
import { MeController }   from "@users/entrypoints/me-controller/mod.ts";
import { UserStore }      from "@users/domain/data/user-store/mod.ts";
import { SessionStore }   from "@users/domain/data/session-store/mod.ts";
import { OtpStore }       from "@users/domain/data/otp-store/mod.ts";
import { SendOtp }        from "@users/domain/coordinators/send-otp/mod.ts";
import { VerifyOtp }      from "@users/domain/coordinators/verify-otp/mod.ts";
import { Logout }         from "@users/domain/coordinators/logout/mod.ts";
import { SmsService }     from "@users/domain/sms/mod.ts";

// --- profile sub-aggregates (folded in from former ProfileModule) ---
import { BusinessIdentityController } from "@profile/entrypoints/business-identity-controller/mod.ts";
import { BusinessAddressController }  from "@profile/entrypoints/business-address-controller/mod.ts";
import { BusinessInsuranceController }from "@profile/entrypoints/business-insurance-controller/mod.ts";
import { TaxIdentityController, TaxIdentityPublicController } from "@profile/entrypoints/tax-identity-controller/mod.ts";
import { ReferenceController }        from "@profile/entrypoints/reference-controller/mod.ts";
import { ContractDefaultsController } from "@profile/entrypoints/contract-defaults-controller/mod.ts";
import { ProfileCompositeController } from "@profile/entrypoints/profile-composite-controller/mod.ts";

import { RateLimiter }            from "@core/rate-limit/mod.ts";
import { BusinessIdentityStore }  from "@profile/domain/data/business-identity-store/mod.ts";
import { BusinessAddressStore }   from "@profile/domain/data/business-address-store/mod.ts";
import { BusinessInsuranceStore } from "@profile/domain/data/business-insurance-store/mod.ts";
import { TaxIdentityStore }       from "@profile/domain/data/tax-identity-store/mod.ts";
import { ReferenceStore }         from "@profile/domain/data/reference-store/mod.ts";
import { ContractDefaultsStore }  from "@profile/domain/data/contract-defaults-store/mod.ts";
import { LoadProfile }            from "@profile/domain/coordinators/load-profile/mod.ts";

/**
 * UsersModule — owns the full user identity surface:
 *
 *   - AUTH       /auth/{send-otp, verify-otp, logout}
 *   - SELF       GET/PUT/DELETE /me
 *   - PROFILE    /profile (composite read)
 *                /profile/{identity, address, insurance, tax, references, contract-defaults}
 *                /profile/:userId/public                    (no auth)
 *                POST /profile/:userId/tax/verify           (no auth, rate-limited)
 *
 * Profile was a separate module in earlier drafts; rolling it under
 * `users` cuts the cross-module wiring overhead since every profile
 * surface is already user-scoped.
 */
@Module({
  controllers: [
    // identity
    AuthController, MeController,
    // profile
    BusinessIdentityController,
    BusinessAddressController,
    BusinessInsuranceController,
    TaxIdentityController,
    TaxIdentityPublicController,
    ReferenceController,
    ContractDefaultsController,
    ProfileCompositeController,
  ],
  injectables: [
    // identity
    UserStore, SessionStore, OtpStore,
    SendOtp, VerifyOtp, Logout,
    SmsService,
    RateLimiter,
    // profile
    BusinessIdentityStore,
    BusinessAddressStore,
    BusinessInsuranceStore,
    TaxIdentityStore,
    ReferenceStore,
    ContractDefaultsStore,
    LoadProfile,
  ],
})
export class UsersModule {}
