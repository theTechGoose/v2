/**
 * REQ-622 (demo-loop cycle 4, p4-p6c): "Days to pay an invoice"
 * (identity.invoiceNetDays, REQ-174) is the one payment-term setting. The
 * retired Settings "Contract defaults" card stored a `paymentTermsDays` on the
 * contract-defaults document that nothing read. This returns that stored day
 * count when it should move into invoiceNetDays — only when invoiceNetDays was
 * never set, and only a whole number the identity accepts (0–365) — else
 * undefined.
 */
export function legacyNetDays(
  identity: { invoiceNetDays?: number } | null | undefined,
  contractDefaults: unknown,
): number | undefined {
  if (identity?.invoiceNetDays != null) return undefined;
  if (!contractDefaults || typeof contractDefaults !== "object") {
    return undefined;
  }
  const days =
    (contractDefaults as { paymentTermsDays?: unknown }).paymentTermsDays;
  if (typeof days !== "number" || !Number.isInteger(days)) return undefined;
  return days >= 0 && days <= 365 ? days : undefined;
}
