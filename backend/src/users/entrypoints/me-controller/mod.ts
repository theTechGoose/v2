import { Body, Context, Controller, Delete, Get, Post, Put } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { Logout } from "@users/domain/coordinators/logout/mod.ts";
import { WipeAccount } from "@users/domain/coordinators/wipe-account/mod.ts";
import { parseUpdateUser } from "@users/dto/user.ts";
import { requireUser, readSessionId, UnauthorizedError } from "@users/domain/coordinators/require-user/mod.ts";
import { ChoosePlan } from "@users/domain/coordinators/choose-plan/mod.ts";
import { CrmCustomerSync } from "@users/domain/coordinators/crm-customer-sync/mod.ts";
import { fakePaymentsWorld, PaymentsLink } from "@users/domain/data/payments-link/mod.ts";
import { parseChoosePlan } from "@users/dto/plan.ts";

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
    private choosePlan: ChoosePlan,
    private paymentsLink: PaymentsLink,
    private crm: CrmCustomerSync,
  ) {}

  /** REQ-054 — the plan this account picked; null until a pick (read as free) */
  @Get("plan")
  async plan(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.choosePlan.current(user.id);
  }

  /** REQ-054 — pick a plan: free is stored; a paid pick mints the CRM pay link (pending) */
  @Post("plan")
  async pickPlan(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const { planId, back, merchant } = parseChoosePlan(body);
    return await this.choosePlan.choose(user.id, planId, back, merchant);
  }

  /** REQ-058 — the CRM customer this account is: made at sign-up, filled in by onboarding */
  @Get("crm-customer")
  async crmCustomer(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return ctx.json(await this.crm.read(user.id)); // null before the first sync, as a body
  }

  /** REQ-054/059 — a pending plan asks the CRM whether its due settled (what /plan/return presses) */
  @Post("plan/refresh")
  async refreshPlan(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.choosePlan.refresh(user.id);
  }

  /**
   * REQ-054 — the FAKE's remote control: settles the pending due the way a card on the real
   * pay page does. Exists only while the CRM client is the fake (PPWK_PAYMENTS_URL unset) —
   * the gate's lanes and a dev box — like the dev master OTP code; 404 against the real one.
   */
  @Post("plan/fake-paid")
  async fakePaid(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    if (!this.paymentsLink.isFake()) throw Object.assign(new Error("not-found: the fake is not in use"), { status: 404 });
    const plan = await this.choosePlan.current(user.id);
    if (!plan?.dueId) throw Object.assign(new Error("plan-missing: nothing to pay"), { status: 404 });
    // REQ-061 — the page names the due it was opened for (a past-due month's); the plan's first month otherwise.
    // The body is optional (the older callers send none), so it is read by hand.
    const named = (await optionalBody(ctx) as { dueId?: unknown } | null)?.dueId;
    const world = fakePaymentsWorld();
    const dueId = typeof named === "string" && world.dues.some((d) => d.dueId === named && d.customerId === plan.customerId) ? named : plan.dueId;
    world.settle(dueId);
    return await this.choosePlan.refresh(user.id);
  }

  /**
   * REQ-061 — the FAKE's clock: bills the account's subscription as of `now` the way the CRM's
   * hourly clock does (its REQ-081); `cardGone` first drops the card on file, so the month
   * cannot be collected. Fake only, like fake-paid; 404 against the real CRM.
   */
  @Post("plan/fake-bill")
  async fakeBill(@Context() ctx: ExecutionContext) {
    const body = await optionalBody(ctx);
    const user = await requireUser(ctx, this.sessions, this.users);
    if (!this.paymentsLink.isFake()) throw Object.assign(new Error("not-found: the fake is not in use"), { status: 404 });
    const plan = await this.choosePlan.current(user.id);
    if (!plan?.customerId) throw Object.assign(new Error("plan-missing: nothing billed"), { status: 404 });
    const b = (body ?? {}) as { now?: unknown; cardGone?: unknown };
    if (b.cardGone === true) fakePaymentsWorld().dropCard(plan.customerId);
    fakePaymentsWorld().bill(typeof b.now === "string" && b.now ? new Date(b.now).toISOString() : new Date().toISOString());
    return await this.choosePlan.current(user.id);
  }

  @Get()
  async me(@Context() ctx: ExecutionContext) {
    return await requireUser(ctx, this.sessions, this.users);
  }

  @Put()
  async update(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const patch = parseUpdateUser(body);
    const updated = await this.users.update(user.id, patch);
    await this.crm.sync(user.id); // REQ-058 — the name and email reach the CRM customer
    return updated;
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
    const marked = await this.users.markOnboarded(user.id, skipped);
    await this.crm.sync(user.id); // REQ-058 — onboarding done: the CRM customer reads what it entered
    return marked;
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

/** a JSON body when one was sent, {} when the request carried none (a bare POST is a 500 through @Body) */
async function optionalBody(ctx: ExecutionContext): Promise<unknown> {
  const raw = await ctx.req.text().catch(() => "");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

