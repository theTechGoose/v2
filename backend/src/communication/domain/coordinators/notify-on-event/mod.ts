import { Injectable } from "#danet/core";
import { type DomainEvent, EventBus } from "@core/business/events/mod.ts";
import { NotificationStore } from "@communication/domain/data/notification-store/mod.ts";
import type { NotificationType } from "@communication/dto/notification.ts";
import { type Lang, t } from "@core/i18n/mod.ts";

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
  const lang         = (event.data?.language as Lang | undefined) ?? "en";
  const customerName = (event.data?.customerName as string | undefined) ?? t(lang, "notify.fallbackClient");
  const amount       = (event.data?.amount as string | undefined);

  if (event.entityType === "quote" && event.action === "sent") {
    return { type: "quote_sent", title: t(lang, "notify.quote.sent", { name: customerName }) };
  }
  if (event.entityType === "quote" && event.action === "accepted") {
    return { type: "quote_accepted", title: t(lang, "notify.quote.accepted", { name: customerName }) };
  }
  if (event.entityType === "quote" && event.action === "declined") {
    const reason = (event.data?.reason as string | undefined);
    return {
      type: "generic",
      title: reason
        ? t(lang, "notify.quote.declinedWithReason", { name: customerName, reason: reason.replace(/_/g, " ") })
        : t(lang, "notify.quote.declined", { name: customerName }),
      body:  (event.data?.note as string | undefined) || undefined,
    };
  }
  if (event.entityType === "contract" && event.action === "signed") {
    return { type: "contract_signed", title: t(lang, "notify.contract.signed", { name: customerName }) };
  }
  if (event.entityType === "invoice" && event.action === "claimed") {
    const method = (event.data?.method as string | undefined);
    const reference = (event.data?.reference as string | undefined);
    return {
      type: "invoice_claimed",
      title: method
        ? t(lang, "notify.invoice.claimedVia", { name: customerName, method })
        : t(lang, "notify.invoice.claimed", { name: customerName }),
      body: reference ? t(lang, "notify.invoice.refLabel", { reference }) : undefined,
    };
  }
  if (event.entityType === "invoice" && event.action === "paid") {
    return {
      type: "invoice_paid",
      title: amount
        ? t(lang, "notify.invoice.paidAmount", { name: customerName, amount })
        : t(lang, "notify.invoice.paid", { name: customerName }),
    };
  }
  if (event.entityType === "invoice" && event.action === "overdue") {
    return { type: "invoice_overdue", title: t(lang, "notify.invoice.overdue", { name: customerName }) };
  }
  if (event.entityType === "message" && event.action === "received") {
    return { type: "customer_replied", title: t(lang, "notify.message.replied", { name: customerName }) };
  }
  if (event.entityType === "quote" && event.action === "inquiry") {
    const question = (event.data?.question as string | undefined);
    return {
      type: "customer_replied",
      title: t(lang, "notify.quote.inquiry", { name: customerName }),
      body: question
        ? (question.length > 140 ? `${question.slice(0, 139)}…` : question)
        : undefined,
    };
  }
  return null;
}
