/**
 * REQ-143 — /field/tasks. The day's round, by worker.
 *
 * A date picker (default today, ◀ ▶ and Today) — the day materializes on read
 * (REQ-170, no Generate button) — the day's tasks as cards
 * grouped by worker · zone (check state, type, customer, address, the worker's
 * note, an inline price input and an office note — both save on blur/Enter),
 * a done/open summary, and the "unstaffed" list (subscriptions due that day
 * whose zone has no worker). A task already on an invoice (409 `invoiceId`)
 * gets a read-only price and a link to /invoices.
 *
 * REQ-163 a Delete with an inline confirm · REQ-164 "Add task": a one-off by
 * hand (customer search box, service, price, worker, address, day) · REQ-165
 * "Add service" on a card · REQ-166 a worker picker on the card.
 *
 * Ported from a2z/web/tareas.html (demo driver dropped).
 */
import { useEffect, useRef, useState } from "preact/hooks";
import {
  fieldClient,
  type FieldWorker,
  type GenerateResult,
  type TaskType,
  type TaskView,
} from "../clients/field.ts";
import { clientsClient } from "../clients/clients.ts";
import FieldHead from "../components/FieldHead.tsx";
import { ApiError } from "../lib/api.ts";
import { I, ICN } from "../lib/dash-icons.tsx";
import {
  customerOptions,
  fmtDay,
  fmtMoneyExact,
  shiftIso,
  todayIso,
} from "../lib/field.ts";
import { langSignal, t } from "../lib/i18n.ts";
import SearchSelect from "./SearchSelect.tsx";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

interface Customer {
  id: string;
  name: string;
  address?: string;
}

function errMsg(e: unknown): string {
  if (e instanceof ApiError && e.body && typeof e.body === "object") {
    const b = e.body as { error?: unknown; message?: unknown };
    if (typeof b.error === "string") return b.error;
    if (typeof b.message === "string") return b.message;
  }
  return t("field.common.error");
}

/** the id of the invoice a 409 names, if any */
function invoiceIdOf(e: unknown): string | null {
  if (
    e instanceof ApiError && e.status === 409 && e.body &&
    typeof e.body === "object"
  ) {
    const id = (e.body as { invoiceId?: unknown }).invoiceId;
    if (typeof id === "string" && id) return id;
  }
  return null;
}

