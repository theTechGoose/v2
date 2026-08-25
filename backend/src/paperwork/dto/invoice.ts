import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
  validateSync,
} from "#class-validator";
import { plainToInstance, Type } from "#class-transformer";
import type { InvoiceUrgency } from "@paperwork/domain/business/invoice-urgency/mod.ts";

/** Canonical invoice lifecycle. String-typed for backward compatibility with
 *  existing rows in KV, but new code should narrow to this union. */
export type InvoiceStatus =
  | "scheduled" // Auto-created by milestones; not yet fired to customer.
  | "draft" // Contractor is editing; not sent.
  | "sent" // Delivered to customer; awaiting view/payment.
  | "viewed" // Customer opened the public link.
  | "claimed" // Customer recorded "I paid by X"; awaiting contractor confirm.
  | "paid" // Contractor confirmed receipt.
  | "void"; // Cancelled.

/** Methods the customer can pick on the public invoice page. Each option
 *  surfaces only when the contractor has a handle configured. */
export type PaymentMethod =
  | "check"
  | "venmo"
  | "zelle"
  | "cashapp"
  | "paypal"
  | "cash"
  | "ach"
  | "card"
  | "other";

/** A customer's "I paid" claim recorded from the public invoice page.
 *  Stays on the invoice until the contractor confirms receipt (which
 *  records a real Payment row and clears the intent). */
export class PaymentIntentDto {
  @IsString()
  method!: PaymentMethod;
  /** Mirror of the invoice amount at claim-time, so post-edit changes don't
   *  rewrite history. INTEGER CENTS. */
  @IsNumber()
  amount!: number;
  /** Customer-supplied reference: check #, transaction ID, "leaving cash
   *  Friday", etc. Free text, sanitized on the public endpoint. */
  @IsOptional() @IsString()
  reference?: string;
  @IsString()
  claimedAt!: string;
  /** Name the customer typed when claiming (optional — defaults to the
   *  customer's name on the invoice). */
  @IsOptional() @IsString()
  claimedBy?: string;
}

/** One row in the past-due reminder cadence history. Recorded after each
 *  step fires so the cron knows not to re-send. */
export class ReminderHistoryEntryDto {
  /** Cadence step in days past due: 3, 7, 14, or 30. */
  @IsNumber()
  day!: number;
  @IsString()
  sentAt!: string;
  /** Channels we managed to dispatch on (some may have failed). */
  @IsArray() @IsString({ each: true })
  channels!: string[];
}

export class CreateInvoiceDto {
  /** The accepted quote (the agreement) this invoice bills against. Optional
   *  — standalone invoices (one-off bills with no quote behind them) are
   *  created straight from the receivables dashboard and carry only a
   *  customer. When set, jobName / description / customer / line items /
   *  amount default from the quote so the invoice carries all the quote's
   *  information without re-entry (roadmap p.6). */
  @IsOptional() @IsString()
  quoteId?: string;

  /** Itemized bill lines, mirroring the quote's line items (integer-cents
   *  price per unit). Populated by the quote derivation or sent directly. */
  @IsOptional() @IsArray()
  lineItems?: Array<{
    description: string;
    quantity: number;
    unit: string;
    price: number;
  }>;

  /** ≤3-word job title for STANDALONE invoices (roadmap p.10) — quote-
   *  linked invoices resolve theirs from the quote instead. */
  @IsOptional() @IsString()
  jobName?: string;
  /** What the bill covers, one line per item — rendered on the public
   *  invoice when no quote supplies job details. */
  @IsOptional() @IsString()
  description?: string;

  /** Defaults to +30 days at create when omitted (quote-derived invoices
   *  usually don't specify one). */
  @IsOptional() @IsString()
  dueDate?: string;

  @IsOptional() @IsString()
  customerId?: string;
  /** Invoice amount in INTEGER CENTS. Audit1 #3. */
  @IsOptional() @IsNumber()
  amount?: number;
  /** Cumulative discount applied, INTEGER CENTS — shown as a line on the
   *  public invoice (roadmap p.12). `amount` is the net total due. */
  @IsOptional() @IsNumber()
  discountCents?: number;
  @IsOptional() @IsString()
  discountReason?: string;
  @IsOptional() @IsString()
  issuedDate?: string;
  @IsOptional() @IsString()
  status?: string;
  @IsOptional() @IsString()
  paidAt?: string;

