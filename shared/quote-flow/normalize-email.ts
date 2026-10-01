/**
 * REQ-050 — the ONE meaning of "the same email address" for email login:
 * trimmed, lowercased, and shaped like an address. The login page, the
 * backend lookup and the OTP key all go through this, so "Raphael@X.com "
 * and "raphael@x.com" are one account.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The canonical form of `raw`, or null when it is not an email address. */
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return EMAIL_SHAPE.test(email) ? email : null;
}
