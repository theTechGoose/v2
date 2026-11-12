/**
 * REQ-210 — /wo/:id. One work order: its number · version, the status walk
 * (open → in progress → done; cancel / reopen), the links to its customer,
 * quote and invoice by number, an inline edit (PUT → a new version), the
 * version history, and delete behind the house modal.
 */
import Backdrop from "../components/Backdrop.tsx";
import { useEffect, useState } from "preact/hooks";
import {
  type WorkOrder,
  workOrdersClient,
  type WorkOrderStatus,
  type WorkOrderVersion,
} from "../clients/work-orders.ts";
import FieldHead from "../components/FieldHead.tsx";
import { ApiError } from "../lib/api.ts";
import { langSignal, t } from "../lib/i18n.ts";
import {
  shortDate,
  versionHistoryLine,
  workOrderNextStatuses,
} from "../../shared/documents/linked-view.ts";

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

interface EditForm {
  description: string;
  serviceAddress: string;
  scheduledFor: string;
  completedOn: string;
  assignee: string;
  notes: string;
}

function formOf(wo: WorkOrder): EditForm {
  return {
    description: wo.description ?? "",
    serviceAddress: wo.serviceAddress ?? "",
    scheduledFor: wo.scheduledFor ?? "",
    completedOn: wo.completedOn ?? "",
    assignee: wo.assignee ?? "",
    notes: wo.notes ?? "",
  };
}

