/**
 * REQ-142 — the batch pull writes REAL invoices through InvoiceStore (one draft
 * per customer, one line item per task) and stamps the tasks; `send` dispatches
 * the chosen drafts through the existing email/text flows and stamps them sent.
 * Customers and invoices are read and written through their own stores only.
 */
import { Injectable } from "#danet/core";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { netDaysFor } from "@field/domain/business/invoice-terms/mod.ts";
import { SendPaperworkEmail } from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import { SendPaperworkSms } from "@paperwork/domain/coordinators/send-paperwork-sms/mod.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";
import { BatchStore, FieldTaskStore, SubscriptionStore, TaskTypeStore } from "@field/domain/data/field-stores/mod.ts";
import { batchTitle, lineItem, lineText, linesFor, summarize } from "@field/domain/business/batch-lines/mod.ts";
import { fieldToday, shiftDate } from "@field/domain/business/schedule/mod.ts";
import { type Batch, FieldError } from "@field/dto/field.ts";
import { newId } from "@field/domain/coordinators/field-zones/mod.ts";
import { overheadSetting } from "../../../../../../shared/field/overhead.ts";

export interface BatchView extends Batch {
  invoices: (Invoice & { customerName: string; zeroLines: number })[];
}

/** The invoices that still bill their tasks: every non-void one, and (REQ-627)
 *  a void one whose "Void & duplicate" copy — followed to the end — still lives. */
const liveIds = (invoices: Invoice[]) => {
  const byId = new Map(invoices.map((i) => [i.id, i]));
  const live = new Set<string>();
  for (const inv of invoices) {
    let cur: Invoice | undefined = inv;
    for (let hops = 0; cur && cur.status === "void" && hops < 20; hops++) {
      cur = cur.replacedBy ? byId.get(cur.replacedBy) : undefined;
    }
    if (cur && cur.status !== "void") live.add(inv.id);
  }
  return live;
};

@Injectable()
export class FieldBatches {
  constructor(
    private tasks: FieldTaskStore,
    private subs: SubscriptionStore,
    private types: TaskTypeStore,
    private batches: BatchStore,
    private invoices: InvoiceStore,
    private customers: CustomerStore,
    private identity: BusinessIdentityStore,
    private email: SendPaperworkEmail,
    private sms: SendPaperworkSms,
  ) {}

  async pull(userId: string, from: string, to: string, lang: "en" | "es") {
    const [tasks, subscriptions, taskTypes, invoices] = await Promise.all([
      this.tasks.listByRange(userId, from, to),
      this.subs.listByUser(userId),
      this.types.listByUser(userId),
      this.invoices.listByUser(userId),
    ]);
    const live = liveIds(invoices);
    // REQ-174: days to pay — the subscription's, else the account's default, else 30
    const identity = await this.identity.get(userId).catch(() => null);
    const accountNetDays = identity?.invoiceNetDays;
    // REQ-788: the overhead cost per visit, as Settings has it today
    const overhead = { setting: overheadSetting(identity), label: lang === "es" ? "Gastos generales" : "Overhead" };
    const subById = new Map(subscriptions.map((s) => [s.id, s]));
    const taskById = new Map(tasks.map((t) => [t.id, t]));
    const summary = summarize({ from, to, tasks, liveInvoiceIds: live });
    const groups = linesFor({ from, to, tasks, subscriptions, taskTypes, liveInvoiceIds: live, overhead });
    const today = fieldToday();
    const batch: Batch = { id: newId(), userId, from, to, invoiceIds: [], createdAt: new Date().toISOString() };
    const made: Invoice[] = [];
    for (const g of groups) {
      const descriptions = g.lines.map((l) => lineText(l, lang));
      const taskLines = g.lines.filter((l) => !l.overhead); // REQ-788: the overhead line names no task
      const netDays = netDaysFor(taskLines.map((l) => subById.get(taskById.get(l.taskId)?.subscriptionId ?? "")?.netDays), accountNetDays);
      const inv = await this.invoices.create(userId, {
        customerId: g.customerId,
        status: "draft",
        ...batchTitle(g.lines, lang), // REQ-703: jobName from the lines + serviceDateFrom/To
        description: descriptions.join("\n"),
        lineItems: g.lines.map((l) => lineItem(l, lang)), // REQ-173: structured — date / service / address
        amount: g.amount,
        netDays,
        dueDate: shiftDate(today, netDays),
      });
      made.push(inv);
      batch.invoiceIds.push(inv.id);
      const byId = new Map(tasks.map((t) => [t.id, t]));
      await this.tasks.putMany(taskLines.map((l) => ({ ...byId.get(l.taskId)!, invoiceId: inv.id })));
    }
    if (made.length) await this.batches.put(batch);
    return { ...await this.view(batch, made), summary };
  }