  /** Scheduled-fire date for status=scheduled rows. The contractor nudge
   *  cron uses this to decide when to ping. ISO yyyy-mm-dd. */
  @IsOptional() @IsString()
  scheduledFor?: string;
  /** Milestone position for "Invoice X of Y" framing on the public page. */
  @IsOptional() @IsNumber()
  installmentIndex?: number;
  @IsOptional() @IsNumber()
  installmentTotal?: number;
  /** Per-invoice mute for the overdue-reminder cadence. */
  @IsOptional() @IsBoolean()
  remindersMuted?: boolean;
  /** Cadence history rows (Day 3 / 7 / 14 / 30). */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReminderHistoryEntryDto)
  reminderHistory?: ReminderHistoryEntryDto[];
  /** Customer's "I paid" claim awaiting contractor confirmation. Cleared
   *  on confirm (which writes a Payment row) or on "didn't get it." */
  @IsOptional() @ValidateNested() @Type(() => PaymentIntentDto)
  paymentIntent?: PaymentIntentDto;
}

export class UpdateInvoiceDto {
  @IsOptional() @IsString()
  quoteId?: string;
  @IsOptional() @IsArray()
  lineItems?: Array<{
    description: string;
    quantity: number;
    unit: string;
    price: number;
  }>;
  @IsOptional() @IsString()
  jobName?: string;
  @IsOptional() @IsString()
  description?: string;
  @IsOptional() @IsString()
  customerId?: string;
  /** Invoice amount in INTEGER CENTS. Audit1 #3. */
  @IsOptional() @IsNumber()
  amount?: number;
  @IsOptional() @IsNumber()
  discountCents?: number;
  @IsOptional() @IsString()
  discountReason?: string;
  @IsOptional() @IsString()
  issuedDate?: string;
  @IsOptional() @IsString()
  dueDate?: string;
  @IsOptional() @IsString()
  status?: string;
  @IsOptional() @IsString()
  paidAt?: string;

  @IsOptional() @IsString()
  scheduledFor?: string;
  @IsOptional() @IsNumber()
  installmentIndex?: number;
  @IsOptional() @IsNumber()
  installmentTotal?: number;
  @IsOptional() @IsBoolean()
  remindersMuted?: boolean;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReminderHistoryEntryDto)
  reminderHistory?: ReminderHistoryEntryDto[];
  // `null` is an explicit "clear the claim" signal (used by reject-claim);
  // `undefined` means "leave it untouched" (the store filters undefined out).
  @IsOptional() @ValidateNested() @Type(() => PaymentIntentDto)
  paymentIntent?: PaymentIntentDto | null;
}

export interface Invoice extends CreateInvoiceDto {
  id: string;
  /** Owner. Populated server-side from the auth context — never accept from request body. */
  userId: string;
  /** Optional on the request (quote-derived creates omit it) but ALWAYS
   *  present on stored rows — create() defaults it to +30 days. */
  dueDate: string;
  createdAt: string;
  updatedAt: string;
  /** Computed read-only field: never accepted from request bodies; projected on read. */
  urgency?: InvoiceUrgency;
}

export function parseCreateInvoice(input: unknown): CreateInvoiceDto {
  const dto = plainToInstance(CreateInvoiceDto, input);
  const errors = validateSync(dto);
  if (errors.length) {
    throw new Error(`invalid invoice: ${JSON.stringify(errors)}`);
  }
  return dto;
}

export function parseUpdateInvoice(input: unknown): UpdateInvoiceDto {
  const dto = plainToInstance(UpdateInvoiceDto, input);
  const errors = validateSync(dto);
  if (errors.length) {
    throw new Error(`invalid invoice patch: ${JSON.stringify(errors)}`);
  }
  return dto;
}
