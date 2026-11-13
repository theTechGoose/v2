import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
  validateSync,
} from "#class-validator";
import { plainToInstance, Type } from "#class-transformer";
import {
  REMINDER_DAY_CHOICES,
  type ReminderDay,
} from "#quote-flow/reminder-settings.ts";

/** A single payment-method handle the contractor is willing to receive
 *  funds on. Each method has a free-text handle the public invoice page
 *  surfaces verbatim ("Send to @hans-hansen"). ACH is the exception — its
 *  routing/account fields are masked on the public projection and only
 *  visible to authenticated requests. */
export class CheckMethod {
  @IsBoolean()
  enabled!: boolean;
  /** "1234 Main St, Austin, TX 78701" — full mailing line. */
  @IsOptional() @IsString()
  mailTo?: string;
}
export class VenmoMethod {
  @IsBoolean()
  enabled!: boolean;
  /** "@hans-hansen". Stored with leading @ for display. */
  @IsOptional() @IsString()
  handle?: string;
}
export class ZelleMethod {
  @IsBoolean()
  enabled!: boolean;
  /** Email or phone — whatever the contractor's Zelle is registered to. */
  @IsOptional() @IsString()
  handle?: string;
}
export class CashAppMethod {
  @IsBoolean()
  enabled!: boolean;
  /** "$hansgenco". Stored with leading $. */
  @IsOptional() @IsString()
  cashtag?: string;
}
export class PaypalMethod {
  @IsBoolean()
  enabled!: boolean;
  /** PayPal.Me handle or the email the PayPal account is registered to. */
  @IsOptional() @IsString()
  handle?: string;
}
export class CashMethod {
  @IsBoolean()
  enabled!: boolean;
}
export class AchMethod {
  @IsBoolean()
  enabled!: boolean;
  /** Public projection masks these — never surface raw on /invoices/:id/public. */
  @IsOptional() @IsString()
  routingNumber?: string;
  @IsOptional() @IsString()
  accountNumberMasked?: string;
  /** Contractor-authored direct-deposit instructions the customer SHOULD see
   *  ("Email me for routing + account", "Bank of America, Acct ••••1234").
   *  Surfaced verbatim on the public page — the masked routing/account fields
   *  above are still stripped, so the contractor controls what goes public. */
  @IsOptional() @IsString()
  instructions?: string;
}
export class CardMethod {
  @IsBoolean()
  enabled!: boolean;
  /** Free-text card instructions ("I'll text a secure payment link",
   *  "Call me with your card number"). Payments stay manual — there is no
   *  processor; this just tells the customer how to hand over the card. */
  @IsOptional() @IsString()
  instructions?: string;
}
export class OtherMethod {
  @IsBoolean()
  enabled!: boolean;
  /** Free-text instructions ("Call me to arrange payment"). */
  @IsOptional() @IsString()
  instructions?: string;
}

/** REQ-630 — an "other payment link" the business adds by name + URL (any platform: "Extra
 *  Pay", Square, a bank portal). Shown as a button on the invoice. The URL is https only —
 *  checked on save (`checkPayLinks`, shared/payments/pay-links.ts) and again on projection. */
export class PayLinkMethod {
  /** stable id, minted on save when absent */
  @IsOptional() @IsString()
  id?: string;
  /** the button label, ≤ 40 chars */
  @IsString()
  name!: string;
  /** https only */
  @IsString()
  url!: string;
  /** unset = on */
  @IsOptional() @IsBoolean()
  enabled?: boolean;
}

