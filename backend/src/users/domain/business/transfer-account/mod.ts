/** REQ-220 — the pure rules of "Transfer account": a new number takes the account. */

export type TransferRefusal = "same_number" | "phone_taken";

/**
 * What a transfer refuses: the owner's own number, and a number that
 * already has an account — open or closed (a closed account keeps its number for recovery,
 * REQ-039).
 */
export function transferCheck(
  ownerPhone: string,
  newPhone: string,
  holder: { id: string; deletedAt?: string } | null,
): TransferRefusal | null {
  if (ownerPhone && ownerPhone === newPhone) return "same_number";
  if (holder) return "phone_taken";
  return null;
}

/**
 * The sessions a transfer drops: the owner's own. An admin acting for the account (REQ-146)
 * stays — the account still has its admins — and so does a super-admin's impersonation.
 */
export function ownSession(
  session: { userId: string; actorId?: string; impersonatorId?: string },
  userId: string,
): boolean {
  return session.userId === userId && !session.actorId && !session.impersonatorId;
}
