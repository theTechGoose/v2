/**
 * Outbound sender identity (P-06) — the seeded placeholder account names
 * ("Nuevo usuario" / "New user", verify-otp/mod.ts:35) must never reach a
 * customer-facing email or SMS.
 *
 * Pure logic, no side effects.
 *
 * Wire-in targets (backend agent): senderName / renderQuoteSubject /
 * renderInvoiceSubject at send-paperwork-email/mod.ts:349-351, 523-526, 955.
 */

/** Mirrors front-end/islands/WelcomeWizard.tsx:73 — keep the lists in sync. */
const PLACEHOLDER_NAMES = ["New user", "Nuevo usuario"];

/**
 * True when the name is a seeded signup placeholder (trim-tolerant) or
 * effectively empty — i.e. "no real name yet".
 */
export function isPlaceholderName(name: string | null | undefined): boolean {
  const n = (name ?? "").trim();
  return n.length === 0 || PLACEHOLDER_NAMES.includes(n);
}

/**
 * The name customer-facing outbound copy may show for the contractor:
 * the real user name when it is not a placeholder, else the business name
 * (also placeholder-filtered), else undefined — the caller must collect a
 * real name; the placeholder is never emitted.
 */
export function outboundSenderName(
  args: { userName?: string | null; businessName?: string | null },
): string | undefined {
  if (!isPlaceholderName(args.userName)) return args.userName!.trim();
  if (!isPlaceholderName(args.businessName)) return args.businessName!.trim();
  return undefined;
}
