/**
 * Customer-facing send receipts (problems.md P-32).
 *
 * One send + accept logs THREE comms-trail messages against the quote's
 * paperworkId: the customer email (the only real delivery) plus the
 * contractor's OWN accepted-alert email and OWN accepted-alert SMS. The
 * receipts strip must show customer deliveries only — self-notifications
 * are noise, and repeat sends to the same destination collapse to one.
 *
 * Trail shape mirrors `GET /api/messages` message-log entries:
 * { channel, toAddress, paperworkId, content, … }.
 */

export interface TrailMessage {
  channel?: string;
  toAddress?: string;
  paperworkId?: string;
  [key: string]: unknown;
}

export interface ContractorContact {
  email?: string | null;
  phone?: string | null;
}

export interface CustomerReceipt {
  channel: "email" | "text";
  to: string;
}

/** Digits only, without a leading US country code — for phone equality. */
function normalizePhone(raw: string | null | undefined): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits;
}

function normalizeEmail(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

/**
 * Project a comms trail into customer-facing send receipts.
 *
 * - When `paperworkId` is given, scopes the trail to that document first
 *   (mirrors the QuotesPage per-quote filter).
 * - Keeps only channel "email" / "text" messages with a toAddress.
 * - DROPS anything addressed to the contractor's OWN email or phone —
 *   accepted-alert self-notifications are not customer sends.
 * - Dedups by `${channel}:${to}` (normalized), preserving first-seen order.
 */
export function classifyReceipts(
  messages: TrailMessage[],
  contractor: ContractorContact,
  paperworkId?: string,
): CustomerReceipt[] {
  const selfEmail = normalizeEmail(contractor.email);
  const selfPhone = normalizePhone(contractor.phone);

  const receipts: CustomerReceipt[] = [];
  const seen = new Set<string>();

  for (const message of messages) {
    if (paperworkId !== undefined && message.paperworkId !== paperworkId) {
      continue;
    }
    const channel = message.channel;
    if (channel !== "email" && channel !== "text") continue;
    const to = (message.toAddress ?? "").trim();
    if (!to) continue;

    // Self-notification? Compare against both contractor identifiers.
    if (selfEmail && normalizeEmail(to) === selfEmail) continue;
    if (selfPhone && normalizePhone(to) === selfPhone) continue;

    const key = channel === "email"
      ? `email:${normalizeEmail(to)}`
      : `text:${normalizePhone(to)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    receipts.push({ channel, to });
  }

  return receipts;
}

export interface ViewedSource {
  viewedAt?: string | null;
  lastOpenAt?: string | null;
  opens?: number;
}

export interface ViewedReceipt {
  kind: "viewed";
  at?: string;
}

/**
 * A "viewed by the customer" receipt when the document has actually been
 * opened (viewedAt / lastOpenAt present, or opens > 0); otherwise null.
 */
export function buildViewedReceipt(source: ViewedSource): ViewedReceipt | null {
  const at = source.viewedAt ?? source.lastOpenAt ?? undefined;
  const opened = Boolean(at) || (source.opens ?? 0) > 0;
  if (!opened) return null;
  return at ? { kind: "viewed", at } : { kind: "viewed" };
}
