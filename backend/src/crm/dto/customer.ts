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
import { addressPartError, stateCode } from "#customer-address/rules.ts"; // REQ-992

/**
 * REQ-715 (demo-loop cycle 5, m31 + c2-M29 + c3-m43 + c4-M34): the language
 * the customer reads. Every customer-facing send resolves to it when no
 * language is picked for that send (shared/quote-flow/comms-language.ts).
 * On edit, "" clears it.
 */
export type CustomerLanguage = "en" | "es";
export const CUSTOMER_LANGUAGES: CustomerLanguage[] = ["en", "es"];

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

  /** REQ-625: the address in parts; the store composes `address` from them. */
  @IsOptional()
  @IsString()
  street?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  zip?: string;

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

  /** REQ-715: the language they read; "" (the form's "Not set") is dropped. */
  @IsOptional()
  @IsIn([...CUSTOMER_LANGUAGES, ""])
  language?: CustomerLanguage;
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

  /** REQ-625: the address in parts; the store composes `address` from them. */
  @IsOptional()
  @IsString()
  street?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  zip?: string;

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

  /** REQ-715: change the language they read; "" clears it. */
  @IsOptional()
  @IsIn([...CUSTOMER_LANGUAGES, ""])
  language?: CustomerLanguage | "";
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
  /** REQ-1139: a headline-only word (DocState "partly"); a card never stores it */
  | "partly"
  | "void"
  | "approved"
  | "pending";

/**
 * REQ-323 (demo-loop cycle 1, m20): one of the customer's documents, as the
 * card back lists it — its number ("Q-001" / "INV-5000"), state, amount and the
 * page that opens it (`/quotes?open=<id>` for a quote, `/i/<id>` for an invoice,
 * REQ-565: `/co/<id>` for a change order).
 */
export interface CustomerDocument {
  /** REQ-565 (demo m33): change orders are the customer's documents too */
  kind: "quote" | "invoice" | "change_order";
  id: string;
  number: string;
  state: CustomerDocState;
  /** a quote: the agreed total (the quote plus its approved change orders);
   *  a change order: its signed delta; an invoice: its amount */
  amountCents: number;
  /** REQ-565: a quote's approved change orders, summed — only when non-zero */
  changeOrdersCents?: number;
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
  /** REQ-924: the part of the balance past due (the sidebar's "$X overdue") */
  overdueCents: number;
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

/**
 * REQ-992 (LOOP-007 q1-74): the address parts are checked before the store
 * composes `address` — a USPS state (code or full name) and a US ZIP; blank
 * is fine. A full state name is stored as its code ("Texas" → "TX"), so the
 * composed line reads "Austin, TX 78704".
 */
function assertAddressParts(dto: { state?: string; zip?: string }): void {
  const key = addressPartError(dto);
  if (key) throw new CustomerInputError(key);
  if (typeof dto.state === "string" && dto.state.trim()) {
    dto.state = stateCode(dto.state) ?? dto.state;
  }
}

/**
 * REQ-1080 (LOOP-007 cycle 2, q2-69): REQ-352's "a customer name is required"
 * is enforced at the API too, not only in the New customer form — a name is
 * kept trimmed, and a blank or whitespace-only one is refused with the form's
 * own key. `required` is false for an edit, where an absent name is "unchanged".
 * businessName is trimmed the same way.
 */
function assertName(
  dto: { name?: string; businessName?: string },
  required: boolean,
): void {
  if (typeof dto.name === "string") dto.name = dto.name.trim();
  if ((required || dto.name !== undefined) && !dto.name) {
    throw new CustomerInputError("customer.nameRequired");
  }
  if (typeof dto.businessName === "string") {
    dto.businessName = dto.businessName.trim();
  }
}

export function parseCreateCustomer(input: unknown): CreateCustomerDto {
  const dto = plainToInstance(CreateCustomerDto, input);
  const errors = validateSync(dto);
  if (errors.length) {
    throw new CustomerInputError(`invalid customer: ${JSON.stringify(errors)}`);
  }
  assertName(dto, true); // REQ-1080
  assertContact(dto);
  assertAddressParts(dto);
  // REQ-715: "Not set" is no language at all, never a stored ""
  if ((dto.language as string | undefined) === "") delete dto.language;
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
  assertName(dto, false); // REQ-1080
  assertContact(dto);
  assertAddressParts(dto);
  return dto;
}
