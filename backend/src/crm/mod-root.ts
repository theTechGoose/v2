import { Module } from "#danet/core";
import { UsersModule } from "@users/mod-root.ts";
import { CustomerController } from "@crm/entrypoints/customer-controller/mod.ts";
import { AccountController } from "@crm/entrypoints/account-controller/mod.ts";
import { EntryController } from "@crm/entrypoints/entry-controller/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { AccountStore } from "@crm/domain/data/account-store/mod.ts";
import { EntryStore } from "@crm/domain/data/entry-store/mod.ts";
import { ComputeAccountBalance } from "@crm/domain/coordinators/compute-account-balance/mod.ts";

@Module({
  imports: [UsersModule],
  controllers: [CustomerController, AccountController, EntryController],
  injectables: [CustomerStore, AccountStore, EntryStore, ComputeAccountBalance],
})
export class CrmModule {}
