/**
 * Notification — a unit of "something happened that the user should know about".
 *
 * Created by the EventBus subscriber when a domain event matches one of
 * the surfaced types (quote_sent, quote_accepted, contract_signed,
 * invoice_paid, invoice_overdue, customer_replied, …). Stored per-user
 * with a recency index so the topbar bell + activity ticker can paginate
 * cheaply.
 *
 * `read` is a boolean toggle; the unread badge counts where read === false.
 */
export type NotificationType =
  | "quote_sent"
  | "quote_accepted"
  | "contract_signed"
  | "invoice_paid"
  | "invoice_overdue"
  | "customer_replied"
  | "generic";

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  /** Optional link target — `entityType` + `entityId` for the dashboard to deep-link from the bell dropdown. */
  entityType?: "quote" | "contract" | "invoice" | "customer" | "conversation";
  entityId?: string;
  /** Short headline rendered in the bell + ticker. */
  title: string;
  body?: string;
  read: boolean;
  readAt?: string;
  createdAt: string;
}
