/**
 * REQ-924 — BuildCustomerWorkspace: one customer's page — the card (BuildCustomerCards, so the balance
 * and documents read exactly as on the board and in the sidebar), the money summary, every invoice,
 * quote, payment and work order of hers, her repeat visits with their next visits by the schedule,
 * and her visits from the last year to two months ahead. A read coordinator; no persistence.
 */
import { Injectable } from "#danet/core";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { PaymentStore } from "@paperwork/domain/data/payment-store/mod.ts";
import { WorkOrderStore } from "@paperwork/domain/data/work-order-store/mod.ts";
import { FieldTaskStore, SubscriptionStore } from "@field/domain/data/field-stores/mod.ts";
import { FieldViews } from "@field/domain/coordinators/field-views/mod.ts";
import { shiftDate } from "@field/domain/business/schedule/mod.ts";
import { fieldTodayFor } from "@users/domain/coordinators/business-zone/mod.ts"; // REQ-940
import { liveIds } from "@field/domain/business/live-invoices/mod.ts";
import { BuildCustomerCards } from "@analytics/domain/coordinators/build-customer-cards/mod.ts";
import {
  hasEnded,
  isRunning,
  isUnbilled,
  monthlyVisits,
  nextVisits,
  perVisitCents,
  remainingVisits,
  workspaceSummary,
} from "@analytics/domain/business/customer-workspace/mod.ts";
import { isOpenReceivable, receivableBalanceCents } from "@paperwork/domain/business/open-receivable/mod.ts";
import { docNumberOf } from "#documents/numbering.ts";
import { invoiceState } from "#documents/versions.ts";
import type {
  CustomerWorkspace,
  WorkspaceInvoice,
  WorkspaceService,
  WorkspaceVisit,
} from "@analytics/dto/customer-workspace.ts";

const MS_PER_DAY = 86_400_000;
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / MS_PER_DAY);
const firstLine = (s?: string) => (s ?? "").split("\n")[0].trim();

export class CustomerNotFound extends Error {}

@Injectable()
export class BuildCustomerWorkspace {
  constructor(
    private customers: CustomerStore,
    private cards: BuildCustomerCards,
    private invoices: InvoiceStore,
    private quotes: QuoteStore,
    private payments: PaymentStore,
    private workOrders: WorkOrderStore,
    private subs: SubscriptionStore,
    private tasks: FieldTaskStore,
    private views: FieldViews,
  ) {}

