import type { BusinessIdentity } from "@profile/dto/business-identity.ts";

/**
 * Filter a `BusinessIdentity` down to fields that are safe to show to a
 * customer on a public quote / contract / invoice page.
 *
 * Currently this is a near-pass-through (all the BusinessIdentity fields
 * are public-facing by design), but we keep the projection in place so the
 * boundary is explicit — when fields like internal_notes or private_terms
 * land later they're filtered here, not inside the controller.
 */
export interface PublicBusinessIdentity {
  businessName?: string;
  businessLicense?: string;
  logoFileId?: string;
}

export function projectPublicBusinessIdentity(
  source: BusinessIdentity | null,
): PublicBusinessIdentity | null {
  if (!source) return null;
  return {
    businessName: source.businessName,
    businessLicense: source.businessLicense,
    logoFileId: source.logoFileId,
  };
}
