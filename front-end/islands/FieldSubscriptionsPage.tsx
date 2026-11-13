/**
 * REQ-139/143 — /field/subscriptions. The office's list of recurring service
 * addresses, each with its task types and a price per visit, plus the
 * New / Edit modal. Ported from the a2z demo's suscripciones.html; the data
 * comes from clients/field.ts and the customer picker from the EXISTING
 * customers resource (REQ-137 — nothing about customers changes here).
 * REQ-152 — the customer field is the SearchSelect (REQ-136): type to narrow,
 * pick; the pick fills the address (REQ-144); retyping un-picks.
 */
import Backdrop from "../components/Backdrop.tsx";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  fieldClient,
  type SubscriptionInput,
  type SubscriptionItemInput,
  type SubscriptionView,
  type TaskType,
} from "../clients/field.ts";
import { clientsClient } from "../clients/clients.ts";
import { profileClient } from "../clients/profile.ts";
import FieldHead from "../components/FieldHead.tsx";
import { ApiError } from "../lib/api.ts";
import { I, ICN } from "../lib/dash-icons.tsx";
import {
  customerOptions,
  fmtMoneyExact,
  prefillAddress,
  todayIso,
} from "../lib/field.ts";
import { langSignal, t } from "../lib/i18n.ts";
import SearchSelect from "./SearchSelect.tsx";

/** the cadence <select>'s values: an interval in weeks, or monthly */
type CadenceChoice = "1" | "2" | "3" | "4" | "monthly";

interface Customer {
  id: string;
  name: string;
  /** the address on file — REQ-144 fills the service address with it */
  address?: string;
}

interface Item {
  /** unset = a task type the server creates on save */
  id?: string;
  name: string;
  priceCents: number;
}

/** a combobox row — a known task type, or the "Create" row (no id) */
interface Option {
  id?: string;
  name: string;
}

interface Form {
  editId: string | null;
  customerId: string;
  address: string;
  cadence: CadenceChoice;
  startDate: string;
  days: number[];
  /** REQ-157 — monthly: the picked days of the month */
  daysOfMonth: number[];
  items: Item[];
  /** the combobox query */
  q: string;
  /** true while the query is the user's own typing (a pick or Escape turns it off) */
  searchOn: boolean;
  options: Option[];
  active: number;
  /** the option last picked from the list (its canonical name wins over the typed one) */
  picked: Option | null;
  /** the price input for the row being added, as typed */
  price: string;
  /** REQ-174: days to pay, as typed (prefilled from Settings) */
  netDays: string;
  err: string | null;
  saving: boolean;
}

/** how long a keystroke waits before it asks the API for task types */
const SEARCH_DEBOUNCE_MS = 150;
/** Mon … Sun, the way the chips read */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_LETTERS: Record<"en" | "es", string[]> = {
  en: ["S", "M", "T", "W", "T", "F", "S"],
  es: ["D", "L", "M", "X", "J", "V", "S"],
};

/** REQ-157 — the day of the month of a date, today's when it is not one */
function monthDayOf(iso: string): number {
  const d = Number(iso.slice(8, 10));
  return Number.isInteger(d) && d >= 1 && d <= 31 ? d : new Date().getDate();
}
const MONTH_DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

function weekdayOf(iso: string): number {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? new Date().getDay() : d.getDay();
}

function blankForm(defaultNetDays = 30): Form {
  const startDate = todayIso();
  return {
    editId: null,
    customerId: "",
    address: "",
    cadence: "1",
    startDate,
    days: [weekdayOf(startDate)],
    daysOfMonth: [monthDayOf(startDate)],
    items: [],
    q: "",
    searchOn: false,
    options: [],
    active: -1,
    picked: null,
    price: "",
    netDays: String(defaultNetDays),
    err: null,
    saving: false,
  };
}

