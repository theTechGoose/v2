import { IsBoolean, IsOptional, IsString, validateSync, ValidateNested } from "#class-validator";
import { plainToInstance, Type } from "#class-transformer";

/** A single payment-method handle the contractor is willing to receive
 *  funds on. Each method has a free-text handle the public invoice page
 *  surfaces verbatim ("Send to @hans-hansen"). ACH is the exception — its
 *  routing/account fields are masked on the public projection and only
 *  visible to authenticated requests. */
export class CheckMethod {
  @IsBoolean() enabled!: boolean;
  /** "1234 Main St, Austin, TX 78701" — full mailing line. */
  @IsOptional() @IsString() mailTo?: string;
}
export class VenmoMethod {
  @IsBoolean() enabled!: boolean;
  /** "@hans-hansen". Stored with leading @ for display. */
  @IsOptional() @IsString() handle?: string;
}
export class ZelleMethod {
  @IsBoolean() enabled!: boolean;
  /** Email or phone — whatever the contractor's Zelle is registered to. */
  @IsOptional() @IsString() handle?: string;
}
export class CashAppMethod {
  @IsBoolean() enabled!: boolean;
  /** "$hansgenco". Stored with leading $. */
  @IsOptional() @IsString() cashtag?: string;
}
export class CashMethod {
  @IsBoolean() enabled!: boolean;
}
export class AchMethod {
  @IsBoolean() enabled!: boolean;
  /** Public projection masks these — never surface raw on /invoices/:id/public. */
  @IsOptional() @IsString() routingNumber?: string;
  @IsOptional() @IsString() accountNumberMasked?: string;
}
export class OtherMethod {
  @IsBoolean() enabled!: boolean;
  /** Free-text instructions ("Call me to arrange payment"). */
  @IsOptional() @IsString() instructions?: string;
}

export class AcceptedPaymentMethods {
  @IsOptional() @ValidateNested() @Type(() => CheckMethod) check?: CheckMethod;
  @IsOptional() @ValidateNested() @Type(() => VenmoMethod) venmo?: VenmoMethod;
  @IsOptional() @ValidateNested() @Type(() => ZelleMethod) zelle?: ZelleMethod;
  @IsOptional() @ValidateNested() @Type(() => CashAppMethod) cashapp?: CashAppMethod;
  @IsOptional() @ValidateNested() @Type(() => CashMethod) cash?: CashMethod;
  @IsOptional() @ValidateNested() @Type(() => AchMethod) ach?: AchMethod;
  @IsOptional() @ValidateNested() @Type(() => OtherMethod) other?: OtherMethod;
}

export interface BusinessIdentity {
  userId: string;
  businessName?: string;
  legalName?: string;
  businessLicense?: string;
  logoFileId?: string;
  /** Lowercase-kebab slug used as the From-localpart for outbound email:
   *  `<emailAlias>@paperworkmonster.com`. Generated from businessName on
   *  first save; persisted to keep the alias stable across edits. */
  emailAlias?: string;
  /** Per-method config that drives the public invoice page's "How would
   *  you like to pay?" buttons. Unset → no methods surface and the
   *  customer sees a "Reach out to coordinate payment" fallback. */
  acceptedPaymentMethods?: AcceptedPaymentMethods;
  createdAt: string;
  updatedAt: string;
}

export class UpdateBusinessIdentityDto {
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
  @ValidateNested()
  @Type(() => AcceptedPaymentMethods)
  acceptedPaymentMethods?: AcceptedPaymentMethods;
}

export function parseUpdateBusinessIdentity(input: unknown): UpdateBusinessIdentityDto {
  const dto = plainToInstance(UpdateBusinessIdentityDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid business identity: ${JSON.stringify(errors)}`);
  return dto;
}
