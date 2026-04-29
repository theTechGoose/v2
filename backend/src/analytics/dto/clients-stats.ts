import { IsArray, IsIn, IsNumber, IsString, validateSync, ValidateNested } from "#class-validator";
import { plainToInstance, Type } from "#class-transformer";
import { CLIENT_SEGMENTS, type ClientSegment } from "@crm/dto/customer.ts";

const SEGMENT_KEYS = [...CLIENT_SEGMENTS, "unsorted"] as const;

export class TopClientDto {
  @IsString() customerId!: string;
  @IsString() name!: string;
  @IsNumber() revenue12moCents!: number;
  @IsNumber() rank!: number;
  /** That customer's revenue / leader's revenue, as 0–100. */
  @IsNumber() barPct!: number;
}

export class TopClientsResponseDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => TopClientDto)
  results!: TopClientDto[];
}

export class ClientSegmentRowDto {
  /** "unsorted" for customers without a segment set. */
  @IsIn(SEGMENT_KEYS) key!: ClientSegment | "unsorted";
  @IsString() label!: string;
  @IsNumber() count!: number;
  /** count / total customers, 0–100. */
  @IsNumber() pct!: number;
}

export class ClientSegmentsResponseDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => ClientSegmentRowDto)
  segments!: ClientSegmentRowDto[];
}

export type TopClient = TopClientDto;
export type TopClientsResponse = TopClientsResponseDto;
export type ClientSegmentRow = ClientSegmentRowDto;
export type ClientSegmentsResponse = ClientSegmentsResponseDto;

export function parseTopClients(input: unknown): TopClientsResponseDto {
  const dto = plainToInstance(TopClientsResponseDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid top-clients response: ${JSON.stringify(errors)}`);
  return dto;
}

export function parseClientSegments(input: unknown): ClientSegmentsResponseDto {
  const dto = plainToInstance(ClientSegmentsResponseDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid client-segments response: ${JSON.stringify(errors)}`);
  return dto;
}
