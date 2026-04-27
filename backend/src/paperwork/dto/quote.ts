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

  @IsOptional()
  @IsNumber()
  estimatedTotal?: number;

  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateQuoteDto {
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() summary?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => LineItemDto) lineItems?: LineItemDto[];
  @IsOptional() @IsNumber() estimatedTotal?: number;
  @IsOptional() @IsString() status?: string;
}

export interface Quote extends CreateQuoteDto {
  id: string;
  /** Owner. Populated server-side from the auth context — never accept from request body. */
  userId: string;
  createdAt: string;
  updatedAt: string;
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
