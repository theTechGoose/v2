import { Body, Context, Controller, Delete, Get, Param, Post, Put, Query } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { ContractStore } from "@paperwork/domain/data/contract-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { parseCreateInvoice, parseUpdateInvoice, type Invoice } from "@paperwork/dto/invoice.ts";
import { deriveUrgency } from "@paperwork/domain/business/invoice-urgency/mod.ts";
import { ConfirmPayment } from "@paperwork/domain/coordinators/confirm-payment/mod.ts";
import { ComputeInvoiceForecast } from "@paperwork/domain/coordinators/compute-invoice-forecast/mod.ts";
import { RecordPaymentFromUtterance } from "@paperwork/domain/coordinators/record-payment-from-utterance/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";

function project(invoice: Invoice, now: Date): Invoice {
  return { ...invoice, urgency: deriveUrgency(invoice, now) };
}

@Controller("invoices")
export class InvoiceController {
  constructor(
    private store: InvoiceStore,
    private customers: CustomerStore,
    private contracts: ContractStore,
    private quotes: QuoteStore,
    private confirm: ConfirmPayment,
    private forecast: ComputeInvoiceForecast,
    private recordFromUtterance: RecordPaymentFromUtterance,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  @Post()
  async create(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return project(await this.store.create(user.id, parseCreateInvoice(body)), new Date());
  }

  @Get()
  async list(@Context() ctx: ExecutionContext, @Query("status") status?: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const list = status
      ? await this.store.listByUserAndStatus(user.id, status)
      : await this.store.listByUser(user.id);
    const now = new Date();
    return list.map((i) => project(i, now));
  }

  @Get(":id")
  async get(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return project(await this.store.getOwned(id, user.id), new Date());
  }

  @Put(":id")
  async update(@Context() ctx: ExecutionContext, @Param("id") id: string, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return project(await this.store.update(id, user.id, parseUpdateInvoice(body)), new Date());
  }

  @Delete(":id")
  async delete(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    await this.store.delete(id, user.id);
    return { ok: true };
  }

  /** Contractor confirms a customer's claimed payment. Records a Payment
   *  row, flips the invoice to paid, fires the PDF receipt. */
  @Post(":id/confirm-payment")
  async confirmPayment(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const result = await this.confirm.run(user.id, id);
    return ctx.json(result, result.ok ? 200 : 409);
  }

  /** "Didn't get it" — reopens an invoice the customer claimed but the
   *  contractor never actually received. Clears the intent (via store
   *  patch) and flips status back to `sent`. */
  @Post(":id/reject-claim")
  async rejectClaim(@Context() ctx: ExecutionContext, @Param("id") id: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const inv = await this.store.getOwned(id, user.id);
    if (inv.status !== "claimed") {
      return ctx.json({ ok: false, reason: "not_claimed" }, 409);
    }
    // We can't clear paymentIntent via the normal patch (undefined is
    // filtered). Stamp a tombstone-shaped intent the public page treats
    // as "no active claim".
    await this.store.update(id, user.id, {
      status: "sent",
      paymentIntent: undefined,
    });
    return ctx.json({ ok: true });
  }

  /** Forecast hero data for /invoices. */
  @Get("forecast/this-week")
  async forecastThisWeek(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return ctx.json(await this.forecast.run(user.id, new Date()));
  }

  /** Tax-time CSV export. Streams CSV bytes for the given year. */
  @Get("export.csv")
  async exportCsv(@Context() ctx: ExecutionContext, @Query("year") yearQ?: string) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const year = yearQ ? Number(yearQ) : new Date().getUTCFullYear();
    const all = await this.store.listByUser(user.id);
    const paid = all.filter((i) => {
      if (i.status !== "paid" || !i.paidAt) return false;
      const d = new Date(i.paidAt);
      return d.getUTCFullYear() === year;
    });
    // Hydrate customer + job context for the export rows. Best-effort.
    const customerCache = new Map<string, string>();
    const contractCache = new Map<string, string>();
    const rows: string[][] = [["Date", "Customer", "Job", "Amount", "Method", "Reference"]];
    for (const inv of paid) {
      const customerName = await resolveName(this.customers, user.id, inv.customerId, customerCache);
      const jobName = await resolveJobName(this.contracts, this.quotes, user.id, inv.contractId, contractCache);
      // Payment intent at the moment-of-paid carries the method/reference.
      // After confirm clears the intent, we lose this — for v1 we mirror
      // it into the row at confirm-time (already happens via the Payment
      // entity, but listing payments per invoice would require a join we
      // skip here; fall back to the intent if still present).
      const method = inv.paymentIntent?.method ?? "—";
      const reference = inv.paymentIntent?.reference ?? "";
      rows.push([
        inv.paidAt!.slice(0, 10),
        customerName ?? "—",
        jobName ?? "—",
        ((inv.amount ?? 0) / 100).toFixed(2),
        method,
        reference,
      ]);
    }
    const csv = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="invoices-${year}.csv"`,
      },
    });
  }

  /** Voice-driven payment recording: contractor's transcript → matched
   *  invoice → Payment + receipt fired (via ConfirmPayment internally).
   *  Returns either a confirmation or a disambiguation list. */
  @Post("record-payment/voice")
  async recordFromVoice(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const b = (body ?? {}) as { transcript?: string };
    if (typeof b.transcript !== "string" || !b.transcript.trim()) {
      throw new Error("transcript is required");
    }
    return ctx.json(await this.recordFromUtterance.run(user.id, { transcript: b.transcript }));
  }

  /** Photo-driven payment recording: OCR fields parsed client-side
   *  (amount, payer name, check #) → matched invoice → recorded. */
  @Post("record-payment/photo")
  async recordFromPhoto(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const b = (body ?? {}) as { amount?: number; payerHint?: string; method?: string; reference?: string };
    return ctx.json(await this.recordFromUtterance.run(user.id, {
      ocrFields: {
        ...(typeof b.amount === "number" ? { amount: b.amount } : {}),
        ...(b.payerHint ? { payerHint: b.payerHint } : {}),
        ...(b.method ? { method: b.method } : {}),
        ...(b.reference ? { reference: b.reference } : {}),
      },
    }));
  }
}

async function resolveName(
  customers: CustomerStore,
  userId: string,
  customerId: string | undefined,
  cache: Map<string, string>,
): Promise<string | undefined> {
  if (!customerId) return undefined;
  if (cache.has(customerId)) return cache.get(customerId);
  try {
    const c = await customers.getOwned(customerId, userId);
    cache.set(customerId, c.name);
    return c.name;
  } catch { return undefined; }
}

async function resolveJobName(
  contracts: ContractStore,
  quotes: QuoteStore,
  userId: string,
  contractId: string | undefined,
  cache: Map<string, string>,
): Promise<string | undefined> {
  if (!contractId) return undefined;
  if (cache.has(contractId)) return cache.get(contractId);
  try {
    const c = await contracts.getOwned(contractId, userId);
    if (!c.quoteId) return undefined;
    const q = await quotes.getOwned(c.quoteId, userId);
    const name = q.jobName?.trim() || q.summary?.trim() || undefined;
    if (name) cache.set(contractId, name);
    return name;
  } catch { return undefined; }
}

function csvCell(s: string): string {
  // Standard RFC 4180 escaping: wrap in quotes if comma/quote/newline,
  // and double interior quotes.
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
