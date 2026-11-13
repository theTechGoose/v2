import { Module } from "#danet/core";
import { UsersModule } from "@users/mod-root.ts";
import { CrmModule } from "@crm/mod-root.ts";
import { CommunicationModule } from "@communication/mod-root.ts";
import { FilesModule } from "@files/mod-root.ts";
import { QuoteController } from "@paperwork/entrypoints/quote-controller/mod.ts";
import { InvoiceController } from "@paperwork/entrypoints/invoice-controller/mod.ts";
import { ViewController } from "@paperwork/entrypoints/view-controller/mod.ts";
import { PaymentTermsController } from "@paperwork/entrypoints/payment-terms-controller/mod.ts";
import { PaymentController } from "@paperwork/entrypoints/payment-controller/mod.ts";
import { PaperworkPublicController } from "@paperwork/entrypoints/public-controller/mod.ts";
import { PaperworkEmailController } from "@paperwork/entrypoints/paperwork-email-controller/mod.ts";
import { CronController } from "@paperwork/entrypoints/cron-controller/mod.ts";
import { InboundController } from "@paperwork/entrypoints/inbound-controller/mod.ts";
import { ReplyTokenStore } from "@paperwork/domain/data/reply-token-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import { ViewStore } from "@paperwork/domain/data/view-store/mod.ts";
import { PaymentTermsStore } from "@paperwork/domain/data/payment-terms-store/mod.ts";
import { PaymentStore } from "@paperwork/domain/data/payment-store/mod.ts";
import { ShortLinkStore } from "@paperwork/domain/data/shortlink-store/mod.ts";
import { SummarizePaperworkViews } from "@paperwork/domain/coordinators/summarize-paperwork-views/mod.ts";
import { SendPaperworkEmail } from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import { SendPaperworkSms } from "@paperwork/domain/coordinators/send-paperwork-sms/mod.ts";
import { PreviewQuoteSend } from "@paperwork/domain/coordinators/preview-quote-send/mod.ts"; // REQ-461
import { PreviewInvoiceSend } from "@paperwork/domain/coordinators/preview-invoice-send/mod.ts"; // REQ-727
import { ComputeInvoiceBalance } from "@paperwork/domain/coordinators/compute-invoice-balance/mod.ts";
import { MarkInvoicePaid } from "@paperwork/domain/coordinators/mark-invoice-paid/mod.ts";
import { RenderQuotePdf } from "@paperwork/domain/coordinators/render-quote-pdf/mod.ts";
import { RenderReceiptPdf } from "@paperwork/domain/coordinators/render-receipt-pdf/mod.ts";
import { RenderInvoicePdf } from "@paperwork/domain/coordinators/render-invoice-pdf/mod.ts";
import { RenderInvoicePrintPdf } from "@paperwork/domain/coordinators/render-invoice-print-pdf/mod.ts"; // REQ-629
import { LoadBusinessLogo } from "@paperwork/domain/coordinators/load-business-logo/mod.ts";
import { SendSignedConfirmation } from "@paperwork/domain/coordinators/send-signed-confirmation/mod.ts";
import { SendAcceptedAlert } from "@paperwork/domain/coordinators/send-accepted-alert/mod.ts";
import { SendInquiryAlert } from "@paperwork/domain/coordinators/send-inquiry-alert/mod.ts";
import { SendChangeOrderAlert } from "@paperwork/domain/coordinators/send-change-order-alert/mod.ts";
import { ConfirmPayment } from "@paperwork/domain/coordinators/confirm-payment/mod.ts";
import { RecordCardPayment } from "@paperwork/domain/coordinators/record-card-payment/mod.ts"; // REQ-213
import { SquareCheckoutStore } from "@paperwork/domain/data/square-checkout-store/mod.ts"; // REQ-803
import { SettleSquareCheckouts } from "@paperwork/domain/coordinators/settle-square-checkouts/mod.ts"; // REQ-803
import { SendPaymentReminder } from "@paperwork/domain/coordinators/send-payment-reminder/mod.ts";
import { ScheduleInvoiceNudges } from "@paperwork/domain/coordinators/schedule-invoice-nudges/mod.ts";
import { ComputeInvoiceForecast } from "@paperwork/domain/coordinators/compute-invoice-forecast/mod.ts";
import { RecordPaymentFromUtterance } from "@paperwork/domain/coordinators/record-payment-from-utterance/mod.ts";
import { DocNumbering } from "@core/data/doc-numbering/mod.ts"; // REQ-198
import { RevisionsController } from "@paperwork/entrypoints/revisions-controller/mod.ts"; // REQ-201/205
import { WorkOrderController } from "@paperwork/entrypoints/work-order-controller/mod.ts"; // REQ-210
import { WorkOrderStore } from "@paperwork/domain/data/work-order-store/mod.ts"; // REQ-210
import { InvoiceTranslatorPort } from "@paperwork/domain/coordinators/invoice-translator-port/mod.ts"; // REQ-497
import { QuoteSignedPort } from "@paperwork/domain/coordinators/quote-signed-port/mod.ts"; // REQ-563
import { QuoteSubscriptionPort } from "@paperwork/domain/coordinators/quote-subscription-port/mod.ts"; // REQ-699
import { QuoteTranslatorPort } from "@paperwork/domain/coordinators/quote-translator-port/mod.ts"; // REQ-591
import { InquiryController } from "@paperwork/entrypoints/inquiry-controller/mod.ts"; // REQ-701
import { QuoteInquiryStore } from "@paperwork/domain/data/inquiry-store/mod.ts"; // REQ-701
import { ReplyToInquiry } from "@paperwork/domain/coordinators/reply-to-inquiry/mod.ts"; // REQ-701
import { QuoteAllowance } from "@paperwork/domain/coordinators/quote-allowance/mod.ts"; // REQ-766

