import { Module } from "#danet/core";
import { UsersModule } from "@users/mod-root.ts";
import { CrmModule } from "@crm/mod-root.ts";
import { CommunicationModule } from "@communication/mod-root.ts";
import { QuoteController } from "@paperwork/entrypoints/quote-controller/mod.ts";
import { ContractController } from "@paperwork/entrypoints/contract-controller/mod.ts";
import { InvoiceController } from "@paperwork/entrypoints/invoice-controller/mod.ts";
import { ViewController } from "@paperwork/entrypoints/view-controller/mod.ts";
import { PaymentTermsController } from "@paperwork/entrypoints/payment-terms-controller/mod.ts";
import { PaymentController } from "@paperwork/entrypoints/payment-controller/mod.ts";
import { PaperworkPublicController } from "@paperwork/entrypoints/public-controller/mod.ts";
import { PaperworkEmailController } from "@paperwork/entrypoints/paperwork-email-controller/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { ContractStore } from "@paperwork/domain/data/contract-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { ViewStore } from "@paperwork/domain/data/view-store/mod.ts";
import { PaymentTermsStore } from "@paperwork/domain/data/payment-terms-store/mod.ts";
import { PaymentStore } from "@paperwork/domain/data/payment-store/mod.ts";
import { SummarizePaperworkViews } from "@paperwork/domain/coordinators/summarize-paperwork-views/mod.ts";
import { SendPaperworkEmail } from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import { ComputeInvoiceBalance } from "@paperwork/domain/coordinators/compute-invoice-balance/mod.ts";

@Module({
  imports: [UsersModule, CrmModule, CommunicationModule],
  controllers: [
    QuoteController,
    ContractController,
    InvoiceController,
    ViewController,
    PaymentTermsController,
    PaymentController,
    PaperworkPublicController,
    PaperworkEmailController,
  ],
  injectables: [
    QuoteStore,
    ContractStore,
    InvoiceStore,
    ViewStore,
    PaymentTermsStore,
    PaymentStore,
    SummarizePaperworkViews,
    SendPaperworkEmail,
    ComputeInvoiceBalance,
  ],
})
export class PaperworkModule {}
