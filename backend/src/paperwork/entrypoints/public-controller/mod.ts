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
import type { Invoice, PaymentMethod } from "@paperwork/dto/invoice.ts";
import { AcceptedPaymentMethods } from "@profile/dto/business-identity.ts";

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
        lookupCustomerPublic(this.customers, c.customerId, c.userId),
        // Public contract page surfaces the linked quote's job details so the
        // customer sees what they're agreeing to before signing. The
        // quote read is best-effort; a missing/forbidden quote shouldn't
        // 404 the contract.
        c.quoteId ? this.quotes.get(c.quoteId).catch(() => undefined) : Promise.resolve(undefined),
      ]);
      const jobDetails = quote
        ? { summary: quote.summary, jobName: quote.jobName, description: quote.description, lineItems: quote.lineItems }
        : undefined;
      return ctx.json({
        ...redactContract(c),
        contractor,
        customer,
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
      const [contractor, customer, contract, siblings] = await Promise.all([
        loadContractor(this.users, this.identity, this.addresses, i.userId),
        lookupCustomerPublic(this.customers, i.customerId, i.userId),
        // The public page surfaces job context (the linked contract's
        // quote summary + jobName) so the customer sees what they're
        // paying for. Best-effort — a missing contract shouldn't 404.
        i.contractId ? this.contracts.get(i.contractId).catch(() => undefined) : Promise.resolve(undefined),
        // Sibling invoices for the same contract — used to render the
        // "Invoice X of Y" framing and the "What you've paid so far"
        // strip on the public page.
        i.contractId ? this.invoices.listByUser(i.userId).then((all) => all.filter((row) => row.contractId === i.contractId)).catch(() => []) : Promise.resolve([]),
      ]);
      // Resolve the linked quote for jobName/summary/lineItems projection.
      let jobDetails: { summary?: string; jobName?: string; description?: string } | undefined;
      if (contract?.quoteId) {
        try {
          const q = await this.quotes.get(contract.quoteId);
          jobDetails = { summary: q.summary, jobName: q.jobName, description: q.description };
        } catch { /* fall through */ }
      }
      // Project sibling invoices into a public-safe shape, sorted by
      // installmentIndex (or createdAt as fallback).
      const sortedSiblings = siblings
        .slice()
        .sort((a, b) => {
          const ai = a.installmentIndex ?? 99;
          const bi = b.installmentIndex ?? 99;
          if (ai !== bi) return ai - bi;
          return (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
        })
        .map((row) => ({
          id:               row.id,
          amount:           row.amount,
          status:           row.status,
          paidAt:           row.paidAt,
          installmentIndex: row.installmentIndex,
          installmentTotal: row.installmentTotal,
        }));
      // Method config drives the public page's "How would you like to
      // pay?" buttons. We surface only methods the contractor has
      // explicitly enabled (handles non-empty).
      const acceptedMethods = projectAcceptedMethods(contractor);
      return ctx.json({
        ...redactInvoice(i),
        contractor,
        customer,
        jobDetails,
        siblings: sortedSiblings,
        acceptedMethods,
      });
    } catch (e) { return notFoundResponse(ctx, e); }
  }

  /**
   * Customer-side "I'm paying you by X" claim.
   *
   * Records a PaymentIntent on the invoice and flips status to
   * `claimed`. No auth — knowledge of the invoice id is the capability,
   * matching the rest of the public surface.
   *
   * Idempotent: replaying the same body just overwrites the existing
   * intent; we don't keep a history (the contractor confirms or rejects
   * in one step, so there's no audit need beyond that).
   */
  @Post("invoices/:id/claim-payment")
  async claimInvoicePayment(@Context() ctx: ExecutionContext, @Param("id") id: string, @Body() body: unknown) {
    const dto = parseClaim(body);
    try {
      const invoice = await this.invoices.get(id);
      if (invoice.status === "paid") {
        return ctx.json({ ok: false, reason: "already_paid" }, 409);
      }
      if (invoice.status === "void") {
        return ctx.json({ ok: false, reason: "void" }, 409);
      }
      const updated = await this.invoices.update(id, invoice.userId, {
        status: "claimed",
        paymentIntent: {
          method: dto.method as PaymentMethod,
          amount: invoice.amount ?? 0,
          ...(dto.reference ? { reference: dto.reference } : {}),
          claimedAt: new Date().toISOString(),
          ...(dto.claimedBy ? { claimedBy: dto.claimedBy } : {}),
        },
      });
      // Fire a domain event so the contractor's bell + activity feed
      // surface the claim.
      await this.bus.emit({
        userId: invoice.userId,
        entityType: "invoice",
        entityId: updated.id,
        action: "claimed",
        data: { method: dto.method, reference: dto.reference ?? "" },
      });
      return ctx.json({ ok: true, invoiceId: updated.id });
    } catch (e) { return notFoundResponse(ctx, e); }
  }
}

