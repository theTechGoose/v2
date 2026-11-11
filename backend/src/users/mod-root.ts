import { Module } from "#danet/core";

// --- auth + identity ---
import { AuthController } from "@users/entrypoints/auth-controller/mod.ts";
import { MeController } from "@users/entrypoints/me-controller/mod.ts";
import { AdminController } from "@users/entrypoints/admin-controller/mod.ts";
import { PaymentsController } from "@users/entrypoints/payments-controller/mod.ts"; // REQ-133
import { AdminsController } from "@users/entrypoints/admins-controller/mod.ts"; // REQ-146
import { AccountAdminStore } from "@users/domain/data/account-admin-store/mod.ts"; // REQ-146
import { AccountAdmins } from "@users/domain/coordinators/account-admins/mod.ts"; // REQ-146
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { SendOtp } from "@users/domain/coordinators/send-otp/mod.ts";
import { VerifyOtp } from "@users/domain/coordinators/verify-otp/mod.ts";
import { SendEmailOtp } from "@users/domain/coordinators/send-email-otp/mod.ts";
import { VerifyEmailOtp } from "@users/domain/coordinators/verify-email-otp/mod.ts";
import { AccountRecovery } from "@users/domain/coordinators/account-recovery/mod.ts";
import { SignInLanding } from "@users/domain/coordinators/sign-in-landing/mod.ts";
import { Logout } from "@users/domain/coordinators/logout/mod.ts";
import { WipeAccount } from "@users/domain/coordinators/wipe-account/mod.ts";
import { Impersonate } from "@users/domain/coordinators/impersonate/mod.ts";
import { BootstrapSuperAdmin } from "@users/domain/coordinators/bootstrap-super-admin/mod.ts";
import { DevLogin } from "@users/domain/coordinators/dev-login/mod.ts";
import { SettleWatch } from "@users/domain/coordinators/settle-watch/mod.ts"; // REQ-131
import { SmsService } from "@users/domain/data/sms/mod.ts";

// --- profile sub-aggregates (folded in from former ProfileModule) ---
import { BusinessIdentityController } from "@profile/entrypoints/business-identity-controller/mod.ts";
import { BusinessAddressController } from "@profile/entrypoints/business-address-controller/mod.ts";
import { BusinessInsuranceController } from "@profile/entrypoints/business-insurance-controller/mod.ts";
import {
  TaxIdentityController,
  TaxIdentityPublicController,
} from "@profile/entrypoints/tax-identity-controller/mod.ts";
import { ReferenceController } from "@profile/entrypoints/reference-controller/mod.ts";
import { ContractDefaultsController } from "@profile/entrypoints/contract-defaults-controller/mod.ts";
import { ProfileCompositeController } from "@profile/entrypoints/profile-composite-controller/mod.ts";

import { RateLimiter } from "@core/data/rate-limit/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { BusinessAddressStore } from "@profile/domain/data/business-address-store/mod.ts";
import { BusinessInsuranceStore } from "@profile/domain/data/business-insurance-store/mod.ts";
import { TaxIdentityStore } from "@profile/domain/data/tax-identity-store/mod.ts";
import { ReferenceStore } from "@profile/domain/data/reference-store/mod.ts";
import { ContractDefaultsStore } from "@profile/domain/data/contract-defaults-store/mod.ts";
import { LoadProfile } from "@profile/domain/coordinators/load-profile/mod.ts";
import { PlanStore } from "@users/domain/data/plan-store/mod.ts";
import { PaymentsLink } from "@users/domain/data/payments-link/mod.ts";
import { ChoosePlan } from "@users/domain/coordinators/choose-plan/mod.ts";
import { CrmCustomerSync } from "@users/domain/coordinators/crm-customer-sync/mod.ts";
import { CrmCaptureOutbox } from "@users/domain/data/crm-capture-outbox/mod.ts";
import { CrmLeadCapture } from "@users/domain/coordinators/crm-lead-capture/mod.ts";
import { SignupNotice } from "@users/domain/coordinators/signup-notice/mod.ts";
import { PayLinkMint } from "@users/domain/coordinators/pay-link-mint/mod.ts";
import { DocNumbering } from "@core/data/doc-numbering/mod.ts"; // REQ-198
import { NumberingStore } from "@users/domain/data/numbering-store/mod.ts"; // REQ-199
import { NumberingController } from "@users/entrypoints/numbering-controller/mod.ts"; // REQ-199
import { SetupReset } from "@users/domain/coordinators/setup-reset/mod.ts"; // REQ-199
import { TransferAccount } from "@users/domain/coordinators/transfer-account/mod.ts"; // REQ-220
import { TransferCodeStore } from "@users/domain/data/transfer-code-store/mod.ts"; // REQ-220

/**
 * UsersModule — owns the full user identity surface:
 *
 *   - AUTH       /auth/{send-otp, verify-otp, send-email-otp, verify-email-otp, logout}
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
    AuthController,
    MeController,
    AdminController,
    PaymentsController, // REQ-133
    AdminsController, // REQ-146
    // profile
    BusinessIdentityController,
    BusinessAddressController,
    BusinessInsuranceController,
    TaxIdentityController,
    TaxIdentityPublicController,
    ReferenceController,
    ContractDefaultsController,
    ProfileCompositeController,
    NumberingController, // REQ-199
  ],
  injectables: [
    // identity
    UserStore,
    SessionStore,
    OtpStore,
    SendOtp,
    VerifyOtp,
    SendEmailOtp,
    VerifyEmailOtp,
    AccountRecovery,
    SignInLanding, // REQ-091
    Logout,
    WipeAccount,
    Impersonate,
    BootstrapSuperAdmin,
    DevLogin,
    SettleWatch, // REQ-131
    SmsService,
    RateLimiter,
    AccountAdminStore, // REQ-146
    AccountAdmins, // REQ-146
    // profile
    BusinessIdentityStore,
    BusinessAddressStore,
    BusinessInsuranceStore,
    TaxIdentityStore,
    ReferenceStore,
    ContractDefaultsStore,
    LoadProfile,
    // REQ-054 — the plan
    PlanStore,
    PaymentsLink,
    CrmCustomerSync, // REQ-058
    CrmCaptureOutbox, // REQ-072
    CrmLeadCapture, // REQ-072
    SignupNotice, // REQ-103
    PayLinkMint, // REQ-106
    ChoosePlan,
    DocNumbering, // REQ-198
    NumberingStore, // REQ-199
    SetupReset, // REQ-199
    TransferCodeStore, // REQ-220
    TransferAccount, // REQ-220
  ],
})
export class UsersModule {}