export class AcceptedPaymentMethods {
  @IsOptional() @ValidateNested() @Type(() => CheckMethod)
  check?: CheckMethod;
  @IsOptional() @ValidateNested() @Type(() => VenmoMethod)
  venmo?: VenmoMethod;
  @IsOptional() @ValidateNested() @Type(() => ZelleMethod)
  zelle?: ZelleMethod;
  @IsOptional() @ValidateNested() @Type(() => CashAppMethod)
  cashapp?: CashAppMethod;
  @IsOptional() @ValidateNested() @Type(() => PaypalMethod)
  paypal?: PaypalMethod;
  @IsOptional() @ValidateNested() @Type(() => CashMethod)
  cash?: CashMethod;
  @IsOptional() @ValidateNested() @Type(() => AchMethod)
  ach?: AchMethod;
  @IsOptional() @ValidateNested() @Type(() => CardMethod)
  card?: CardMethod;
  @IsOptional() @ValidateNested() @Type(() => OtherMethod)
  other?: OtherMethod;
  /** REQ-630 — the business's other payment links, in display order. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PayLinkMethod)
  links?: PayLinkMethod[];
}

/** REQ-623 (demo cycle 4, M26): the business's automatic payment reminders —
 *  on/off for every invoice, and which steps run (days from the due date: -3, 0, 3, 7, 14, 30 — REQ-704). Unset → on,
 *  day 3/7/14/30 (`reminderSettingsOf`, shared/quote-flow/reminder-settings.ts). */
export class ReminderSettingsDto {
  @IsBoolean()
  enabled!: boolean;
  @IsArray()
  @ArrayNotEmpty()
  @IsIn([...REMINDER_DAY_CHOICES], { each: true })
  days!: ReminderDay[];
}

export interface BusinessIdentity {
  userId: string;
  businessName?: string;
  /** REQ-038 (NW-06b): the business website (with scheme), when provided. */
  websiteUrl?: string;
  legalName?: string;
  businessLicense?: string;
  logoFileId?: string;
  /** Lowercase-kebab slug used as the From-localpart for outbound email:
   *  `<emailAlias>@documonster.com` (REQ-123). Generated from businessName on
   *  first save; persisted to keep the alias stable across edits. */
  emailAlias?: string;
  /** Per-method config that drives the public invoice page's "How would
   *  you like to pay?" buttons. Unset → no methods surface and the
   *  customer sees a "Reach out to coordinate payment" fallback. */
  acceptedPaymentMethods?: AcceptedPaymentMethods;
  /** Language the contractor's CUSTOMERS receive outbound comms in —
   *  quote/invoice SMS + email, public docs, PDF (roadmap p.13). Distinct
   *  from the contractor's own UI language (user.language). Unset → "en".
   *  Kept as a free string so we can broaden the set later. */
  commsLanguage?: string;
  /** The set of languages the contractor can SEND paperwork in — surfaces
   *  as the "Send in" buttons on the quote-review screen and is configured
   *  via checkboxes in Settings. `commsLanguage` above stays the default
   *  (first enabled) so every existing read keeps working. Unset → derive
   *  from `commsLanguage` (or ["en"]). */
  commsLanguages?: string[];
  /** REQ-174: the default days a customer has to pay an invoice, from the day it is sent (subscriptions can override). */
  invoiceNetDays?: number;
  /** REQ-172: the business's IANA time zone — the 9 am schedule texts follow it (default America/New_York) */
  timezone?: string;
  /** REQ-623: automatic payment reminders — see ReminderSettingsDto */
  reminders?: { enabled: boolean; days: ReminderDay[] };
  createdAt: string;
  updatedAt: string;
}

export class UpdateBusinessIdentityDto {
  /** REQ-038 (NW-06b): the business website — surfaces on every From block. */
  @IsOptional() @IsString()
  websiteUrl?: string;
  @IsOptional()
  @IsString()
  businessName?: string;

  @IsOptional()
  @IsString()
  legalName?: string;

  @IsOptional()
  @IsString()
  businessLicense?: string;

  @IsOptional()
  @IsString()
  logoFileId?: string;

  @IsOptional()
  @IsString()
  emailAlias?: string;

  @IsOptional()
  @IsString()
  commsLanguage?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  commsLanguages?: string[];

  /** REQ-174 */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  invoiceNetDays?: number;
  /** REQ-172: an IANA zone (validated by the route) */
  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AcceptedPaymentMethods)
  acceptedPaymentMethods?: AcceptedPaymentMethods;

  /** REQ-623 (demo cycle 4, M26) */
  @IsOptional()
  @ValidateNested()
  @Type(() => ReminderSettingsDto)
  reminders?: ReminderSettingsDto;
}

/** A PUT body the DTO refuses is the caller's mistake — a 400, not a 500 (REQ-623). */
class InvalidBusinessIdentity extends Error {
  readonly status = 400;
}

export function parseUpdateBusinessIdentity(
  input: unknown,
): UpdateBusinessIdentityDto {
  const dto = plainToInstance(UpdateBusinessIdentityDto, input);
  const errors = validateSync(dto);
  if (errors.length) {
    throw new InvalidBusinessIdentity(
      `invalid business identity: ${JSON.stringify(errors)}`,
    );
  }
  return dto;
}
