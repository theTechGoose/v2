/**
 * REQ-143 — /field/batches: the office pulls the completed, un-invoiced tasks of
 * a date range into one DRAFT invoice per customer (REQ-142), reviews the
 * drafts as cards, ticks the ones to send, and sends. Earlier batches are listed
 * below. Invoices themselves are the existing feature (REQ-137) — a card only
 * links to that invoice (REQ-162); since REQ-790 the link opens the
 * customer-facing page /i/<id> in a new tab — what the customer would see —
 * never the invoices list. Nothing is edited here.
 *
 * Ported from a2z/web/lotes.html (minus the demo driver and the inline line
 * editor, which belongs to the invoices page).
 */
import { useEffect, useState } from "preact/hooks";
import {
  type BatchInvoice,
  type BatchView,
  fieldClient,
  type PullSummary,
} from "../clients/field.ts";
import FieldHead from "../components/FieldHead.tsx";
import { ApiError } from "../lib/api.ts";
import { customerFixHref } from "../lib/customer-card-edit.ts";
import { I, ICN } from "../lib/dash-icons.tsx";
import { fmtMoneyExact, shiftIso, todayIso } from "../lib/field.ts";
import {
  batchCounts,
  defaultBatchChecks,
  describeSend,
  pluralParens,
  type SendFailureLine,
} from "../lib/field-batches.ts";
import { langSignal, t, tn, type Vars } from "../lib/i18n.ts";
import type { FieldBatchesSeed } from "../lib/field-ssr.ts";

/** "{n} invoice(s)" → "1 invoice" / "3 invoices" (the lang files carry the "(s)") */
function tp(key: string, vars: Vars): string {
  return pluralParens(t(key, vars), Number(vars.n));
}

const KNOWN_STATUS = new Set([
  "draft",
  "sent",
  "paid",
  "void",
  "claimed",
  "scheduled",
]);

function statusLabel(status: string): string {
  return KNOWN_STATUS.has(status) ? t(`field.lt.status.${status}`) : status;
}

function statusChip(status: string): string {
  if (status === "paid") return "chip chip--green";
  if (status === "sent") return "chip chip--teal";
  if (status === "void") return "chip chip--muted";
  return "chip";
}

/** "Oct 12, 2026" / "12 oct 2026" */
function fmtD(iso: string, lang: "en" | "es"): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(lang === "es" ? "es-MX" : "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const b = e.body as { error?: string; message?: string } | null;
    if (b && typeof b === "object") {
      if (typeof b.error === "string" && b.error) return b.error;
      if (typeof b.message === "string" && b.message) return b.message;
    }
  }
  return t("field.common.error");
}

const batchTotal = (b: BatchView) =>
  b.invoices.filter((i) => i.status !== "void").reduce(
    (s, i) => s + i.amount,
    0,
  );

/** the past batches as listed: only those with invoices, newest first */
const pastBatches = (all: BatchView[]) =>
  all.filter((b) => b.invoices.length > 0)
    .sort((a, b) => b.from.localeCompare(a.from));

