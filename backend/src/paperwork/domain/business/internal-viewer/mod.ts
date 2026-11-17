/**
 * REQ-225 (demo M18 / test-setup-claims-m3): who is looking at a public
 * document page. Only the end customer's load is an "open" — it records a view
 * and flips a sent quote to "viewed". These viewers are internal and are not
 * counted:
 *   - the owner, or an admin acting for the owner's account (`userId` is the
 *     owner's): "view as customer", the /welcome sample-preview iframe;
 *   - any impersonation session (`impersonatorId`): staff, including the
 *     demo stage's replica frame that follows the customer to /q/:id.
 * A session from another account still counts. That person may really be
 * this contractor's customer.
 */
export interface ViewerSession {
  userId: string;
  impersonatorId?: string;
  actorId?: string;
}

export function isInternalViewer(
  session: ViewerSession | null,
  ownerId: string,
): boolean {
  if (!session) return false;
  if (session.impersonatorId) return true;
  return session.userId === ownerId;
}
