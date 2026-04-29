import { Injectable } from "#danet/core";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { ContractDefaultsStore } from "@profile/domain/data/contract-defaults-store/mod.ts";
import { BusinessAddressStore } from "@profile/domain/data/business-address-store/mod.ts";
import { BusinessInsuranceStore } from "@profile/domain/data/business-insurance-store/mod.ts";
import { TaxIdentityStore } from "@profile/domain/data/tax-identity-store/mod.ts";
import { ReferenceStore } from "@profile/domain/data/reference-store/mod.ts";
import { computeInitials } from "@profile/domain/business/initials/mod.ts";
import {
  type PublicBusinessIdentity,
  projectPublicBusinessIdentity,
} from "@profile/domain/business/public-profile-projection/mod.ts";
import type { User } from "@users/dto/user.ts";
import type { BusinessIdentity } from "@profile/dto/business-identity.ts";
import type { ContractDefaults } from "@profile/dto/contract-defaults.ts";
import type { BusinessAddress } from "@profile/dto/business-address.ts";
import type { BusinessInsurance } from "@profile/dto/business-insurance.ts";
import type { TaxIdentity } from "@profile/dto/tax-identity.ts";
import type { Reference } from "@profile/dto/reference.ts";

/** Owner-side projection of TaxIdentity — never returns the salt or hash. */
export interface OwnerTaxIdentity {
  userId: string;
  w9FileId?: string;
  w9UploadedAt?: string;
  tinMasked?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileSnapshot {
  user: User;
  identity:         BusinessIdentity   | null;
  address:          BusinessAddress    | null;
  insurance:        BusinessInsurance  | null;
  tax:              OwnerTaxIdentity   | null;
  contractDefaults: ContractDefaults   | null;
  references:       Reference[];
  /** Convenience derived field — sidebar avatar initials. */
  initials: string;
}

/** Customer-facing subset — never includes private aggregates. */
export interface PublicProfileSnapshot {
  identity: PublicBusinessIdentity | null;
  address: { city?: string; state?: string; country?: string } | null;
  insurance: { provider?: string; coverageCents?: number } | null;
  hasW9: boolean;
}

/**
 * LoadProfile — fan out across the user + every per-user profile
 * sub-aggregate and return a single composite. Dashboard /settings hits
 * `load`; customer-facing pages hit `loadPublic` (safe subset, never
 * returns street/policyNumber/raw TIN).
 */
@Injectable()
export class LoadProfile {
  constructor(
    private users: UserStore,
    private identity:  BusinessIdentityStore,
    private address:   BusinessAddressStore,
    private insurance: BusinessInsuranceStore,
    private tax:       TaxIdentityStore,
    private defaults:  ContractDefaultsStore,
    private refs:      ReferenceStore,
  ) {}

  async load(userId: string): Promise<ProfileSnapshot> {
    const [user, identity, address, insurance, tax, contractDefaults, references] = await Promise.all([
      this.users.get(userId),
      this.identity.get(userId),
      this.address.get(userId),
      this.insurance.get(userId),
      this.tax.get(userId),
      this.defaults.get(userId),
      this.refs.listByUser(userId),
    ]);
    return {
      user,
      identity,
      address,
      insurance,
      tax: redactTaxForOwner(tax),
      contractDefaults,
      references,
      initials: computeInitials(user.name),
    };
  }

  async loadPublic(userId: string): Promise<PublicProfileSnapshot> {
    const [identity, address, insurance, tax] = await Promise.all([
      this.identity.get(userId),
      this.address.get(userId),
      this.insurance.get(userId),
      this.tax.get(userId),
    ]);
    return {
      identity:  projectPublicBusinessIdentity(identity),
      address:   address ? { city: address.city, state: address.state, country: address.country } : null,
      insurance: insurance ? { provider: insurance.provider, coverageCents: insurance.coverageCents } : null,
      hasW9:     Boolean(tax?.w9FileId),
    };
  }
}

function redactTaxForOwner(t: TaxIdentity | null): OwnerTaxIdentity | null {
  if (!t) return null;
  return {
    userId:       t.userId,
    w9FileId:     t.w9FileId,
    w9UploadedAt: t.w9UploadedAt,
    tinMasked:    t.tinMasked,
    createdAt:    t.createdAt,
    updatedAt:    t.updatedAt,
  };
}