  async list(userId: string): Promise<BatchView[]> {
    const [batches, invoices] = await Promise.all([this.batches.listByUser(userId), this.invoices.listByUser(userId)]);
    const names = await this.customerNames(userId);
    const byId = new Map(invoices.map((i) => [i.id, i]));
    return batches
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((b) => this.decorate(b, b.invoiceIds.map((id) => byId.get(id)).filter((i): i is Invoice => !!i), names));
  }

  async get(userId: string, id: string): Promise<BatchView> {
    const b = await this.batches.getOwned(id, userId);
    const invoices = (await Promise.all(b.invoiceIds.map((i) => this.invoices.get(i).catch((): Invoice | null => null)))).filter((i): i is Invoice => !!i && i.userId === userId);
    return this.view(b, invoices);
  }

  /** REQ-142: send the chosen drafts of a batch; each customer gets theirs */
  async send(userId: string, batchId: string, invoiceIds: string[], allowZero: boolean) {
    const b = await this.batches.getOwned(batchId, userId);
    const chosen: Invoice[] = [];
    for (const id of invoiceIds) {
      if (!b.invoiceIds.includes(id)) continue;
      const inv = await this.invoices.get(id).catch((): Invoice | null => null);
      if (inv && inv.userId === userId && inv.status === "draft") chosen.push(inv);
    }
    const zero = chosen.filter((inv) => (inv.lineItems ?? []).some((l) => l.price === 0));
    if (zero.length && !allowZero) throw new FieldError("some drafts have $0 lines — price them, or send with allowZero", 409, { invoiceIds: zero.map((i) => i.id) });
    const today = fieldToday();
    const sent: string[] = [];
    // REQ-401 (demo M30): `code` is what the page translates; `reason` stays for logs and older clients
    const failed: { invoiceId: string; reason: string; code?: "noRecipient"; customerId?: string }[] = [];
    for (const inv of chosen) {
      const customer = inv.customerId ? await this.customers.get(inv.customerId).catch(() => null) : null;
      const noRecipient = !customer?.email && !customer?.phoneNumber;
      let ok = false, reason = "no recipient: the customer has no email or phone";
      try {
        if (customer?.email) {
          const r = await this.email.run(userId, { kind: "invoice", resourceId: inv.id });
          ok = r.ok === true;
          if (!ok) reason = r.reason ?? "email refused";
        } else if (customer?.phoneNumber) {
          const r = await this.sms.run(userId, { kind: "invoice", resourceId: inv.id });
          ok = r.ok === true;
          if (!ok) reason = r.reason ?? "text refused";
        }
      } catch (e) {
        reason = e instanceof Error ? e.message : String(e);
      }
      if (ok) {
        // REQ-174: due = the day it is sent + its days to pay
        await this.invoices.update(inv.id, userId, { status: "sent", issuedDate: inv.issuedDate ?? today, ...(typeof inv.netDays === "number" ? { dueDate: shiftDate(today, inv.netDays) } : {}) });
        sent.push(inv.id);
      } else failed.push({ invoiceId: inv.id, reason, ...(noRecipient ? { code: "noRecipient" as const } : {}), ...(inv.customerId ? { customerId: inv.customerId } : {}) });
    }
    return { sent: sent.length, sentIds: sent, failed, batch: await this.get(userId, batchId) };
  }

  private async customerNames(userId: string) {
    return new Map((await this.customers.listByUser(userId)).map((c) => [c.id, c.name]));
  }

  private async view(b: Batch, invoices: Invoice[]): Promise<BatchView> {
    return this.decorate(b, invoices, await this.customerNames(b.userId));
  }

  private decorate(b: Batch, invoices: Invoice[], names: Map<string, string>): BatchView {
    return {
      ...b,
      invoices: invoices.map((i) => ({ ...i, customerName: (i.customerId && names.get(i.customerId)) || "—", zeroLines: (i.lineItems ?? []).filter((l) => l.price === 0).length })),
    };
  }
}
