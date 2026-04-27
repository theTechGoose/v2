import { Body, Context, Controller, Delete, Get, Param, Post, Put } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { IsString, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";
import { TaxIdentityStore } from "@profile/domain/data/tax-identity-store/mod.ts";
import { parseUpdateTaxIdentity } from "@profile/dto/tax-identity.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/entrypoints/auth-helpers.ts";
import { RateLimiter } from "@core/rate-limit/mod.ts";

/** Per-target attempt cap for TIN verification — prevents brute-forcing the W-9 gate. */
const TIN_VERIFY_MAX = 5;
const TIN_VERIFY_WINDOW_MS = 15 * 60 * 1000;        // 15 minutes

class VerifyTinDto { @IsString() tin!: string; }

function parseVerifyTin(input: unknown): VerifyTinDto {
  const dto = plainToInstance(VerifyTinDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid tin: ${JSON.stringify(errors)}`);
  return dto;
}

/** /profile/tax — owner endpoints (auth-gated). */
@Controller("profile/tax")
export class TaxIdentityController {
  constructor(
    private store: TaxIdentityStore,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  @Get()
  async get(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return ctx.json(redactTaxForOwner(await this.store.get(user.id)));
  }

  @Put()
  async update(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return ctx.json(redactTaxForOwner(await this.store.update(user.id, parseUpdateTaxIdentity(body))));
  }

  @Delete("w9")
  async deleteW9(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return ctx.json(redactTaxForOwner(await this.store.deleteW9(user.id)));
  }
}

/**
 * Public TIN verification — sits at /profile/:userId/tax/verify so a
 * customer (no session) can prove they know the TIN to download the
 * W-9 file. Returns only ok:true/false; no leakage about whether the
 * file exists, what the masked TIN is, or anything else.
 *
 * Rate-limit at the proxy layer; this endpoint is enumerable via userId
 * guessing and TIN brute-forcing otherwise.
 */
@Controller("profile")
export class TaxIdentityPublicController {
  constructor(
    private store: TaxIdentityStore,
    private rateLimiter: RateLimiter,
  ) {}

  @Post(":userId/tax/verify")
  async verify(@Context() ctx: ExecutionContext, @Param("userId") userId: string, @Body() body: unknown) {
    const decision = await this.rateLimiter.take("tin-verify", userId, TIN_VERIFY_MAX, TIN_VERIFY_WINDOW_MS);
    if (!decision.allowed) {
      // Status mapping happens at the proxy layer (see auth-controller comment);
      // `ok:false` + `reason` is the convention for failures.
      return ctx.json({ ok: false, reason: "too_many_attempts", retryAfterMs: decision.resetMs });
    }
    const dto = parseVerifyTin(body);
    const ok = await this.store.verifyTin(userId, dto.tin);
    return ctx.json({ ok });
  }
}

/**
 * Owner-side projection — strips internal-only fields (the salt + raw
 * hash) so the dashboard's settings page never sees them.
 */
function redactTaxForOwner(t: { userId: string; w9FileId?: string; w9UploadedAt?: string; tinMasked?: string; createdAt: string; updatedAt: string } | null) {
  if (!t) return null;
  return {
    userId:       t.userId,
    w9FileId:     t.w9FileId,
    w9UploadedAt: t.w9UploadedAt,
    tinMasked:    t.tinMasked,
    createdAt:    t.createdAt,
    updatedAt:    t.updatedAt,
  };
}