@Module({
  imports: [UsersModule, CrmModule, CommunicationModule, FilesModule],
  controllers: [
    QuoteController,
    InvoiceController,
    ViewController,
    PaymentTermsController,
    PaymentController,
    PaperworkPublicController,
    PaperworkEmailController,
    CronController,
    InboundController,
    RevisionsController, // REQ-201/205
    WorkOrderController, // REQ-210
    InquiryController, // REQ-701
  ],
  injectables: [
    QuoteStore,
    InvoiceStore,
    ChangeOrderStore,
    ViewStore,
    PaymentTermsStore,
    PaymentStore,
    ShortLinkStore,
    ReplyTokenStore,
    SummarizePaperworkViews,
    SendPaperworkEmail,
    SendPaperworkSms,
    PreviewQuoteSend, // REQ-461
    PreviewInvoiceSend, // REQ-727
    MarkInvoicePaid,
    ComputeInvoiceBalance,
    RenderQuotePdf,
    RenderReceiptPdf,
    RenderInvoicePdf,
    LoadBusinessLogo, // REQ-628
    RenderInvoicePrintPdf, // REQ-629
    SendSignedConfirmation,
    SendAcceptedAlert,
    SendInquiryAlert,
    SendChangeOrderAlert,
    ConfirmPayment,
    RecordCardPayment, // REQ-213
    SquareCheckoutStore, // REQ-803
    SettleSquareCheckouts, // REQ-803
    SendPaymentReminder,
    ScheduleInvoiceNudges,
    ComputeInvoiceForecast,
    RecordPaymentFromUtterance,
    DocNumbering, // REQ-198
    WorkOrderStore, // REQ-210
    InvoiceTranslatorPort, // REQ-497
    QuoteSignedPort, // REQ-563
    QuoteSubscriptionPort, // REQ-699
    QuoteTranslatorPort, // REQ-591
    QuoteInquiryStore, // REQ-701
    ReplyToInquiry, // REQ-701
    QuoteAllowance, // REQ-766
  ],
})
export class PaperworkModule {}
