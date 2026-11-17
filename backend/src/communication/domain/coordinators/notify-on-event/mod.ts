import { Injectable } from "#danet/core";
import { type DomainEvent, EventBus } from "@core/business/events/mod.ts";
import { NotificationStore } from "@communication/domain/data/notification-store/mod.ts";
import type {
  Notification,
  NotificationType,
} from "@communication/dto/notification.ts";
import { type Lang, t, type Vars } from "@core/i18n/mod.ts";
import {
  notificationTitle,
  renderNotifString as renderShared,
} from "#quote-flow/notification-title.ts";

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
    // REQ-022 (NW-31c): the scheduled-invoice nudge is re-emitted by every
    // /cron/run-nudges call and could meet the server sweep (REQ-508) — keep
    // ONE notification per invoice per day.
    if (l.type === "invoice_nudge_due" && event.entityId) {
      const day = (event.data?.dayBucket as string | undefined) ??
        new Date().toISOString().slice(0, 10);
      const existing = await this.store.listByUser(event.userId, { limit: 500 });
      const dup = existing.some((n) =>
        n.type === "invoice_nudge_due" && n.entityId === event.entityId &&
        n.createdAt.slice(0, 10) === day
      );
      if (dup) return;
    }
    // The language the event happened to carry (contractor-initiated events
    // set it; customer-initiated public actions don't). Used only for the
    // stored fallback string — the read path re-renders per viewer.
    const lang = (event.data?.language as Lang | undefined) ?? "en";
    await this.store.create({
      userId: event.userId,
      type: l.type,
      title: renderNotifString(lang, l.titleKey, l.titleParams),
      body: l.bodyKey
        ? renderNotifString(lang, l.bodyKey, l.bodyParams)
        : l.bodyText,
      titleKey: l.titleKey,
      titleParams: l.titleParams,
      bodyKey: l.bodyKey,
      bodyParams: l.bodyParams,
      entityType: notificationEntityType(event.entityType),
      entityId: event.entityId,
    });
    // REQ-488 (demo m57): "Didn't get it" closes the claim it answers — the
    // invoice's open "says they paid" rows are marked read, and the row just
    // written is the newest, so the topbar chip shows it instead.
    if (
      event.entityType === "invoice" && event.action === "claim_rejected" &&
      event.entityId
    ) {
      const open = await this.store.listByUser(event.userId, {
        unreadOnly: true,
        limit: 500,
      });
      for (const n of open) {
        if (n.type === "invoice_claimed" && n.entityId === event.entityId) {
          await this.store.markRead(n.id, event.userId);
        }
      }
    }
  }
}

/**
 * Notification.entityType is a narrower union than DomainEvent.entityType:
 * payment + message events fan in from CRM/communication but the bell's
 * "open this" link doesn't have a destination for them yet. Drop those.
 */
function notificationEntityType(
  t: DomainEvent["entityType"],
): "quote" | "invoice" | "customer" | "conversation" | undefined {
  if (t === "payment" || t === "message" || t === "task") return undefined;
  return t;
}

/**
 * Render a notification template in `lang`. REQ-496 (demo m36, cycle 3): the
 * rendering itself (the "your client" `{name}` fallback, REQ-224's
 * `amountCents` / `method` formatting) lives in the shared
 * `#quote-flow/notification-title.ts`, so the topbar ticker re-renders a feed
 * row in the live UI language with exactly the server's words. No
 * sentence-casing here — that is a read-path concern so the pure
 * `mapEventToNotification` contract keeps its exact prose.
 */
function renderNotifString(lang: Lang, key: string, params?: Vars): string {
  return renderShared((k, v) => t(lang, k, v), key, params, lang);
}

/**
 * Re-render a stored notification into the viewer's language. Rows written
 * with a `titleKey` (every event-sourced notification) are localized fresh;
 * legacy / direct-store rows without a key pass through untouched. Titles
 * are sentence-cased so every feed string starts with a capital (P-59).
 */
