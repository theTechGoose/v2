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
  type ChecklistView,
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
  ownItems,
  perVisitCents,
  prefillAddress,
  todayIso,
} from "../lib/field.ts";
import {
  overheadCentsFor,
  type OverheadSetting,
  overheadSetting,
  overheadText,
} from "../../shared/field/overhead.ts";
import { langSignal, t } from "../lib/i18n.ts";
import { formatLongDate } from "../../shared/quote-flow/format-helpers.ts";
import type { FieldSubscriptionsSeed } from "../lib/field-ssr.ts";
import SearchSelect from "./SearchSelect.tsx";
import ServiceSelect from "../components/ServiceSelect.tsx"; // REQ-921

/** the cadence <select>'s values: an interval in weeks, monthly, or (REQ-787) annual */
type CadenceChoice = "1" | "2" | "3" | "4" | "monthly" | "annual";

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

interface Form {
  editId: string | null;
  customerId: string;
  address: string;
  cadence: CadenceChoice;
  startDate: string;
  days: number[];
  /** REQ-157 — monthly: the picked days of the month (REQ-787: annual's days in its month) */
  daysOfMonth: number[];
  /** REQ-787 — annual: the month, 1–12 */
  month: number;
  /** REQ-811 — the checklist referenced ("" = none); its rows are included on every visit */
  checklistId: string;
  /** the visit's OWN rows (REQ-811: extras beside the checklist, or everything when there is none) */
  items: Item[];
  /** REQ-921: the service picked in the dropdown for the row being added ("" = none) */
  pickId: string;
  /** the price input for the row being added, as typed */
  price: string;
  /** REQ-174: days to pay, as typed (prefilled from Settings) */
  netDays: string;
  /** REQ-788: every visit bills the overhead cost set in Settings */
  overhead: boolean;
  err: string | null;
  saving: boolean;
}

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

/** REQ-787 — the month of a date (1–12), today's when it is not one */
function monthOf(iso: string): number {
  const m = Number(iso.slice(5, 7));
  return Number.isInteger(m) && m >= 1 && m <= 12
    ? m
    : new Date().getMonth() + 1;
}
/** REQ-787 — the year an annual visit in `month` first falls: the first visit's year, or the next one when that month is already behind it */
function annualYear(startIso: string, month: number): number {
  const y = Number(startIso.slice(0, 4));
  const year = Number.isInteger(y) && y > 1900 ? y : new Date().getFullYear();
  return month >= monthOf(startIso) ? year : year + 1;
}
/** days in a month (1–12) of a year */
const daysIn = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();
/** weekday (0 = Sunday) of a date in a year/month */
const weekdayAt = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day)).getUTCDay();
const monthName = (lang: "en" | "es", month: number, year?: number) => {
  const name = new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", {
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2000, month - 1, 1)));
  const cap = name.charAt(0).toUpperCase() + name.slice(1);
  if (year === undefined) return cap;
  return lang === "es" ? `${cap} de ${year}` : `${cap} ${year}`;
};
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

function weekdayOf(iso: string): number {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? new Date().getDay() : d.getDay();
}

/** REQ-940 — `today`: the business's day from the server; the browser's only until it answers */
function blankForm(defaultNetDays = 30, today?: string | null): Form {
  const startDate = today || todayIso();
  return {
    editId: null,
    customerId: "",
    address: "",
    cadence: "1",
    startDate,
    days: [weekdayOf(startDate)],
    daysOfMonth: [monthDayOf(startDate)],
    month: monthOf(startDate),
    checklistId: "",
    items: [],
    pickId: "",
    price: "",
    netDays: String(defaultNetDays),
    overhead: false,
    err: null,
    saving: false,
  };
}

