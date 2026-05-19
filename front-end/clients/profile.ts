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
  /** Per-method enable flags + handles (Venmo @, Zelle email, etc.).
   *  Shape mirrors backend AcceptedPaymentMethods but kept permissive so
   *  consumers only need the .enabled flag for gating logic. */
  acceptedPaymentMethods?: Partial<Record<
    "check" | "venmo" | "zelle" | "cashapp" | "cash" | "ach" | "other",
    { enabled?: boolean; handle?: string; cashtag?: string; mailTo?: string; routingNumber?: string; accountNumberMasked?: string; instructions?: string }
  >>;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessAddress {
  userId: string;
  street?: string;
  unit?: string;
  city?: string;
  state?: string;
  postal?: string;
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
  /** PATCH the authenticated user (name, email, language). */
  updateUser: (patch: Record<string, unknown>, opts: ApiOptions = {}) =>
    api.put<ProfileUser>("/me", patch, opts),
  /** PATCH the business identity (businessName, logoFileId, etc.). */
  updateIdentity: (patch: Record<string, unknown>, opts: ApiOptions = {}) =>
    api.put<BusinessIdentity>("/profile/identity", patch, opts),
};
