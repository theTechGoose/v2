import { Body, Context, Controller, Get, Param, Post } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { IsOptional, IsString, validateSync } from "#class-validator";
import { plainToInstance } from "#class-transformer";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { ContractStore } from "@paperwork/domain/data/contract-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import type { Quote } from "@paperwork/dto/quote.ts";
import type { Contract } from "@paperwork/dto/contract.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";

class AcceptQuoteDto {
  @IsOptional() @IsString() signature?: string;
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
    private bus:       EventBus,
  ) {}

  // ---------- quotes ----------

  @Get("quotes/:id/public")
  async getQuotePublic(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const q = await this.quotes.get(id);             // no ownership gate — knowledge of id is the capability
    return ctx.json(redactQuote(q));
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

  // ---------- contracts ----------

  @Get("contracts/:id/public")
  async getContractPublic(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const c = await this.contracts.get(id);
    return ctx.json(redactContract(c));
  }

  @Get("contracts/by-quote/:quoteId/public")
  async getContractByQuote(@Context() ctx: ExecutionContext, @Param("quoteId") quoteId: string) {
    // Cheap scan: the quote's owner is known via quotes.get; we then
    // search that user's contracts for one with matching quoteId.
    const quote = await this.quotes.get(quoteId);
    const all = await this.contracts.listByUser(quote.userId);
    const found = all.find((c) => c.quoteId === quoteId);
    return ctx.json({ contractId: found?.id ?? null });
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
    return ctx.json({ ok: true, contractId: updated.id });
  }

  // ---------- invoices ----------

  @Get("invoices/:id/public")
  async getInvoicePublic(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const i = await this.invoices.get(id);
    return ctx.json(redactInvoice(i));
  }
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
    // omit: userId, updatedAt, customer signature/TIN payload
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
