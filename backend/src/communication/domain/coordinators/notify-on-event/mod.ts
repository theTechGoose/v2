import { Injectable } from "#danet/core";
import { type DomainEvent, EventBus } from "@core/business/events/mod.ts";
import { NotificationStore } from "@communication/domain/data/notification-store/mod.ts";
import type { Notification, NotificationType } from "@communication/dto/notification.ts";
import { type Lang, t, type Vars } from "@core/i18n/mod.ts";
import { sentenceCase } from "#quote-flow/format-helpers.ts";

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
 * P-59: the feed must render in the VIEWER's language, not frozen in the
 * language the event was materialized in (a customer-driven public accept
 * carries no language at all). So each notification is stored as a
 * translation KEY + PARAMS; the read path (`localizeNotification`) renders
 * the title/body fresh in the current viewer's `user.language`. The stored
 * `title` is still materialized (default EN) so legacy rows / direct-store
 * writes remain readable.
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
    const l = notificationL10n(event);
    if (!l) return;
    // The language the event happened to carry (contractor-initiated events
    // set it; customer-initiated public actions don't). Used only for the
    // stored fallback string — the read path re-renders per viewer.
    const lang = (event.data?.language as Lang | undefined) ?? "en";
    await this.store.create({
      userId:      event.userId,
      type:        l.type,
      title:       renderNotifString(lang, l.titleKey, l.titleParams),
      body:        l.bodyKey ? renderNotifString(lang, l.bodyKey, l.bodyParams) : l.bodyText,
      titleKey:    l.titleKey,
      titleParams: l.titleParams,
      bodyKey:     l.bodyKey,
      bodyParams:  l.bodyParams,
      entityType:  notificationEntityType(event.entityType),
      entityId:    event.entityId,
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

/**
 * Render a notification template in `lang`. A default `{name}` (the
 * localized "your client" fallback) is injected first so a name-less event
 * still reads correctly in the VIEWER's language, then overridden by any
 * real params. No sentence-casing here — that is a read-path concern so the
 * pure `mapEventToNotification` contract keeps its exact prose.
 */
function renderNotifString(lang: Lang, key: string, params?: Vars): string {
  return t(lang, key, { name: t(lang, "notify.fallbackClient"), ...(params ?? {}) });
}

/**
 * Re-render a stored notification into the viewer's language. Rows written
 * with a `titleKey` (every event-sourced notification) are localized fresh;
 * legacy / direct-store rows without a key pass through untouched. Titles
 * are sentence-cased so every feed string starts with a capital (P-59).
 */
export function localizeNotification(n: Notification, lang: Lang): Notification {
  if (!n.titleKey) return n;
  const title = sentenceCase(renderNotifString(lang, n.titleKey, n.titleParams));
  const body = n.bodyKey ? renderNotifString(lang, n.bodyKey, n.bodyParams) : n.body;
  return { ...n, title, body };
}

interface NotificationMapping {
  type: NotificationType;
  title: string;
  body?: string;
}

/** Localization-ready mapping: keys + params, rendered per viewer. */
export interface NotificationL10n {
  type: NotificationType;
  titleKey: string;
  titleParams?: Vars;
  /** A translatable body (re-rendered per viewer). */
  bodyKey?: string;
  bodyParams?: Vars;
  /** A raw, language-independent body (a customer's note / question). */
  bodyText?: string;
}

/**
 * Pure mapping from `(entityType, action)` to the notification type +
 * translation key + params. Exported so it can be unit-tested and reused by
 * the read-path localizer. Returns `null` for events we don't surface.
 */
export function notificationL10n(event: DomainEvent): NotificationL10n | null {
  const customerName = event.data?.customerName as string | undefined;
  const nameParams: Vars | undefined = customerName ? { name: customerName } : undefined;

  if (event.entityType === "quote" && event.action === "sent") {
    return { type: "quote_sent", titleKey: "notify.quote.sent", titleParams: nameParams };
  }
  if (event.entityType === "quote" && event.action === "accepted") {
    // UX-20: when the event knows the job, the feed line names it too
    // ("María aceptó tu cotización de Cerca Nueva") — tappable context, not
    // a generic sentence. Job-less events keep the original key.
    const jobName = event.data?.jobName as string | undefined;
    if (jobName) {
      return {
        type: "quote_accepted",
        titleKey: "notify.quote.acceptedJob",
        titleParams: { ...(nameParams ?? {}), job: jobName },
      };
    }
    return { type: "quote_accepted", titleKey: "notify.quote.accepted", titleParams: nameParams };
  }
  if (event.entityType === "quote" && event.action === "declined") {
    const reason = event.data?.reason as string | undefined;
    const note = event.data?.note as string | undefined;
    return {
      type: "generic",
      titleKey: reason ? "notify.quote.declinedWithReason" : "notify.quote.declined",
      titleParams: reason ? { ...nameParams, reason: reason.replace(/_/g, " ") } : nameParams,
      bodyText: note || undefined,
    };
  }
  if (event.entityType === "contract" && event.action === "signed") {
    return { type: "contract_signed", titleKey: "notify.contract.signed", titleParams: nameParams };
  }
  if (event.entityType === "invoice" && event.action === "claimed") {
    const method = event.data?.method as string | undefined;
    const reference = event.data?.reference as string | undefined;
    return {
      type: "invoice_claimed",
      titleKey: method ? "notify.invoice.claimedVia" : "notify.invoice.claimed",
      titleParams: method ? { ...nameParams, method } : nameParams,
      bodyKey: reference ? "notify.invoice.refLabel" : undefined,
      bodyParams: reference ? { reference } : undefined,
    };
  }
  if (event.entityType === "invoice" && event.action === "paid") {
    const amount = event.data?.amount as string | undefined;
    return {
      type: "invoice_paid",
      titleKey: amount ? "notify.invoice.paidAmount" : "notify.invoice.paid",
      titleParams: amount ? { ...nameParams, amount } : nameParams,
    };
  }
  if (event.entityType === "invoice" && event.action === "overdue") {
    return { type: "invoice_overdue", titleKey: "notify.invoice.overdue", titleParams: nameParams };
  }
  if (
    event.entityType === "invoice" &&
    (event.action === "change_order_approved" || event.action === "change_order_declined")
  ) {
    // Customer decided on a change order via the public /co/:id link. The
    // delta arrives pre-formatted ("+$250.00") from the public controller.
    const approved = event.action === "change_order_approved";
    const delta = event.data?.delta as string | undefined;
    const description = event.data?.description as string | undefined;
    const base = approved ? "notify.invoice.changeOrderApproved" : "notify.invoice.changeOrderDeclined";
    const withAmount = approved
      ? "notify.invoice.changeOrderApprovedAmount"
      : "notify.invoice.changeOrderDeclinedAmount";
    return {
      type: "generic",
      titleKey: delta ? withAmount : base,
      titleParams: delta ? { ...nameParams, delta } : nameParams,
      bodyText: description
        ? (description.length > 140 ? `${description.slice(0, 139)}…` : description)
        : undefined,
    };
  }
  if (event.entityType === "message" && event.action === "received") {
    return { type: "customer_replied", titleKey: "notify.message.replied", titleParams: nameParams };
  }
  if (event.entityType === "quote" && event.action === "inquiry") {
    const question = event.data?.question as string | undefined;
    return {
      type: "customer_replied",
      titleKey: "notify.quote.inquiry",
      titleParams: nameParams,
      bodyText: question
        ? (question.length > 140 ? `${question.slice(0, 139)}…` : question)
        : undefined,
    };
  }
  return null;
}

/**
 * Back-compat pure mapper: renders `notificationL10n` in the event's own
 * language (default EN) into the flat `{ type, title, body }` shape. Kept
 * so existing unit tests + any non-viewer caller still get materialized
 * prose. The live feed uses `notificationL10n` + `localizeNotification`.
 */
export function mapEventToNotification(event: DomainEvent): NotificationMapping | null {
  const l = notificationL10n(event);
  if (!l) return null;
  const lang = (event.data?.language as Lang | undefined) ?? "en";
  const out: NotificationMapping = {
    type: l.type,
    title: renderNotifString(lang, l.titleKey, l.titleParams),
  };
  const body = l.bodyKey ? renderNotifString(lang, l.bodyKey, l.bodyParams) : l.bodyText;
  if (body !== undefined) out.body = body;
  return out;
}
