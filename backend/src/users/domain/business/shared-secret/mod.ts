/**
 * REQ-154 — the owner tools' gate (`/me/reset-by-phone` since REQ-? and `/field/workers/welcome-by-owner`):
 * a shared secret in the `x-reset-secret` header against `RESET_SECRET`. DISABLED BY DEFAULT — unset or
 * shorter than 16 characters refuses every call, so shipping the code never opens a tool on its own.
 */
export function secretAllows(
  secret: string | undefined,
  provided: string | undefined,
): boolean {
  const s = secret ?? "";
  if (s.length < 16) return false;
  return constantTimeEqual(s, provided ?? "");
}

/** length-checked constant-time string comparison (no early char-by-char bailout that would leak the secret via timing) */
export function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
  return diff === 0;
}
