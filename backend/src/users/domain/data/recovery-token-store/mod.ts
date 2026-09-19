import { getKv } from "@core/data/kv/mod.ts";

/**
 * RecoveryTokenStore (REQ-039 / NW-52): a one-shot, short-lived token minted
 * when a verified OTP lands on a CLOSED account. It carries the closed
 * account's id to POST /auth/recover or /auth/start-fresh, so the person —
 * not the login flow — decides what happens to the old data.
 */
const PREFIX = "account_recovery";
const TTL_MS = 15 * 60 * 1000;

export class InvalidRecoveryTokenError extends Error {
  readonly status = 401;
  constructor() {
    super("recovery token is invalid or expired");
    this.name = "InvalidRecoveryTokenError";
  }
}

export async function issueRecoveryToken(userId: string): Promise<string> {
  const kv = await getKv();
  const token = crypto.randomUUID();
  await kv.set([PREFIX, token], { userId, issuedAt: new Date().toISOString() }, {
    expireIn: TTL_MS,
  });
  return token;
}

/** Redeems the token exactly once; throws when unknown or already used. */
export async function consumeRecoveryToken(token: string): Promise<string> {
  const kv = await getKv();
  const r = await kv.get<{ userId: string }>([PREFIX, token]);
  if (!r.value) throw new InvalidRecoveryTokenError();
  await kv.delete([PREFIX, token]);
  return r.value.userId;
}
