/**
 * REQ-1135 (LOOP-007 cycle 3, q3-60) — AMENDMENT of REQ-627: voiding an
 * invoice the customer was sent can tell her it is cancelled and nothing is
 * due. Pure rules shared by the void step (front-end) and the coordinator
 * that sends the notice (backend).
 */

export type VoidNoticeChannel = "email" | "text";

/** Was this invoice ever sent to the customer? (REQ-480: sentAt is stamped
 *  by the first send; a void before any send has nobody to tell.) */
export function wasSent(inv: { sentAt?: string | null }): boolean {
  return !!(inv.sentAt && String(inv.sentAt).trim());
}

/** The "Let <customer> know" box starts checked when the invoice went out
 *  and the customer can be reached by email or text. */
export function voidNoticeDefault(
  inv: { sentAt?: string | null },
  contact: { email?: string | null; textPhone?: string | null },
): boolean {
  return wasSent(inv) && !!(contact.email?.trim() || contact.textPhone?.trim());
}

/**
 * Which channels the notice goes out on: the ones the invoice itself went
 * out on (as the outbox recorded them), limited to the contacts she still
 * has. When the invoice went out some other way (paper, before the outbox)
 * or those contacts are gone, every contact she has.
 */
export function voidNoticeChannels(
  sentOn: readonly VoidNoticeChannel[],
  contact: { email?: string | null; phone?: string | null },
): VoidNoticeChannel[] {
  const reachable: VoidNoticeChannel[] = [];
  if (contact.email?.trim()) reachable.push("email");
  if (contact.phone?.trim()) reachable.push("text");
  const same = reachable.filter((c) => sentOn.includes(c));
  return same.length > 0 ? same : reachable;
}
