/**
 * REQ-628 — A2Z Landscape, 2026-11-12: "They NEED THEIR LOGO NOT OURS". What a
 * customer-facing page calls the business: its name, else the contractor's,
 * else nothing (the page shows a neutral word) — never DocuMonster. Pure.
 */
export function publicBusinessLabel(
  c: { businessName?: string; name?: string } | undefined | null,
): string | undefined {
  return c?.businessName?.trim() || c?.name?.trim() || undefined;
}

/** "Invoice · A2Z Landscape LLC" — the tab title names the business, not us. */
export function publicDocTitle(kind: string, business: string | undefined): string {
  const b = business?.trim();
  return b ? `${kind} · ${b}` : kind;
}
