import { IsNumber, IsString, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";

/**
 * ChangeOrder — a contractor-proposed adjustment to an already-issued
 * invoice that the customer must approve via a fresh public link before it
 * takes effect (roadmap p.12). On approval the signed `deltaAmountCents` is
 * applied to the invoice total.
 */
export type ChangeOrderStatus = "pending" | "approved" | "declined";

export interface ChangeOrder {
  id: string;
  userId: string;
  invoiceId: string;
  contractId?: string;
  customerId?: string;
  /** Plain-English description of what changed ("Add second coat of paint"). */
  description: string;
  /** Signed delta to the invoice total, INTEGER CENTS. + adds, − credits. */
  deltaAmountCents: number;
  status: ChangeOrderStatus;
  createdAt: string;
  updatedAt: string;
  /** Stamped when the customer approves/declines via the public link. */
  decidedAt?: string;
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
