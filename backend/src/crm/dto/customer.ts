import { IsBoolean, IsIn, IsOptional, IsString, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";

export type ClientSegment = "property_mgmt" | "homeowner" | "small_biz" | "hoa";
export const CLIENT_SEGMENTS: ClientSegment[] = ["property_mgmt", "homeowner", "small_biz", "hoa"];

export class CreateCustomerDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsIn(CLIENT_SEGMENTS)
  segment?: ClientSegment;

  @IsOptional()
  @IsBoolean()
  vip?: boolean;

  @IsOptional()
  @IsBoolean()
  isBusiness?: boolean;
}

export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsIn(CLIENT_SEGMENTS)
  segment?: ClientSegment;

  @IsOptional()
  @IsBoolean()
  vip?: boolean;

  @IsOptional()
  @IsBoolean()
  isBusiness?: boolean;
}

export interface Customer extends CreateCustomerDto {
  id: string;
  /** Owner. Populated server-side from the auth context — never accept from request body. */
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export type CustomerStatus = "active" | "lead" | "owes" | "regular" | "cold";
export type CustomerLastTone = "hot" | "warm" | "cold";

/**
 * Enriched customer row for the /clients page. Extends `Customer` with derived
 * rollups computed by `BuildCustomerCards`. Never persisted — pure projection.
 */
export interface CustomerCard extends Customer {
  lastWhen:         string | null;
  lastWhenRel:      string;
  lastTone:         CustomerLastTone;
  balanceCents:     number;
  balanceSub:       string;
  activeJobs:       number;
  jobsSub:          string;
  status:           CustomerStatus;
  temp:             number;
  daysSinceContact: number;
  revenue12moCents: number;
}

export function parseCreateCustomer(input: unknown): CreateCustomerDto {
  const dto = plainToInstance(CreateCustomerDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid customer: ${JSON.stringify(errors)}`);
  return dto;
}

export function parseUpdateCustomer(input: unknown): UpdateCustomerDto {
  const dto = plainToInstance(UpdateCustomerDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid customer patch: ${JSON.stringify(errors)}`);
  return dto;
}
