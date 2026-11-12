import { secretAllows } from "@users/domain/business/shared-secret/mod.ts";
import { Body, Context, Controller, Delete, Get, Post, Put } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { Logout } from "@users/domain/coordinators/logout/mod.ts";
import { WipeAccount } from "@users/domain/coordinators/wipe-account/mod.ts";
import { SetupReset } from "@users/domain/coordinators/setup-reset/mod.ts"; // REQ-199
import { parseUpdateUser } from "@users/dto/user.ts";
import {
  readSessionId,
  requireOwner,
  requireSession,
  requireUser,
  UnauthorizedError,
} from "@users/domain/coordinators/require-user/mod.ts";
import { AccountAdmins } from "@users/domain/coordinators/account-admins/mod.ts"; // REQ-146
import { splitActingPatch } from "@users/domain/business/account-admins/mod.ts"; // REQ-624
import type { User } from "@users/dto/user.ts";
import { buildSessionCookie, clearSessionCookie } from "@users/domain/business/session-cookie/mod.ts";
import { TransferAccount, TransferError } from "@users/domain/coordinators/transfer-account/mod.ts"; // REQ-220
import { ChoosePlan } from "@users/domain/coordinators/choose-plan/mod.ts";
import { CrmCustomerSync } from "@users/domain/coordinators/crm-customer-sync/mod.ts";
import { CrmLeadCapture } from "@users/domain/coordinators/crm-lead-capture/mod.ts";
import {
  fakePaymentsWorld,
  PaymentsLink,
} from "@users/domain/data/payments-link/mod.ts";
import { parseChoosePlan } from "@users/dto/plan.ts";
import { externalRefFor } from "@users/domain/business/plan/mod.ts"; // REQ-106 — the fake's clock is per account

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
    private setupReset: SetupReset, // REQ-199
    private choosePlan: ChoosePlan,
    private paymentsLink: PaymentsLink,
    private crm: CrmCustomerSync,
    private leads: CrmLeadCapture,
    /** REQ-146 — the accounts a session can act in, and the switch between them */
    private accountAdmins: AccountAdmins,
    /** REQ-220 — "Transfer account": a new number takes the account */
    private transfer: TransferAccount,
  ) {}

  /** REQ-146 — the person's own account first, then every account they administer */
  @Get("accounts")
  async accounts(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const session = (await this.sessions.get(readSessionId(ctx)!))!;
    return await this.accountAdmins.accountsFor(session, user);
  }

  /** REQ-146 — `{ userId }`: a new session in that account (own or administered), the cookie swapped, the old session dropped */
  @Post("switch-account")
  async switchAccount(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const session = (await this.sessions.get(readSessionId(ctx)!))!;
    const target = (body as { userId?: unknown } | null)?.userId;
    const next = await this.accountAdmins.switchTo(session, user, target);
    ctx.header("Set-Cookie", buildSessionCookie(next.id));
    return { ok: true, sessionId: next.id, userId: next.userId };
  }

  /** REQ-054 — the plan this account picked; null until a pick (read as free) */
  @Get("plan")
  async plan(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.choosePlan.current(user.id);
  }

  /** REQ-054 — pick a plan: free is stored; a paid pick mints the CRM pay link (pending) */
  @Post("plan")
  async pickPlan(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireOwner(ctx, this.sessions, this.users); // REQ-146 — billing is the owner's
    const { planId, back, merchant } = parseChoosePlan(body);
    return await this.choosePlan.choose(user.id, planId, back, merchant);
  }

  /** REQ-058 — the CRM customer this account is: made at sign-up, filled in by onboarding */
  @Get("crm-customer")
  async crmCustomer(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return ctx.json(await this.crm.read(user.id)); // null before the first sync, as a body
  }

  /**
   * REQ-054 — the FAKE's remote control: settles the pending due the way a card on the real
   * pay page does. Exists only while the CRM client is the fake (PPWK_PAYMENTS_URL unset) —
   * the gate's lanes and a dev box — like the dev master OTP code; 404 against the real one.
   */
  @Post("plan/fake-paid")
  async fakePaid(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    if (!this.paymentsLink.isFake()) {
      throw Object.assign(new Error("not-found: the fake is not in use"), {
        status: 404,
      });
    }
    const plan = await this.choosePlan.current(user.id);
    if (!plan?.dueId) {
      throw Object.assign(new Error("plan-missing: nothing to pay"), {
        status: 404,
      });
    }
    // REQ-061 — the page names the due it was opened for (a past-due month's); the plan's first month otherwise.
    // The body is optional (the older callers send none), so it is read by hand.
    const body = await optionalBody(ctx) as
      | { dueId?: unknown; quiet?: unknown }
      | null;
    const named = body?.dueId;
    const world = fakePaymentsWorld();
    const dueId = typeof named === "string" &&
        world.dues.some((d) =>
          d.dueId === named && d.customerId === plan.customerId
        )
      ? named
      : plan.dueId;
    world.settle(dueId);
    // REQ-131 — `quiet`: the card landed and the receipt tab was closed — the app is not told; the
    // sweep's watch is. The record as stored: a read would find the due settled (REQ-133)
    if (body?.quiet === true) return await this.choosePlan.stored(user.id);
    return await this.choosePlan.current(user.id); // REQ-133 — the read finds it settled
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
    if (!this.paymentsLink.isFake()) {
      throw Object.assign(new Error("not-found: the fake is not in use"), {
        status: 404,
      });
    }
    const plan = await this.choosePlan.current(user.id);
    if (!plan?.customerId) {
      throw Object.assign(new Error("plan-missing: nothing billed"), {
        status: 404,
      });
    }
    const b = (body ?? {}) as { now?: unknown; cardGone?: unknown };
    if (b.cardGone === true) fakePaymentsWorld().dropCard(plan.customerId);
    fakePaymentsWorld().bill(
      typeof b.now === "string" && b.now
        ? new Date(b.now).toISOString()
        : new Date().toISOString(),
      plan.customerId,
    ); // REQ-129 — this person's billing alone
    return await this.choosePlan.current(user.id);
  }

  /**
   * REQ-106 — the FAKE's clock on the link builder: from here on THIS account's pay link takes
   * `ms` to mint (up to a minute), the way the real CRM's cold start and Quickbase writes take
   * theirs — so a story can watch the hand-off page wait and then move. Fake only, like fake-paid;
   * 404 against the real CRM.
   */
  @Post("plan/fake-slow")
  async fakeSlow(@Context() ctx: ExecutionContext) {
    const body = await optionalBody(ctx);
    const user = await requireUser(ctx, this.sessions, this.users);
    if (!this.paymentsLink.isFake()) {
      throw Object.assign(new Error("not-found: the fake is not in use"), {
        status: 404,
      });
    }
    const asked = Number((body as { ms?: unknown } | null)?.ms ?? 0);
    const ms = Number.isFinite(asked) && asked > 0
      ? Math.min(Math.round(asked), 60_000)
      : 0;
    fakePaymentsWorld().slowFor.set(externalRefFor(user.id), ms);
    return { ms };
  }

  /**
   * GET /me — the account (the owner's user while acting) and, REQ-624, when the session acts for
   * someone else's account, `actor`: the person signed in — `{ id, name, needsName, email? }`, her
   * name never the owner's. Every "Hi {name}" reads `actor.name` over `name`.
   */
  @Get()
  async me(@Context() ctx: ExecutionContext) {
    const { user, actor } = await requireSession(ctx, this.sessions, this.users);
    return await withActor(this.accountAdmins, user, actor);
  }

  /**
   * PUT /me — name, email, language. While acting, all three are the PERSON's own and are written
   * to HER record (REQ-624 name/email, REQ-631 language); the owner's record is never touched.
   * Replies with the /me view (`actor.language` is hers).
   */
  @Put()
  async update(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const { user, actor } = await requireSession(ctx, this.sessions, this.users);
    const patch = parseUpdateUser(body);
    if (!actor) {
      const updated = await this.users.update(user.id, patch);
      await this.leads.enqueueSync(user.id); // REQ-058/099 — the name and email reach the CRM customer, after this reply
      return updated;
    }
    const split = splitActingPatch(patch);
    const me = Object.keys(split.actor).length ? await this.users.update(actor.id, split.actor) : actor;
    const account = Object.keys(split.account).length ? await this.users.update(user.id, split.account) : user;
    return await withActor(this.accountAdmins, account, me);
  }

  /**
   * POST /me/onboarded — record that the person reached the end of the
   * /welcome wizard, or left it (`{ skipped: true }`). Idempotent: the first
   * call stamps the server's now-ISO onto `onboardedAt`; later calls are
   * no-ops that keep the first timestamp. A record, not a gate (REQ-091):
   * the wizard, the dashboard and a verified code look at the questions
   * still open on the profile, never at this stamp — onboarding happens
   * until every question is answered.
   */
  @Post("onboarded")
  async onboarded(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const skipped = Boolean((body as { skipped?: unknown } | null)?.skipped);
    const marked = await this.users.markOnboarded(user.id, skipped);
    await this.leads.enqueueSync(user.id); // REQ-058/099 — onboarding done: the CRM customer reads what it entered, after this reply
    await this.leads.enqueueSignupNotice(
      user.id,
      skipped ? "skipped setup" : "completed onboarding",
    ); // REQ-112 — the team hears it, with everything collected
    return marked;
  }

  @Delete()
  async closeAccount(@Context() ctx: ExecutionContext) {
    const user = await requireOwner(ctx, this.sessions, this.users); // REQ-146 — never an admin
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
    const user = await requireOwner(ctx, this.sessions, this.users); // REQ-146 — never an admin
    return await this.wipeCoord.run(user.id);
  }

  /**
   * POST /me/setup-reset — REQ-199: clear the account's test records
   * (customers, documents, payments, conversations, counters) and restart
   * numbering, keeping the account, its profile, its plan, its admins and
   * this session. Owner only. Meant for the moment before going live.
   */
  @Post("setup-reset")
  async setupResetAccount(@Context() ctx: ExecutionContext) {
    const user = await requireOwner(ctx, this.sessions, this.users);
    return await this.setupReset.run(user.id);
  }

  /**
   * POST /me/transfer — REQ-220 (+ AMENDMENT: no code): `{ phoneNumber }`, the new owner's
   * number. Moves the account onto that number at once (same id, every record), frees the old
   * number, drops the owner's own sessions and clears this browser's cookie. Owner only.
   *   - 200 { ok:true, phoneNumber }
   *   - 400 bad_phone · 409 same_number | phone_taken
   */
  @Post("transfer")
  async transferAccount(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireOwner(ctx, this.sessions, this.users);
    try {
      const moved = await this.transfer.run(user, (body as { phoneNumber?: unknown } | null)?.phoneNumber);
      await this.leads.enqueueSync(user.id); // REQ-058/099 — the CRM customer reads the new phone, after this reply
      ctx.header("Set-Cookie", clearSessionCookie());
      return { ok: true, phoneNumber: moved.phoneNumber };
    } catch (err) {
      return transferRefusal(err);
    }
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
    if (
      !secretAllows(
        Deno.env.get("RESET_SECRET"),
        ctx.req.header("x-reset-secret"),
      )
    ) {
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

/** REQ-624 — the account as /me answers it, with the acting person when there is one (a plain
 *  function: an undecorated method on a Danet controller breaks its router) */
async function withActor(admins: AccountAdmins, user: User, actor: User | null) {
  if (!actor) return user;
  return { ...user, actor: await admins.actorView(actor, user.id, user) };
}

/** REQ-220 — a refused transfer as `{ ok:false, error }` under its status; anything else is rethrown */
function transferRefusal(err: unknown): Response {
  if (!(err instanceof TransferError)) throw err;
  return new Response(JSON.stringify({ ok: false, error: err.error }), {
    status: err.status,
    headers: { "content-type": "application/json" },
  });
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
