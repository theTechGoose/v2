import { IsArray, IsNumber, IsString, ValidateNested, validateSync } from "#class-validator";
import { plainToInstance, Type } from "#class-transformer";
import type { PaymentMethod } from "@paperwork/dto/payment.ts";

/**
 * The shape returned by `GET /analytics/dashboard`.
 *
 * Drives the dashboard's hero numbers, KPI tiles, sidebar nav badges, and
 * sparkline. One round-trip on dashboard mount.
 *
 * Money fields are in CENTS (integer), not dollars — the frontend formats
 * for display. Eliminates float drift in summation.
 */

export class QuoteCountsDto {
  @IsNumber() total!: number;
  @IsNumber() draft!: number;
  @IsNumber() sent!: number;
  @IsNumber() accepted!: number;
}

export class ContractCountsDto {
  @IsNumber() total!: number;
  @IsNumber() draft!: number;
  @IsNumber() signed!: number;
}

export class AgingBucketsDto {
  @IsNumber() current!: number;
  @IsNumber() aging1_14d!: number;
  @IsNumber() overdue15_30d!: number;
  @IsNumber() overdue30plus!: number;
}

export class InvoiceCountsDto {
  @IsNumber() total!: number;
  @IsNumber() pending!: number;
  @IsNumber() paid!: number;
  /** Subset of pending whose dueDate is in the past. */
  @IsNumber() overdue!: number;
  @ValidateNested() @Type(() => AgingBucketsDto) agingBuckets!: AgingBucketsDto;
}

export class RevenueStatsDto {
  /** Sum of paid-invoice amounts year-to-date. */
  @IsNumber() ytdCents!: number;
  /** Sum of paid-invoice amounts in the previous calendar month. */
  @IsNumber() lastMonthCents!: number;
  /** monthOverMonth percentage change vs the month before lastMonth (positive = growth). */
  @IsNumber() monthOverMonthPct!: number;
  /** Length-12 array, oldest → newest, of monthly paid-invoice totals (cents). */
  @IsArray() sparkline12mo!: number[];
}

export class TopPayorDto {
  @IsString() customerId!: string;
  @IsNumber() totalCents!: number;
}

export class PaymentStatsDto {
  /** Sum of payment amounts received in the current calendar year, in cents. */
  @IsNumber() receivedYtdCents!: number;
  /** Total payment volume by method, in cents. Keys are PaymentMethod values. */
  methodMixCents!: Record<PaymentMethod, number>;
  /** Top 3 customers by lifetime payment total, in cents. */
  @IsArray() @ValidateNested({ each: true }) @Type(() => TopPayorDto) topPayors!: TopPayorDto[];
}

export class DashboardStatsDto {
  @IsNumber() customers!: number;
  @ValidateNested() @Type(() => QuoteCountsDto)    quotes!: QuoteCountsDto;
  @ValidateNested() @Type(() => ContractCountsDto) contracts!: ContractCountsDto;
  @ValidateNested() @Type(() => InvoiceCountsDto)  invoices!: InvoiceCountsDto;
  /** Sum of estimatedTotal across quotes whose status === 'sent'. In cents. */
  @IsNumber() quotedValueCents!: number;
  /** Number of quotes in 'sent' status (i.e. waiting on the customer). */
  @IsNumber() awaitingResponse!: number;
  @ValidateNested() @Type(() => RevenueStatsDto) revenue!: RevenueStatsDto;
  @ValidateNested() @Type(() => PaymentStatsDto) payments!: PaymentStatsDto;
}

export type QuoteCounts = QuoteCountsDto;
export type ContractCounts = ContractCountsDto;
export type InvoiceCounts = InvoiceCountsDto;
export type RevenueStats = RevenueStatsDto;
export type PaymentStats = PaymentStatsDto;
export type TopPayor = TopPayorDto;
export type DashboardStats = DashboardStatsDto;

export function parseDashboardStats(input: unknown): DashboardStatsDto {
  const dto = plainToInstance(DashboardStatsDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid dashboard stats: ${JSON.stringify(errors)}`);
  return dto;
}
