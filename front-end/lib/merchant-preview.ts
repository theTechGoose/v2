/**
 * REQ-1044 (LOOP-007 q2-28): the merchant preview drawn on the Stripe and Square payment
 * cards in /settings. The server builds `status.merchant` from the very same identity
 * fields (businessName → legalName → user.name), but the card's status is only fetched on
 * mount and on connect/disconnect — so the LIVE snapshot (updated at once by saveIdentity)
 * must win, and the cached status is only the last fallback. Otherwise a rename or a new
 * logo shows in the header and sidebar but not here until a reload.
 */
export type MerchantPreviewSnapshot = {
  user?: { name?: string | null } | null;
  identity?: {
    businessName?: string | null;
    legalName?: string | null;
    logoFileId?: string | null;
  } | null;
};

export type MerchantPreviewStatus =
  | {
    merchant?: { name?: string | null; logoFileId?: string | null } | null;
  }
  | null
  | undefined;

export type MerchantPreview = { name: string; logoFileId: string | null };

export function merchantPreview(
  snapshot: MerchantPreviewSnapshot,
  status: MerchantPreviewStatus,
): MerchantPreview {
  const name = snapshot.identity?.businessName?.trim() ||
    snapshot.identity?.legalName?.trim() ||
    snapshot.user?.name?.trim() ||
    status?.merchant?.name?.trim() || "";
  const logoFileId = snapshot.identity?.logoFileId ??
    status?.merchant?.logoFileId ?? null;
  return { name, logoFileId };
}
