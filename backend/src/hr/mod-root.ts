import { Module } from "#danet/core";
import { UsersModule } from "@users/mod-root.ts";
import { CommunicationModule } from "@communication/mod-root.ts";
import { FilesModule } from "@files/mod-root.ts";
import {
  HrController,
  HrSignController,
} from "@hr/entrypoints/hr-controllers/mod.ts";
import {
  DepartmentStore,
  HireStore,
  HrDocumentStore,
  HrSettingsStore,
  HrSystemStore,
  ProofStore,
} from "@hr/domain/data/hr-stores/mod.ts";
import { HrNotices } from "@hr/domain/coordinators/hr-notices/mod.ts";
import { Provisioner } from "@hr/domain/coordinators/provisioner/mod.ts";

/** REQ-883 — HR: new-hire onboarding — hires, their signing packet by token, documents, departments, systems, provisioning. */
@Module({
  // UsersModule for the session + SmsService, CommunicationModule for EmailService, FilesModule for the PDFs
  imports: [UsersModule, CommunicationModule, FilesModule],
  controllers: [HrSignController, HrController],
  injectables: [
    HireStore,
    DepartmentStore,
    HrDocumentStore,
    HrSystemStore,
    ProofStore,
    HrSettingsStore,
    HrNotices,
    Provisioner,
  ],
})
export class HrModule {}