/** REQ-730 (demo c2-p13-p) — `seed`: the batches read by the route on the SSR side; the first HTML carries them, not "Loading…" */
export default function FieldBatchesPage(
  { seed }: { seed?: FieldBatchesSeed | null } = {},
) {
  const lang = langSignal.value;
  const seeded = seed ? pastBatches(seed.batches) : null;
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [batches, setBatches] = useState<BatchView[]>(seeded ?? []);
  const [current, setCurrent] = useState<BatchView | null>(
    seeded?.[0] ?? null,
  );
  const [summary, setSummary] = useState<PullSummary | null>(null);
  const [flash, setFlash] = useState("");
  const [error, setError] = useState<string | null>(null);
  // REQ-401: a send's failures, each with its fix (demo M30)
  const [failures, setFailures] = useState<SendFailureLine[]>([]);
  /** a send refused with 409 because of a $0 line — offer "Send anyway" */
  const [zeroBlocked, setZeroBlocked] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(() =>
    defaultBatchChecks(seeded?.[0] ?? null, new Set())
  );
  const [busy, setBusy] = useState<"pull" | "send" | null>(null);
  const [loading, setLoading] = useState(!seed);

  // Default range: the last two weeks. Resolved in an effect — the browser's
  // day, not the server's.
  useEffect(() => {
    const today = todayIso();
    setFrom(shiftIso(today, -14));
    setTo(today);
  }, []);

  async function load(keepId?: string): Promise<BatchView[]> {
    const rows = pastBatches(await fieldClient.batches());
    setBatches(rows);
    if (keepId) {
      const found = rows.find((b) => b.id === keepId);
      if (found) setCurrent(found);
    }
    return rows;
  }

  useEffect(() => {
    if (seed) return; // REQ-730 — seeded on the server: no client fetch on mount
    load()
      .then((rows) => {
        const first = rows[0] ?? null;
        setCurrent((c) => c ?? first);
        // REQ-608 (demo m47): a reload ticks the drafts, as the pull did
        setChecked((c) => defaultBatchChecks(first, c));
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, []);

  async function pull() {
    if (busy || !from || !to) return;
    setBusy("pull");
    setError(null);
    setFailures([]);
    setZeroBlocked(false);
    try {
      const r = await fieldClient.pull(from, to);
      setSummary(r.summary);
      if (r.invoices.length) {
        setFlash(
          tp("field.lt.pulled", {
            n: r.invoices.length,
            lines: r.invoices.reduce(
              (s, i) => s + (i.lineItems?.length ?? 0),
              0,
            ),
          }),
        );
        setChecked(
          new Set(
            r.invoices.filter((i) => i.status === "draft").map((i) => i.id),
          ),
        );
        setCurrent(r);
        await load(r.id);
      } else {
        setFlash(t("field.lt.nothing"));
        setChecked(new Set());
        await load();
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function send(allowZero: boolean) {
    if (busy || !current || checked.size === 0) return;
    setBusy("send");
    setError(null);
    setFailures([]);
    try {
      const r = await fieldClient.send(current.id, [...checked], allowZero);
      setZeroBlocked(false);
      // REQ-401 (demo M30): "each client got theirs" only when something went out
      const told = describeSend(r, current.invoices, t);
      setFlash(told.flash);
      setFailures(told.failures);
      setChecked(new Set());
      setCurrent(r.batch);
      await load(r.batch.id);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setZeroBlocked(true);
        setError(`${errorMessage(e)} — ${t("field.lt.zeroConfirm")}`);
      } else {
        setError(errorMessage(e));
      }
    } finally {
      setBusy(null);
    }
  }

  function openBatch(b: BatchView) {
    setCurrent(b);
    setSummary(null);
    setFlash("");
    setError(null);
    setFailures([]);
    setZeroBlocked(false);
    setChecked(defaultBatchChecks(b, new Set())); // REQ-608 — its drafts, ticked
  }

  function toggle(id: string, on: boolean) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
    setZeroBlocked(false);
  }

  const drafts = current
    ? current.invoices.filter((i) => i.status === "draft")
    : [];
  const allChecked = drafts.length > 0 &&
    drafts.every((i) => checked.has(i.id));

  return (
    <>
      <FieldHead
        eyebrow={t("field.lt.eyebrow")}
        title={t("field.lt.title")}
        sub={t("field.lt.sub")}
      />

      <div class="panel">
        <div class="row">
          <label class="field">
            {t("field.lt.from")}
            <input
              type="date"
              data-cy="lt-from"
              value={from}
              onInput={(e) => setFrom((e.target as HTMLInputElement).value)}
            />
          </label>
          <label class="field">
            {t("field.lt.to")}
            <input
              type="date"
              data-cy="lt-to"
              value={to}
              onInput={(e) => setTo((e.target as HTMLInputElement).value)}
            />
          </label>
          <button
            type="button"
            class="btn btn--pink"
            data-cy="lt-pull"
            disabled={busy !== null || !from || !to}
            onClick={pull}
          >
            <I d={ICN.batch} size={14} />
            {busy === "pull" ? t("field.common.loading") : t("field.lt.pull")}
          </button>
        </div>
        {flash && (
          <div class="chip chip--green" style="margin-top:12px">{flash}</div>
        )}
        {summary && (
          <div class="hint" data-cy="lt-summary" style="margin-top:8px">
            {t("field.lt.summary", {
              pullable: summary.pullable,
              skipped: summary.skipped,
              deferred: summary.deferred,
              open: summary.open,
              already: summary.alreadyInvoiced,
            })}
            {summary.zeroPriced > 0 && (
              <>
                {" · "}
                <span class="chip chip--pink">
                  {t("field.lt.zero", { n: summary.zeroPriced })}
                </span>
              </>
            )}
          </div>
        )}
        {error && <p class="alert">{error}</p>}
        {failures.map((f, i) => (
          <p class="alert" data-cy="lt-send-failure" key={i}>
            {f.text}
            {f.fix && (
              <>
                {" "}
                {/* REQ-600 (cycle 4, M5): straight to that customer's card */}
                <a
                  class="link"
                  href={customerFixHref(f.customerId)}
                  data-cy="lt-send-fix"
                >
                  {f.fix}
                </a>
              </>
            )}
          </p>
        ))}
      </div>

      {current && (
        <div class="panel">
          <h3 class="panel__title">
            {t("field.lt.batch")} {fmtD(current.from, lang)} →{" "}
            {fmtD(current.to, lang)}{" "}
            <span class="count">
              {tp("field.lt.invoices", { n: current.invoices.length })}
            </span>
            <span style="flex:1"></span>
            {drafts.length > 0 && (
              <>
                <label style="font-size:13px;font-weight:600;display:flex;gap:6px;align-items:center">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={(e) => {
                      const on = (e.target as HTMLInputElement).checked;
                      setChecked(
                        new Set(on ? drafts.map((i) => i.id) : []),
                      );
                      setZeroBlocked(false);
                    }}
                  />
                  {t("field.lt.selectAll")}
                </label>
                <button
                  type="button"
                  class="btn btn--green btn--sm"
                  data-cy="lt-send"
                  disabled={busy !== null || checked.size === 0}
                  onClick={() => send(false)}
                >
                  <I d={ICN.send} size={13} />
                  {t("field.lt.send")}
                </button>
                {zeroBlocked && (
                  <button
                    type="button"
                    class="btn btn--pink btn--sm"
                    data-cy="lt-send-zero"
                    disabled={busy !== null || checked.size === 0}
                    onClick={() => send(true)}
                  >
                    <I d={ICN.send} size={13} />
                    {t("field.lt.sendAnyway")}
                  </button>
                )}
              </>
            )}
          </h3>
          <div class="hint" style="margin-bottom:10px">
            {t("field.lt.noteHint")} ·{" "}
            <b>{t("field.lt.total")}: {fmtMoneyExact(batchTotal(current))}</b>
          </div>
          {current.invoices.map((inv) => (
            <InvoiceCard
              key={inv.id}
              inv={inv}
              checked={checked.has(inv.id)}
              onToggle={(on) => toggle(inv.id, on)}
            />
          ))}
        </div>
      )}

      <div class="panel">
        <h3 class="panel__title">{t("field.lt.past")}</h3>
        {loading
          ? <div class="hint">{t("field.common.loading")}</div>
          : batches.length
          ? (
            <table class="table">
              <tbody>
                {batches.map((b) => (
                  <tr
                    key={b.id}
                    data-cy="lt-past"
                    style={`cursor:pointer${
                      current?.id === b.id ? ";font-weight:700" : ""
                    }`}
                    onClick={() => openBatch(b)}
                  >
                    <td>{fmtD(b.from, lang)} → {fmtD(b.to, lang)}</td>
                    <td>
                      {batchCounts(b.invoices, tn)}
                    </td>
                    <td class="money">{fmtMoneyExact(batchTotal(b))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
          : <div class="hint">{t("field.lt.noPast")}</div>}
      </div>
    </>
  );
}

function InvoiceCard(
  { inv, checked, onToggle }: {
    inv: BatchInvoice;
    checked: boolean;
    onToggle: (on: boolean) => void;
  },
) {
  const draft = inv.status === "draft";
  const lines = inv.lineItems ?? [];
  return (
    <div
      class={`inv${draft ? "" : " inv--sent"}`}
      data-cy="lt-invoice"
      data-id={inv.id}
    >
      <div class="inv__head">
        {draft && (
          <input
            type="checkbox"
            data-cy="lt-check"
            checked={checked}
            onChange={(e) => onToggle((e.target as HTMLInputElement).checked)}
          />
        )}
        <span class="inv__client">{inv.customerName}</span>
        <span class={statusChip(inv.status)}>{statusLabel(inv.status)}</span>
        {draft && inv.zeroLines > 0 && (
          <span class="chip chip--pink">
            {t("field.lt.zero", { n: inv.zeroLines })}
          </span>
        )}
        <span class="inv__total">{fmtMoneyExact(inv.amount)}</span>
      </div>
      <div class="inv__line">
        {lines.map((l, i) => (
          <div key={i}>
            {l.description} — {fmtMoneyExact(l.price)}
          </div>
        ))}
        <a
          href={`/i/${inv.id}`}
          target="_blank"
          rel="noopener noreferrer"
          data-cy="lt-open"
          style="display:inline-flex;align-items:center;gap:6px;margin-top:8px;font-weight:700;color:var(--brand-teal)"
        >
          <I d={ICN.invoice} size={13} />
          {t("field.lt.openInvoice")}
        </a>
      </div>
    </div>
  );
}
