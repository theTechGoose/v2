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

/**
 * The first name outbound SMS copy may use for the contractor: first
 * whitespace token of the REAL user name; undefined when the name is a
 * seeded placeholder or empty. The placeholder's first token
 * ("Nuevo"/"New") is NEVER returned (UX-26).
 */
export function outboundSenderFirstName(
  userName: string | null | undefined,
): string | undefined {
  if (isPlaceholderName(userName)) return undefined;
  return userName!.trim().split(/\s+/)[0];
}

/** P-06 refusal reason — machine-readable needs-name signal (must keep
 *  matching /name|nombre/i). The one string every outbound gate emits. */
export const SENDER_NAME_REQUIRED_REASON =
  "sender name required — add your name in Settings / falta el nombre: agrega tu nombre en Configuración";

/**
 * The single machine-readable refusal every outbound dispatch coordinator
 * consults BEFORE composing/dispatching/logging (UX-26). undefined when a
 * real user name OR business name exists; otherwise the P-06-shaped refusal.
 */
export function senderIdentityRefusal(args: {
  userName?: string | null;
  businessName?: string | null;
}): { ok: false; reason: string; needsName: true; to: "" } | undefined {
  if (outboundSenderName(args) !== undefined) return undefined;
  return {
    ok: false,
    reason: SENDER_NAME_REQUIRED_REASON,
    needsName: true,
    to: "",
  };
}
