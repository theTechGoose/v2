/**
 * REQ-072 — the lead capture's retry clock. A capture the CRM did not confirm is tried again
 * after a wait that doubles from 5 s and caps at five minutes; a record another sweep holds (a
 * live lease) is left alone. Pure — the outbox stores these fields, the sweep reads them.
 */
export interface PendingCapture {
  /** the lead's phone (REQ-072); "" on a customer sync record */
  phone: string;
  /** REQ-098 — a customer sync record: the account whose CRM customer the sweep makes or revises
   *  (CrmCustomerSync.ensure), keyed apart from the leads */
  userId?: string;
  enqueuedAt: string;
  attempts: number;
  /** ISO — not tried before this */
  nextAt: string;
  lastError?: string;
  /** ISO — a sweep is on it until then */
  leaseUntil?: string;
}

const FIRST_BACKOFF_MS = 5_000;
export const MAX_BACKOFF_MS = 5 * 60_000;
/** how long one sweep may hold a record before another may take it over */
export const LEASE_MS = 90_000;

export function backoffMs(attempts: number): number {
  return Math.min(FIRST_BACKOFF_MS * 2 ** Math.max(0, attempts), MAX_BACKOFF_MS);
}

export function isDue(rec: PendingCapture, now: number): boolean {
  if (Date.parse(rec.nextAt) > now) return false;
  if (rec.leaseUntil && Date.parse(rec.leaseUntil) > now) return false;
  return true;
}
