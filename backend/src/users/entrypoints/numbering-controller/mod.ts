import { Body, Context, Controller, Get, Put } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { NumberingStore } from "@users/domain/data/numbering-store/mod.ts";
import { DocNumbering } from "@core/data/doc-numbering/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import {
  type NumberingView,
  parseUpdateNumbering,
} from "@users/dto/numbering.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";
import { DOC_KINDS, type DocKind, START_FIELD } from "#documents/numbering.ts";

/**
 * /profile/numbering — REQ-199: the account's starting numbers.
 *
 *   GET → the account number, the settings, the next number of each kind,
 *         and which kinds already issued (their start is locked).
 *   PUT → set starting numbers; a kind that already issued answers 409
 *         `numbering_locked` and nothing is written.
 */
@Controller("profile/numbering")
export class NumberingController {
  constructor(
    private store: NumberingStore,
    private numbering: DocNumbering,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  @Get()
  async get(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return ctx.json(await buildView(this.store, this.numbering, user.id));
  }

  @Put()
  async upsert(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    let patch;
    try {
      patch = parseUpdateNumbering(body);
    } catch (err) {
      // a bad starting number is the caller's mistake, not a server fault
      return ctx.json({
        ok: false,
        reason: "invalid",
        detail: (err as Error).message,
      }, 400);
    }
    const issued = await this.numbering.issuedMap(user.id);
    const locked = (DOC_KINDS as readonly DocKind[]).filter((kind) =>
      patch[START_FIELD[kind]] !== undefined && issued[kind]
    );
    if (locked.length) {
      return ctx.json(
        { ok: false, reason: "numbering_locked", kinds: locked },
        409,
      );
    }
    await this.store.upsert(user.id, patch);
    return ctx.json(await buildView(this.store, this.numbering, user.id));
  }
}

/** Module-level on purpose: Danet registers every controller method as a route. */
async function buildView(
  store: NumberingStore,
  numbering: DocNumbering,
  userId: string,
): Promise<NumberingView> {
  const [settings, accountNumber, next, issued] = await Promise.all([
    store.get(userId),
    numbering.accountNumber(userId),
    numbering.nextMap(userId),
    numbering.issuedMap(userId),
  ]);
  const { userId: _u, createdAt: _c, updatedAt: _d, ...starts } = settings ??
    { userId, createdAt: "", updatedAt: "" };
  return {
    accountNumber,
    settings: starts,
    next,
    issued,
    locked: Object.values(issued).some(Boolean),
  };
}
