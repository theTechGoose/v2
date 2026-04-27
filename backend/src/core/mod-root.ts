import { Module } from "#danet/core";
import { UsersModule } from "@users/mod-root.ts";
import { CrmModule } from "@crm/mod-root.ts";
import { PaperworkModule } from "@paperwork/mod-root.ts";

// --- analytics: cross-domain fan-in reads (dashboard, jobs, search) ---
import { ComputeDashboardStats } from "@analytics/domain/coordinators/compute-dashboard-stats/mod.ts";
import { ListActiveJobs } from "@analytics/domain/coordinators/list-active-jobs/mod.ts";
import { GlobalSearch } from "@analytics/domain/coordinators/global-search/mod.ts";
import { DashboardController } from "@analytics/entrypoints/dashboard-controller/mod.ts";
import { JobsController } from "@analytics/entrypoints/jobs-controller/mod.ts";
import { SearchController } from "@analytics/entrypoints/search-controller/mod.ts";

// --- files: cross-cutting blob storage (PDFs, W-9s, voice clips) ---
import { FilesController } from "@files/entrypoints/files-controller/mod.ts";
import { FileStore } from "@files/domain/data/file-store/mod.ts";

/**
 * CoreModule — the home for cross-cutting concerns: things that span
 * multiple domain modules and don't belong to any single one.
 *
 *   - analytics: read-only fan-in views over CRM + Paperwork + Users
 *     (`/analytics/dashboard`, `/jobs`, `/search`)
 *   - files: blob storage consumed by paperwork (PDFs), profile (W-9s),
 *     and agents (voice clips)
 *
 * Imports CrmModule + PaperworkModule so the analytics coordinators can
 * reach the data stores they synthesize. UsersModule is in for auth.
 */
@Module({
  imports: [UsersModule, CrmModule, PaperworkModule],
  controllers: [
    DashboardController,
    JobsController,
    SearchController,
    FilesController,
  ],
  injectables: [
    ComputeDashboardStats,
    ListActiveJobs,
    GlobalSearch,
    FileStore,
  ],
})
export class CoreModule {}