  async run(userId: string, customerId: string, today?: string): Promise<CustomerWorkspace> {
    today ??= await fieldTodayFor(userId); // REQ-940: the business's day
    const owned = await this.customers.getOwned(customerId, userId).catch(() => null);
    if (!owned || owned.deletedAt) throw new CustomerNotFound(customerId);

    const [cards, allInvoices, allQuotes, allPayments, allWorkOrders, allSubs, tasks, names] = await Promise.all([
      this.cards.run(userId),
      this.invoices.listByUser(userId),
      this.quotes.listByUser(userId),
      this.payments.listByUser(userId),
      this.workOrders.listByUser(userId),
      this.subs.listByUser(userId),
      this.tasks.listByRange(userId, shiftDate(today, -365), shiftDate(today, 60)),
      this.views.names(userId),
    ]);
    const customer = cards.find((c) => c.id === customerId);
    if (!customer) throw new CustomerNotFound(customerId);

    const live = liveIds(allInvoices);
    const invoiceNumber = new Map(allInvoices.map((i) => [i.id, docNumberOf(i)]));
    const mine = allInvoices.filter((i) => i.customerId === customerId);
    const mineIds = new Set(mine.map((i) => i.id));

    const invoices: WorkspaceInvoice[] = mine
      .map((i) => {
        const open = isOpenReceivable(i);
        const balanceCents = open ? receivableBalanceCents(i) : 0;
        const overdue = open && i.dueDate < today ? daysBetween(i.dueDate, today) : 0;
        return {
          id: i.id,
          number: docNumberOf(i),
          title: i.jobName?.trim() || firstLine(i.description),
          status: i.status ?? "draft",
          state: invoiceState(i),
          ...(i.issuedDate ? { issuedDate: i.issuedDate } : {}),
          dueDate: i.dueDate,
          amountCents: i.amount ?? 0,
          paidCents: i.status === "paid" ? i.amount ?? 0 : Math.max(0, i.paidCents ?? 0),
          balanceCents,
          ...(overdue > 0 ? { overdueDays: overdue } : {}),
          url: `/i/${i.id}`,
          updatedAt: i.updatedAt,
        };
      })
      .sort((a, b) => (b.issuedDate ?? b.updatedAt).localeCompare(a.issuedDate ?? a.updatedAt));

    const myQuotes = allQuotes.filter((q) => q.customerId === customerId && !q.isSample);
    const quoteTitle = new Map(myQuotes.map((q) => [q.id, q.jobName?.trim() ?? ""]));
    const quotes = customer.documents
      .filter((d) => d.kind === "quote")
      .map((d) => ({ id: d.id, number: d.number, title: quoteTitle.get(d.id) ?? "", state: d.state, amountCents: d.amountCents, url: d.url, updatedAt: d.updatedAt }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    const payments = allPayments
      .filter((p) => mineIds.has(p.invoiceId))
      .map((p) => ({
        id: p.id,
        invoiceId: p.invoiceId,
        invoiceNumber: invoiceNumber.get(p.invoiceId) ?? "",
        amountCents: p.amount,
        method: p.method,
        receivedAt: p.receivedAt,
        ...(p.reference ? { reference: p.reference } : {}),
      }))
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));

    const myTasks = tasks.filter((t) => t.customerId === customerId && !t.deleted);
    const visits: WorkspaceVisit[] = myTasks
      .map((t) => ({
        id: t.id,
        subscriptionId: t.subscriptionId,
        date: t.date,
        status: t.status,
        priceCents: t.priceCents,
        taskTypeName: names.type(t.taskTypeId),
        workerName: t.workerId ? names.worker(t.workerId) : "",
        ...(t.invoiceId ? { invoiceId: t.invoiceId, invoiceNumber: invoiceNumber.get(t.invoiceId) ?? "" } : {}),
        unbilled: isUnbilled(t, live),
      }))
      .sort((a, b) => b.date.localeCompare(a.date));

    const services: WorkspaceService[] = allSubs
      .filter((s) => s.customerId === customerId)
      .map((s) => {
        const view = this.views.subscription(s, names);
        const perVisit = perVisitCents(view);
        const unbilled = visits.filter((v) => v.subscriptionId === s.id && v.unbilled);
        // a day already done or skipped is not a next visit (nor one left)
        const taken = new Set(visits.filter((v) => v.subscriptionId === s.id && (v.status === "complete" || v.status === "skipped")).map((v) => v.date));
        const left = remainingVisits(s, today, taken);
        return {
          id: s.id,
          address: s.address,
          active: s.active,
          cadence: s.cadence,
          schedule: view.schedule,
          items: view.items.map((i) => ({ taskTypeId: i.taskTypeId, taskTypeName: i.taskTypeName, priceCents: i.priceCents })),
          ...(s.netDays != null ? { netDays: s.netDays } : {}),
          ...(s.quoteNumber ? { quoteNumber: s.quoteNumber } : {}),
          ...(s.startDate ? { startDate: s.startDate } : {}),
          ...(s.endDate ? { endDate: s.endDate } : {}),
          perVisitCents: perVisit,
          monthlyCents: Math.round(perVisit * monthlyVisits(s)),
          ...(hasEnded(s, today) ? { ended: true } : {}),
          ...(left !== undefined ? { remainingCents: perVisit * left } : {}),
          nextVisits: nextVisits(s, today, 5, taken),
          unbilledVisits: unbilled.length,
          unbilledCents: unbilled.reduce((sum, v) => sum + v.priceCents, 0),
        };
      })
      .sort((a, b) => Number(isRunning(b, today)) - Number(isRunning(a, today)));

    const workOrders = allWorkOrders
      .filter((w) => w.customerId === customerId)
      .map((w) => ({
        id: w.id,
        number: docNumberOf(w),
        description: w.description,
        status: w.status,
        ...(w.scheduledFor ? { scheduledFor: w.scheduledFor } : {}),
        url: `/work-orders?open=${w.id}`,
        updatedAt: w.updatedAt,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    const summary = workspaceSummary({
      today,
      invoices: mine,
      payments: payments.map((p) => ({ amount: p.amountCents, method: p.method, receivedAt: p.receivedAt })),
      quotes: myQuotes,
      services: services.map((s) => ({ active: s.active, perVisitCents: s.perVisitCents, monthlyVisits: s.perVisitCents ? s.monthlyCents / s.perVisitCents : 0, ...(s.endDate ? { endDate: s.endDate } : {}), nextVisit: s.nextVisits[0] })),
      unbilledVisitCents: visits.filter((v) => v.unbilled).map((v) => v.priceCents),
    });
    // the services' monthly figure is already rounded per service; the summary sums those
    summary.recurringMonthlyCents = services.filter((s) => isRunning(s, today)).reduce((sum, s) => sum + s.monthlyCents, 0);

    return { customer, today, summary, invoices, quotes, payments, services, visits, workOrders };
  }
}
