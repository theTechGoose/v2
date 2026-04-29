import { Module } from "#danet/core";
import { UsersModule } from "@users/mod-root.ts";
import { ConversationController } from "@communication/entrypoints/conversation-controller/mod.ts";
import { MessageController } from "@communication/entrypoints/message-controller/mod.ts";
import { NotificationController } from "@communication/entrypoints/notification-controller/mod.ts";
import { EmailController } from "@communication/entrypoints/email-controller/mod.ts";
import { ConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore } from "@communication/domain/data/message-store/mod.ts";
import { NotificationStore } from "@communication/domain/data/notification-store/mod.ts";
import { NotifyOnEvent } from "@communication/domain/coordinators/notify-on-event/mod.ts";
import { EmailService } from "@communication/domain/data/email-service/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";

/**
 * CommunicationModule — covers everything user↔user / user↔customer
 * messaging plus the per-user notification feed (bell + ticker) plus the
 * outbound email service (Postmark wrapper).
 *
 * `EventBus` is registered here so the notification subscriber wires
 * itself up at module load. Other modules (paperwork, agents) inject the
 * same EventBus to emit events that fan out through here.
 *
 * `EmailService` is similarly available app-wide; resource-specific
 * controllers (e.g. POST /quotes/:id/email) inject it directly to render
 * + dispatch their own bodies, while the generic POST /email/send is
 * exposed for ad-hoc use.
 */
@Module({
  imports: [UsersModule],
  controllers: [
    ConversationController,
    MessageController,
    NotificationController,
    EmailController,
  ],
  injectables: [
    ConversationStore,
    MessageStore,
    NotificationStore,
    EventBus,
    NotifyOnEvent,
    EmailService,
  ],
})
export class CommunicationModule {}
