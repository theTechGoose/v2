import { Context, Controller, Get, Query } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { GlobalSearch, type SearchHit } from "@analytics/domain/coordinators/global-search/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";

const ALLOWED_TYPES = new Set<SearchHit["type"]>(["customer", "quote", "contract", "invoice"]);

@Controller("search")
export class SearchController {
  constructor(
    private flow: GlobalSearch,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  /**
   * GET /search?q=&type=&limit=
   *
   * Powers the topbar `⌘K`. Returns a typed-union array; frontend
   * switches on `type` to route to the right detail page.
   */
  @Get()
  async search(
    @Context() ctx: ExecutionContext,
    @Query("q") q?: string,
    @Query("type") type?: string,
    @Query("limit") limit?: string,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const filteredType = type && ALLOWED_TYPES.has(type as SearchHit["type"])
      ? (type as SearchHit["type"])
      : undefined;
    const cap = limit ? Math.min(50, Math.max(1, Number(limit) | 0)) : 10;
    const results = await this.flow.run(user.id, { q: q ?? "", type: filteredType, limit: cap });
    return ctx.json({ results });
  }
}
