import { IsIn, IsNumber, IsOptional, IsString, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";

const INSIGHT_KINDS = [
  "open_count",
  "median_days_to_decide",
  "best_day_of_week",
  "static_fallback",
] as const;

export type InsightKind = typeof INSIGHT_KINDS[number];

export class WinRateResponseDto {
  @IsNumber() windowDays!: number;
  @IsNumber() decided!: number;
  @IsNumber() won!: number;
  @IsNumber() lost!: number;
  /** 0–100, or null when decided === 0. */
  @IsOptional() @IsNumber() winRate!: number | null;
}

export class InsightResponseDto {
  @IsString() text!: string;
  @IsIn(INSIGHT_KINDS) kind!: InsightKind;
}

export type WinRateResponse = WinRateResponseDto;
export type InsightResponse = InsightResponseDto;

export function parseWinRate(input: unknown): WinRateResponseDto {
  const dto = plainToInstance(WinRateResponseDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid win-rate response: ${JSON.stringify(errors)}`);
  return dto;
}

export function parseInsight(input: unknown): InsightResponseDto {
  const dto = plainToInstance(InsightResponseDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid insight response: ${JSON.stringify(errors)}`);
  return dto;
}
