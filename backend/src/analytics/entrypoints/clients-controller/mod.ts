import { Context, Controller, Get, Query } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { BuildCustomerCards } from "@analytics/domain/coordinators/build-customer-cards/mod.ts";
import { CLIENT_SEGMENTS, type ClientSegment } from "@crm/dto/customer.ts";
import type {
  ClientSegmentRow,
  ClientSegmentsResponse,
  TopClient,
  TopClientsResponse,
} from "@analytics/dto/clients-stats.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";

const SEGMENT_LABELS: Record<ClientSegment | "unsorted", string> = {
  property_mgmt: "Property mgmt",
  homeowner:     "Homeowner",
  small_biz:     "Small biz",
  hoa:           "HOA",
  unsorted:      "Unsorted",
};

/**
 * ClientsController — page-aligned endpoint for the /clients UI surface.
 *
 *   GET /clients                       → CustomerCard[] (cards page rows)
 *   GET /analytics/clients/top         → TopClients leaderboard (right rail)
 *   GET /analytics/clients/segments    → segment-mix bar chart
 *
 * Lives in CoreModule because BuildCustomerCards needs to fan across
 * CrmModule + PaperworkModule stores. Putting it here avoids the
 * crm → core dependency cycle.
 *
 * The raw `/customers` CRUD route in CrmModule is unchanged — this
 * controller is the read-side companion for analytics-shaped views.
 */
@Controller()
export class ClientsController {
  constructor(
    private flow:     BuildCustomerCards,
    private users:    UserStore,
    private sessions: SessionStore,
  ) {}

  @Get("clients")
  async listCards(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.flow.run(user.id);
  }

  @Get("analytics/clients/top")
  async top(
    @Context() ctx: ExecutionContext,
    @Query("limit") limit?: string,
  ): Promise<TopClientsResponse> {
    const user  = await requireUser(ctx, this.sessions, this.users);
    const cards = await this.flow.run(user.id);
    const lim   = Math.max(1, Math.min(50, Number(limit ?? "5") || 5));

    const ranked = cards
      .filter((c) => c.revenue12moCents > 0)
      .sort((a, b) => b.revenue12moCents - a.revenue12moCents)
      .slice(0, lim);

    const leader = ranked[0]?.revenue12moCents ?? 0;
    const results: TopClient[] = ranked.map((c, idx) => ({
      customerId:       c.id,
      name:             c.name,
      revenue12moCents: c.revenue12moCents,
      rank:             idx + 1,
      barPct:           leader > 0 ? Math.round((c.revenue12moCents / leader) * 100) : 0,
    }));

    return { results };
  }

  @Get("analytics/clients/segments")
  async segments(@Context() ctx: ExecutionContext): Promise<ClientSegmentsResponse> {
    const user  = await requireUser(ctx, this.sessions, this.users);
    const cards = await this.flow.run(user.id);
    const total = cards.length;

    const counts = new Map<ClientSegment | "unsorted", number>();
    for (const c of cards) {
      const key: ClientSegment | "unsorted" = c.segment ?? "unsorted";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const ordered: (ClientSegment | "unsorted")[] = [...CLIENT_SEGMENTS, "unsorted"];
    const segments: ClientSegmentRow[] = ordered
      .filter((k) => (counts.get(k) ?? 0) > 0 || k !== "unsorted")
      .map((k) => {
        const count = counts.get(k) ?? 0;
        return {
          key:   k,
          label: SEGMENT_LABELS[k],
          count,
          pct:   total > 0 ? Math.round((count / total) * 100) : 0,
        };
      });

    return { segments };
  }
}
