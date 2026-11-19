/**
 * REQ-210 — /work-orders. The account's numbered WO- documents: a list
 * (number, status, customer, description, assignee, scheduled date, the
 * quote / invoice it belongs to, filtered by status) and the "New work
 * order" modal. Data: clients/work-orders.ts; the pickers read the customer,
 * quote and invoice lists the other pages already use.
 */
import Backdrop from "../components/Backdrop.tsx";
import { useEffect, useState } from "preact/hooks";
import {
  type WorkOrder,
  workOrdersClient,
  type WorkOrderStatus,
} from "../clients/work-orders.ts";
import {
  type Customer,
  dashboardClient,
  type Invoice,
} from "../clients/dashboard.ts";
import { type QuoteCard, quotesClient } from "../clients/quotes.ts";
import {
  fieldClient,
  type FieldWorker,
  type SubscriptionView,
} from "../clients/field.ts";
import { knownServiceAddress } from "../lib/field.ts";
import FieldHead from "../components/FieldHead.tsx";
import { ApiError } from "../lib/api.ts";
import { langSignal, t } from "../lib/i18n.ts";
import { assigneeLabel } from "../lib/work-order-assignee.ts"; // REQ-1022
import { fmtMoneyExact } from "../lib/format.ts";
import { shortDate } from "../../shared/documents/linked-view.ts";
import { workOrderQuoteOptions } from "../../shared/documents/work-order-quotes.ts";

const STATUSES: WorkOrderStatus[] = [
  "open",
  "in_progress",
  "done",
  "cancelled",
];

function statusChipClass(status: string): string {
  switch (status) {
    case "in_progress":
      return "chip chip--amber";
    case "done":
      return "chip chip--green";
    case "cancelled":
      return "chip chip--pink";
    default:
      return "chip";
  }
}

function errMsg(err: unknown): string {
  if (err instanceof ApiError) {
    const b = err.body as { detail?: unknown; reason?: unknown } | null;
    if (b && typeof b === "object") {
      if (typeof b.detail === "string") return b.detail;
      if (typeof b.reason === "string") return b.reason;
    }
  }
  if (err instanceof Error && err.message) return err.message;
  return t("workOrders.error");
}

interface Lists {
  customers: Customer[];
  quotes: QuoteCard[];
  invoices: Invoice[];
  /** REQ-1007 — the repeat visits, for the customer's known service address */
  subscriptions: SubscriptionView[];
  /** REQ-1010 — the account's field workers, for the Assignee picker */
  workers: FieldWorker[];
}