/** Validation DTO for the public claim endpoint. */
class ClaimPaymentDto {
  @IsString() method!: string;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() claimedBy?: string;
}

function parseClaim(input: unknown): ClaimPaymentDto {
  const dto = plainToInstance(ClaimPaymentDto, input);
  const errors = validateSync(dto);
  if (errors.length) throw new Error(`invalid claim body: ${JSON.stringify(errors)}`);
  const allowed = new Set(["check", "venmo", "zelle", "cashapp", "cash", "ach", "other"]);
  if (!allowed.has(dto.method)) throw new Error(`invalid method: ${dto.method}`);
  return dto;
}

/** Project the contractor's accepted-payment methods (set in their
 *  business-identity settings) into the shape the public page consumes:
 *  one row per enabled method with the handle/address to display.
 *
 *  We never expose ACH routing/account numbers in clear text — the
 *  public page renders a "Ask the contractor for ACH details" stub for
 *  ACH instead, with the real numbers only surfaced via a separate
 *  authenticated request flow (out of v1 scope). */
function projectAcceptedMethods(contractor: { acceptedPaymentMethods?: AcceptedPaymentMethods } | undefined): Array<{ method: string; handle?: string }> {
  const m = contractor?.acceptedPaymentMethods;
  if (!m) return [];
  const out: Array<{ method: string; handle?: string }> = [];
  if (m.check?.enabled) out.push({ method: "check", handle: m.check.mailTo });
  if (m.venmo?.enabled) out.push({ method: "venmo", handle: m.venmo.handle });
  if (m.zelle?.enabled) out.push({ method: "zelle", handle: m.zelle.handle });
  if (m.cashapp?.enabled) out.push({ method: "cashapp", handle: m.cashapp.cashtag });
  if (m.cash?.enabled) out.push({ method: "cash" });
  if (m.ach?.enabled) out.push({ method: "ach" });
  if (m.other?.enabled) out.push({ method: "other", handle: m.other.instructions });
  return out;
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
  /** Per-method payment config from business-identity. Used by the
   *  invoice public page to render the "How would you like to pay?"
   *  buttons. ACH routing/account numbers are stripped here — only the
   *  enabled flag survives onto the public surface. */
  acceptedPaymentMethods?: AcceptedPaymentMethods;
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
      name:                   user?.name,
      businessName:           ident?.businessName ?? ident?.legalName,
      phoneNumber:            user?.phoneNumber,
      email:                  user?.email,
      addressLine:            composeAddressLine(addr),
      state:                  addr?.state?.trim() || undefined,
      acceptedPaymentMethods: redactAcceptedMethods(ident?.acceptedPaymentMethods),
    };
  } catch {
    return undefined;
  }
}

/** Strip ACH routing/account numbers from the public projection — the
 *  customer page should only know that ACH is *offered*, not how to
 *  reach the bank account. Other methods pass through unchanged. */
function redactAcceptedMethods(m: AcceptedPaymentMethods | undefined): AcceptedPaymentMethods | undefined {
  if (!m) return undefined;
  return {
    ...m,
    ach: m.ach
      ? { enabled: m.ach.enabled }
      : undefined,
  };
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
    id:                i.id,
    contractId:        i.contractId,
    customerId:        i.customerId,
    amount:            i.amount,
    issuedDate:        i.issuedDate,
    dueDate:           i.dueDate,
    status:            i.status,
    paidAt:            i.paidAt,
    createdAt:         i.createdAt,
    installmentIndex:  i.installmentIndex,
    installmentTotal:  i.installmentTotal,
    scheduledFor:      i.scheduledFor,
    // The paymentIntent is safe to surface so the public page can render
    // a "you said you paid by X on Y" confirmation strip after the
    // customer submits a claim.
    paymentIntent:     i.paymentIntent,
    // omit: userId, updatedAt, remindersMuted, reminderHistory (internal)
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

/** Safe-to-expose customer projection for public preview "To:" block.
 *  Returns name + phone + email; intentionally omits anything internal. */
async function lookupCustomerPublic(
  customers: CustomerStore,
  customerId: string | undefined,
  ownerId: string,
): Promise<{ name?: string; phoneNumber?: string; email?: string } | undefined> {
  if (!customerId) return undefined;
  try {
    const c = await customers.getOwned(customerId, ownerId);
    return { name: c.name, phoneNumber: c.phoneNumber, email: c.email };
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
