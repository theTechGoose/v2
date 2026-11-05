/**
 * REQ-146 — an admin on an account: a phone number the owner invited. The
 * person signs in with that number and the session opens IN the owner's
 * account (`Session.actorId` is their own user id). `userId` is the OWNER —
 * the account the record belongs to, like every user-owned record.
 */
export interface AccountAdmin {
  id: string;
  /** the account (the owner's user id) */
  userId: string;
  /** E.164 */
  phoneNumber: string;
  /** what the owner called them on the invite */
  name?: string;
  createdAt: string;
}
