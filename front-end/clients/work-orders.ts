/**
 * HTTP client for the work-orders pages (REQ-210, A2Z).
 *
 * Backend: paperwork/entrypoints/work-order-controller/mod.ts
 *   GET    /work-orders?customerId=&quoteId=&invoiceId=
 *   POST   /work-orders            { description, customerId?, quoteId?, invoiceId?, …, requestId? }
 *   GET    /work-orders/:id        → the order + links {quote?, invoice?, customer?}
 *   PUT    /work-orders/:id        → a new version
 *   GET    /work-orders/:id/versions
 *   DELETE /work-orders/:id
 */
import { api, type ApiOptions } from "../lib/api.ts";
import type { DocVersionRecord } from "../../shared/documents/versions.ts";
import type { WorkOrderStatus } from "../../shared/documents/linked-view.ts";

export type { WorkOrderStatus };

export interface WorkOrderLink {
  id?: string;
  number?: string;
  url?: string;
  name?: string;
}

export interface WorkOrder {
  id: string;
  number: string;
  version: number;
  url: string;
  status: WorkOrderStatus;
  description: string;
  customerId?: string;
  quoteId?: string;
  invoiceId?: string;
  serviceAddress?: string;
  scheduledFor?: string;
  completedOn?: string;
  assignee?: string;
  notes?: string;
  publishedAt?: string;
  publishedBy?: { userId?: string; name?: string; customer?: boolean };
  customerSnapshot?: { name?: string; number?: string; address?: string };
  createdAt: string;
  updatedAt: string;
  links?: {
    quote?: WorkOrderLink;
    invoice?: WorkOrderLink;
    customer?: WorkOrderLink;
  };
}

export interface WorkOrderInput {
  description?: string;
  customerId?: string;
  quoteId?: string;
  invoiceId?: string;
  serviceAddress?: string;
  scheduledFor?: string;
  completedOn?: string;
  assignee?: string;
  notes?: string;
  status?: WorkOrderStatus;
  /** REQ-200: generated once per form submission, the same on a retry. */
  requestId?: string;
}

export type WorkOrderVersion = DocVersionRecord & { current?: boolean };

export const workOrdersClient = {
  list: (
    filter: { customerId?: string; quoteId?: string; invoiceId?: string } = {},
    opts: ApiOptions = {},
  ) => api.get<WorkOrder[]>("/work-orders", { ...opts, query: filter }),
  get: (id: string, opts: ApiOptions = {}) =>
    api.get<WorkOrder>(`/work-orders/${id}`, opts),
  create: (body: WorkOrderInput, opts: ApiOptions = {}) =>
    api.post<WorkOrder>("/work-orders", body, opts),
  update: (id: string, body: WorkOrderInput, opts: ApiOptions = {}) =>
    api.put<WorkOrder>(`/work-orders/${id}`, body, opts),
  versions: (id: string, opts: ApiOptions = {}) =>
    api.get<WorkOrderVersion[]>(`/work-orders/${id}/versions`, opts),
  delete: (id: string, opts: ApiOptions = {}) =>
    api.delete<{ ok: true }>(`/work-orders/${id}`, opts),
};
