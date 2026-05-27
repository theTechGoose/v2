import { Body, Context, Controller, Post } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { PolishJobDetails } from "@agents/domain/coordinators/polish-job-details/mod.ts";
import { GenerateJobOptions } from "@agents/domain/coordinators/generate-job-options/mod.ts";
import { SuggestPrices } from "@agents/domain/coordinators/suggest-prices/mod.ts";
import { ProfessionalizeBullet } from "@agents/domain/coordinators/professionalize-bullet/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";

/**
 * Outgoing-comms language (customer-facing copy). Defaults to "en".
 *
 * NOTE: this is a module-level function, *not* a controller method. Danet
 * registers every method on a controller's prototype as a route and calls
 * `trimSlash(endpoint)` on each — an undecorated helper method has no
 * `endpoint` metadata, which crashes bootstrap. Keep controller prototypes
 * to decorated route handlers + the constructor only.
 */
async function commsLang(
  identity: BusinessIdentityStore,
  userId: string,
): Promise<string> {
  const ident = await identity.get(userId).catch(() => null);
  return ident?.commsLanguage === "es" ? "es" : "en";
}

/**
 * POST /agents/job-details/polish
 * Body: { raw: string, priceCents?: number }
 * Returns: { summary, description }
 *
 * One-shot LLM pass used by the assistant's empty-state flow:
 *   1. User types a price (MoneyInput)
 *   2. Assistant asks "tell me the job details"
 *   3. User types raw text into the chat input
 *   4. Frontend POSTs here BEFORE creating the quote — the polished
 *      summary + description seed quote.summary and quote.description.
 */
@Controller("agents/job-details")
export class JobDetailsController {
  constructor(
    private polish: PolishJobDetails,
    private options: GenerateJobOptions,
    private prices: SuggestPrices,
    private professionalize: ProfessionalizeBullet,
    private users: UserStore,
    private sessions: SessionStore,
    private identity: BusinessIdentityStore,
  ) {}

  /**
   * POST /agents/job-details/prices
   * Body: { raw: string }
   * Returns: { options: [{ tier, label, priceCents, rationale }] }
   *
   * Powers the "I know the job, help me price it" flow — three suggested
   * price tiers the contractor picks between (4th custom is client-side).
   */
  @Post("prices")
  async suggestPrices(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const b = (body ?? {}) as { raw?: unknown };
    if (typeof b.raw !== "string" || !b.raw.trim()) {
      throw new Error("raw is required");
    }
    return ctx.json(
      await this.prices.run({
        userId: user.id,
        raw: b.raw,
        lang: user.language === "es" ? "es" : "en",
      }),
    );
  }

  @Post("polish")
  async polishDetails(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const b = (body ?? {}) as { raw?: unknown; priceCents?: unknown };
    if (typeof b.raw !== "string" || !b.raw.trim()) {
      throw new Error("raw is required");
    }
    const priceCents =
      typeof b.priceCents === "number" && Number.isFinite(b.priceCents)
        ? b.priceCents
        : undefined;
    return ctx.json(
      await this.polish.run({
        userId: user.id,
        raw: b.raw,
        priceCents,
        commsLanguage: await commsLang(this.identity, user.id),
      }),
    );
  }

  /**
   * POST /agents/job-details/options
   * Body: { raw: string, priceCents?: number }
   * Returns: { options: [{ id, jobName, summary, bullets[] }] }
   *
   * Powers the "Job Details" picker screen — three editable scope-of-work
   * options the contractor edits and picks between before the quote is built.
   */
  @Post("options")
  async generateOptions(
    @Context() ctx: ExecutionContext,
    @Body() body: unknown,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const b = (body ?? {}) as { raw?: unknown; priceCents?: unknown };
    if (typeof b.raw !== "string" || !b.raw.trim()) {
      throw new Error("raw is required");
    }
    const priceCents =
      typeof b.priceCents === "number" && Number.isFinite(b.priceCents)
        ? b.priceCents
        : undefined;
    return ctx.json(
      await this.options.run({
        userId: user.id,
        raw: b.raw,
        priceCents,
        commsLanguage: await commsLang(this.identity, user.id),
      }),
    );
  }

  /**
   * POST /agents/job-details/professionalize
   * Body: { text: string }
   * Returns: { text: string }
   *
   * Single-line cleanup invoked when the contractor edits or adds a bullet
   * on the picker screen and opts in to "professionalize that".
   */
  @Post("professionalize")
  async professionalizeBullet(
    @Context() ctx: ExecutionContext,
    @Body() body: unknown,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const b = (body ?? {}) as { text?: unknown };
    if (typeof b.text !== "string" || !b.text.trim()) {
      throw new Error("text is required");
    }
    return ctx.json(
      await this.professionalize.run({ userId: user.id, text: b.text }),
    );
  }
}