/** every customer, page after page (REQ-137 — the existing resource) */
async function loadAllCustomers(): Promise<Customer[]> {
  const out: Customer[] = [];
  let page = 1;
  for (;;) {
    const res = await clientsClient.list({ page, pageSize: 200 });
    for (const c of res.items) {
      out.push({ id: c.id, name: c.name, address: c.address });
    }
    if (page >= res.totalPages || res.items.length === 0) break;
    page++;
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** "120" / "120.50" → cents, or null when it is not a price */
function centsOf(raw: string): number | null {
  const n = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

const isOpen = (x: TaskView) =>
  x.status !== "skipped" && x.status !== "deferred";

/** one price draft per task — committed on blur / Enter */
type Drafts = Record<string, string>;

interface AddForm {
  customerId: string;
  typeName: string;
  price: string;
  workerId: string;
  address: string;
  date: string;
}

const INPUT =
  "padding:8px 10px;border:1px solid var(--border);border-radius:8px;font:inherit;font-size:13px";

export default function FieldTasksPage() {
  const lang = langSignal.value;
  const [date, setDate] = useState<string>(() => todayIso());
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [skipped, setSkipped] = useState<GenerateResult["skipped"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState("");
  const [busy, setBusy] = useState(false);
  const [priceDraft, setPriceDraft] = useState<Drafts>({});
  const [noteDraft, setNoteDraft] = useState<Drafts>({});
  const [saving, setSaving] = useState<string | null>(null);
  // REQ-164..166 — what the forms pick from
  const [workers, setWorkers] = useState<FieldWorker[]>([]);
  const [types, setTypes] = useState<TaskType[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [add, setAdd] = useState<AddForm | null>(null);
  const [addErr, setAddErr] = useState<string | null>(null);
  const [service, setService] = useState<
    { taskId: string; typeName: string; price: string } | null
  >(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const lastPick = useRef<string | null>(null);

  async function load(d: string) {
    setLoading(true);
    try {
      // REQ-170 — the day materializes on read; the unstaffed list rides along
      const [rows, un] = await Promise.all([
        fieldClient.tasks(d),
        fieldClient.unstaffed(d).catch(() => []),
      ]);
      setTasks(rows);
      setSkipped(un);
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(date);
  }, [date]);

  useEffect(() => {
    let alive = true;
    fieldClient.workers().then((w) => alive && setWorkers(w)).catch(() => {});
    fieldClient.taskTypes().then((x) => alive && setTypes(x)).catch(() => {});
    loadAllCustomers().then((c) => alive && setCustomers(c)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  function go(d: string) {
    if (!ISO.test(d) || d === date) return;
    setFlash("");
    setSkipped([]);
    setPriceDraft({});
    setNoteDraft({});
    setDate(d);
  }

  function replace(next: TaskView) {
    setTasks((rows) => rows.map((x) => (x.id === next.id ? next : x)));
  }

  async function save(
    task: TaskView,
    patch: {
      adminNote?: string;
      priceCents?: number;
      status?: "complete" | "assigned";
      workerId?: string;
    },
  ) {
    setSaving(task.id);
    setError(null);
    try {
      const next = await fieldClient.updateTask(task.id, patch);
      replace(next);
      setFlash(
        patch.workerId
          ? t("field.tk.moved", { name: next.workerName })
          : t("field.tk.saved"),
      );
    } catch (e) {
      const inv = invoiceIdOf(e);
      if (inv) {
        // already on an invoice — lock the price locally and point at the invoice
        replace({ ...task, invoiceId: inv });
      } else {
        setError(errMsg(e));
      }
    } finally {
      setSaving(null);
    }
  }

  // REQ-163 — the confirmed delete
  async function remove(task: TaskView) {
    setSaving(task.id);
    setError(null);
    try {
      await fieldClient.deleteTask(task.id);
      setTasks((rows) => rows.filter((x) => x.id !== task.id));
      setFlash(t("field.tk.deleted"));
    } catch (e) {
      const inv = invoiceIdOf(e);
      if (inv) replace({ ...task, invoiceId: inv });
      else setError(errMsg(e));
    } finally {
      setConfirmDelete(null);
      setSaving(null);
    }
  }

  // REQ-164 — the one-off form
  function openAdd() {
    setAddErr(null);
    lastPick.current = null;
    setAdd({
      customerId: "",
      typeName: "",
      price: "",
      workerId: "",
      address: "",
      date,
    });
  }

  async function submitAdd(e: Event) {
    e.preventDefault();
    if (!add) return;
    const cents = centsOf(add.price);
    if (!add.customerId || !add.typeName.trim() || cents === null) {
      setAddErr(t("field.common.error"));
      return;
    }
    setBusy(true);
    setAddErr(null);
    try {
      const made = await fieldClient.createTask({
        customerId: add.customerId,
        date: add.date,
        taskTypeName: add.typeName.trim(),
        priceCents: cents,
        workerId: add.workerId || undefined,
        address: add.address.trim() || undefined,
      });
      if (made.date === date) setTasks((rows) => [...rows, made]);
      if (!types.some((x) => x.id === made.taskTypeId)) {
        setTypes((x) => [...x, {
          id: made.taskTypeId,
          userId: made.userId,
          name: made.taskTypeName,
          createdAt: "",
        }]);
      }
      setFlash(t("field.tk.added"));
      setAdd(null);
    } catch (err) {
      setAddErr(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  // REQ-165 — a service on the visit
  async function submitService(task: TaskView) {
    if (!service || service.taskId !== task.id) return;
    const name = service.typeName.trim();
    if (!name) return;
    const cents = service.price.trim() === ""
      ? undefined
      : centsOf(service.price);
    if (cents === null) return;
    setSaving(task.id);
    setError(null);
    try {
      const made = await fieldClient.addTaskService(task.id, {
        taskTypeName: name,
        priceCents: cents,
      });
      setTasks((rows) =>
        rows.some((x) => x.id === made.id)
          ? rows.map((x) => (x.id === made.id ? made : x))
          : [...rows, made]
      );
      setFlash(t("field.tk.serviceAdded"));
      setService(null);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(null);
    }
  }

  function commitPrice(task: TaskView) {
    const raw = priceDraft[task.id];
    if (raw === undefined) return;
    setPriceDraft((d) => {
      const { [task.id]: _drop, ...rest } = d;
      return rest;
    });
    const cents = centsOf(raw);
    if (cents === null) return;
    if (cents === task.priceCents) return;
    save(task, { priceCents: cents });
  }

  function commitNote(task: TaskView) {
    const raw = noteDraft[task.id];
    if (raw === undefined) return;
    setNoteDraft((d) => {
      const { [task.id]: _drop, ...rest } = d;
      return rest;
    });
    if (raw === (task.adminNote ?? "")) return;
    save(task, { adminNote: raw });
  }

  const onEnter = (fn: () => void) => (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      (e.currentTarget as HTMLInputElement).blur();
      fn();
    }
  };

  const done = tasks.filter((x) => x.status === "complete").length;
  const open = tasks.filter(isOpen).length;

  // group by worker · zone, in first-seen order
  const groups = new Map<string, TaskView[]>();
  for (const x of tasks) {
    const k = `${x.workerName} · ${x.regionName}`;
    const g = groups.get(k);
    if (g) g.push(x);
    else groups.set(k, [x]);
  }

  // the worker's note belongs to the visit — show it once per subscription+day
  const seenNote = new Set<string>();

  function statusChip(x: TaskView) {
    if (x.status === "complete") {
      return <span class="chip chip--green">{t("field.tk.done")}</span>;
    }
    if (x.status === "skipped") {
      return <span class="chip chip--muted">{t("field.tk.skipped")}</span>;
    }
    if (x.status === "deferred") {
      return (
        <span class="chip chip--amber">
          {t("field.tk.deferred", { date: (x.deferredTo ?? "").slice(5) })}
        </span>
      );
    }
    return <span class="chip">{t("field.tk.assigned")}</span>;
  }

  const typeList = (
    <datalist id="tk-types">
      {types.map((x) => <option key={x.id} value={x.name} />)}
    </datalist>
  );

  function card(x: TaskView) {
    const noteKey = `${x.subscriptionId || x.customerId}|${x.date}`;
    const showNote = !!x.note && !seenNote.has(noteKey);
    if (showNote) seenNote.add(noteKey);
    const locked = !!x.invoiceId;
    const zero = x.addedBy === "worker" && x.priceCents === 0;
    const priceVal = priceDraft[x.id] ?? (x.priceCents / 100).toFixed(2);
    const noteVal = noteDraft[x.id] ?? x.adminNote ?? "";
    const cls = [
      "task",
      x.status === "complete" ? "task--done" : "",
      !isOpen(x) ? "task--skipped" : "",
    ].filter(Boolean)
      .join(" ");
    const asking = confirmDelete === x.id;
    const adding = service?.taskId === x.id;
    return (
      <div
        class={cls}
        key={x.id}
        data-cy="tk-task"
        data-id={x.id}
        data-status={x.status}
        data-worker={x.workerId}
        data-oneoff={x.oneOff ? "true" : undefined}
        style={isOpen(x) ? undefined : "opacity:.55"}
      >
        {/* REQ-159 — the office marks the task done, or re-opens it; inert once invoiced */}
        <button
          type="button"
          class="task__check"
          data-cy="tk-done"
          aria-pressed={x.status === "complete"}
          aria-label={x.status === "complete"
            ? t("field.tk.markOpen")
            : t("field.tk.markDone")}
          title={x.status === "complete"
            ? t("field.tk.markOpen")
            : t("field.tk.markDone")}
          disabled={locked || saving === x.id}
          onClick={() =>
            save(x, {
              status: x.status === "complete" ? "assigned" : "complete",
            })}
        >
          <I d={ICN.check} size={20} sw={3} />
        </button>
        <div>
          <div class="task__type">
            {x.taskTypeName}
            {x.oneOff && (
              <>
                {" "}
                <span class="chip chip--teal">{t("field.tk.oneOff")}</span>
              </>
            )}
            {x.addedBy === "worker" && (
              <>
                {" "}
                <span class="chip chip--pink">
                  {t("field.tk.extra")}
                  {x.addedByName ? ` · ${x.addedByName}` : ""}
                </span>
              </>
            )}
            {x.addedBy === "office" && !x.oneOff && (
              <>
                {" "}
                <span class="chip chip--pink">{t("field.tk.officeExtra")}</span>
              </>
            )}
            {x.deferredFrom && (
              <>
                {" "}
                <span class="chip chip--amber">
                  {t("field.tk.deferredFrom", {
                    date: x.deferredFrom.slice(5),
                  })}
                </span>
              </>
            )}
          </div>
          <div class="task__client">{x.customerName}</div>
          {x.address && <div class="task__addr">{x.address}</div>}
          <div class="hint">
            {x.workerName} · {x.regionName}
          </div>
          {showNote && (
            <div class="task__note">
              💬 <b>{t("field.tk.note")}:</b> {x.note}
            </div>
          )}
          <div
            class="office"
            style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap"
          >
            <input
              type="text"
              data-cy="tk-admin-note"
              placeholder={t("field.tk.officePh")}
              aria-label={t("field.tk.adminNote")}
              value={noteVal}
              disabled={saving === x.id}
              style={`flex:1;min-width:200px;${INPUT}`}
              onInput={(e) => {
                const v = (e.currentTarget as HTMLInputElement).value;
                setNoteDraft((d) => ({ ...d, [x.id]: v }));
              }}
              onBlur={() => commitNote(x)}
              onKeyDown={onEnter(() => commitNote(x))}
            />
            <label style="font-size:12px;color:var(--fg-muted);display:flex;align-items:center;gap:4px">
              {t("field.tk.price")} $
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                class={`num${zero ? " num--zero" : ""}`}
                data-cy="tk-price"
                aria-label={t("field.tk.price")}
                value={priceVal}
                readOnly={locked}
                disabled={saving === x.id}
                title={locked ? t("field.tk.invoiced") : undefined}
                style={`width:96px;text-align:right;${INPUT}`}
                onInput={(e) => {
                  const v = (e.currentTarget as HTMLInputElement).value;
                  setPriceDraft((d) => ({ ...d, [x.id]: v }));
                }}
                onBlur={() => commitPrice(x)}
                onKeyDown={onEnter(() => commitPrice(x))}
              />
            </label>
            {locked && (
              <a
                class="chip chip--amber"
                href="/invoices"
                style="text-decoration:none"
              >
                {t("field.tk.invoiced")}
              </a>
            )}
          </div>
          {/* REQ-163/165/166 — the office's actions on the task */}
          <div
            class="office"
            style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap"
          >
            <label style="font-size:12px;color:var(--fg-muted);display:flex;align-items:center;gap:4px">
              {t("field.tk.worker")}
              <select
                data-cy="tk-worker"
                aria-label={t("field.tk.worker")}
                value={x.workerId}
                disabled={locked || saving === x.id}
                style={INPUT}
                onChange={(e) => {
                  const v = (e.currentTarget as HTMLSelectElement).value;
                  if (v && v !== x.workerId) save(x, { workerId: v });
                }}
              >
                {!workers.some((w) => w.id === x.workerId) && (
                  <option value={x.workerId}>{x.workerName}</option>
                )}
                {workers.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </label>
            {!adding && !asking && (
              <button
                type="button"
                class="btn btn--ghost btn--sm"
                data-cy="tk-add-service"
                disabled={locked || saving === x.id}
                onClick={() => {
                  setConfirmDelete(null);
                  setService({ taskId: x.id, typeName: "", price: "" });
                }}
              >
                <I d={ICN.plus} size={12} /> {t("field.tk.addService")}
              </button>
            )}
            {!adding && !asking && (
              <button
                type="button"
                class="btn btn--ghost btn--sm"
                data-cy="tk-delete"
                disabled={locked || saving === x.id}
                style="color:#a83b3b"
                onClick={() => {
                  setService(null);
                  setConfirmDelete(x.id);
                }}
              >
                <I d={ICN.trash} size={12} /> {t("field.tk.delete")}
              </button>
            )}
            {asking && (
              <span
                data-cy="tk-delete-ask"
                style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"
              >
                <span style="font-size:13px">{t("field.tk.deleteAsk")}</span>
                <button
                  type="button"
                  class="btn btn--danger btn--sm"
                  data-cy="tk-delete-confirm"
                  disabled={saving === x.id}
                  onClick={() => remove(x)}
                >
                  {t("field.tk.deleteYes")}
                </button>
                <button
                  type="button"
                  class="btn btn--ghost btn--sm"
                  data-cy="tk-delete-cancel"
                  onClick={() => setConfirmDelete(null)}
                >
                  {t("field.common.cancel")}
                </button>
              </span>
            )}
          </div>
          {adding && service && (
            <form
              data-cy="tk-service-form"
              style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap"
              onSubmit={(e) => {
                e.preventDefault();
                submitService(x);
              }}
            >
              <input
                type="text"
                list="tk-types"
                data-cy="tk-service-type"
                placeholder={t("field.tk.typePh")}
                aria-label={t("field.tk.type")}
                value={service.typeName}
                required
                style={`flex:1;min-width:160px;${INPUT}`}
                onInput={(e) => {
                  const v = (e.currentTarget as HTMLInputElement).value;
                  setService((s) => s && { ...s, typeName: v });
                }}
              />
              <label style="font-size:12px;color:var(--fg-muted);display:flex;align-items:center;gap:4px">
                $
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  data-cy="tk-service-price"
                  aria-label={t("field.tk.price")}
                  value={service.price}
                  style={`width:96px;text-align:right;${INPUT}`}
                  onInput={(e) => {
                    const v = (e.currentTarget as HTMLInputElement).value;
                    setService((s) => s && { ...s, price: v });
                  }}
                />
              </label>
              <button
                type="submit"
                class="btn btn--green btn--sm"
                data-cy="tk-service-save"
                disabled={saving === x.id}
              >
                {t("field.common.save")}
              </button>
              <button
                type="button"
                class="btn btn--ghost btn--sm"
                data-cy="tk-service-cancel"
                onClick={() => setService(null)}
              >
                {t("field.common.cancel")}
              </button>
            </form>
          )}
        </div>
        <div class="task__meta">
          <b>{fmtMoneyExact(x.priceCents)}</b>
          {statusChip(x)}
        </div>
      </div>
    );
  }

  return (
    <>
      <FieldHead
        eyebrow={t("field.tk.eyebrow", { done, n: open })}
        title={t("field.tk.title")}
        sub={t("field.tk.sub")}
      >
        <label class="field" style="min-width:0">
          {t("field.tk.date")}
          <span style="display:flex;gap:4px;align-items:center">
            <button
              type="button"
              class="btn btn--ghost btn--sm"
              data-cy="tk-prev"
              title="−1"
              onClick={() => go(shiftIso(date, -1))}
            >
              ◀
            </button>
            <input
              type="date"
              data-cy="tk-date"
              value={date}
              onChange={(e) => go((e.currentTarget as HTMLInputElement).value)}
            />
            <button
              type="button"
              class="btn btn--ghost btn--sm"
              data-cy="tk-next"
              title="+1"
              onClick={() => go(shiftIso(date, 1))}
            >
              ▶
            </button>
            <button
              type="button"
              class="btn btn--ghost btn--sm"
              onClick={() => go(todayIso())}
            >
              {t("field.common.today")}
            </button>
          </span>
        </label>
        {/* REQ-164 — the page's one primary action */}
        <button
          type="button"
          class="btn btn--green"
          data-cy="tk-add"
          disabled={busy || add !== null}
          onClick={openAdd}
        >
          <I d={ICN.plus} size={14} /> {t("field.tk.add")}
        </button>
      </FieldHead>

      {typeList}

      {add && (
        <form
          class="panel"
          data-cy="tk-add-form"
          style="margin-bottom:14px"
          onSubmit={submitAdd}
        >
          <h3 class="panel__title">
            <I d={ICN.plus} size={16} /> {t("field.tk.addTitle")}
          </h3>
          <p class="hint" style="margin:0 0 10px">{t("field.tk.addHint")}</p>
          <div class="row">
            <div class="field">
              <span>{t("field.tk.customer")}</span>
              <div data-cy="tk-customer">
                <SearchSelect
                  name="customer"
                  options={customerOptions(customers)}
                  value={add.customerId}
                  placeholder={t("field.tk.pickCustomer")}
                  onSelect={(o) => {
                    const previous = customers.find((c) =>
                      c.id === lastPick.current
                    );
                    lastPick.current = o.id;
                    const picked = customers.find((c) => c.id === o.id);
                    setAdd((f) =>
                      f && {
                        ...f,
                        customerId: o.id,
                        address: !f.address.trim() ||
                            f.address === (previous?.address ?? "")
                          ? picked?.address ?? ""
                          : f.address,
                      }
                    );
                  }}
                  onQuery={(q) => {
                    const current = customers.find((c) =>
                      c.id === add.customerId
                    );
                    if (current && q !== current.name) {
                      setAdd((f) => f && { ...f, customerId: "" });
                    }
                  }}
                />
              </div>
            </div>
            <label class="field">
              <span>{t("field.tk.type")}</span>
              <input
                type="text"
                list="tk-types"
                data-cy="tk-add-type"
                placeholder={t("field.tk.typePh")}
                value={add.typeName}
                required
                onInput={(e) => {
                  const v = (e.currentTarget as HTMLInputElement).value;
                  setAdd((f) => f && { ...f, typeName: v });
                }}
              />
            </label>
            <label class="field">
              <span>{t("field.tk.price")} ($)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                data-cy="tk-add-price"
                value={add.price}
                required
                onInput={(e) => {
                  const v = (e.currentTarget as HTMLInputElement).value;
                  setAdd((f) => f && { ...f, price: v });
                }}
              />
            </label>
          </div>
          <div class="row">
            <label class="field">
              <span>{t("field.tk.worker")}</span>
              <select
                data-cy="tk-add-worker"
                value={add.workerId}
                onChange={(e) => {
                  const v = (e.currentTarget as HTMLSelectElement).value;
                  setAdd((f) => f && { ...f, workerId: v });
                }}
              >
                <option value="">{t("field.tk.pickWorker")}</option>
                {workers.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </label>
            <label class="field">
              <span>{t("field.tk.address")}</span>
              <input
                type="text"
                data-cy="tk-add-address"
                value={add.address}
                onInput={(e) => {
                  const v = (e.currentTarget as HTMLInputElement).value;
                  setAdd((f) => f && { ...f, address: v });
                }}
              />
            </label>
            <label class="field">
              <span>{t("field.tk.date")}</span>
              <input
                type="date"
                data-cy="tk-add-date"
                value={add.date}
                required
                onChange={(e) => {
                  const v = (e.currentTarget as HTMLInputElement).value;
                  setAdd((f) => f && { ...f, date: v });
                }}
              />
            </label>
          </div>
          {addErr && (
            <div class="alert" style="margin:0 0 10px" role="alert">
              {addErr}
            </div>
          )}
          <div style="display:flex;gap:8px;align-items:center">
            <button
              type="submit"
              class="btn btn--green"
              data-cy="tk-add-save"
              disabled={busy}
            >
              {t("field.common.save")}
            </button>
            <button
              type="button"
              class="btn btn--ghost"
              data-cy="tk-add-cancel"
              onClick={() => setAdd(null)}
            >
              {t("field.common.cancel")}
            </button>
          </div>
        </form>
      )}

      <div class="workload" data-cy="tk-summary" style="align-items:center">
        <span class="hint" style="font-weight:700">{fmtDay(date, lang)}</span>
        <span class="chip chip--green">{t("field.tk.done")} {done}</span>
        <span class="chip">
          {t("field.tk.assigned")} {Math.max(0, open - done)}
        </span>
        {tasks.length - open > 0 && (
          <span class="chip chip--muted">
            {t("field.tk.skipped")} {tasks.length - open}
          </span>
        )}
      </div>

      {flash && (
        <div class="chip chip--green" style="margin-bottom:12px">{flash}</div>
      )}
      {error && (
        <div class="alert" style="margin:0 0 12px" role="alert">{error}</div>
      )}

      {skipped.length > 0 && (
        <div class="panel" style="margin-bottom:14px">
          <h3 class="panel__title">
            <I d={ICN.hardhat} size={16} />{" "}
            {t("field.tk.skippedGen", { n: skipped.length })}
          </h3>
          <div class="alert" style="margin:0 0 10px">
            {t("field.asg.unstaffed")}
          </div>
          <div class="tasks">
            {skipped.map((s) => (
              <div
                class="rsub"
                key={s.subscriptionId}
                data-cy="tk-unstaffed"
                style="cursor:default"
              >
                <span class="rsub__name">{s.customerName}</span>
                <span class="rsub__addr">{s.address}</span>
                <a
                  class="chip chip--pink"
                  href="/field/assignments"
                  style="text-decoration:none"
                >
                  {s.regionName}
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading && tasks.length === 0 && (
        <div class="panel hint">{t("field.common.loading")}</div>
      )}
      {!loading && tasks.length === 0 && (
        <div class="panel hint">{t("field.tk.none")}</div>
      )}

      {[...groups.entries()].map(([k, rows]) => (
        <div class="panel" key={k}>
          <h3 class="panel__title">
            <I d={ICN.hardhat} size={16} /> {k}{" "}
            <span class="count">
              {rows.filter((r) => r.status === "complete").length}/{rows.filter(
                isOpen,
              ).length}
            </span>
          </h3>
          <div class="tasks">{rows.map(card)}</div>
        </div>
      ))}
    </>
  );
}
