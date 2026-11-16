/**
 * REQ-811 — /field/checklists. The account's checklists: a named list of
 * services (task types with a price each) a repeat visit REFERENCES instead of
 * listing the same rows again. Cards with the rows, the per-visit sum and
 * "Used by N repeat visits"; the New / Edit modal (a name + the task-type
 * combobox and price rows of the repeat-visit form, REQ-139); Delete with an
 * inline confirm — refused with the count while a repeat visit uses it.
 * Editing a checklist changes every repeat visit on it.
 */
import Backdrop from "../components/Backdrop.tsx";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  type ChecklistView,
  fieldClient,
  type SubscriptionItemInput,
  type TaskType,
} from "../clients/field.ts";
import FieldHead from "../components/FieldHead.tsx";
import { ApiError } from "../lib/api.ts";
import { I, ICN } from "../lib/dash-icons.tsx";
import { fmtMoneyExact, perVisitCents } from "../lib/field.ts";
import { langSignal, t, tn } from "../lib/i18n.ts";
import type { FieldChecklistsSeed } from "../lib/field-ssr.ts";

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
  name: string;
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
  err: string | null;
  saving: boolean;
}

/** how long a keystroke waits before it asks the API for task types */
const SEARCH_DEBOUNCE_MS = 150;

const blankForm = (): Form => ({
  editId: null,
  name: "",
  items: [],
  q: "",
  searchOn: false,
  options: [],
  active: -1,
  picked: null,
  price: "",
  err: null,
  saving: false,
});

const formFor = (c: ChecklistView): Form => ({
  ...blankForm(),
  editId: c.id,
  name: c.name,
  items: c.items.map((i) => ({
    id: i.taskTypeId,
    name: i.taskTypeName,
    priceCents: i.priceCents,
  })),
});

/** the server's refusal in the user's words: a stable code first (REQ-421), else its message */
function errMsg(err: unknown): string {
  if (err instanceof ApiError) {
    const b = err.body as {
      code?: unknown;
      error?: unknown;
      message?: unknown;
      detail?: { subscriptions?: unknown };
    } | null;
    if (b && typeof b === "object") {
      if (b.code === "checklist_name_taken") return t("field.ckl.nameTaken");
      if (b.code === "checklist_in_use") {
        return t("field.ckl.inUse", {
          n: Number(b.detail?.subscriptions ?? 0),
        });
      }
      if (typeof b.error === "string") return b.error;
      if (typeof b.message === "string") return b.message;
    }
  }
  if (err instanceof Error && err.message) return err.message;
  return t("field.common.error");
}