function formFor(s: SubscriptionView, defaultNetDays = 30): Form {
  const startDate = (s.startDate ?? s.createdAt).slice(0, 10);
  const cadence: CadenceChoice = s.cadence === "monthly" ? "monthly" : (String(
    s.intervalWeeks ?? (s.cadence === "biweekly" ? 2 : 1),
  ) as CadenceChoice);
  return {
    ...blankForm(defaultNetDays),
    editId: s.id,
    netDays: String(s.netDays ?? defaultNetDays),
    customerId: s.customerId,
    address: s.address,
    cadence: ["1", "2", "3", "4", "monthly"].includes(cadence) ? cadence : "1",
    startDate,
    days: s.days?.length ? s.days : [weekdayOf(startDate)],
    daysOfMonth: s.daysOfMonth?.length
      ? s.daysOfMonth
      : [monthDayOf(startDate)],
    items: s.items.map((i) => ({
      id: i.taskTypeId,
      name: i.taskTypeName,
      priceCents: i.priceCents,
    })),
  };
}

/** the server's message when it sent one; the house fallback otherwise */
function errMsg(err: unknown): string {
  if (err instanceof ApiError) {
    const b = err.body as { error?: unknown; message?: unknown } | null;
    if (b && typeof b === "object") {
      if (typeof b.error === "string") return b.error;
      if (typeof b.message === "string") return b.message;
    }
  }
  if (err instanceof Error && err.message) return err.message;
  return t("field.common.error");
}

