/**
 * HTTP client for the Outbox page (REQ-784, demo-loop cycle dv1, d12).
 *
 * Backend: communication/entrypoints/outbox-controller/mod.ts
 *   GET /outbox        the account's customer messages, newest first (no bodies)
 *   GET /outbox/:id    one message with its content exactly as sent
 */
import { api, type ApiOptions } from "../lib/api.ts";
import type { OutboxMessage, OutboxRow } from "../lib/outbox.ts";

export type { OutboxMessage, OutboxRow };

export const outboxClient = {
  list: (opts: ApiOptions = {}) => api.get<OutboxRow[]>("/outbox", opts),
  get: (id: string, opts: ApiOptions = {}) =>
    api.get<OutboxMessage>(`/outbox/${encodeURIComponent(id)}`, opts),
};
