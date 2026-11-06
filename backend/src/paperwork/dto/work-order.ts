import { IsIn, IsOptional, IsString, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";
import type { NumberedFields } from "@core/data/numbered-store/mod.ts";

/**
 * WorkOrder — REQ-210 (the A2Z customization): the contractor's own
 * numbered WO- document under a client, linked to the customer, the quote
 * and/or the invoice the work belongs to. Contractor-side only: it never
 * gets a customer link, and nothing on it bills or signs.
 */
export const WORK_ORDER_STATUSES = [
  "open",
  "in_progress",
  "done",
  "cancelled",
] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

export interface WorkOrder extends NumberedFields {
  id: string;
  userId: string;
  customerId?: string;
  quoteId?: string;
  invoiceId?: string;
  description: string;
  serviceAddress?: string;
  /** ISO date the work is scheduled for */
  scheduledFor?: string;
  /** ISO date the work was completed */
  completedOn?: string;
  /** free text: the crew / tech it is assigned to */
  assignee?: string;
  notes?: string;
  status: WorkOrderStatus;
  createdAt: string;
  updatedAt: string;
}

export class CreateWorkOrderDto {
  @IsString()
  description!: string;
  @IsOptional() @IsString()
  customerId?: string;
  @IsOptional() @IsString()
  quoteId?: string;
  @IsOptional() @IsString()
  invoiceId?: string;
  @IsOptional() @IsString()
  serviceAddress?: string;
  @IsOptional() @IsString()
  scheduledFor?: string;
  @IsOptional() @IsString()
  completedOn?: string;
  @IsOptional() @IsString()
  assignee?: string;
  @IsOptional() @IsString()
  notes?: string;
  @IsOptional() @IsIn(WORK_ORDER_STATUSES as unknown as string[])
  status?: WorkOrderStatus;
}

export class UpdateWorkOrderDto {
  @IsOptional() @IsString()
  description?: string;
  @IsOptional() @IsString()
  customerId?: string;
  @IsOptional() @IsString()
  quoteId?: string;
  @IsOptional() @IsString()
  invoiceId?: string;
  @IsOptional() @IsString()
  serviceAddress?: string;
  @IsOptional() @IsString()
  scheduledFor?: string;
  @IsOptional() @IsString()
  completedOn?: string;
  @IsOptional() @IsString()
  assignee?: string;
  @IsOptional() @IsString()
  notes?: string;
  @IsOptional() @IsIn(WORK_ORDER_STATUSES as unknown as string[])
  status?: WorkOrderStatus;
}

/** The fields a revision of a work order is made of (everything but the links' ids is content). */
export const WORK_ORDER_CONTENT_FIELDS = [
  "description",
  "serviceAddress",
  "scheduledFor",
  "completedOn",
  "assignee",
  "notes",
  "status",
  "customerId",
  "quoteId",
  "invoiceId",
] as const;

export function parseCreateWorkOrder(input: unknown): CreateWorkOrderDto {
  const dto = plainToInstance(CreateWorkOrderDto, input);
  const errors = validateSync(dto, { whitelist: true });
  if (errors.length) {
    throw new Error(`invalid work order: ${JSON.stringify(errors)}`);
  }
  if (!dto.description?.trim()) {
    throw new Error("work order needs a description");
  }
  return dto;
}

export function parseUpdateWorkOrder(input: unknown): UpdateWorkOrderDto {
  const dto = plainToInstance(UpdateWorkOrderDto, input);
  const errors = validateSync(dto, { whitelist: true });
  if (errors.length) {
    throw new Error(`invalid work order: ${JSON.stringify(errors)}`);
  }
  if (dto.description !== undefined && !dto.description.trim()) {
    throw new Error("work order needs a description");
  }
  return dto;
}
