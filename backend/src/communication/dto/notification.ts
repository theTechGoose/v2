import { IsBoolean, IsIn, IsOptional, IsString, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";

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
export const NOTIFICATION_TYPES = [
  "quote_sent",
  "quote_accepted",
  "contract_signed",
  "invoice_paid",
  "invoice_overdue",
  "customer_replied",
  "generic",
] as const;
export type NotificationType = typeof NOTIFICATION_TYPES[number];

export const NOTIFICATION_ENTITY_TYPES = [
  "quote",
  "contract",
  "invoice",
  "customer",
  "conversation",
] as const;
export type NotificationEntityType = typeof NOTIFICATION_ENTITY_TYPES[number];

export class CreateNotificationDto {
  @IsString()
  @IsIn(NOTIFICATION_TYPES as unknown as string[])
  type!: NotificationType;

  @IsString()
  title!: string;

  @IsOptional() @IsString() body?: string;

  @IsOptional()
  @IsString()
  @IsIn(NOTIFICATION_ENTITY_TYPES as unknown as string[])
  entityType?: NotificationEntityType;

  @IsOptional() @IsString() entityId?: string;
}

export class UpdateNotificationDto {
  @IsOptional() @IsBoolean() read?: boolean;
  @IsOptional() @IsString() readAt?: string;
}

export interface Notification extends CreateNotificationDto {
  id: string;
  userId: string;
  read: boolean;
  readAt?: string;
  createdAt: string;
}

export function parseCreateNotification(input: unknown): CreateNotificationDto {
  const dto = plainToInstance(CreateNotificationDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid notification: ${JSON.stringify(errors)}`);
  return dto;
}

export function parseUpdateNotification(input: unknown): UpdateNotificationDto {
  const dto = plainToInstance(UpdateNotificationDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid notification patch: ${JSON.stringify(errors)}`);
  return dto;
}