export function localizeNotification(
  n: Notification,
  lang: Lang,
): Notification {
  if (!n.titleKey) return n;
  const title = notificationTitle((k, v) => t(lang, k, v), n, lang);
  const body = n.bodyKey
    ? renderNotifString(lang, n.bodyKey, n.bodyParams)
    : n.body;
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
  const nameParams: Vars | undefined = customerName
    ? { name: customerName }
    : undefined;

  if (event.entityType === "quote" && event.action === "sent") {
    return {
      type: "quote_sent",
      titleKey: "notify.quote.sent",
      titleParams: nameParams,
    };
  }
  if (event.entityType === "quote" && event.action === "accepted") {
    // UX-20: when the event knows the job, the feed line names it too
    // ("María aceptó tu cotización de Cerca Nueva") — tappable context, not
    // a generic sentence. Job-less events keep the original key.
    const jobName = event.data?.jobName as string | undefined;
    if (jobName) {
      // REQ-589 (demo-loop cycle 4, m15): the per-language names ride along
      // so the feed names the job in the READER's language.
      const byLang = event.data?.jobNameByLang as
        | Record<string, string>
        | undefined;
      const perLang: Vars = {};
      for (const l of ["en", "es"] as const) {
        const v = byLang?.[l]?.trim();
        if (v) perLang[`job_${l}`] = v;
      }
      return {
        type: "quote_accepted",
        titleKey: "notify.quote.acceptedJob",
        titleParams: { ...(nameParams ?? {}), job: jobName, ...perLang },
      };
    }
    return {
      type: "quote_accepted",
      titleKey: "notify.quote.accepted",
      titleParams: nameParams,
    };
  }
  if (event.entityType === "quote" && event.action === "declined") {
    const reason = event.data?.reason as string | undefined;
    const note = event.data?.note as string | undefined;
    return {
      type: "generic",
      titleKey: reason
        ? "notify.quote.declinedWithReason"
        : "notify.quote.declined",
      titleParams: reason
        ? { ...nameParams, reason: reason.replace(/_/g, " ") }
        : nameParams,
      bodyText: note || undefined,
    };
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
  // REQ-488 (demo m57): the contractor answered a claim with "Didn't get
  // it" — a row of its own, newer than the claim it closes.
  if (event.entityType === "invoice" && event.action === "claim_rejected") {
    const method = event.data?.method as string | undefined;
    return {
      type: "generic",
      titleKey: method
        ? "notify.invoice.claimRejectedVia"
        : "notify.invoice.claimRejected",
      titleParams: method ? { ...nameParams, method } : nameParams,
    };
  }
  if (event.entityType === "invoice" && event.action === "paid") {
    // REQ-224: ConfirmPayment sends integer `amountCents`; the money is
    // formatted per viewer at render time (renderParams). A pre-formatted
    // string `amount` is still accepted.
    const amountCents = event.data?.amountCents as number | undefined;
    const amount = event.data?.amount as string | number | undefined;
    const money: Vars | undefined = typeof amountCents === "number"
      ? { amountCents }
      : amount !== undefined && amount !== ""
      ? { amount }
      : undefined;
    return {
      type: "invoice_paid",
      titleKey: money ? "notify.invoice.paidAmount" : "notify.invoice.paid",
      titleParams: money ? { ...nameParams, ...money } : nameParams,
    };
  }
  if (event.entityType === "invoice" && event.action === "overdue") {
    return {
      type: "invoice_overdue",
      titleKey: "notify.invoice.overdue",
      titleParams: nameParams,
    };
  }
  // REQ-022 (NW-31c): a scheduled invoice's send date is here — nudge the
  // contractor to confirm the job is done and send the final invoice.
  if (event.entityType === "invoice" && event.action === "nudge_due") {
    const date = (event.data?.scheduledFor as string | undefined) ?? "";
    return {
      type: "invoice_nudge_due",
      titleKey: "notify.invoice.nudgeDue",
      titleParams: { date },
      bodyKey: "notify.invoice.nudgeDueBody",
    };
  }
  if (
    event.entityType === "invoice" &&
    (event.action === "change_order_approved" ||
      event.action === "change_order_declined")
  ) {
    // Customer decided on a change order via the public /co/:id link.
    // REQ-717 (cycle 5, p11): the delta is stored as raw signed cents and
    // formatted at render time ("+$1,600") by the shared renderer; a legacy
    // event's pre-formatted `delta` string still passes through.
    const approved = event.action === "change_order_approved";
    const deltaCents = event.data?.deltaAmountCents;
    const legacy = event.data?.delta as string | undefined;
    const delta: Vars | undefined = typeof deltaCents === "number"
      ? { deltaCents }
      : legacy
      ? { delta: legacy }
      : undefined;
    const description = event.data?.description as string | undefined;
    const base = approved
      ? "notify.invoice.changeOrderApproved"
      : "notify.invoice.changeOrderDeclined";
    const withAmount = approved
      ? "notify.invoice.changeOrderApprovedAmount"
      : "notify.invoice.changeOrderDeclinedAmount";
    return {
      type: "generic",
      titleKey: delta ? withAmount : base,
      titleParams: delta ? { ...nameParams, ...delta } : nameParams,
      bodyText: description
        ? (description.length > 140
          ? `${description.slice(0, 139)}…`
          : description)
        : undefined,
    };
  }
  // REQ-698 (demo-loop cycle 5, m14): the owner sent a change order (the
  // assistant, a chat edit, the invoice page) — pair 5's CO-002 never showed
  // in "What we handled today" because no send event existed.
  if (event.entityType === "invoice" && event.action === "change_order_sent") {
    const delta = event.data?.delta as string | undefined;
    const number = (event.data?.number as string | undefined) ?? "";
    return {
      type: "generic",
      titleKey: delta
        ? "notify.invoice.changeOrderSentAmount"
        : "notify.invoice.changeOrderSent",
      titleParams: {
        ...(nameParams ?? {}),
        number,
        ...(delta ? { delta } : {}),
      },
    };
  }
  // REQ-566 (demo-loop cycle 4, m11): the owner's own work is activity too.
  // The dashboard's "What we handled today" reads this feed (REQ-299); with
  // only customer-side events mapped it said "Nothing yet" after the owner
  // issued an invoice, recorded a payment or a worker finished a job.
  // `sent` is SendInvoice's first-send event, `issued` every other path's.
  if (
    event.entityType === "invoice" &&
    (event.action === "issued" || event.action === "sent")
  ) {
    const amountCents = event.data?.amountCents;
    const money = typeof amountCents === "number" && amountCents > 0;
    return {
      type: "invoice_sent",
      titleKey: money ? "notify.invoice.issuedAmount" : "notify.invoice.issued",
      titleParams: money ? { ...nameParams, amountCents } : nameParams,
    };
  }
  if (event.entityType === "invoice" && event.action === "payment_recorded") {
    const amountCents = event.data?.amountCents;
    const money = typeof amountCents === "number" && amountCents > 0;
    return {
      type: "invoice_paid",
      titleKey: money
        ? "notify.payment.recordedAmount"
        : "notify.payment.recorded",
      titleParams: money ? { ...nameParams, amountCents } : nameParams,
    };
  }
  if (event.entityType === "task" && event.action === "completed") {
    const task = (event.data?.task as string | undefined) ?? "";
    const worker = event.data?.worker as string | undefined;
    return {
      type: "task_completed",
      titleKey: worker ? "notify.task.completedBy" : "notify.task.completed",
      titleParams: worker
        ? { ...nameParams, task, worker }
        : { ...nameParams, task },
    };
  }
  // REQ-564 (demo-loop cycle 4, m35): a published revision is a feed row —
  // "Q-001 Version 2 published to María" — so the ticker and Activity stop
  // reading the older "Quote sent" after the contractor publishes.
  if (
    (event.entityType === "quote" || event.entityType === "invoice") &&
    event.action === "revised"
  ) {
    const number = event.data?.number as string | undefined;
    const version = event.data?.version as number | undefined;
    return {
      type: "generic",
      titleKey: `notify.${event.entityType}.revised`,
      titleParams: {
        ...(nameParams ?? {}),
        number: number ?? "",
        version: version ?? "",
      },
    };
  }
  if (event.entityType === "message" && event.action === "received") {
    return {
      type: "customer_replied",
      titleKey: "notify.message.replied",
      titleParams: nameParams,
    };
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
export function mapEventToNotification(
  event: DomainEvent,
): NotificationMapping | null {
  const l = notificationL10n(event);
  if (!l) return null;
  const lang = (event.data?.language as Lang | undefined) ?? "en";
  const out: NotificationMapping = {
    type: l.type,
    title: renderNotifString(lang, l.titleKey, l.titleParams),
  };
  const body = l.bodyKey
    ? renderNotifString(lang, l.bodyKey, l.bodyParams)
    : l.bodyText;
  if (body !== undefined) out.body = body;
  return out;
}