export default function WorkOrdersPage() {
  const lang = langSignal.value;
  const [rows, setRows] = useState<WorkOrder[] | null>(null);
  const [lists, setLists] = useState<Lists>({
    customers: [],
    quotes: [],
    invoices: [],
    subscriptions: [],
    workers: [],
  });
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | WorkOrderStatus>("all");
  const [showNew, setShowNew] = useState<boolean>(() => {
    if (typeof globalThis.location === "undefined") return false;
    return new URLSearchParams(globalThis.location.search).get("new") === "1";
  });

  async function reload() {
    const [wos, customers, quotes, invoices, subscriptions, workers] =
      await Promise.all([
        workOrdersClient.list(),
        dashboardClient.customers().catch(() => [] as Customer[]),
        quotesClient.list().catch(() => [] as QuoteCard[]),
        dashboardClient.invoices().catch(() => [] as Invoice[]),
        fieldClient.subscriptions().catch(() => [] as SubscriptionView[]),
        fieldClient.workers().catch(() => [] as FieldWorker[]),
      ]);
    setRows(Array.isArray(wos) ? wos : []);
    setLists({
      customers: Array.isArray(customers) ? customers : [],
      quotes: Array.isArray(quotes) ? quotes : [],
      invoices: Array.isArray(invoices) ? invoices : [],
      subscriptions: Array.isArray(subscriptions) ? subscriptions : [],
      workers: Array.isArray(workers) ? workers : [],
    });
    setLoadErr(null);
  }

  useEffect(() => {
    let alive = true;
    reload().catch((err: unknown) => {
      if (!alive) return;
      setLoadErr(errMsg(err));
      setRows([]);
    });
    return () => {
      alive = false;
    };
  }, []);

  const customerName = (wo: WorkOrder) =>
    wo.links?.customer?.name ?? wo.customerSnapshot?.name ??
      lists.customers.find((c) => c.id === wo.customerId)?.name ?? "—";
  const quoteOf = (wo: WorkOrder) =>
    wo.quoteId ? lists.quotes.find((q) => q.id === wo.quoteId) : undefined;
  const invoiceOf = (wo: WorkOrder) =>
    wo.invoiceId
      ? lists.invoices.find((i) => i.id === wo.invoiceId)
      : undefined;
  const numberOf = (doc: { number?: unknown; id: string } | undefined) =>
    doc
      ? (typeof doc.number === "string" && doc.number
        ? doc.number
        : `#${doc.id.slice(0, 8).toUpperCase()}`)
      : undefined;

  const visible = (rows ?? []).filter((w) =>
    filter === "all" || w.status === filter
  );

  return (
    <>
      <FieldHead
        eyebrow={t("workOrders.eyebrow")}
        title={t("workOrders.title")}
        sub={t("workOrders.sub")}
      >
        <button
          type="button"
          class="btn btn--green"
          data-cy="wo-new"
          onClick={() => setShowNew(true)}
        >
          + {t("workOrders.new")}
        </button>
      </FieldHead>

      {/* REQ-609 (demo c4 m48): a finished task never becomes a work order — say so */}
      <p class="hint" data-cy="wo-vs-tasks" style="margin:0 0 12px">
        {t("workOrders.vsTasks")}{" "}
        <a class="link" href="/field/tasks">{t("workOrders.openTasks")}</a>
      </p>

      {loadErr && <p class="alert" data-cy="wo-load-error">{loadErr}</p>}

      <div class="panel">
        <div class="panel__title">
          {t("workOrders.listTitle")}
          <span class="count" data-cy="wo-count">{visible.length}</span>
          <span style="margin-left:auto;display:inline-flex;gap:4px;flex-wrap:wrap">
            {(["all", ...STATUSES] as const).map((s) => (
              <button
                type="button"
                key={s}
                data-cy={`wo-filter-${s}`}
                aria-pressed={filter === s}
                onClick={() => setFilter(s)}
                style={`border:1px solid var(--border);border-radius:999px;padding:4px 10px;font:inherit;font-size:11px;font-weight:800;cursor:pointer;background:${
                  filter === s ? "var(--brand-teal)" : "#fff"
                };color:${filter === s ? "#fff" : "var(--fg-muted)"}`}
              >
                {s === "all"
                  ? t("workOrders.filterAll")
                  : t(`workOrders.status.${s}`)}
              </button>
            ))}
          </span>
        </div>
        {rows === null
          ? (
            <div class="hint" style="padding:12px 4px">
              {t("workOrders.loading")}
            </div>
          )
          : visible.length === 0
          ? (
            <div class="hint" style="padding:12px 4px" data-cy="wo-empty">
              {t("workOrders.empty")}
            </div>
          )
          : (
            <div style="overflow-x:auto">
              <table class="table" data-cy="wo-table">
                <thead>
                  <tr>
                    <th>{t("workOrders.col.number")}</th>
                    <th>{t("workOrders.col.status")}</th>
                    <th>{t("workOrders.col.customer")}</th>
                    <th>{t("workOrders.col.description")}</th>
                    <th>{t("workOrders.col.assignee")}</th>
                    <th>{t("workOrders.col.scheduled")}</th>
                    <th>{t("workOrders.col.linked")}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((wo) => {
                    const q = quoteOf(wo);
                    const inv = invoiceOf(wo);
                    return (
                      <tr key={wo.id} data-cy="wo-row" data-id={wo.id}>
                        <td>
                          <a
                            href={`/wo/${wo.id}`}
                            data-cy="wo-row-number"
                            style="font-weight:800;color:var(--brand-teal);text-decoration:none"
                          >
                            {wo.number}
                          </a>
                        </td>
                        <td>
                          <span
                            class={statusChipClass(wo.status)}
                            data-cy="wo-row-status"
                          >
                            {t(`workOrders.status.${wo.status}`)}
                          </span>
                        </td>
                        <td data-cy="wo-row-customer">{customerName(wo)}</td>
                        <td
                          data-cy="wo-row-description"
                          style="max-width:280px"
                        >
                          {wo.description}
                        </td>
                        <td
                          data-cy="wo-row-assignee"
                          style={wo.assigneeOut
                            ? "color:var(--danger)"
                            : undefined}
                        >
                          {assigneeLabel(wo, t) ?? "—"}
                        </td>
                        <td data-cy="wo-row-scheduled">
                          {wo.scheduledFor
                            ? shortDate(wo.scheduledFor, lang)
                            : "—"}
                        </td>
                        <td data-cy="wo-row-linked" style="white-space:nowrap">
                          {q
                            ? (
                              <a
                                href={`/quotes?open=${
                                  encodeURIComponent(q.id)
                                }`}
                                style="color:var(--brand-teal);font-weight:700;text-decoration:none"
                              >
                                {numberOf(q)}
                              </a>
                            )
                            : null}
                          {q && inv ? " · " : ""}
                          {inv
                            ? (
                              <a
                                href={`/invoices?open=${
                                  encodeURIComponent(inv.id)
                                }`}
                                style="color:var(--brand-teal);font-weight:700;text-decoration:none"
                              >
                                {numberOf(inv)}
                              </a>
                            )
                            : null}
                          {!q && !inv ? "—" : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>

      {showNew && (
        <NewWorkOrderModal
          lists={lists}
          onClose={() => {
            setShowNew(false);
            try {
              const url = new URL(globalThis.location.href);
              url.searchParams.delete("new");
              url.searchParams.delete("quoteId"); // REQ-1140 prefill
              url.searchParams.delete("customerId");
              globalThis.history.replaceState(null, "", url.toString());
            } catch { /* history unavailable — the modal still closes */ }
          }}
          onCreated={async () => {
            setShowNew(false);
            await reload().catch(() => {});
          }}
        />
      )}
    </>
  );
}

/** REQ-1140 — a query parameter of the page, "" on the server or when absent */
function urlParam(name: string): string {
  if (typeof globalThis.location === "undefined") return "";
  return new URLSearchParams(globalThis.location.search).get(name) ?? "";
}

/** The "New work order" modal — description, customer, optional quote /
 *  invoice (filtered by the customer), service address (prefilled from the
 *  customer), scheduled date, assignee, notes. One requestId per form open
 *  (REQ-200): a retry after a network blip returns the same WO-. */
function NewWorkOrderModal(
  { lists, onClose, onCreated }: {
    lists: Lists;
    onClose: () => void;
    onCreated: () => void | Promise<void>;
  },
) {
  const [requestId] = useState(() => crypto.randomUUID());
  const [description, setDescription] = useState("");
  // REQ-1140: the customer page's "Create work order" on a signed job opens this form prefilled
  // (/work-orders?new=1&quoteId=…&customerId=…)
  const [customerId, setCustomerId] = useState(() => urlParam("customerId"));
  const [quoteId, setQuoteId] = useState(() => urlParam("quoteId"));
  const [invoiceId, setInvoiceId] = useState("");
  const [serviceAddress, setServiceAddress] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  /** REQ-1010 — the picked worker's id; the work order lists on their /worker day */
  const [assigneeWorkerId, setAssigneeWorkerId] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // REQ-1058 — never the onboarding sample quote
  const quotes = workOrderQuoteOptions(lists.quotes, customerId);
  const invoices = lists.invoices.filter((i) =>
    !customerId || i.customerId === customerId
  );
  const label = (doc: { number?: unknown; id: string }, title?: string) =>
    `${
      typeof doc.number === "string" && doc.number
        ? doc.number
        : `#${doc.id.slice(0, 8).toUpperCase()}`
    }${title ? ` · ${title}` : ""}`;

  function pickCustomer(id: string) {
    setCustomerId(id);
    setQuoteId("");
    setInvoiceId("");
    const c = lists.customers.find((x) => x.id === id);
    // REQ-1007 — the known service address: a city-only record gives way to
    // the street address on the customer's active repeat visit
    const known = c ? knownServiceAddress(c, lists.subscriptions) : "";
    if (known && !serviceAddress.trim()) setServiceAddress(known);
  }

  async function submit(e: Event) {
    e.preventDefault();
    if (busy) return;
    if (!description.trim()) {
      setError(t("workOrders.modal.errDescription"));
      return;
    }
    setBusy(true);
    setError(null);
    const worker = lists.workers.find((w) => w.id === assigneeWorkerId);
    try {
      await workOrdersClient.create({
        description: description.trim(),
        ...(customerId ? { customerId } : {}),
        ...(quoteId ? { quoteId } : {}),
        ...(invoiceId ? { invoiceId } : {}),
        ...(serviceAddress.trim()
          ? { serviceAddress: serviceAddress.trim() }
          : {}),
        ...(scheduledFor ? { scheduledFor } : {}),
        ...(worker
          ? { assignee: worker.name, assigneeWorkerId: worker.id }
          : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        requestId,
      });
      await onCreated();
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  }

  return (
    <Backdrop class="modal-bg" onClose={() => !busy && onClose()}>
      <form
        class="modal"
        data-cy="wo-new-modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2>{t("workOrders.modal.title")}</h2>
        <p class="hint" style="margin:0">{t("workOrders.modal.intro")}</p>
        <label class="field">
          {t("workOrders.modal.description")}
          <input
            type="text"
            data-cy="wo-new-description"
            autoFocus
            required
            value={description}
            disabled={busy}
            onInput={(e) =>
              setDescription((e.target as HTMLInputElement).value)}
          />
        </label>
        <label class="field">
          {t("workOrders.modal.customer")}
          <select
            data-cy="wo-new-customer"
            value={customerId}
            disabled={busy}
            onInput={(e) => pickCustomer((e.target as HTMLSelectElement).value)}
          >
            <option value="">{t("workOrders.modal.customerNone")}</option>
            {lists.customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.number ? `${c.number} · ${c.name}` : c.name}
              </option>
            ))}
          </select>
        </label>
        <div class="row">
          <label class="field">
            {t("workOrders.modal.quote")}
            <select
              data-cy="wo-new-quote"
              value={quoteId}
              disabled={busy}
              onInput={(e) => setQuoteId((e.target as HTMLSelectElement).value)}
            >
              <option value="">{t("workOrders.modal.quoteNone")}</option>
              {quotes.map((q) => (
                <option key={q.id} value={q.id}>
                  {label(q, q.jobName?.trim() || q.summary)}
                </option>
              ))}
            </select>
          </label>
          <label class="field">
            {t("workOrders.modal.invoice")}
            <select
              data-cy="wo-new-invoice"
              value={invoiceId}
              disabled={busy}
              onInput={(e) =>
                setInvoiceId((e.target as HTMLSelectElement).value)}
            >
              <option value="">{t("workOrders.modal.invoiceNone")}</option>
              {invoices.map((i) => (
                <option key={i.id} value={i.id}>
                  {label(i, i.jobName?.trim() || fmtMoneyExact(i.amount))}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label class="field">
          {t("workOrders.modal.serviceAddress")}
          <input
            type="text"
            data-cy="wo-new-address"
            value={serviceAddress}
            disabled={busy}
            onInput={(e) =>
              setServiceAddress((e.target as HTMLInputElement).value)}
          />
        </label>
        <div class="row">
          <label class="field">
            {t("workOrders.modal.scheduledFor")}
            <input
              type="date"
              data-cy="wo-new-scheduled"
              value={scheduledFor}
              disabled={busy}
              onInput={(e) =>
                setScheduledFor((e.target as HTMLInputElement).value)}
            />
          </label>
          <label class="field">
            {t("workOrders.modal.assignee")}
            <select
              data-cy="wo-new-assignee"
              value={assigneeWorkerId}
              disabled={busy}
              onInput={(e) =>
                setAssigneeWorkerId((e.target as HTMLSelectElement).value)}
            >
              <option value="">{t("workOrders.modal.assigneeNone")}</option>
              {lists.workers.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </label>
        </div>
        <label class="field">
          {t("workOrders.modal.notes")}
          <textarea
            rows={2}
            data-cy="wo-new-notes"
            value={notes}
            disabled={busy}
            onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)}
          />
        </label>
        {error && (
          <p class="alert" role="alert" data-cy="wo-new-error">{error}</p>
        )}
        <div class="modal__foot">
          <button
            type="button"
            class="btn--cancel"
            disabled={busy}
            onClick={onClose}
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            class="btn--submit"
            data-cy="wo-new-submit"
            disabled={busy}
          >
            {busy
              ? t("workOrders.modal.creating")
              : t("workOrders.modal.create")}
          </button>
        </div>
      </form>
    </Backdrop>
  );
}
