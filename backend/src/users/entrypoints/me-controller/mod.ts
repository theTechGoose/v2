import { Body, Context, Controller, Delete, Get, Post, Put } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { Logout } from "@users/domain/coordinators/logout/mod.ts";
import { WipeAccount } from "@users/domain/coordinators/wipe-account/mod.ts";
import { parseUpdateUser } from "@users/dto/user.ts";
import { requireUser, readSessionId, UnauthorizedError } from "@users/domain/coordinators/require-user/mod.ts";

/**
 * /me — endpoints that act on the currently-authenticated User.
 *
 * Every method calls requireUser() first; UnauthorizedError bubbles up and
 * (post-Danet-guard-wiring) maps to a 401 response.
 */
@Controller("me")
export class MeController {
  constructor(
    private users: UserStore,
    private sessions: SessionStore,
    private logoutCoord: Logout,
    private wipeCoord: WipeAccount,
  ) {}

  @Get()
  async me(@Context() ctx: ExecutionContext) {
    return await requireUser(ctx, this.sessions, this.users);
  }

  @Put()
  async update(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const patch = parseUpdateUser(body);
    return await this.users.update(user.id, patch);
  }

  /**
   * POST /me/onboarded — mark first-sign-in onboarding as finished (or
   * skipped). Body `{ skipped?: boolean }` (defaults to false = a real
   * finish). Idempotent: the first call stamps the server's now-ISO onto
   * `onboardedAt`; later calls are no-ops that keep the first timestamp, so
   * `/welcome` bounces to `/dashboard` forever after (skip is permanent).
   */
  @Post("onboarded")
  async onboarded(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const skipped = Boolean((body as { skipped?: unknown } | null)?.skipped);
    return await this.users.markOnboarded(user.id, skipped);
  }

  @Delete()
  async closeAccount(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const sessionId = readSessionId(ctx);
    if (!sessionId) throw new UnauthorizedError();
    await this.users.delete(user.id);
    await this.logoutCoord.run(sessionId);
    return { ok: true };
  }

  /**
   * GET /me/wipe — irreversibly delete the authenticated user and 100% of
   * their data (invoices, quotes, customers, paperwork, files, sessions, …).
   * Scoped entirely by the calling session's user; there is no way to wipe
   * anyone else. The user's sessions are part of the sweep, so this also logs
   * them out as a side effect.
   *
   * A GET (rather than DELETE) by request — it's hit straight from the
   * Settings "danger zone" button.
   */
  @Get("wipe")
  async wipe(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.wipeCoord.run(user.id);
  }

  /**
   * POST /me/reset-by-phone — OWNER TOOL. Wipe a user (resolved by phone) and
   * 100% of their data WITHOUT a session, so `deno task wipe` can reset a test
   * account (e.g. the owner's own number) and re-run first-sign-in onboarding
   * without receiving an OTP. Reuses the exact same WipeAccount sweep as
   * GET /me/wipe — it just resolves the target by phone instead of by session.
   *
   * Gated by a shared secret: the caller MUST send `x-reset-secret` matching
   * the `RESET_SECRET` env var (constant-time compared). DISABLED BY DEFAULT —
   * if `RESET_SECRET` is unset or shorter than 16 chars (as on any environment
   * that hasn't deliberately opted in) every call is refused, so shipping this
   * code never opens a delete-by-phone backdoor on its own. Set RESET_SECRET
   * in the prod environment only when you want the tool live.
   *
   * Body: `{ phoneNumber: string }` (E.164, or a bare US 10/11-digit number).
   */
  @Post("reset-by-phone")
  async resetByPhone(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const secret = Deno.env.get("RESET_SECRET") ?? "";
    const provided = ctx.req.header("x-reset-secret") ?? "";
    if (secret.length < 16 || !constantTimeEqual(secret, provided)) {
      return { ok: false as const, error: "forbidden" };
    }
    const raw = (body as { phoneNumber?: unknown } | null)?.phoneNumber;
    const phone = normalizeE164(typeof raw === "string" ? raw : "");
    if (!phone) return { ok: false as const, error: "bad_phone" };
    const user = await this.users.findByPhone(phone);
    if (!user) {
      return { ok: true as const, deleted: 0, phone, note: "no_such_user" };
    }
    const res = await this.wipeCoord.run(user.id);
    return { ...res, phone, userId: user.id };
  }
}

/** Length-checked constant-time string comparison (no early char-by-char
 *  bailout that would leak the secret via timing). */
function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
  return diff === 0;
}

/** Normalize a US phone to the stored E.164 form, or "" if unusable. */
function normalizeE164(raw: string): string {
  const s = raw.trim();
  if (/^\+\d{8,15}$/.test(s)) return s;
  const d = s.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return "";
}
