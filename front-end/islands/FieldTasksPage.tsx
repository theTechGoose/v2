/**
 * REQ-143 — /field/tasks. The day's round, by worker.
 *
 * A date picker (default today, ◀ ▶ and Today), "Generate the day's tasks", the
 * day's tasks as cards grouped by worker · zone (check state, type, customer,
 * address, the worker's note, an inline price input and an office note — both
 * save on blur/Enter), a done/open summary, and the "unstaffed" list generate
 * returns (subscriptions due that day whose zone has no worker). A task already
 * on an invoice (409 `invoiceId`) gets a read-only price and a link to /invoices.
 *
 * Ported from a2z/web/tareas.html (demo driver dropped).
 */
import { useEffect, useState } from "preact/hooks";
import {
  fieldClient,
  type GenerateResult,
  type TaskView,
} from "../clients/field.ts";
import FieldHead from "../components/FieldHead.tsx";
import { ApiError } from "../lib/api.ts";
import { I, ICN } from "../lib/dash-icons.tsx";
import { fmtDay, fmtMoneyExact, shiftIso, todayIso } from "../lib/field.ts";
import { langSignal, t } from "../lib/i18n.ts";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

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

const isOpen = (x: TaskView) =>
  x.status !== "skipped" && x.status !== "deferred";

/** one price draft per task — committed on blur / Enter */
type Drafts = Record<string, string>;

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

  async function load(d: string) {
    setLoading(true);
    try {
      const rows = await fieldClient.tasks(d);
      setTasks(rows);
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

  function go(d: string) {
    if (!ISO.test(d) || d === date) return;
    setFlash("");
    setSkipped([]);
    setPriceDraft({});
    setNoteDraft({});
    setDate(d);
  }

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const r = await fieldClient.generate(date);
      setSkipped(r.skipped ?? []);
      setFlash(
        t("field.tk.generated", { n: r.created }) +
          (r.skipped?.length
            ? ` · ${t("field.tk.skippedGen", { n: r.skipped.length })}`
            : ""),
      );
      await load(date);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
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
    },
  ) {
    setSaving(task.id);
    setError(null);
    try {
      const next = await fieldClient.updateTask(task.id, patch);
      replace(next);
      setFlash(t("field.tk.saved"));
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

  function commitPrice(task: TaskView) {
    const raw = priceDraft[task.id];
    if (raw === undefined) return;
    setPriceDraft((d) => {
      const { [task.id]: _drop, ...rest } = d;
      return rest;
    });
    const n = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(n) || n < 0) return;
    const cents = Math.round(n * 100);
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

  function card(x: TaskView) {
    const noteKey = `${x.subscriptionId}|${x.date}`;
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
    return (
      <div
        class={cls}
        key={x.id}
        data-cy="tk-task"
        data-id={x.id}
        data-status={x.status}
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
            {x.addedBy === "worker" && (
              <>
                {" "}
                <span class="chip chip--pink">
                  {t("field.tk.extra")}
                  {x.addedByName ? ` · ${x.addedByName}` : ""}
                </span>
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
              style="flex:1;min-width:200px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font:inherit;font-size:13px"
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
                style="width:96px;padding:8px;border:1px solid var(--border);border-radius:8px;font:inherit;font-size:13px;text-align:right"
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
        <button
          type="button"
          class="btn btn--green"
          data-cy="tk-generate"
          disabled={busy}
          onClick={generate}
        >
          <I d={ICN.cal} size={14} /> {t("field.tk.generate")}
        </button>
      </FieldHead>

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
