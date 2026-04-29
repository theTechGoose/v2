import { Module } from "#danet/core";
import { UsersModule } from "@users/mod-root.ts";
import { CrmModule } from "@crm/mod-root.ts";
import { PaperworkModule } from "@paperwork/mod-root.ts";

import { ComputeDashboardStats } from "@analytics/domain/coordinators/compute-dashboard-stats/mod.ts";
import { ListActiveJobs } from "@analytics/domain/coordinators/list-active-jobs/mod.ts";
import { GlobalSearch } from "@analytics/domain/coordinators/global-search/mod.ts";
import { BuildCustomerCards } from "@analytics/domain/coordinators/build-customer-cards/mod.ts";
import { BuildQuoteCards } from "@analytics/domain/coordinators/build-quote-cards/mod.ts";
import { ComputeQuoteWinRate } from "@analytics/domain/coordinators/compute-quote-win-rate/mod.ts";
import { ComputeQuoteInsight } from "@analytics/domain/coordinators/compute-quote-insight/mod.ts";
import { DashboardController } from "@analytics/entrypoints/dashboard-controller/mod.ts";
import { JobsController } from "@analytics/entrypoints/jobs-controller/mod.ts";
import { SearchController } from "@analytics/entrypoints/search-controller/mod.ts";
import { ClientsController } from "@analytics/entrypoints/clients-controller/mod.ts";
import { QuotesController } from "@analytics/entrypoints/quotes-controller/mod.ts";

/**
 * AnalyticsModule — read-only fan-in views over CRM + Paperwork + Users.
 *
 * Owns all `/analytics/*` routes plus the page-aligned `/clients`, `/quotes`,
 * `/jobs`, and `/search` reads that need to compose data across modules.
 *
 * Imports CrmModule + PaperworkModule so the coordinators can reach the
 * data stores they synthesize. UsersModule is in for auth.
 */
@Module({
  imports: [UsersModule, CrmModule, PaperworkModule],
  controllers: [
    DashboardController,
    JobsController,
    SearchController,
    ClientsController,
    QuotesController,
  ],
  injectables: [
    ComputeDashboardStats,
    ListActiveJobs,
    GlobalSearch,
    BuildCustomerCards,
    BuildQuoteCards,
    ComputeQuoteWinRate,
    ComputeQuoteInsight,
  ],
})
export class AnalyticsModule {}
