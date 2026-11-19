import { IsNumber, IsString, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";
import type { NumberedFields } from "@core/data/numbered-store/mod.ts";

/**
 * ChangeOrder — a contractor-proposed adjustment to an already-issued
 * invoice that the customer must approve via a fresh public link before it
 * takes effect (roadmap p.12). On approval the signed `deltaAmountCents` is
 * applied to the invoice total.
 */
export type ChangeOrderStatus = "pending" | "approved" | "declined";

export interface ChangeOrder extends NumberedFields {
  id: string;
  userId: string;
  invoiceId: string;
  quoteId?: string;
  customerId?: string;
  /** Plain-English description of what changed ("Add second coat of paint"). */
  description: string;
  /** Signed delta to the invoice total, INTEGER CENTS. + adds, − credits. */
  deltaAmountCents: number;
  /** Snapshot of the invoice's amount (cents) at create time. The public
   *  projection renders original / delta / original+delta from this so the
   *  math stays stable after approval mutates the live invoice. Optional —
   *  rows created before the snapshot existed fall back to deriving it. */
  originalAmountCents?: number;
  status: ChangeOrderStatus;
  createdAt: string;
  updatedAt: string;
  /** Stamped when the customer approves/declines via the public link. */
  decidedAt?: string;
  /** REQ-202: who approved it, as typed on the public page. */
  approvedName?: string;
  /** REQ-948: the decision alerts (contractor text + email, the customer's
   *  receipt) already went for the decision stamped at `decidedAt`. */
  decisionNotifiedAt?: string;
  /** REQ-1030 (LOOP-007 q2-14): when the approval request last reached the
   *  customer (an email or a text went out). REQ-652 made a chat change order
   *  unsent until an explicit Send, so "pending" alone no longer means
   *  "waiting on the customer". Stamped by SendChangeOrderAlert. */
  sentAt?: string;
  /** REQ-1030: true on every order created since `sentAt` exists. Rows
   *  without it predate the stamp — they were sent on create, so they keep
   *  counting as sent. */
  sendTracked?: boolean;
}

/** REQ-1030: has the approval request reached the customer? Legacy rows
 *  (no `sendTracked`) were always sent when created. */
export function changeOrderWasSent(co: ChangeOrder): boolean {
  return !!co.sentAt || !co.sendTracked;
}

export class CreateChangeOrderDto {
  @IsString()
  description!: string;
  @IsNumber()
  deltaAmountCents!: number;
}

export function parseCreateChangeOrder(input: unknown): CreateChangeOrderDto {
  const dto = plainToInstance(CreateChangeOrderDto, input);
  const errors = validateSync(dto);
  if (errors.length) {
    throw new Error(`invalid change order: ${JSON.stringify(errors)}`);
  }
  if (!dto.description?.trim()) {
    throw new Error("change order needs a description");
  }
  return dto;
}
