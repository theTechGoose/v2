import type { BalanceSubParts } from "#quote-flow/balance-sub.ts";
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

/**
 * REQ-367 (demo-loop cycle 1, m10): the card's jobs line as a kind — the client
 * words it (`clientsDisplay.jobsSub.<kind>`) in the language live on screen.
 */
export type CustomerJobsSub = "overdue" | "active" | "scheduled" | "none";
/** REQ-271: "new" — nothing on the books yet (no quote, no paid invoice); was mislabelled "regular". */
export type CustomerStatus = "active" | "lead" | "owes" | "regular" | "cold" | "new";
export type CustomerLastTone = "hot" | "warm" | "cold";

/** REQ-323 — the lifecycle states `quoteState` / `invoiceState` (shared/documents/versions.ts) name. */
export type CustomerDocState =
  | "draft"
  | "scheduled"
  | "sent"
  | "accepted"
  | "declined"
  | "revised"
  | "claimed"
  | "paid"
  | "void"
  | "approved"
  | "pending";

/**
 * REQ-323 (demo-loop cycle 1, m20): one of the customer's documents, as the
 * card back lists it — its number ("Q-001" / "INV-5000"), state, amount and the
 * page that opens it (`/quotes?open=<id>` for a quote, `/i/<id>` for an invoice).
 */
export interface CustomerDocument {
  kind: "quote" | "invoice";
  id: string;
  number: string;
  state: CustomerDocState;
  amountCents: number;
  url: string;
  updatedAt: string;
}

/**
 * Enriched customer row for the /clients page. Extends `Customer` with derived
 * rollups computed by `BuildCustomerCards`. Never persisted — pure projection.
 */
export interface CustomerCard extends Customer {
  /** REQ-367: the last activity's timestamp — the client words "how long ago" in the live language */
  lastWhen: string | null;
  lastTone: CustomerLastTone;
  balanceCents: number;
  /** The balance sub-line in English — the neutral base (REQ-204/350). */
  balanceSub: string;
  /** REQ-350 + REQ-367: the same line as data; the client words it in the
   *  live language (shared/quote-flow/balance-sub.ts balanceSubLabel). */
  balanceSubParts?: BalanceSubParts;
  activeJobs: number;
  jobsSub: CustomerJobsSub;
  status: CustomerStatus;
  temp: number;
  daysSinceContact: number;
  revenue12moCents: number;
  /** REQ-323 — every quote and invoice of the customer, newest first. */
  documents: CustomerDocument[];
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
