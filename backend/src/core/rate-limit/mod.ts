import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";

export interface RateLimitDecision {
  allowed: boolean;
  /** How many takes remain in the current window. */
  remaining: number;
  /** ms until the window resets. */
  resetMs: number;
}

/**
 * Token-bucket-ish counter persisted in Deno KV with TTL. Each `take` call
 * increments the counter under `["rate", scope, key]`; once the count
 * exceeds `max`, further calls return `{ allowed: false }` until the TTL
 * expires.
 *
 * Uses the KV row's expiry to drive the window — no janitor needed. The
 * counter is replaced (not incremented) on the first take so a fresh
 * window always starts at 1.
 *
 * Scope-prefixing lets multiple call sites share a bucket without
 * stepping on each other (e.g. `take("tin-verify", userId, ...)` vs
 * `take("login", phone, ...)`).
 */
@Injectable()
export class RateLimiter {
  async take(scope: string, key: string, max: number, windowMs: number): Promise<RateLimitDecision> {
    const kv = await getKv();
    const k = ["rate", scope, key];
    const r = await kv.get<{ count: number; resetAt: number }>(k);
    const now = Date.now();
    const existing = r.value;

    if (existing && existing.resetAt > now) {
      if (existing.count >= max) {
        return { allowed: false, remaining: 0, resetMs: existing.resetAt - now };
      }
      const next = { count: existing.count + 1, resetAt: existing.resetAt };
      await kv.set(k, next, { expireIn: existing.resetAt - now });
      return { allowed: true, remaining: max - next.count, resetMs: existing.resetAt - now };
    }

    // Window expired (or never set) — start a fresh one at count 1.
    const resetAt = now + windowMs;
    await kv.set(k, { count: 1, resetAt }, { expireIn: windowMs });
    return { allowed: true, remaining: max - 1, resetMs: windowMs };
  }
}
