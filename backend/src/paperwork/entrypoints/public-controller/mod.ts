import { Body, Context, Controller, Get, Param, Post } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { IsOptional, IsString, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { ContractStore } from "@paperwork/domain/data/contract-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { BusinessAddressStore } from "@profile/domain/data/business-address-store/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { NotFoundError } from "@core/data/repository/mod.ts";
import { SendSignedConfirmation } from "@paperwork/domain/coordinators/send-signed-confirmation/mod.ts";
import { ShortLinkStore } from "@paperwork/domain/data/shortlink-store/mod.ts";
import type { Quote } from "@paperwork/dto/quote.ts";
import type { Contract } from "@paperwork/dto/contract.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";

/**
 * Map a NotFoundError into a 404 JSON response. Public endpoints used to
 * bubble these as 500s, which the FE rendered as "(500)" on customer-
 * facing pages — see audit P0.5.
 */
function notFoundResponse(ctx: ExecutionContext, e: unknown) {
  if (e instanceof NotFoundError) {
    return ctx.json({ error: "not_found", resource: e.resource }, 404);
  }
  throw e;
}

class AcceptQuoteDto {
  @IsOptional() @IsString() signature?: string;
  @IsOptional() @IsString() name?: string;
}

class DeclineQuoteDto {
  @IsOptional() @IsString() reason?: string;   // chip — "price" | "timing" | "going_elsewhere" | "other"
  @IsOptional() @IsString() note?: string;     // free-text explanation
  @IsOptional() @IsString() name?: string;     // who clicked decline
}

class InquireQuoteDto {
  @IsString() question!: string;               // the customer's actual question
  @IsOptional() @IsString() contactBack?: string; // phone or email — how the contractor should follow up
  @IsOptional() @IsString() name?: string;
}

class SignContractDto {
  @IsString() signature!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() tin?: string;
}

function parseAccept(input: unknown): AcceptQuoteDto {
  const dto = plainToInstance(AcceptQuoteDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid accept body: ${JSON.stringify(errors)}`);
  return dto;
}

function parseDecline(input: unknown): DeclineQuoteDto {
  const dto = plainToInstance(DeclineQuoteDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid decline body: ${JSON.stringify(errors)}`);
  return dto;
}

function parseInquire(input: unknown): InquireQuoteDto {
  const dto = plainToInstance(InquireQuoteDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid inquiry body: ${JSON.stringify(errors)}`);
  return dto;
}

function parseSign(input: unknown): SignContractDto {
  const dto = plainToInstance(SignContractDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid sign body: ${JSON.stringify(errors)}`);
  return dto;
}

/**
 * Public-facing paperwork endpoints.
 *
 * These are reached by the customer (the recipient of the contractor's
 * quote/contract/invoice email) and are NOT auth-gated. Authorization is
 * implicit: knowing the unguessable record id is the capability.
 *
 * Each public read returns a "redacted" projection — fields that are safe
 * to show a customer. Internal flags + the contractor's userId never leak
 * out (the projection drops them explicitly).
 *
 * Mutations (accept, sign) annotate the record so the contractor can see
 * progress on their dashboard. They never expose the contractor's data
 * back; on success they return only `{ ok: true }`.
 */
@Controller()
export class PaperworkPublicController {
  constructor(
    private quotes:    QuoteStore,
    private contracts: ContractStore,
    private invoices:  InvoiceStore,
    private customers: CustomerStore,
    private users:     UserStore,
    private identity:  BusinessIdentityStore,
    private addresses: BusinessAddressStore,
    private bus:       EventBus,
    private signedConfirmation: SendSignedConfirmation,
    private shortlinks: ShortLinkStore,
  ) {}

  /**
   * GET /s/:code — resolve a shortlink code to its kind + id so the
   * front-end can issue a 302 to the canonical public surface.
   * Returns 404 when the code is unknown.
   */
  @Get("s/:code")
  async resolveShortlink(@Context() ctx: ExecutionContext, @Param("code") code: string) {
    try {
      const link = await this.shortlinks.get(code);
      return ctx.json({ kind: link.kind, id: link.id });
    } catch (e) { return notFoundResponse(ctx, e); }
  }

  // ---------- quotes ----------

  @Get("quotes/:id/public")
  async getQuotePublic(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    try {
      const q = await this.quotes.get(id);             // no ownership gate — knowledge of id is the capability
      const [contractor, customer] = await Promise.all([
        loadContractor(this.users, this.identity, this.addresses, q.userId),
        lookupCustomerName(this.customers, q.customerId, q.userId),
      ]);
      return ctx.json({
        ...redactQuote(q),
        contractor,
        customer: customer ? { name: customer } : undefined,
      });
    } catch (e) { return notFoundResponse(ctx, e); }
  }

  @Post("quotes/:id/accept")
  async acceptQuote(@Context() ctx: ExecutionContext, @Param("id") id: string, @Body() body: unknown) {
    const dto = parseAccept(body);
    const existing = await this.quotes.get(id);
    if (existing.status === "accepted") return ctx.json({ ok: true, alreadyAccepted: true });
    const updated = await this.quotes.update(id, existing.userId, {
      status: "accepted",
      // The accept action augments the quote with signature metadata if provided.
      // Stored on the quote itself so the contractor can see who accepted.
      ...(dto.signature ? { acceptedSignature: dto.signature } : {}),
      ...(dto.name      ? { acceptedName:      dto.name }      : {}),
      acceptedAt: new Date().toISOString(),
    });

    const customerName = await lookupCustomerName(this.customers, updated.customerId, existing.userId);
    await this.bus.emit({
      userId: existing.userId,
      entityType: "quote",
      entityId: updated.id,
      action: "accepted",
      data: { ...(customerName ? { customerName } : {}) },
    });
    return ctx.json({ ok: true, quoteId: updated.id });
  }

  /** Customer declines a quote (audit P5.1).
   *
   *  Reason is one of the chip values; note is freetext. Sets the quote's
   *  terminal status to 'lost' (matches the QuoteStage union — there's no
   *  separate 'declined' state on the read side) and records who declined +
   *  why on the row, so the contractor can read it from /quotes. */
  @Post("quotes/:id/decline")
  async declineQuote(@Context() ctx: ExecutionContext, @Param("id") id: string, @Body() body: unknown) {
    const dto = parseDecline(body);
    const existing = await this.quotes.get(id);
    if (existing.status === "accepted") {
      // Already accepted — don't let a stale link revoke it.
      return ctx.json({ ok: false, reason: "already_accepted" }, 409);
    }
    if (existing.status === "lost") {
      return ctx.json({ ok: true, alreadyDeclined: true });
    }
    const updated = await this.quotes.update(id, existing.userId, {
      status: "lost",
      lostAt: new Date().toISOString(),
      // Store reason/note loosely on the row — the DTO doesn't expose them
      // yet, but the FE will display whatever is there. Mirrors the pattern
      // for customerSignature on contracts.
      ...(dto.reason ? { declineReason: dto.reason } as Partial<Quote> : {}),
      ...(dto.note   ? { declineNote:   dto.note }   as Partial<Quote> : {}),
      ...(dto.name   ? { declinedName:  dto.name }   as Partial<Quote> : {}),
    } as Partial<Quote>);

    const customerName = await lookupCustomerName(this.customers, updated.customerId, existing.userId);
    await this.bus.emit({
      userId: existing.userId,
      entityType: "quote",
      entityId: updated.id,
      action: "declined",
      data: { ...(customerName ? { customerName } : {}), reason: dto.reason, note: dto.note },
    });
    return ctx.json({ ok: true, quoteId: updated.id });
  }

  /** Customer asks a question on a quote (audit P5.1).
   *
   *  This is a one-shot inbound message — the customer doesn't have a chat
   *  thread of their own, so it lands as a notification on the contractor's
   *  bell + activity feed. No quote-status change. */
  @Post("quotes/:id/inquiry")
  async inquireQuote(@Context() ctx: ExecutionContext, @Param("id") id: string, @Body() body: unknown) {
    const dto = parseInquire(body);
    const existing = await this.quotes.get(id);
    const customerName = await lookupCustomerName(this.customers, existing.customerId, existing.userId);
    await this.bus.emit({
      userId: existing.userId,
      // Emit as a quote-scoped event so the topbar bell can link back to the
      // quote. The notification type ("customer_replied") is decided by the
      // mapper based on the action verb.
      entityType: "quote",
      entityId: existing.id,
      action: "inquiry",
      data: {
        ...(customerName ? { customerName } : {}),
        question:    dto.question,
        ...(dto.contactBack ? { contactBack: dto.contactBack } : {}),
        ...(dto.name        ? { askName:     dto.name }        : {}),
        quoteId:     existing.id,
      },
    });
    return ctx.json({ ok: true });
  }

  // ---------- contracts ----------

  @Get("contracts/:id/public")
  async getContractPublic(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    try {
      const c = await this.contracts.get(id);
      const [contractor, customer, quote] = await Promise.all([
        loadContractor(this.users, this.identity, this.addresses, c.userId),
        lookupCustomerName(this.customers, c.customerId, c.userId),
        // Public contract page surfaces the linked quote's job details so the
        // customer sees what they're agreeing to before signing. The
        // quote read is best-effort; a missing/forbidden quote shouldn't
        // 404 the contract.
        c.quoteId ? this.quotes.get(c.quoteId).catch(() => undefined) : Promise.resolve(undefined),
      ]);
      const jobDetails = quote
        ? { summary: quote.summary, description: quote.description, lineItems: quote.lineItems }
        : undefined;
      return ctx.json({
        ...redactContract(c),
        contractor,
        customer: customer ? { name: customer } : undefined,
        jobDetails,
        terms: c.terms ?? [],
      });
    } catch (e) { return notFoundResponse(ctx, e); }
  }

  @Get("contracts/by-quote/:quoteId/public")
  async getContractByQuote(@Context() ctx: ExecutionContext, @Param("quoteId") quoteId: string) {
    try {
      // Cheap scan: the quote's owner is known via quotes.get; we then
      // search that user's contracts for one with matching quoteId.
      const quote = await this.quotes.get(quoteId);
      const all = await this.contracts.listByUser(quote.userId);
      const found = all.find((c) => c.quoteId === quoteId);
      return ctx.json({ contractId: found?.id ?? null });
    } catch (e) { return notFoundResponse(ctx, e); }
  }

  @Post("contracts/:id/sign")
  async signContract(@Context() ctx: ExecutionContext, @Param("id") id: string, @Body() body: unknown) {
    const dto = parseSign(body);
    const existing = await this.contracts.get(id);
    if (existing.status === "signed") return ctx.json({ ok: true, alreadySigned: true });
    const updated = await this.contracts.update(id, existing.userId, {
      status: "signed",
      signedAt: new Date().toISOString(),
      // Customer signature data; these fields aren't on the current Contract DTO
      // but will be added when contracts get full payment-terms (see backend.md §7).
      // Storing as loose fields for now via cast — the DTO will catch up.
      ...(dto.signature ? { customerSignature: dto.signature } as Partial<Contract> : {}),
      ...(dto.name      ? { customerSignedName: dto.name }     as Partial<Contract> : {}),
      ...(dto.tin       ? { customerTinMasked: maskTin(dto.tin) } as Partial<Contract> : {}),
    } as Partial<Contract>);

    const customerName = await lookupCustomerName(this.customers, updated.customerId, existing.userId);
    await this.bus.emit({
      userId: existing.userId,
      entityType: "contract",
      entityId: updated.id,
      action: "signed",
      data: { ...(customerName ? { customerName } : {}) },
    });

    // Fire the signed-confirmation flow: render PDF + create the first
    // (deposit) invoice + email the customer with the PDF attached and
    // the new invoice's pay link. Errors here MUST NOT fail the sign
    // request — the contract is signed regardless of email delivery.
    this.signedConfirmation.run(updated.id).catch((err) => {
      console.error(`[contracts/${updated.id}/sign] signed-confirmation failed:`, err);
    });

    return ctx.json({ ok: true, contractId: updated.id });
  }

  // ---------- invoices ----------

  @Get("invoices/:id/public")
  async getInvoicePublic(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    try {
      const i = await this.invoices.get(id);
      const [contractor, customer] = await Promise.all([
        loadContractor(this.users, this.identity, this.addresses, i.userId),
        lookupCustomerName(this.customers, i.customerId, i.userId),
      ]);
      return ctx.json({
        ...redactInvoice(i),
        contractor,
        customer: customer ? { name: customer } : undefined,
      });
    } catch (e) { return notFoundResponse(ctx, e); }
  }
}

interface PublicContractor {
  name?: string;
  businessName?: string;
  phoneNumber?: string;
  email?: string;
  /** Single-line address ("123 Main St, Austin, TX 78701") composed from
   *  the BusinessAddress record. Omitted when the contractor hasn't filled
   *  in any street/city fields. Surfaces under the eyebrow on public docs. */
  addressLine?: string;
  /** 2-letter state code (e.g. "CA"). Drives the public contract's
   *  "Governing law" + "State notices" copy. */
  state?: string;
}

/** Public-safe contractor projection — never returns internal IDs or
 *  private profile fields (insurance/tax/etc.). */
async function loadContractor(
  users: UserStore,
  identity: BusinessIdentityStore,
  addresses: BusinessAddressStore,
  ownerId: string,
): Promise<PublicContractor | undefined> {
  try {
    const [user, ident, addr] = await Promise.all([
      users.get(ownerId).catch(() => undefined),
      identity.get(ownerId).catch(() => null),
      addresses.get(ownerId).catch(() => null),
    ]);
    if (!user && !ident && !addr) return undefined;
    return {
      name:         user?.name,
      businessName: ident?.businessName ?? ident?.legalName,
      phoneNumber:  user?.phoneNumber,
      email:        user?.email,
      addressLine:  composeAddressLine(addr),
      state:        addr?.state?.trim() || undefined,
    };
  } catch {
    return undefined;
  }
}

export function composeAddressLine(
  addr: { street?: string; city?: string; state?: string; postal?: string } | null | undefined,
): string | undefined {
  if (!addr) return undefined;
  const street = addr.street?.trim();
  const city   = addr.city?.trim();
  const state  = addr.state?.trim();
  const postal = addr.postal?.trim();
  // City + ST [postal] is the canonical second half. Skip the second half
  // entirely if neither city nor state is set so we don't render a stray comma.
  const cityState = [city, [state, postal].filter(Boolean).join(" ").trim()].filter(Boolean).join(", ");
  const out = [street, cityState].filter(Boolean).join(", ");
  return out.length ? out : undefined;
}

/**
 * Redaction projections.
 *
 * Drop the owner's userId, internal status flags that aren't customer-relevant,
 * timestamps that customers don't care about. This is the place to add new
 * "safe-for-customer" fields when the DTOs grow.
 */
function redactQuote(q: Quote) {
  return {
    id:             q.id,
    summary:        q.summary,
    description:    q.description,
    customerId:     q.customerId,
    lineItems:      q.lineItems,
    estimatedTotal: q.estimatedTotal,
    status:         q.status,
    createdAt:      q.createdAt,
    // omit: userId, updatedAt, internal acceptedSignature/acceptedName
  };
}

function redactContract(c: Contract) {
  return {
    id:                       c.id,
    quoteId:                  c.quoteId,
    customerId:               c.customerId,
    status:                   c.status,
    effectiveDate:            c.effectiveDate,
    startDate:                c.startDate,
    estimatedCompletionDate:  c.estimatedCompletionDate,
    totalAmount:              c.totalAmount,
    signedAt:                 c.signedAt,
    createdAt:                c.createdAt,
    terms:                    c.terms,
    // The typed legal name is safe to surface so the public page can fill
    // the customer-signature card after signing; the captured PNG and TIN
    // stay omitted.
    customerSignedName:       (c as { customerSignedName?: string }).customerSignedName,
    // omit: userId, updatedAt, customer signature PNG, customerTinMasked
  };
}

function redactInvoice(i: Invoice) {
  return {
    id:          i.id,
    contractId:  i.contractId,
    customerId:  i.customerId,
    amount:      i.amount,
    issuedDate:  i.issuedDate,
    dueDate:     i.dueDate,
    status:      i.status,
    paidAt:      i.paidAt,
    createdAt:   i.createdAt,
    // omit: userId, updatedAt
  };
}

/** Best-effort customer name lookup for notification copy. */
async function lookupCustomerName(
  customers: CustomerStore,
  customerId: string | undefined,
  ownerId: string,
): Promise<string | undefined> {
  if (!customerId) return undefined;
  try {
    const c = await customers.getOwned(customerId, ownerId);
    return c.name;
  } catch {
    return undefined;
  }
}

/** Mask TIN to last-4 (e.g. "123-45-6789" → "***-**-6789"). */
function maskTin(tin: string): string {
  const digits = tin.replace(/\D/g, "");
  if (digits.length < 4) return "***-**-****";
  return `***-**-${digits.slice(-4)}`;
}
