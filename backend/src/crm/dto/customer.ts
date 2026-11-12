import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  validateSync,
} from "#class-validator";
import { plainToInstance } from "#class-transformer";
import type { NumberedFields } from "@core/data/numbered-store/mod.ts";
import { customerContactError } from "#quote-flow/customer-contact.ts"; // REQ-278

export type ClientSegment = "property_mgmt" | "homeowner" | "small_biz" | "hoa";
export const CLIENT_SEGMENTS: ClientSegment[] = [
  "property_mgmt",
  "homeowner",
  "small_biz",
  "hoa",
];

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

  @IsOptional()
  @IsString()
  businessName?: string;
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

  @IsOptional()
  @IsString()
  businessName?: string;
}

export interface Customer
  extends CreateCustomerDto, Pick<NumberedFields, "number" | "seq"> {
  /** REQ-039 (NW-52): flagged, never erased — lists exclude it. */
  deletedAt?: string;
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
  lastWhen: string | null;
  lastWhenRel: string;
  lastTone: CustomerLastTone;
  balanceCents: number;
  balanceSub: string;
  activeJobs: number;
  jobsSub: string;
  status: CustomerStatus;
  temp: number;
  daysSinceContact: number;
  revenue12moCents: number;
}

/**
 * A refused customer body. Danet answers `error.status || 500`, so this is a
 * 400; REQ-278 (demo M16): a malformed contact's message is the dictionary
 * key (`customer.invalidPhone` / `customer.invalidEmail`) the client shows.
 */
export class CustomerInputError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "CustomerInputError";
  }
}

/** REQ-278: a contact is checked when the customer is SAVED, not at send. */
function assertContact(dto: { email?: string; phoneNumber?: string }): void {
  const key = customerContactError(dto);
  if (key) throw new CustomerInputError(key);
}

export function parseCreateCustomer(input: unknown): CreateCustomerDto {
  const dto = plainToInstance(CreateCustomerDto, input);
  const errors = validateSync(dto);
  if (errors.length) {
    throw new CustomerInputError(`invalid customer: ${JSON.stringify(errors)}`);
  }
  assertContact(dto);
  return dto;
}

export function parseUpdateCustomer(input: unknown): UpdateCustomerDto {
  const dto = plainToInstance(UpdateCustomerDto, input);
  const errors = validateSync(dto);
  if (errors.length) {
    throw new CustomerInputError(
      `invalid customer patch: ${JSON.stringify(errors)}`,
    );
  }
  assertContact(dto);
  return dto;
}