export default function WorkOrderPage({ id }: { id: string }) {
  const lang = langSignal.value;
  const [wo, setWo] = useState<WorkOrder | null | undefined>(undefined);
  const [versions, setVersions] = useState<WorkOrderVersion[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<EditForm | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function load() {
    const [row, vs] = await Promise.all([
      workOrdersClient.get(id),
      workOrdersClient.versions(id).catch(() => [] as WorkOrderVersion[]),
    ]);
    setWo(row);
    setVersions(Array.isArray(vs) ? vs : []);
  }

  useEffect(() => {
    let alive = true;
    load().catch(() => {
      if (alive) setWo(null);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  async function setStatus(status: WorkOrderStatus) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await workOrdersClient.update(id, {
        status,
        // REQ-210: "done" stamps the completion date when none was set
        ...(status === "done" && !wo?.completedOn
          ? { completedOn: new Date().toISOString().slice(0, 10) }
          : {}),
      });
      setWo(next);
      setVersions(await workOrdersClient.versions(id).catch(() => versions));
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  async function save(e: Event) {
    e.preventDefault();
    if (busy || !form) return;
    if (!form.description.trim()) {
      setError(t("workOrders.modal.errDescription"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await workOrdersClient.update(id, {
        description: form.description.trim(),
        serviceAddress: form.serviceAddress.trim(),
        scheduledFor: form.scheduledFor,
        completedOn: form.completedOn,
        assignee: form.assignee.trim(),
        notes: form.notes.trim(),
      });
      setWo(next);
      setEditing(false);
      setVersions(await workOrdersClient.versions(id).catch(() => versions));
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await workOrdersClient.delete(id);
      globalThis.location.assign("/work-orders");
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  if (wo === undefined) {
    return (
      <div class="hint" style="padding:12px 4px">
        {t("workOrders.detail.loading")}
      </div>
    );
  }
  if (wo === null) {
    return (
      <>
        <p class="alert" data-cy="wo-not-found">
          {t("workOrders.detail.notFound")}
        </p>
        <a href="/work-orders" class="btn btn--ghost btn--sm">
          {t("workOrders.detail.back")}
        </a>
      </>
    );
  }

  const nextStatuses = workOrderNextStatuses(wo.status);
  const links = wo.links ?? {};
  const kv = (label: string, value: string | undefined, cy: string) =>
    value
      ? (
        <div data-cy={cy}>
          <div
            class="hint"
            style="text-transform:uppercase;letter-spacing:.08em;font-weight:800;font-size:10.5px"
          >
            {label}
          </div>
          <div style="margin-top:2px;color:var(--brand-teal);font-weight:600">
            {value}
          </div>
        </div>
      )
      : null;

  return (
    <>
      <FieldHead
        eyebrow={`${wo.number} · ${
          t("workOrders.detail.versionN", { n: wo.version })
        }`}
        title={wo.description}
        sub={links.customer?.name
          ? `${
            links.customer.number ? `${links.customer.number} · ` : ""
          }${links.customer.name}`
          : undefined}
      >
        <a href="/work-orders" class="btn btn--ghost btn--sm">
          {t("workOrders.detail.back")}
        </a>
      </FieldHead>

      <div class="panel" data-cy="wo-detail" data-id={wo.id}>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <span class={statusChipClass(wo.status)} data-cy="wo-status">
            {t(`workOrders.status.${wo.status}`)}
          </span>
          <span style="display:inline-flex;gap:8px;flex-wrap:wrap">
            {nextStatuses.map((s, i) => (
              <button
                type="button"
                key={s}
                data-cy={`wo-set-status-${s}`}
                class={`btn btn--sm ${i === 0 ? "btn--green" : "btn--ghost"}`}
                disabled={busy}
                onClick={() => setStatus(s)}
              >
                {t(`workOrders.detail.setStatus.${s}`)}
              </button>
            ))}
          </span>
        </div>

        {error && <p class="alert" role="alert" data-cy="wo-error">{error}</p>}

        {!editing
          ? (
            <>
              <div
                data-cy="wo-links"
                style="margin-top:16px;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;font-size:14px"
              >
                {links.customer
                  ? (
                    <div data-cy="wo-link-customer">
                      <div
                        class="hint"
                        style="text-transform:uppercase;letter-spacing:.08em;font-weight:800;font-size:10.5px"
                      >
                        {t("workOrders.detail.customer")}
                      </div>
                      {links.customer.url
                        ? (
                          <a
                            href={links.customer.url}
                            style="color:var(--brand-teal);font-weight:700;text-decoration:none"
                          >
                            {links.customer.number
                              ? `${links.customer.number} · `
                              : ""}
                            {links.customer.name}
                          </a>
                        )
                        : (
                          <span style="font-weight:700">
                            {links.customer.name}
                          </span>
                        )}
                    </div>
                  )
                  : null}
                {links.quote
                  ? (
                    <div data-cy="wo-link-quote">
                      <div
                        class="hint"
                        style="text-transform:uppercase;letter-spacing:.08em;font-weight:800;font-size:10.5px"
                      >
                        {t("workOrders.detail.quote")}
                      </div>
                      <a
                        href={`/quotes?open=${
                          encodeURIComponent(links.quote.id ?? "")
                        }`}
                        style="color:var(--brand-teal);font-weight:700;text-decoration:none"
                      >
                        {links.quote.number}
                      </a>
                    </div>
                  )
                  : null}
                {links.invoice
                  ? (
                    <div data-cy="wo-link-invoice">
                      <div
                        class="hint"
                        style="text-transform:uppercase;letter-spacing:.08em;font-weight:800;font-size:10.5px"
                      >
                        {t("workOrders.detail.invoice")}
                      </div>
                      <a
                        href={`/invoices?open=${
                          encodeURIComponent(links.invoice.id ?? "")
                        }`}
                        style="color:var(--brand-teal);font-weight:700;text-decoration:none"
                      >
                        {links.invoice.number}
                      </a>
                    </div>
                  )
                  : null}
                {kv(
                  t("workOrders.detail.serviceAddress"),
                  wo.serviceAddress,
                  "wo-service-address",
                )}
                {kv(
                  t("workOrders.detail.scheduledFor"),
                  wo.scheduledFor
                    ? shortDate(wo.scheduledFor, lang)
                    : undefined,
                  "wo-scheduled",
                )}
                {kv(
                  t("workOrders.detail.completedOn"),
                  wo.completedOn ? shortDate(wo.completedOn, lang) : undefined,
                  "wo-completed",
                )}
                {kv(
                  t("workOrders.detail.assignee"),
                  wo.assignee,
                  "wo-assignee",
                )}
              </div>
              {wo.notes
                ? (
                  <p
                    data-cy="wo-notes"
                    style="margin:14px 0 0;white-space:pre-wrap;font-size:14px;color:var(--fg)"
                  >
                    {wo.notes}
                  </p>
                )
                : null}
              <div style="margin-top:18px;display:flex;gap:8px;flex-wrap:wrap">
                <button
                  type="button"
                  class="btn btn--ghost btn--sm"
                  data-cy="wo-edit"
                  disabled={busy}
                  onClick={() => {
                    setForm(formOf(wo));
                    setEditing(true);
                  }}
                >
                  {t("workOrders.detail.edit")}
                </button>
                <button
                  type="button"
                  class="btn btn--danger btn--sm"
                  data-cy="wo-delete"
                  disabled={busy}
                  onClick={() => setConfirmDelete(true)}
                >
                  {t("workOrders.detail.delete")}
                </button>
              </div>
            </>
          )
          : form
          ? (
            <form
              onSubmit={save}
              data-cy="wo-edit-form"
              style="margin-top:16px;display:flex;flex-direction:column;gap:12px"
            >
              <label class="field">
                {t("workOrders.modal.description")}
                <input
                  type="text"
                  data-cy="wo-edit-description"
                  value={form.description}
                  disabled={busy}
                  onInput={(e) =>
                    setForm({
                      ...form,
                      description: (e.target as HTMLInputElement).value,
                    })}
                />
              </label>
              <label class="field">
                {t("workOrders.modal.serviceAddress")}
                <input
                  type="text"
                  value={form.serviceAddress}
                  disabled={busy}
                  onInput={(e) =>
                    setForm({
                      ...form,
                      serviceAddress: (e.target as HTMLInputElement).value,
                    })}
                />
              </label>
              <div class="row">
                <label class="field">
                  {t("workOrders.modal.scheduledFor")}
                  <input
                    type="date"
                    value={form.scheduledFor}
                    disabled={busy}
                    onInput={(e) =>
                      setForm({
                        ...form,
                        scheduledFor: (e.target as HTMLInputElement).value,
                      })}
                  />
                </label>
                <label class="field">
                  {t("workOrders.detail.completedOn")}
                  <input
                    type="date"
                    value={form.completedOn}
                    disabled={busy}
                    onInput={(e) =>
                      setForm({
                        ...form,
                        completedOn: (e.target as HTMLInputElement).value,
                      })}
                  />
                </label>
                <label class="field">
                  {t("workOrders.modal.assignee")}
                  <input
                    type="text"
                    data-cy="wo-edit-assignee"
                    value={form.assignee}
                    disabled={busy}
                    onInput={(e) =>
                      setForm({
                        ...form,
                        assignee: (e.target as HTMLInputElement).value,
                      })}
                  />
                </label>
              </div>
              <label class="field">
                {t("workOrders.modal.notes")}
                <textarea
                  rows={3}
                  value={form.notes}
                  disabled={busy}
                  onInput={(e) =>
                    setForm({
                      ...form,
                      notes: (e.target as HTMLTextAreaElement).value,
                    })}
                />
              </label>
              <div style="display:flex;gap:8px;justify-content:flex-end">
                <button
                  type="button"
                  class="btn--cancel"
                  disabled={busy}
                  onClick={() => setEditing(false)}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  class="btn--submit"
                  data-cy="wo-edit-save"
                  disabled={busy}
                >
                  {busy
                    ? t("workOrders.detail.saving")
                    : t("workOrders.detail.save")}
                </button>
              </div>
            </form>
          )
          : null}
      </div>

      {versions.length > 0 && (
        <div class="panel" data-cy="wo-versions">
          <div class="panel__title">
            {t("workOrders.detail.versions", { n: versions.length })}
          </div>
          <ul style="margin:0;padding-left:18px;font-size:13.5px;line-height:1.8;color:var(--fg)">
            {versions.map((v) => (
              <li key={v.version}>
                {versionHistoryLine(v, lang)}
                {v.current
                  ? <span class="hint">· {t("workOrders.detail.current")}</span>
                  : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {confirmDelete && (
        <Backdrop
          class="modal-bg"
          onClose={() => !busy && setConfirmDelete(false)}
        >
          <div
            class="modal"
            data-cy="wo-delete-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>{t("workOrders.detail.deleteTitle", { number: wo.number })}</h2>
            <p class="hint" style="margin:0">
              {t("workOrders.detail.deleteBody")}
            </p>
            <div class="modal__foot">
              <button
                type="button"
                class="btn--cancel"
                disabled={busy}
                onClick={() => setConfirmDelete(false)}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                class="btn btn--danger"
                data-cy="wo-delete-confirm"
                disabled={busy}
                onClick={remove}
              >
                {t("workOrders.detail.deleteConfirm")}
              </button>
            </div>
          </div>
        </Backdrop>
      )}
    </>
  );
}
