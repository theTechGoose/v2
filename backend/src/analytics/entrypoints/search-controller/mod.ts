import { Context, Controller, Get, Query } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { GlobalSearch } from "@analytics/domain/coordinators/global-search/mod.ts";
import { isSearchType } from "#documents/search.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";

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
   * REQ-207: the dashboard search box. Returns `{ results: SearchHit[] }`
   * ranked (exact number, prefix, substring) across customers, quotes,
   * invoices, change orders and work orders; every row carries the page
   * that opens it (`url`) and its related records. `type` narrows to one
   * kind (an unknown type is ignored); `limit` caps rows per type (1..50).
   */
  @Get()
  async search(
    @Context() ctx: ExecutionContext,
    @Query("q") q?: string,
    @Query("type") type?: string,
    @Query("limit") limit?: string,
  ) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const cap = limit ? Math.min(50, Math.max(1, Number(limit) | 0)) : 10;
    const results = await this.flow.run(user.id, {
      q: q ?? "",
      ...(isSearchType(type) ? { type } : {}),
      limit: cap,
    });
    return ctx.json({ results });
  }
}