/** "Zona 3" reads "Zone 3" in English (the server names zones in Spanish) */
function zoneName(name: string, lang: "en" | "es"): string {
  return lang === "en" ? name.replace(/^Zona /, "Zone ") : name;
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

export default function FieldSubscriptionsPage() {
  const lang = langSignal.value;
  const [subs, setSubs] = useState<SubscriptionView[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  /** REQ-152 — the customer last picked in the open form (its address may sit in the box) */
  const lastPick = useRef<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  // REQ-174: the account's default days to pay, from Settings
  const [defaultNetDays, setDefaultNetDays] = useState(30);
  /** the card whose Delete is waiting for its Confirm */
  const [confirmId, setConfirmId] = useState<string | null>(null);
  /** the card with a request in flight, and the message its last one failed with */
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cardErr, setCardErr] = useState<{ id: string; msg: string } | null>(
    null,
  );
  const qRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);
  const searchSeq = useRef(0);

  async function reload() {
    try {
      const list = await fieldClient.subscriptions();
      setSubs(list);
      setLoadErr(null);
    } catch (err) {
      setLoadErr(errMsg(err));
      setSubs((prev) => prev ?? []);
    }
  }

  useEffect(() => {
    let alive = true;
    fieldClient.subscriptions().then((list) => {
      if (!alive) return;
      setSubs(list);
    }).catch((err: unknown) => {
      if (!alive) return;
      setLoadErr(errMsg(err));
      setSubs([]);
    });
    loadAllCustomers().then((list) => {
      if (alive) setCustomers(list);
    }).catch(() => {
      // the picker stays empty; the modal's error line reports the save failure
    });
    profileClient.get().then((snap) => {
      const n = snap.identity?.invoiceNetDays;
      if (alive && typeof n === "number") setDefaultNetDays(n);
    }).catch(() => {
      // 30 stays the default
    });
    return () => {
      alive = false;
    };
  }, []);

  // ---- the combobox: search as you type, case-insensitive, create when nothing matches exactly ----
  const q = form?.q ?? "";
  const searchOn = form?.searchOn ?? false;
  useEffect(() => {
    if (!searchOn) return;
    const seq = ++searchSeq.current;
    const timer = setTimeout(async () => {
      let found: TaskType[] = [];
      try {
        found = await fieldClient.taskTypes(q);
      } catch {
        found = [];
      }
      if (seq !== searchSeq.current) return;
      setForm((f) => {
        if (!f) return f;
        const typed = f.q.trim();
        const lower = typed.toLowerCase();
        const known = found
          .filter((tt) => tt.name.toLowerCase().includes(lower))
          .filter((tt) => !f.items.some((it) => it.id === tt.id));
        const exact = found.some((tt) => tt.name.toLowerCase() === lower);
        const options: Option[] = typed && !exact
          ? [...known, { name: typed }]
          : known;
        return { ...f, options, active: options.length ? 0 : -1 };
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q, searchOn]);

  function patch(p: Partial<Form>) {
    setForm((f) => (f ? { ...f, ...p } : f));
  }

  function openNew() {
    setConfirmId(null);
    setForm(blankForm(defaultNetDays));
  }

  function openEdit(s: SubscriptionView) {
    setConfirmId(null);
    setForm(formFor(s, defaultNetDays));
  }

  function close() {
    searchSeq.current++;
    setForm(null);
  }

  function pick(i: number) {
    setForm((f) => {
      if (!f) return f;
      const o = f.options[i];
      if (!o) return f;
      searchSeq.current++;
      return {
        ...f,
        q: o.name,
        searchOn: false,
        options: [],
        active: -1,
        picked: o,
      };
    });
    setTimeout(() => priceRef.current?.focus(), 0);
  }

  /** Add the typed task type + price as a row; false when there is nothing valid to add. */
  function addItem(f: Form): Form {
    const typed = f.q.trim();
    const name = f.picked && f.picked.name.toLowerCase() === typed.toLowerCase()
      ? f.picked.name
      : typed;
    const cents = Math.round(Number(f.price) * 100);
    if (!name || !(cents > 0)) return { ...f, err: t("field.subs.noItems") };
    const id = f.picked && f.picked.id &&
        f.picked.name.toLowerCase() === name.toLowerCase()
      ? f.picked.id
      : undefined;
    const dup = f.items.some((it) =>
      it.name.toLowerCase() === name.toLowerCase()
    );
    const items = dup ? f.items : [...f.items, { id, name, priceCents: cents }];
    searchSeq.current++;
    return {
      ...f,
      items,
      q: "",
      searchOn: false,
      options: [],
      active: -1,
      picked: null,
      price: "",
      err: null,
    };
  }

  function onAddItem() {
    setForm((f) => (f ? addItem(f) : f));
    setTimeout(() => qRef.current?.focus(), 0);
  }

  function onComboKey(e: KeyboardEvent) {
    if (!form) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      patch({ active: Math.min(form.active + 1, form.options.length - 1) });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      patch({ active: Math.max(form.active - 1, 0) });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (form.options.length) pick(Math.max(form.active, 0));
      else priceRef.current?.focus();
    } else if (e.key === "Escape") {
      e.stopPropagation();
      searchSeq.current++;
      patch({ searchOn: false, options: [], active: -1 });
    }
  }

  function toggleDay(d: number) {
    setForm((f) => {
      if (!f) return f;
      const days = f.days.includes(d)
        ? f.days.filter((x) => x !== d)
        : [...f.days, d].sort((a, b) => a - b);
      return { ...f, days };
    });
  }

  /** REQ-157 — a day of the month on or off */
  function toggleMonthDay(d: number) {
    setForm((f) => {
      if (!f) return f;
      const daysOfMonth = f.daysOfMonth.includes(d)
        ? f.daysOfMonth.filter((x) => x !== d)
        : [...f.daysOfMonth, d].sort((a, b) => a - b);
      return { ...f, daysOfMonth };
    });
  }

  function onStartDate(v: string) {
    setForm((
      f,
    ) => (f
      ? {
        ...f,
        startDate: v,
        days: f.days.length ? f.days : [weekdayOf(v)],
        daysOfMonth: f.daysOfMonth.length ? f.daysOfMonth : [monthDayOf(v)],
      }
      : f)
    );
  }

  async function submit(e: Event) {
    e.preventDefault();
    if (!form || form.saving) return;
    // a typed-but-not-added row counts, as in the demo
    let f: Form = { ...form, err: null };
    if (form.q.trim() || form.price) {
      f = addItem(f);
      if (f.err) {
        setForm(f);
        return;
      }
    }
    if (!f.editId && !f.customerId) {
      setForm({ ...f, err: t("field.subs.pickCustomer") });
      return;
    }
    if (!f.address.trim()) {
      setForm({ ...f, err: t("field.subs.addressPh") });
      return;
    }
    if (!f.items.length) {
      setForm({ ...f, err: t("field.subs.noItems") });
      return;
    }
    const monthly = f.cadence === "monthly";
    if (monthly ? !f.daysOfMonth.length : !f.days.length) {
      setForm({ ...f, err: t("field.subs.daysHint") });
      return;
    }
    // REQ-174: a whole number of days, 0–365
    const netDays = Number(f.netDays);
    if (
      f.netDays.trim() === "" || !Number.isInteger(netDays) || netDays < 0 ||
      netDays > 365
    ) {
      setForm({ ...f, err: t("field.subs.netDays") + ": 0–365" });
      return;
    }
    const items: SubscriptionItemInput[] = f.items.map((it) => ({
      ...(it.id ? { taskTypeId: it.id } : {}),
      taskTypeName: it.name,
      priceCents: it.priceCents,
    }));
    const n = Number(f.cadence);
    const schedule: Pick<
      SubscriptionInput,
      "cadence" | "intervalWeeks" | "days" | "daysOfMonth" | "startDate"
    > = monthly
      ? {
        cadence: "monthly",
        startDate: f.startDate,
        daysOfMonth: f.daysOfMonth,
      }
      : {
        cadence: n === 2 ? "biweekly" : "weekly",
        intervalWeeks: n,
        days: f.days,
        startDate: f.startDate,
      };
    setForm({ ...f, saving: true });
    try {
      if (f.editId) {
        await fieldClient.updateSubscription(f.editId, {
          address: f.address.trim(),
          ...schedule,
          items,
          netDays,
        });
      } else {
        await fieldClient.createSubscription({
          customerId: f.customerId,
          address: f.address.trim(),
          ...schedule,
          items,
          netDays,
        });
      }
      close();
      await reload();
    } catch (err) {
      setForm((
        cur,
      ) => (cur ? { ...cur, saving: false, err: errMsg(err) } : cur));
    }
  }

  async function toggle(s: SubscriptionView) {
    setBusyId(s.id);
    setCardErr(null);
    try {
      const next = await fieldClient.updateSubscription(s.id, {
        active: !s.active,
      });
      setSubs((list) => (list ?? []).map((x) => (x.id === s.id ? next : x)));
    } catch (err) {
      setCardErr({ id: s.id, msg: errMsg(err) });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(s: SubscriptionView) {
    setBusyId(s.id);
    setCardErr(null);
    try {
      await fieldClient.deleteSubscription(s.id);
      setConfirmId(null);
      setSubs((list) => (list ?? []).filter((x) => x.id !== s.id));
    } catch (err) {
      setCardErr({ id: s.id, msg: errMsg(err) });
    } finally {
      setBusyId(null);
    }
  }

  const list = subs ?? [];
  const activeCount = list.filter((s) => s.active).length;
  useEffect(() => {
    if (!form) lastPick.current = null;
  }, [form === null]);

  const customerKnown = form
    ? customers.some((c) => c.id === form.customerId)
    : true;
  // REQ-152 — the search rows; an edited subscription's customer is listed even before the fetch lands
  const customerChoices = customerKnown || !form?.customerId
    ? customerOptions(customers)
    : [
      {
        id: form.customerId,
        label: list.find((s) => s.id === form.editId)?.customerName ??
          form.customerId,
      },
      ...customerOptions(customers),
    ];

  return (
    <>
      <FieldHead
        eyebrow={t("field.subs.eyebrow", { n: activeCount })}
        title={t("field.subs.title")}
        sub={t("field.subs.sub")}
      >
        <button
          type="button"
          class="btn btn--pink"
          data-cy="subs-new"
          onClick={openNew}
        >
          <I d={ICN.plus} size={14} sw={2.5} /> {t("field.subs.new")}
        </button>
      </FieldHead>

      {loadErr && <p class="alert">{loadErr}</p>}

      {subs === null
        ? (
          <div class="hint" style="padding:12px 4px">
            {t("field.common.loading")}
          </div>
        )
        : (
          <div class="subs">
            {list.map((s) => {
              const busy = busyId === s.id;
              const confirming = confirmId === s.id;
              return (
                <div
                  class={`sub${s.active ? "" : " sub--off"}`}
                  data-cy="subs-card"
                  data-id={s.id}
                  key={s.id}
                >
                  <div class="sub__client">
                    <span>{s.customerName}</span>
                    {s.region
                      ? (
                        <span
                          class="chip"
                          style={`background:${s.region.color}22;color:${s.region.color}`}
                        >
                          <span
                            class="dot"
                            style={`background:${s.region.color}`}
                          />
                          {zoneName(s.region.name, lang)}
                          {s.region.workerId
                            ? ""
                            : ` · ${t("field.subs.noWorker")}`}
                          {s.pinned ? " 📌" : ""}
                        </span>
                      )
                      : <span class="chip">{t("field.subs.noRegion")}</span>}
                  </div>
                  <div
                    class="sub__addr"
                    style="display:flex;align-items:center;gap:6px"
                  >
                    <I d={ICN.pin} size={12} /> <span>{s.address}</span>
                  </div>
                  <div class="sub__items">
                    {s.items.map((it) => (
                      <div key={it.taskTypeId}>
                        <span>{it.taskTypeName}</span>
                        <b>{fmtMoneyExact(it.priceCents)}</b>
                      </div>
                    ))}
                  </div>
                  {
                    /* REQ-699 (demo-loop cycle 5, M20): a subscription a
                      signed quote made says so — "From Q-001 · Monthly ·
                      $180/mo" — and opens that quote */
                  }
                  {s.quoteId && (
                    <a
                      class="hint"
                      data-cy="subs-from-quote"
                      href={`/quotes?open=${s.quoteId}`}
                      style="display:block;text-decoration:none"
                    >
                      {t("field.subs.fromQuote", {
                        quote: s.quoteNumber ?? "",
                      })}
                      {s.billing ? ` · ${s.billing[lang]}` : ""}
                    </a>
                  )}
                  {cardErr?.id === s.id && (
                    <p class="alert" style="margin:0">{cardErr.msg}</p>
                  )}
                  <div class="sub__foot">
                    <span>
                      {s.schedule
                        ? s.schedule[lang]
                        : t(`field.subs.${s.cadence}`)} ·{" "}
                      {s.active
                        ? t("field.subs.active")
                        : t("field.subs.paused")}
                    </span>
                    <span style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
                      {confirming
                        ? (
                          <>
                            <span class="hint" style="align-self:center">
                              {t("field.subs.confirmDelete")}
                            </span>
                            <button
                              type="button"
                              class="btn btn--danger btn--sm"
                              data-cy="subs-delete-confirm"
                              disabled={busy}
                              onClick={() => remove(s)}
                            >
                              {t("field.common.confirm")}
                            </button>
                            <button
                              type="button"
                              class="btn btn--ghost btn--sm"
                              data-cy="subs-delete-cancel"
                              disabled={busy}
                              onClick={() => setConfirmId(null)}
                            >
                              {t("field.common.cancel")}
                            </button>
                          </>
                        )
                        : (
                          <>
                            <button
                              type="button"
                              class="btn btn--ghost btn--sm"
                              data-cy="subs-edit"
                              disabled={busy}
                              onClick={() => openEdit(s)}
                            >
                              {t("field.subs.edit")}
                            </button>
                            <button
                              type="button"
                              class="btn btn--ghost btn--sm"
                              data-cy="subs-toggle"
                              disabled={busy}
                              onClick={() => toggle(s)}
                            >
                              {s.active
                                ? t("field.subs.pause")
                                : t("field.subs.resume")}
                            </button>
                            <button
                              type="button"
                              class="btn btn--danger btn--sm"
                              data-cy="subs-delete"
                              disabled={busy}
                              onClick={() => {
                                setCardErr(null);
                                setConfirmId(s.id);
                              }}
                            >
                              {t("field.subs.delete")}
                            </button>
                          </>
                        )}
                    </span>
                  </div>
                </div>
              );
            })}
            {list.length === 0 && (
              <div class="hint" style="padding:12px 4px">
                {t("field.subs.empty")}
              </div>
            )}
          </div>
        )}

      {form && (
        <Backdrop
          class="modal-bg"
          onClose={() => close()}
        >
          <form class="modal" onSubmit={submit} data-cy="subs-form">
            <h2>
              {form.editId ? t("field.subs.editTitle") : t("field.subs.new")}
            </h2>

            <div class="field">
              <span>{t("field.subs.client")}</span>
              <div data-cy="subs-customer">
                <SearchSelect
                  name="customer"
                  options={customerChoices}
                  value={form.customerId}
                  placeholder={t("field.subs.pickCustomer")}
                  disabled={form.editId !== null}
                  onSelect={(o) => {
                    // REQ-144: the pick fills the service address, never over a typed one —
                    // "over the previous pick's" counts as untouched, even after a retype un-picked it
                    const previous = customers.find((c) =>
                      c.id === lastPick.current
                    );
                    lastPick.current = o.id;
                    setForm((f) =>
                      f
                        ? {
                          ...f,
                          customerId: o.id,
                          address: prefillAddress(
                            f.address,
                            previous,
                            customers.find((c) => c.id === o.id),
                          ),
                        }
                        : f
                    );
                  }}
                  onQuery={(q) => {
                    // REQ-152: a cleared or retyped box is no longer a pick
                    setForm((f) => {
                      if (!f || !f.customerId) return f;
                      const cur = customers.find((c) => c.id === f.customerId);
                      return cur && q === cur.name
                        ? f
                        : { ...f, customerId: "" };
                    });
                  }}
                />
              </div>
              <span class="hint">
                {t("field.subs.manageCustomers")}{" "}
                <a href="/customers">{t("nav.customers")}</a>
              </span>
            </div>

            <label class="field">
              {t("field.subs.address")}
              <input
                name="address"
                data-cy="subs-address"
                required
                placeholder={t("field.subs.addressPh")}
                value={form.address}
                onInput={(e) =>
                  patch({
                    address: (e.currentTarget as HTMLInputElement).value,
                  })}
              />
              <span class="hint">{t("field.subs.geo")}</span>
            </label>

            <div class="row">
              <label class="field">
                {t("field.subs.cadence")}
                <select
                  name="cadence"
                  data-cy="subs-cadence"
                  value={form.cadence}
                  onChange={(e) =>
                    patch({
                      cadence: (e.currentTarget as HTMLSelectElement)
                        .value as CadenceChoice,
                    })}
                >
                  <option value="1">{t("field.subs.weekly")}</option>
                  {/* REQ-157 — weekly or monthly; an older every-N-weeks subscription keeps its own */}
                  {form.cadence === "2" && (
                    <option value="2">{t("field.subs.biweekly")}</option>
                  )}
                  {form.cadence === "3" && (
                    <option value="3">{t("field.subs.every3")}</option>
                  )}
                  {form.cadence === "4" && (
                    <option value="4">{t("field.subs.every4")}</option>
                  )}
                  <option value="monthly">{t("field.subs.monthly")}</option>
                </select>
              </label>
              <label class="field">
                {t("field.subs.start")}
                <input
                  type="date"
                  name="startDate"
                  data-cy="subs-start"
                  value={form.startDate}
                  onChange={(e) =>
                    onStartDate((e.currentTarget as HTMLInputElement).value)}
                />
              </label>
            </div>

            {/* REQ-174: days to pay, from the day the invoice is sent */}
            <div class="row">
              <label class="field">
                {t("field.subs.netDays")}
                <input
                  type="number"
                  name="netDays"
                  min="0"
                  max="365"
                  step="1"
                  data-cy="subs-net-days"
                  value={form.netDays}
                  onInput={(e) =>
                    patch({
                      netDays: (e.currentTarget as HTMLInputElement).value,
                    })}
                />
                <span class="hint">
                  {t("field.subs.netDaysHint", { n: defaultNetDays })}
                </span>
              </label>
            </div>

            {form.cadence !== "monthly" && (
              <div class="field" data-cy="subs-days">
                {t("field.subs.days")}
                <div class="days">
                  {DAY_ORDER.map((d) => {
                    const on = form.days.includes(d);
                    return (
                      <label
                        class={`day${on ? " on" : ""}`}
                        key={d}
                        data-cy="subs-day"
                        data-day={d}
                      >
                        <input
                          type="checkbox"
                          name="days"
                          value={d}
                          checked={on}
                          onChange={() => toggleDay(d)}
                        />
                        {DAY_LETTERS[lang][d]}
                      </label>
                    );
                  })}
                </div>
                <span class="hint">{t("field.subs.daysHint")}</span>
              </div>
            )}

            {form.cadence === "monthly" && (
              <div class="field" data-cy="subs-dom">
                {t("field.subs.daysOfMonth")}
                <div class="days dom">
                  {MONTH_DAYS.map((d) => {
                    const on = form.daysOfMonth.includes(d);
                    return (
                      <label
                        class={`day${on ? " on" : ""}`}
                        key={d}
                        data-cy="subs-dom-day"
                        data-dom={d}
                      >
                        <input
                          type="checkbox"
                          name="daysOfMonth"
                          value={d}
                          checked={on}
                          onChange={() => toggleMonthDay(d)}
                        />
                        {d}
                      </label>
                    );
                  })}
                </div>
                <span class="hint">{t("field.subs.domHint")}</span>
              </div>
            )}

            <div class="field">
              {t("field.subs.taskTypes")}
              <div class="items">
                {form.items.map((it, i) => (
                  <div
                    class="items__row"
                    key={`${it.name}-${i}`}
                    data-cy="subs-item"
                  >
                    <span class="name">{it.name}</span>
                    <input
                      class="price"
                      type="number"
                      min="0"
                      step="0.01"
                      aria-label={t("field.subs.pricePh")}
                      value={(it.priceCents / 100).toFixed(2)}
                      onChange={(e) => {
                        const cents = Math.round(
                          Number((e.currentTarget as HTMLInputElement).value) *
                            100,
                        );
                        setForm((f) =>
                          f
                            ? {
                              ...f,
                              items: f.items.map((
                                x,
                                j,
                              ) => (j === i ? { ...x, priceCents: cents } : x)),
                            }
                            : f
                        );
                      }}
                    />
                    <button
                      type="button"
                      class="x"
                      aria-label={t("field.common.close")}
                      data-cy="subs-item-remove"
                      onClick={() =>
                        setForm((f) => (f
                          ? {
                            ...f,
                            items: f.items.filter((_, j) => j !== i),
                          }
                          : f)
                        )}
                    >
                      <I d={ICN.x} size={12} sw={2.5} />
                    </button>
                  </div>
                ))}
              </div>
              <div class="items__row" style="margin-top:6px">
                <div class="combo">
                  <input
                    ref={qRef}
                    data-cy="subs-type-q"
                    placeholder={t("field.subs.taskPh")}
                    autocomplete="off"
                    role="combobox"
                    aria-expanded={form.options.length > 0}
                    aria-autocomplete="list"
                    value={form.q}
                    style="width:100%;box-sizing:border-box;padding:11px 13px;border:1px solid var(--border);border-radius:10px;font:inherit;font-size:15px;font-weight:400;color:var(--fg)"
                    onInput={(e) =>
                      patch({
                        q: (e.currentTarget as HTMLInputElement).value,
                        searchOn: true,
                        picked: null,
                      })}
                    onFocus={() => {
                      if (form && !form.options.length && !form.q) {
                        patch({ searchOn: true });
                      }
                    }}
                    onKeyDown={onComboKey}
                  />
                  {form.options.length > 0 && (
                    <div
                      class="combo__list"
                      role="listbox"
                      data-cy="subs-type-list"
                    >
                      {form.options.map((o, i) => (
                        <div
                          key={o.id ?? `new:${o.name}`}
                          role="option"
                          aria-selected={i === form.active}
                          class={`combo__opt${
                            i === form.active ? " combo__opt--active" : ""
                          }${o.id ? "" : " combo__opt--new"}`}
                          data-cy={o.id ? "subs-type-opt" : "subs-type-create"}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            pick(i);
                          }}
                        >
                          {o.id
                            ? o.name
                            : t("field.subs.create", { name: o.name })}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <input
                  ref={priceRef}
                  class="price"
                  type="number"
                  min="0"
                  step="0.01"
                  data-cy="subs-price"
                  placeholder={t("field.subs.pricePh")}
                  value={form.price}
                  onInput={(e) =>
                    patch({
                      price: (e.currentTarget as HTMLInputElement).value,
                    })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onAddItem();
                    }
                  }}
                />
                <button
                  type="button"
                  class="x"
                  title={t("field.subs.add")}
                  data-cy="subs-add-item"
                  onClick={onAddItem}
                >
                  <I d={ICN.plus} size={14} sw={2.5} />
                </button>
              </div>
              <span class="hint">{t("field.subs.noItems")}</span>
            </div>

            {form.err && <p class="alert" data-cy="subs-error">{form.err}</p>}

            <div class="modal__foot">
              <button type="button" class="btn--cancel" onClick={close}>
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                class="btn--submit"
                data-cy="subs-submit"
                disabled={form.saving}
              >
                {form.saving
                  ? t("field.common.loading")
                  : form.editId
                  ? t("field.common.save")
                  : t("common.add")}
              </button>
            </div>
          </form>
        </Backdrop>
      )}
    </>
  );
}