export default function FieldChecklistsPage(
  { seed }: { seed?: FieldChecklistsSeed | null } = {},
) {
  const _lang = langSignal.value; // re-render on a language flip
  const [list, setList] = useState<ChecklistView[] | null>(
    seed?.checklists ?? null,
  );
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
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
      setList(await fieldClient.checklists());
      setLoadErr(null);
    } catch (err) {
      setLoadErr(errMsg(err));
      setList((prev) => prev ?? []);
    }
  }

  useEffect(() => {
    if (seed) return;
    let alive = true;
    fieldClient.checklists().then((l) => {
      if (alive) setList(l);
    }).catch((err: unknown) => {
      if (!alive) return;
      setLoadErr(errMsg(err));
      setList([]);
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
    setForm(blankForm());
  }

  function openEdit(c: ChecklistView) {
    setConfirmId(null);
    setForm(formFor(c));
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

  /** Add the typed task type + price as a row; an error when there is nothing valid to add. */
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
      // REQ-732: only an Escape that shuts the open search stops here; otherwise it reaches the Backdrop
      if (form.searchOn || form.options.length) e.stopPropagation();
      searchSeq.current++;
      patch({ searchOn: false, options: [], active: -1 });
    }
  }

  async function submit(e: Event) {
    e.preventDefault();
    if (!form || form.saving) return;
    // a typed-but-not-added row counts
    let f: Form = { ...form, err: null };
    if (form.q.trim() || form.price) {
      f = addItem(f);
      if (f.err) {
        setForm(f);
        return;
      }
    }
    if (!f.name.trim()) {
      setForm({ ...f, err: t("field.ckl.nameRequired") });
      return;
    }
    if (!f.items.length) {
      setForm({ ...f, err: t("field.subs.noItems") });
      return;
    }
    const items: SubscriptionItemInput[] = f.items.map((it) => ({
      ...(it.id ? { taskTypeId: it.id } : {}),
      taskTypeName: it.name,
      priceCents: it.priceCents,
    }));
    setForm({ ...f, saving: true });
    try {
      if (f.editId) {
        await fieldClient.updateChecklist(f.editId, {
          name: f.name.trim(),
          items,
        });
      } else {
        await fieldClient.createChecklist({ name: f.name.trim(), items });
      }
      close();
      await reload();
    } catch (err) {
      setForm((
        cur,
      ) => (cur ? { ...cur, saving: false, err: errMsg(err) } : cur));
    }
  }

  async function remove(c: ChecklistView) {
    setBusyId(c.id);
    setCardErr(null);
    try {
      await fieldClient.deleteChecklist(c.id);
      setConfirmId(null);
      setList((l) => (l ?? []).filter((x) => x.id !== c.id));
    } catch (err) {
      setConfirmId(null);
      setCardErr({ id: c.id, msg: errMsg(err) });
    } finally {
      setBusyId(null);
    }
  }

  const cards = list ?? [];

  return (
    <>
      <FieldHead
        eyebrow={t("field.ckl.eyebrow", { n: cards.length })}
        title={t("field.ckl.title")}
        sub={t("field.ckl.sub")}
      >
        <button
          type="button"
          class="btn btn--pink"
          data-cy="ckl-new"
          onClick={openNew}
        >
          <I d={ICN.plus} size={14} sw={2.5} /> {t("field.ckl.new")}
        </button>
      </FieldHead>

      {loadErr && <p class="alert">{loadErr}</p>}

      {list === null
        ? (
          <div class="hint" style="padding:12px 4px">
            {t("field.common.loading")}
          </div>
        )
        : (
          <div class="subs">
            {cards.map((c) => {
              const busy = busyId === c.id;
              const confirming = confirmId === c.id;
              return (
                <div class="sub" data-cy="ckl-card" data-id={c.id} key={c.id}>
                  <div class="sub__client">
                    <span style="display:inline-flex;align-items:center;gap:6px">
                      <I d={ICN.list} size={14} /> {c.name}
                    </span>
                    <span class="chip" data-cy="ckl-used-by">
                      {tn("field.ckl.usedBy", c.usedBy)}
                    </span>
                  </div>
                  <div class="sub__items">
                    {c.items.map((it) => (
                      <div key={it.taskTypeId} data-cy="ckl-card-item">
                        <span>{it.taskTypeName}</span>
                        <b>{fmtMoneyExact(it.priceCents)}</b>
                      </div>
                    ))}
                  </div>
                  {cardErr?.id === c.id && (
                    <p class="alert" style="margin:0" data-cy="ckl-card-error">
                      {cardErr.msg}
                    </p>
                  )}
                  <div class="sub__foot">
                    <span>
                      {t("field.ckl.perVisit", {
                        amount: fmtMoneyExact(perVisitCents(c)),
                      })}
                    </span>
                    <span style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
                      {confirming
                        ? (
                          <>
                            <span class="hint" style="align-self:center">
                              {t("field.ckl.confirmDelete")}
                            </span>
                            <button
                              type="button"
                              class="btn btn--danger btn--sm"
                              data-cy="ckl-delete-confirm"
                              disabled={busy}
                              onClick={() => remove(c)}
                            >
                              {t("field.common.confirm")}
                            </button>
                            <button
                              type="button"
                              class="btn btn--ghost btn--sm"
                              data-cy="ckl-delete-cancel"
                              disabled={busy}
                              onClick={() =>
                                setConfirmId(null)}
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
                              data-cy="ckl-edit"
                              disabled={busy}
                              onClick={() => openEdit(c)}
                            >
                              {t("field.subs.edit")}
                            </button>
                            <button
                              type="button"
                              class="btn btn--danger btn--sm"
                              data-cy="ckl-delete"
                              disabled={busy}
                              onClick={() => {
                                setCardErr(null);
                                setConfirmId(c.id);
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
            {cards.length === 0 && (
              <div class="hint" style="padding:12px 4px" data-cy="ckl-empty">
                {t("field.ckl.empty")}
              </div>
            )}
          </div>
        )}

      {form && (
        <Backdrop class="modal-bg" onClose={() => close()}>
          <form class="modal" onSubmit={submit} data-cy="ckl-form">
            <div class="modal__head">
              <h2>
                {form.editId ? t("field.ckl.editTitle") : t("field.ckl.new")}
              </h2>
            </div>

            <label class="field">
              {t("field.ckl.name")}
              <input
                data-cy="ckl-name"
                placeholder={t("field.ckl.namePh")}
                maxLength={80}
                value={form.name}
                onInput={(e) =>
                  patch({ name: (e.currentTarget as HTMLInputElement).value })}
              />
            </label>

            <div class="field">
              {t("field.subs.taskTypes")}
              <div class="items">
                {form.items.map((it, i) => (
                  <div
                    class="items__row"
                    key={`${it.name}-${i}`}
                    data-cy="ckl-item"
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
                      data-cy="ckl-item-remove"
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
                    data-cy="ckl-type-q"
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
                      data-cy="ckl-type-list"
                    >
                      {form.options.map((o, i) => (
                        <div
                          key={o.id ?? `new:${o.name}`}
                          role="option"
                          aria-selected={i === form.active}
                          class={`combo__opt${
                            i === form.active ? " combo__opt--active" : ""
                          }${o.id ? "" : " combo__opt--new"}`}
                          data-cy={o.id ? "ckl-type-opt" : "ckl-type-create"}
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
                  data-cy="ckl-price"
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
                  data-cy="ckl-add-item"
                  onClick={onAddItem}
                >
                  <I d={ICN.plus} size={14} sw={2.5} />
                </button>
              </div>
              <span class="hint">{t("field.subs.noItems")}</span>
            </div>

            {form.err && <p class="alert" data-cy="ckl-error">{form.err}</p>}

            <div class="modal__foot">
              <button type="button" class="btn--cancel" onClick={close}>
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                class="btn--submit"
                data-cy="ckl-submit"
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
