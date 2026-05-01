import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  validateSync,
  ValidateNested,
} from "#class-validator";
import { plainToInstance, Type } from "#class-transformer";

export class LineItemDto {
  @IsString()
  description!: string;

  @IsNumber()
  quantity!: number;

  @IsString()
  unit!: string;

  /** Per-unit price in INTEGER CENTS. Line total is price * quantity. */
  @IsNumber()
  price!: number;
}

export class CreateQuoteDto {
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsString()
  summary!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineItemDto)
  lineItems!: LineItemDto[];

  /** Total quote value in INTEGER CENTS. Audit1 #3 unified the money
   *  schema so dollars-as-floats no longer cross any boundary. */
  @IsOptional()
  @IsNumber()
  estimatedTotal?: number;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional() @IsString() sentAt?: string;
  @IsOptional() @IsString() acceptedAt?: string;
  @IsOptional() @IsString() lostAt?: string;
  @IsOptional() @IsString() acceptedSignature?: string;
  @IsOptional() @IsString() acceptedName?: string;
}

export class UpdateQuoteDto {
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() summary?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => LineItemDto) lineItems?: LineItemDto[];
  /** INTEGER CENTS. */
  @IsOptional() @IsNumber() estimatedTotal?: number;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() sentAt?: string;
  @IsOptional() @IsString() acceptedAt?: string;
  @IsOptional() @IsString() lostAt?: string;
  @IsOptional() @IsString() acceptedSignature?: string;
  @IsOptional() @IsString() acceptedName?: string;
}

export interface Quote extends CreateQuoteDto {
  id: string;
  /** Owner. Populated server-side from the auth context — never accept from request body. */
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export type QuoteStage = "draft" | "sent" | "opened" | "cooling" | "stale" | "won" | "lost";

/**
 * Quote row enriched with the derived stage + engagement signal the /quotes
 * card consumes. Computed by `BuildQuoteCards`; never persisted.
 */
export interface QuoteCard extends Quote {
  stage:        QuoteStage;
  daysIn:       number;
  opens:        number;
  lastOpenAt:   string | null;
  sentDays:     number | null;
  decidedDays:  number | null;
  customerName: string | null;
}

export interface QuoteOpenEntry {
  at:         string;
  atRel:      string;
  device:     "desktop" | "mobile" | "tablet" | "unknown";
  durationMs?: number;
}

export interface QuoteOpensResponse {
  opens: QuoteOpenEntry[];
}

export function parseCreateQuote(input: unknown): CreateQuoteDto {
  const dto = plainToInstance(CreateQuoteDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid quote: ${JSON.stringify(errors)}`);
  return dto;
}

export function parseUpdateQuote(input: unknown): UpdateQuoteDto {
  const dto = plainToInstance(UpdateQuoteDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid quote patch: ${JSON.stringify(errors)}`);
  return dto;
}
