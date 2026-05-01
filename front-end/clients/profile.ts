/**
 * HTTP client for the /settings page.
 *
 * Backend reference: users/entrypoints/profile-composite-controller/mod.ts
 *   GET /profile                       → ProfileSnapshot (auth)
 */
import { api, type ApiOptions } from "../lib/api.ts";

export interface BusinessIdentity {
  userId: string;
  /** Backend persists this as `businessName`. We expose both names from
   *  the same field so older callers reading `displayName` keep working. */
  businessName?: string;
  displayName?: string;
  legalName?: string;
  businessLicense?: string;
  logoFileId?: string;
  logoUrl?: string;
  tagline?: string;
  websiteUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessAddress {
  userId: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessInsurance {
  userId: string;
  provider?: string;
  policyNumber?: string;
  coverageCents?: number;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContractDefaults {
  userId: string;
  paymentTermsDays?: number;
  depositPct?: number;
  warrantyDays?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileUser {
  id: string;
  phoneNumber: string;
  name?: string;
  email?: string;
  language?: "en" | "es";
  createdAt: number;
  updatedAt: number;
}

export interface ProfileSnapshot {
  user: ProfileUser;
  identity: BusinessIdentity | null;
  address: BusinessAddress | null;
  insurance: BusinessInsurance | null;
  tax: { tinMasked?: string; w9UploadedAt?: string } | null;
  contractDefaults: ContractDefaults | null;
  references: unknown[];
  initials: string;
}

export const profileClient = {
  get: (opts: ApiOptions = {}) => api.get<ProfileSnapshot>("/profile", opts),
};
