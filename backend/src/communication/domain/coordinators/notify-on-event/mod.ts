import { Injectable } from "#danet/core";
import { type DomainEvent, EventBus } from "@core/business/events/mod.ts";
import { NotificationStore } from "@communication/domain/data/notification-store/mod.ts";
import type { NotificationType } from "@communication/dto/notification.ts";

/**
 * NotifyOnEvent — subscribes to the EventBus on construction and writes a
 * notification record for each event whose `entityType + action` maps to
 * a known notification type.
 *
 * The translation is intentionally narrow — only events that should
 * surface in the topbar bell + activity ticker get a notification. Domain
 * events that are pure internal signals (e.g. a wizard step advancing)
 * stay off the bell.
 *
 * Subscribed at module-load time via the constructor. Danet instantiates
 * NotifyOnEvent once per app boot; that single subscription survives for
 * the process lifetime.
 */
@Injectable()
export class NotifyOnEvent {
  constructor(bus: EventBus, private store: NotificationStore) {
    bus.subscribe((e) => this.handle(e));
  }

  private async handle(event: DomainEvent): Promise<void> {
    const mapping = mapEventToNotification(event);
    if (!mapping) return;
    await this.store.create({
      userId:     event.userId,
      type:       mapping.type,
      title:      mapping.title,
      body:       mapping.body,
      entityType: notificationEntityType(event.entityType),
      entityId:   event.entityId,
    });
  }
}

/**
 * Notification.entityType is a narrower union than DomainEvent.entityType:
 * payment + message events fan in from CRM/communication but the bell's
 * "open this" link doesn't have a destination for them yet. Drop those.
 */
function notificationEntityType(t: DomainEvent["entityType"]): "quote" | "contract" | "invoice" | "customer" | "conversation" | undefined {
  if (t === "payment" || t === "message") return undefined;
  return t;
}

interface NotificationMapping {
  type: NotificationType;
  title: string;
  body?: string;
}

/**
 * Pure mapping from `(entityType, action)` to the notification type +
 * default title. Exported so it can be unit-tested in isolation and so
 * the future analytics/audit-log subscribers can reuse the same vocabulary.
 *
 * Returns `null` for events we don't surface as user-visible notifications
 * (e.g. internal wizard steps).
 */
export function mapEventToNotification(event: DomainEvent): NotificationMapping | null {
  const customerName = (event.data?.customerName as string | undefined) ?? "your client";
  const amount       = (event.data?.amount as string | undefined);

  if (event.entityType === "quote" && event.action === "sent") {
    return { type: "quote_sent", title: `Quote sent to ${customerName}` };
  }
  if (event.entityType === "quote" && event.action === "accepted") {
    return { type: "quote_accepted", title: `${customerName} accepted your quote` };
  }
  if (event.entityType === "quote" && event.action === "declined") {
    const reason = (event.data?.reason as string | undefined);
    const reasonLabel = reason ? ` · ${reason.replace(/_/g, " ")}` : "";
    return {
      type: "generic",
      title: `${customerName} declined your quote${reasonLabel}`,
      body:  (event.data?.note as string | undefined) || undefined,
    };
  }
  if (event.entityType === "contract" && event.action === "signed") {
    return { type: "contract_signed", title: `${customerName} signed the contract` };
  }
  if (event.entityType === "invoice" && event.action === "paid") {
    return { type: "invoice_paid", title: `${customerName} paid${amount ? ` ${amount}` : ""}` };
  }
  if (event.entityType === "invoice" && event.action === "overdue") {
    return { type: "invoice_overdue", title: `Invoice for ${customerName} is overdue` };
  }
  if (event.entityType === "message" && event.action === "received") {
    return { type: "customer_replied", title: `${customerName} replied` };
  }
  if (event.entityType === "quote" && event.action === "inquiry") {
    const question = (event.data?.question as string | undefined);
    return {
      type: "customer_replied",
      title: `${customerName} asked a question`,
      body: question
        ? (question.length > 140 ? `${question.slice(0, 139)}…` : question)
        : undefined,
    };
  }
  return null;
}
