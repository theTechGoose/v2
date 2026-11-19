/**
 * HTTP client for the Outbox page (REQ-784, demo-loop cycle dv1, d12).
 *
 * Backend: communication/entrypoints/outbox-controller/mod.ts
 *   GET /outbox        the account's customer messages, newest first (no bodies)
 *   GET /outbox?customerId=  only those sent to one customer (REQ-989)
 *   GET /outbox/:id    one message with its content exactly as sent
 */
import { api, type ApiOptions } from "../lib/api.ts";
import {
  customerOutboxPath,
  type OutboxMessage,
  type OutboxRow,
} from "../lib/outbox.ts";

export type { OutboxMessage, OutboxRow };

export const outboxClient = {
  list: (opts: ApiOptions = {}) => api.get<OutboxRow[]>("/outbox", opts),
  forCustomer: (customerId: string, opts: ApiOptions = {}) =>
    api.get<OutboxRow[]>(customerOutboxPath(customerId), opts),
  get: (id: string, opts: ApiOptions = {}) =>
    api.get<OutboxMessage>(`/outbox/${encodeURIComponent(id)}`, opts),
};