function formFor(s: SubscriptionView, defaultNetDays = 30): Form {
  const startDate = (s.startDate ?? s.createdAt).slice(0, 10);
  const cadence: CadenceChoice =
    s.cadence === "monthly" || s.cadence === "annual" ? s.cadence : (String(
      s.intervalWeeks ?? (s.cadence === "biweekly" ? 2 : 1),
    ) as CadenceChoice);
  return {
    ...blankForm(defaultNetDays),
    editId: s.id,
    netDays: String(s.netDays ?? defaultNetDays),
    overhead: s.overhead === true,
    customerId: s.customerId,
    address: s.address,
    cadence: ["1", "2", "3", "4", "monthly", "annual"].includes(cadence)
      ? cadence
      : "1",
    startDate,
    days: s.days?.length ? s.days : [weekdayOf(startDate)],
    daysOfMonth: s.daysOfMonth?.length
      ? s.daysOfMonth
      : [monthDayOf(startDate)],
    month: s.month ?? monthOf(startDate),
    checklistId: s.checklistId ?? "",
    // REQ-811: the checklist's rows stay the checklist's — only the visit's own are edited here
    items: ownItems(s).map((i) => ({
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

/** REQ-730 (demo c2-p13-p) — `seed`: the cards read by the route on the SSR side; the first HTML carries them, not "Loading…" */
export default function FieldSubscriptionsPage(
  { seed }: { seed?: FieldSubscriptionsSeed | null } = {},
) {
  const lang = langSignal.value;
  const [subs, setSubs] = useState<SubscriptionView[] | null>(
    seed?.subs ?? null,
  );
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  /** REQ-811 — the account's checklists, for the form's Checklist select */
  const [checklists, setChecklists] = useState<ChecklistView[]>([]);
  /** REQ-152 — the customer last picked in the open form (its address may sit in the box) */
  const lastPick = useRef<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  // REQ-174: the account's default days to pay, from Settings
  const [defaultNetDays, setDefaultNetDays] = useState(30);
  // REQ-788: the account's overhead per visit, from Settings — flat cents or a percent of the services
  const [overhead, setOverhead] = useState<OverheadSetting>({
    mode: "flat",
    cents: 0,
  });
  /** the card whose Delete is waiting for its Confirm */
  const [confirmId, setConfirmId] = useState<string | null>(null);
  /** the card with a request in flight, and the message its last one failed with */
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cardErr, setCardErr] = useState<{ id: string; msg: string } | null>(
    null,
  );
  const priceRef = useRef<HTMLInputElement>(null);
  /** REQ-921: the services catalogue — the only thing a visit can bill */
  const [catalog, setCatalog] = useState<TaskType[] | null>(null);

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

  // REQ-940 — a new subscription starts on the business's day, not the browser's
  const [bizToday, setBizToday] = useState<string | null>(null);
  useEffect(() => {
    fieldClient.today().then((r) => setBizToday(r.date)).catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    // REQ-730 — seeded on the server: the list is already here
    if (!seed) {
      fieldClient.subscriptions().then((list) => {
        if (!alive) return;
        setSubs(list);
      }).catch((err: unknown) => {
        if (!alive) return;
        setLoadErr(errMsg(err));
        setSubs([]);
      });
    }
    loadAllCustomers().then((list) => {
      if (alive) setCustomers(list);
    }).catch(() => {
      // the picker stays empty; the modal's error line reports the save failure
    });
    fieldClient.taskTypes("").then((list) => {
      if (alive) setCatalog(list);
    }).catch(() => {
      if (alive) setCatalog([]);
    });
    fieldClient.checklists().then((list) => {
      if (alive) setChecklists(list);
    }).catch(() => {
      // REQ-811: the select offers "None" only; the rows below still work
    });
    profileClient.get().then((snap) => {
      const n = snap.identity?.invoiceNetDays;
      if (alive && typeof n === "number") {
        setDefaultNetDays(n);
        // REQ-174: a new form opened before Settings arrived still holds the
        // fallback 30 — take the account's number unless it was typed over
        setForm((f) =>
          f && !f.editId && f.netDays === "30"
            ? { ...f, netDays: String(n) }
            : f
        );
      }
      if (alive) setOverhead(overheadSetting(snap.identity));
    }).catch(() => {
      // 30 stays the default
    });
    return () => {
      alive = false;
    };
  }, []);

  function patch(p: Partial<Form>) {
    setForm((f) => (f ? { ...f, ...p } : f));
  }

  /** REQ-921: the dropdown reads the catalogue as it is when the form opens */
  function refreshCatalog() {
    fieldClient.taskTypes("").then(setCatalog).catch(() => {
      // the list loaded at mount stays
    });
  }

  function openNew() {
    setConfirmId(null);
    setForm(blankForm(defaultNetDays, bizToday));
    refreshCatalog();
  }

  // REQ-924: the customer page's "Start recurring service" (?new=1&customerId=<id>) opens the form
  // with her chosen and her address filled; its "Edit" (?edit=<subscription>) opens that one; with
  // ?back=<path> a save returns there
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || typeof globalThis.location === "undefined") {
      return;
    }
    const p = new URLSearchParams(globalThis.location.search);
    const edit = p.get("edit");
    if (edit) {
      const sub = subs?.find((x) => x.id === edit);
      if (!sub) return;
      deepLinked.current = true;
      openEdit(sub);
      return;
    }
    if (p.get("new") !== "1") {
      deepLinked.current = true;
      return;
    }
    const customerId = p.get("customerId");
    if (customerId && !customers.length) return;
    deepLinked.current = true;
    const c = customers.find((x) => x.id === customerId);
    setConfirmId(null);
    setForm({
      ...blankForm(defaultNetDays, bizToday),
      ...(c ? { customerId: c.id, address: c.address ?? "" } : {}),
    });
  }, [customers, subs]);

  /** REQ-924: back to the page that sent us here (a same-site path only) */
  function backTarget(): string | null {
    if (typeof globalThis.location === "undefined") return null;
    const back = new URLSearchParams(globalThis.location.search).get("back");
    return back && back.startsWith("/") && !back.startsWith("//") ? back : null;
  }

  function openEdit(s: SubscriptionView) {
    setConfirmId(null);
    setForm(formFor(s, defaultNetDays));
    refreshCatalog();
  }

  function close() {
    setForm(null);
  }

  /** REQ-921: add the picked service + price as a row; an error when either is missing */
  function addItem(f: Form): Form {
    const svc = (catalog ?? []).find((c) => c.id === f.pickId);
    const cents = Math.round(Number(f.price) * 100);
    if (!svc) return { ...f, err: t("serviceLines.err.pick") };
    if (!(cents > 0)) return { ...f, err: t("serviceLines.err.price") };
    const dup = f.items.some((it) => it.id === svc.id);
    const items = dup
      ? f.items
      : [...f.items, { id: svc.id, name: svc.name, priceCents: cents }];
    return { ...f, items, pickId: "", price: "", err: null };
  }

  function onAddItem() {
    setForm((f) => (f ? addItem(f) : f));
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

  /** REQ-787 — the annual month; picks past its last day are dropped */
  function onMonth(month: number) {
    setForm((f) => {
      if (!f) return f;
      const last = daysIn(annualYear(f.startDate, month), month);
      const kept = f.daysOfMonth.filter((d) => d <= last);
      return { ...f, month, daysOfMonth: kept.length ? kept : [last] };
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
    // a picked-but-not-added row counts, as in the demo
    let f: Form = { ...form, err: null };
    if (form.pickId || form.price) {
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
    if (!f.items.length && !f.checklistId) { // REQ-811: a checklist stands in for the rows
      setForm({ ...f, err: t("field.subs.noItemsOrChecklist") });
      return;
    }
    const annual = f.cadence === "annual"; // REQ-787
    const monthly = f.cadence === "monthly";
    if (monthly || annual ? !f.daysOfMonth.length : !f.days.length) {
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
      | "cadence"
      | "intervalWeeks"
      | "days"
      | "daysOfMonth"
      | "month"
      | "startDate"
    > = annual
      ? {
        cadence: "annual",
        startDate: f.startDate,
        month: f.month,
        daysOfMonth: f.daysOfMonth,
      }
      : monthly
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
          checklistId: f.checklistId || null, // REQ-811: null clears it
          netDays,
          overhead: f.overhead,
        });
      } else {
        await fieldClient.createSubscription({
          customerId: f.customerId,
          address: f.address.trim(),
          ...schedule,
          items,
          ...(f.checklistId ? { checklistId: f.checklistId } : {}), // REQ-811
          netDays,
          overhead: f.overhead,
        });
      }
      close();
      const back = backTarget();
      if (back) {
        globalThis.location.assign(back);
        return;
      }
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
                  {/* REQ-811: the checklist this visit references — its own line, so the name and zone keep theirs */}
                  {s.checklistName && (
                    <div
                      class="sub__addr"
                      data-cy="subs-card-checklist"
                      style="display:flex;align-items:center;gap:6px"
                    >
                      <I d={ICN.list} size={12} />{" "}
                      <span>
                        {t("field.subs.checklist")}: <b>{s.checklistName}</b>
                      </span>
                    </div>
                  )}
                  <div class="sub__items">
                    {s.items.map((it) => (
                      <div
                        key={it.taskTypeId}
                        data-cy={it.fromChecklist
                          ? "subs-item-from-checklist"
                          : "subs-card-item"}
                      >
                        <span>
                          {it.taskTypeName}
                          {/* REQ-811: a row the checklist contributes, not one of the visit's own */}
                          {it.fromChecklist && (
                            <span
                              class="chip chip--muted"
                              style="margin-left:6px;font-size:11px"
                            >
                              {t("field.subs.fromChecklist")}
                            </span>
                          )}
                        </span>
                        <b>{fmtMoneyExact(it.priceCents)}</b>
                      </div>
                    ))}
                    {/* REQ-788: the overhead, when the toggle is on */}
                    {s.overhead && (
                      <div data-cy="subs-card-overhead">
                        <span>{t("field.subs.overheadLabel")}</span>
                        <b>
                          {fmtMoneyExact(
                            overheadCentsFor(overhead, perVisitCents(s)),
                          )}
                          {overhead.mode === "percent"
                            ? ` · ${overheadText(overhead)}`
                            : ""}
                        </b>
                      </div>
                    )}
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
            {/* REQ-788: the title, and the Overhead toggle in the upper right — a weekday chip */}
            <div class="modal__head">
              <h2>
                {form.editId ? t("field.subs.editTitle") : t("field.subs.new")}
              </h2>
              <div class="days">
                <label
                  class={`day day--wide${form.overhead ? " on" : ""}`}
                  data-cy="subs-overhead"
                  title={overheadCentsFor(overhead, 100) > 0
                    ? ""
                    : t("field.subs.overheadHint")}
                >
                  <input
                    type="checkbox"
                    name="overhead"
                    checked={form.overhead}
                    onChange={() => patch({ overhead: !form.overhead })}
                  />
                  {t("field.subs.overhead", { amount: overheadText(overhead) })}
                </label>
              </div>
            </div>

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
                <a class="link" href="/customers">{t("nav.customers")}</a>
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
                  <option value="annual">{t("field.subs.annual")}</option>
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
                {
                  /* REQ-713 (cycle 5, m27): the native date input draws the
                    BROWSER locale (11/12/2026 in an en-US browser), so the
                    picked day is also spelled out in the page language —
                    the REQ-587 companion from the payment form. */
                }
                {form.startDate && (
                  <span class="hint" data-cy="subs-start-text">
                    {formatLongDate(form.startDate, lang)}
                  </span>
                )}
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

            {form.cadence !== "monthly" && form.cadence !== "annual" && (
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

            {form.cadence === "annual" && (() => {
              // REQ-787 — pick the month, then the day(s) on that month's calendar
              const year = annualYear(form.startDate, form.month);
              const n = daysIn(year, form.month);
              const lead = DAY_ORDER.indexOf(weekdayAt(year, form.month, 1));
              return (
                <>
                  <div class="row">
                    <label class="field">
                      {t("field.subs.month")}
                      <select
                        name="month"
                        data-cy="subs-month"
                        value={String(form.month)}
                        onChange={(e) =>
                          onMonth(
                            Number(
                              (e.currentTarget as HTMLSelectElement).value,
                            ),
                          )}
                      >
                        {MONTHS.map((m) => (
                          <option value={String(m)} key={m}>
                            {monthName(lang, m)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div class="field" data-cy="subs-month-view">
                    <span class="month-view__title" data-cy="subs-month-title">
                      {monthName(lang, form.month, year)}
                    </span>
                    <div class="days dom month-view__dow" aria-hidden="true">
                      {DAY_ORDER.map((d) => (
                        <span class="dow" key={d} data-cy="subs-dow">
                          {DAY_LETTERS[lang][d]}
                        </span>
                      ))}
                    </div>
                    <div class="days dom">
                      {Array.from(
                        { length: lead },
                        (_, i) => <span class="day day--blank" key={`b${i}`} />,
                      )}
                      {MONTH_DAYS.slice(0, n).map((d) => {
                        const on = form.daysOfMonth.includes(d);
                        return (
                          <label
                            class={`day${on ? " on" : ""}`}
                            key={d}
                            data-cy="subs-dom-day"
                            data-dom={d}
                            data-weekday={weekdayAt(year, form.month, d)}
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
                    <span class="hint">{t("field.subs.annualHint")}</span>
                  </div>
                </>
              );
            })()}

            {/* REQ-811: a checklist stands in for the rows — pick one and add only the extras below */}
            <label class="field">
              {t("field.subs.checklist")}
              <select
                data-cy="subs-checklist"
                value={form.checklistId}
                onChange={(e) =>
                  patch({
                    checklistId: (e.currentTarget as HTMLSelectElement).value,
                  })}
              >
                <option value="">{t("field.subs.checklistNone")}</option>
                {checklists.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <span class="hint">
                <a href="/field/checklists" data-cy="subs-manage-checklists">
                  {t("field.subs.manageChecklists")}
                </a>
              </span>
            </label>

            <div class="field">
              {form.checklistId
                ? t("field.subs.extraTypes")
                : t("field.subs.taskTypes")}
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
                      aria-label={t("serviceLines.remove")}
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
                      <I d={ICN.minus} size={12} sw={2.5} />
                    </button>
                  </div>
                ))}
              </div>
              <div class="items__row" style="margin-top:6px">
                {/* REQ-921: a service from the catalogue — never one made up here */}
                <ServiceSelect
                  catalog={(catalog ?? []).filter((c) =>
                    !form.items.some((it) => it.id === c.id)
                  )}
                  serviceId={form.pickId}
                  name=""
                  lang={langSignal.value}
                  data-cy="subs-service"
                  aria-label={t("serviceLines.service")}
                  onPick={(id) => {
                    patch({ pickId: id });
                    setTimeout(() => priceRef.current?.focus(), 0);
                  }}
                  style="flex:1"
                />
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
                  title={t("serviceLines.add")}
                  aria-label={t("serviceLines.add")}
                  data-cy="subs-add-item"
                  onClick={onAddItem}
                >
                  <I d={ICN.plus} size={14} sw={2.5} />
                </button>
              </div>
              {catalog && catalog.length === 0 && (
                <span class="hint" data-cy="subs-no-services">
                  {t("serviceLines.none")}{" "}
                  <a href="/field/services">{t("serviceLines.manage")}</a>
                </span>
              )}
              <span class="hint" data-cy="subs-items-hint">
                {form.checklistId
                  ? t("field.subs.checklistHint")
                  : t("field.subs.noItems")}
              </span>
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
