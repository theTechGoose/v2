import { Module } from "#danet/core";
import { UsersModule } from "@users/mod-root.ts";
import { CrmModule } from "@crm/mod-root.ts";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { CommunicationModule } from "@communication/mod-root.ts";
import { FieldBatchesController, FieldRegionsController, FieldSubscriptionsController, FieldTasksController, FieldTaskTypesController, FieldWorkersController } from "@field/entrypoints/field-controllers/mod.ts";
import { FieldWorkerController } from "@field/entrypoints/worker-controller/mod.ts";
import { BatchStore, FieldTaskStore, FieldWorkerStore, RegionStore, SubscriptionStore, TaskTypeStore } from "@field/domain/data/field-stores/mod.ts";
import { WorkerSessionStore } from "@field/domain/data/worker-session-store/mod.ts";
import { FieldGeocoder } from "@field/domain/data/geocoder/mod.ts";
import { FieldZones } from "@field/domain/coordinators/field-zones/mod.ts";
import { FieldDay } from "@field/domain/coordinators/field-day/mod.ts";
import { FieldBatches } from "@field/domain/coordinators/field-batches/mod.ts";
import { FieldViews } from "@field/domain/coordinators/field-views/mod.ts";
import { FieldNotices } from "@field/domain/coordinators/field-notices/mod.ts";
import { FieldMapCenter } from "@field/domain/coordinators/field-map-center/mod.ts";
import { FieldActivity } from "@field/domain/coordinators/field-activity/mod.ts";
import { FieldQuoteSubscriptions } from "@field/domain/coordinators/field-quote-subscriptions/mod.ts"; // REQ-699

/** REQ-137 — field tasks: workers, subscriptions, zones, the day's round, batch invoicing — on the account's customers and invoices. */
@Module({
  // REQ-566: CommunicationModule for the EventBus the activity feed listens on
  imports: [UsersModule, CrmModule, PaperworkModule, CommunicationModule],
  controllers: [
    FieldWorkersController,
    FieldTaskTypesController,
    FieldSubscriptionsController,
    FieldRegionsController,
    FieldTasksController,
    FieldBatchesController,
    FieldWorkerController,
  ],
  injectables: [
    FieldWorkerStore,
    TaskTypeStore,
    SubscriptionStore,
    RegionStore,
    FieldTaskStore,
    BatchStore,
    WorkerSessionStore,
    FieldGeocoder,
    FieldZones,
    FieldDay,
    FieldBatches,
    FieldViews,
    FieldNotices,
    FieldMapCenter,
    FieldActivity,
    FieldQuoteSubscriptions, // REQ-699 — registers itself on paperwork's QuoteSubscriptionPort
  ],
})
export class FieldModule {}
