import { IsArray, IsNumber, ValidateNested, validateSync } from "#class-validator";
import { plainToInstance, Type } from "#class-transformer";

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

export class InvoiceCountsDto {
  @IsNumber() total!: number;
  @IsNumber() pending!: number;
  @IsNumber() paid!: number;
  /** Subset of pending whose dueDate is in the past. */
  @IsNumber() overdue!: number;
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
}

export type QuoteCounts = QuoteCountsDto;
export type ContractCounts = ContractCountsDto;
export type InvoiceCounts = InvoiceCountsDto;
export type RevenueStats = RevenueStatsDto;
export type DashboardStats = DashboardStatsDto;

export function parseDashboardStats(input: unknown): DashboardStatsDto {
  const dto = plainToInstance(DashboardStatsDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid dashboard stats: ${JSON.stringify(errors)}`);
  return dto;
}
