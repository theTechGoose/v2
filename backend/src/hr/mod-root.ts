import { Module } from "#danet/core";
import { UsersModule } from "@users/mod-root.ts";
import { CommunicationModule } from "@communication/mod-root.ts";
import { FilesModule } from "@files/mod-root.ts";
import { FieldModule } from "@field/mod-root.ts";
import { CommunicationsModule } from "@communications/mod-root.ts";
import { SystemsController } from "@hr/entrypoints/systems-controller/mod.ts";
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

/** REQ-883 — HR: new-hire onboarding — hires, their signing packet by token, documents, departments, systems, provisioning (REQ-913: built in DocuMonster). REQ-912: /me/systems. */
@Module({
  // UsersModule for the session + SmsService + editors, CommunicationModule for EmailService, FilesModule
  // for the PDFs; REQ-913: FieldModule for the worker account an arm builds, CommunicationsModule
  // for the welcome text from the account's line
  imports: [UsersModule, CommunicationModule, FilesModule, FieldModule, CommunicationsModule],
  controllers: [HrSignController, HrController, SystemsController],
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
