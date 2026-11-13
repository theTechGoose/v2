/**
 * REQ-192 — /field/timesheet. A week at a time: each worker's shifts, total and anomalies; the
 * week's punch log (voided ones struck through) with Void (a reason) and Add (a whole shift —
 * in + out — or a single in/out, with a reason). Data: clients/timeclock.ts; the workers from
 * clients/field.ts. Strings: ts.*.
 */
import { useEffect, useState } from "preact/hooks";
import { fieldClient, type FieldWorker } from "../clients/field.ts";
import {
  fmtDuration,
  localWeek,
  type Punch,
  type PunchType,
  type Report,
  timeclockClient,
} from "../clients/timeclock.ts";
import FieldHead from "../components/FieldHead.tsx";
import { ApiError } from "../lib/api.ts";
import { type Lang, langSignal, t } from "../lib/i18n.ts";

type AddType = PunchType | "shift";

const locale = (lang: Lang) => lang === "es" ? "es-MX" : "en-US";
const fmtTime = (iso: string, lang: Lang) =>
  new Date(iso).toLocaleTimeString(locale(lang), {
    hour: "numeric",
    minute: "2-digit",
  });
const fmtDayOf = (iso: string, lang: Lang) =>
  new Date(iso).toLocaleDateString(locale(lang), {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
const fmtWhen = (iso: string, lang: Lang) =>
  `${fmtDayOf(iso, lang)} ${fmtTime(iso, lang)}`;
const fmtRange = (from: string, to: string, lang: Lang) => {
  const last = new Date(new Date(to).getTime() - 1);
  const o: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${new Date(from).toLocaleDateString(locale(lang), o)} – ${
    last.toLocaleDateString(locale(lang), o)
  }`;
};
/** a datetime-local value for an instant, in the browser's zone */
const toLocalInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${
    p(d.getHours())
  }:${p(d.getMinutes())}`;
};

function friendly(e: unknown): string {
  if (e instanceof ApiError) {
    const code = e.body && typeof e.body === "object"
      ? String((e.body as { code?: unknown }).code ?? "")
      : "";
    const known: Record<string, string> = {
      same_as_prev: t("ts.err.same_as_prev"),
      same_as_next: t("ts.err.same_as_next"),
      out_without_in: t("ts.err.out_without_in"),
      in_the_future: t("ts.err.in_the_future"),
      punch_exists_at_time: t("ts.err.punch_exists_at_time"),
      overlaps: t("ts.err.overlaps"),
      invalid_range: t("ts.err.invalid_range"),
      reason_required: t("ts.err.reason_required"),
      already_voided: t("ts.err.already_voided"),
    };
    return known[code] ?? e.message;
  }
  return t("field.common.offline");
}

export default function TimesheetPage() {
  const lang = langSignal.value;
  const [weeks, setWeeks] = useState(0);
  const [report, setReport] = useState<Report | null>(null);
  const [punches, setPunches] = useState<Punch[]>([]);
  const [workers, setWorkers] = useState<FieldWorker[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [voiding, setVoiding] = useState<{ id: string; reason: string } | null>(
    null,
  );
  const [add, setAdd] = useState({
    workerId: "",
    type: "shift" as AddType,
    at: toLocalInput(new Date()),
    end: toLocalInput(new Date()),
    reason: "",
  });
  const win = localWeek(new Date(), weeks);

  async function load() {
    try {
      const [r, p, w] = await Promise.all([
        timeclockClient.report(win.from, win.to),
        timeclockClient.punches(win.from, win.to),
        fieldClient.workers(),
      ]);
      setReport(r);
      setPunches(p);
      setWorkers(w);
      setAdd((a) => a.workerId || !w.length ? a : { ...a, workerId: w[0].id });
      setErr("");
    } catch (e) {
      setErr(friendly(e));
    }
  }
  useEffect(() => {
    load();
  }, [weeks]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setErr("");
    try {
      await fn();
      await load();
      return true;
    } catch (e) {
      setErr(friendly(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submitAdd(e: Event) {
    e.preventDefault();
    const at = new Date(add.at), end = new Date(add.end);
    if (
      Number.isNaN(at.getTime()) ||
      (add.type === "shift" && Number.isNaN(end.getTime()))
    ) return;
    const reason = add.reason.trim();
    const ok = await run(() =>
      add.type === "shift"
        ? timeclockClient.shift({
          workerId: add.workerId,
          start: at.toISOString(),
          end: end.toISOString(),
          reason,
        })
        : timeclockClient.manual({
          workerId: add.workerId,
          type: add.type,
          at: at.toISOString(),
          reason,
        })
    );
    if (ok) setAdd((a) => ({ ...a, reason: "" }));
  }

  const nameOf = (id: string) =>
    workers.find((w) => w.id === id)?.name ?? report?.workers.find((r) =>
      r.worker.id === id
    )?.worker.name ?? "—";

  return (
    <div data-cy="ts-page">
      <FieldHead
        eyebrow={t("ts.eyebrow", { range: fmtRange(win.from, win.to, lang) })}
        title={t("ts.title")}
        sub={t("ts.sub")}
      >
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button
            type="button"
            class="btn btn--ghost btn--sm"
            data-cy="ts-prev"
            onClick={() => setWeeks(weeks - 1)}
          >
            ← {t("ts.prevWeek")}
          </button>
          <button
            type="button"
            class="btn btn--ghost btn--sm"
            data-cy="ts-this"
            disabled={weeks === 0}
            onClick={() => setWeeks(0)}
          >
            {t("ts.thisWeek")}
          </button>
          <button
            type="button"
            class="btn btn--ghost btn--sm"
            data-cy="ts-next"
            disabled={weeks >= 0}
            onClick={() => setWeeks(weeks + 1)}
          >
            {t("ts.nextWeek")} →
          </button>
        </div>
      </FieldHead>

      {err && (
        <div
          class="chip chip--pink"
          data-cy="ts-error"
          style="margin-bottom:12px"
        >
          {err}
        </div>
      )}

      {report && report.workers.length === 0 && (
        <div class="panel" data-cy="ts-empty">{t("ts.empty")}</div>
      )}

      {report?.workers.map((row) => (
        <div
          class="panel"
          key={row.worker.id}
          data-cy="ts-worker"
          data-worker={row.worker.id}
        >
          <h3 class="panel__title">
            <span data-cy="ts-worker-name">{row.worker.name}</span>
            <span class="count" data-cy="ts-worker-total">
              {t("ts.total")} {fmtDuration(row.totalMs)}
            </span>
            {row.anomalies.map((a) => (
              <span
                class="chip chip--amber"
                key={a.punchId}
                data-cy="ts-anomaly"
                title={fmtWhen(a.at, lang)}
              >
                {t(`ts.anomaly.${a.kind}`)} · {fmtWhen(a.at, lang)}
              </span>
            ))}
          </h3>
          {row.shifts.length === 0
            ? (
              <div style="color:var(--fg-muted);font-size:13px">
                {t("ts.noShifts")}
              </div>
            )
            : (
              <table class="table" style="width:100%">
                <thead>
                  <tr>
                    <th>{t("ts.day")}</th>
                    <th>{t("ts.in")}</th>
                    <th>{t("ts.out")}</th>
                    <th style="text-align:right">{t("ts.hours")}</th>
                  </tr>
                </thead>
                <tbody>
                  {row.shifts.map((s) => (
                    <tr
                      key={s.inPunchId}
                      data-cy="ts-shift"
                      data-open={s.open ? "1" : "0"}
                    >
                      <td>{fmtDayOf(s.start, lang)}</td>
                      <td>{fmtTime(s.start, lang)}</td>
                      <td>
                        {s.end
                          ? fmtTime(s.end, lang)
                          : s.open
                          ? t("clock.open")
                          : (
                            <span class="chip chip--amber">
                              {t("ts.anomaly.missing_out")}
                            </span>
                          )}
                      </td>
                      <td style="text-align:right">
                        {s.durationMs === null
                          ? "—"
                          : fmtDuration(s.durationMs)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      ))}

      <div class="panel" data-cy="ts-add-panel">
        <h3 class="panel__title">{t("ts.add")}</h3>
        <form
          class="row"
          style="flex-wrap:wrap;align-items:flex-end"
          onSubmit={submitAdd}
        >
          <label class="field" style="flex:1 1 160px">
            {t("ts.worker")}
            <select
              data-cy="ts-add-worker"
              value={add.workerId}
              onChange={(e) =>
                setAdd({
                  ...add,
                  workerId: (e.currentTarget as HTMLSelectElement).value,
                })}
            >
              {workers.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </label>
          <label class="field" style="flex:0 0 170px">
            {t("ts.type")}
            <select
              data-cy="ts-add-type"
              value={add.type}
              onChange={(e) =>
                setAdd({
                  ...add,
                  type: (e.currentTarget as HTMLSelectElement).value as AddType,
                })}
            >
              <option value="shift">{t("ts.shift")}</option>
              <option value="in">{t("ts.in")}</option>
              <option value="out">{t("ts.out")}</option>
            </select>
          </label>
          <label class="field" style="flex:0 0 220px">
            {add.type === "shift" ? t("ts.start") : t("ts.time")}
            <input
              type="datetime-local"
              data-cy="ts-add-at"
              value={add.at}
              onInput={(e) =>
                setAdd({
                  ...add,
                  at: (e.currentTarget as HTMLInputElement).value,
                })}
            />
          </label>
          {add.type === "shift" && (
            <label class="field" style="flex:0 0 220px">
              {t("ts.end")}
              <input
                type="datetime-local"
                data-cy="ts-add-end"
                value={add.end}
                onInput={(e) =>
                  setAdd({
                    ...add,
                    end: (e.currentTarget as HTMLInputElement).value,
                  })}
              />
            </label>
          )}
          <label class="field" style="flex:2 1 220px">
            {t("ts.reason")}
            <input
              type="text"
              data-cy="ts-add-reason"
              value={add.reason}
              maxLength={300}
              required
              onInput={(e) =>
                setAdd({
                  ...add,
                  reason: (e.currentTarget as HTMLInputElement).value,
                })}
            />
          </label>
          <button
            type="submit"
            class="btn btn--pink"
            data-cy="ts-add-ok"
            disabled={busy || !add.workerId || !add.reason.trim()}
          >
            {t("ts.addOk")}
          </button>
        </form>
      </div>

      <div class="panel" data-cy="ts-log-panel">
        <h3 class="panel__title">
          {t("ts.log")} <span class="count">{punches.length}</span>
        </h3>
        {punches.length === 0
          ? (
            <div style="color:var(--fg-muted);font-size:13px">
              {t("ts.noPunches")}
            </div>
          )
          : (
            <table class="table" style="width:100%">
              <thead>
                <tr>
                  <th>{t("ts.worker")}</th>
                  <th>{t("ts.type")}</th>
                  <th>{t("ts.time")}</th>
                  <th>{t("ts.note")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {punches.map((p) => (
                  <tr
                    key={p.id}
                    data-cy="ts-punch"
                    data-id={p.id}
                    data-voided={p.voided ? "1" : "0"}
                    data-type={p.type}
                    style={p.voided
                      ? "text-decoration:line-through;color:var(--fg-muted)"
                      : ""}
                  >
                    <td>{nameOf(p.workerId)}</td>
                    <td data-cy="ts-punch-type">
                      {p.type === "in" ? t("ts.in") : t("ts.out")}
                    </td>
                    <td>{fmtWhen(p.at, lang)}</td>
                    <td style="font-size:12.5px">
                      {p.source === "manual" && (
                        <span class="chip chip--teal" data-cy="ts-punch-manual">
                          {t("ts.manual")}
                        </span>
                      )}
                      {p.reason && ` ${p.reason}`}
                      {p.voided && (
                        <div data-cy="ts-punch-voided">
                          {t("ts.voided")}: {p.voided.reason}
                        </div>
                      )}
                    </td>
                    <td style="text-align:right;white-space:nowrap">
                      {!p.voided && voiding?.id !== p.id && (
                        <button
                          type="button"
                          class="btn btn--ghost btn--sm"
                          data-cy="ts-void"
                          disabled={busy}
                          onClick={() => setVoiding({ id: p.id, reason: "" })}
                        >
                          {t("ts.void")}
                        </button>
                      )}
                      {voiding?.id === p.id && (
                        <span style="display:inline-flex;gap:6px;align-items:center">
                          <input
                            type="text"
                            data-cy="ts-void-reason"
                            placeholder={t("ts.voidReason")}
                            value={voiding.reason}
                            maxLength={300}
                            onInput={(e) =>
                              setVoiding({
                                id: p.id,
                                reason:
                                  (e.currentTarget as HTMLInputElement).value,
                              })}
                          />
                          <button
                            type="button"
                            class="btn btn--danger btn--sm"
                            data-cy="ts-void-ok"
                            disabled={busy || !voiding.reason.trim()}
                            onClick={async () => {
                              const ok = await run(() =>
                                timeclockClient.void(
                                  p.id,
                                  voiding.reason.trim(),
                                )
                              );
                              if (ok) setVoiding(null);
                            }}
                          >
                            {t("ts.void")}
                          </button>
                          <button
                            type="button"
                            class="btn btn--ghost btn--sm"
                            data-cy="ts-void-cancel"
                            onClick={() => setVoiding(null)}
                          >
                            {t("ts.cancel")}
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </div>
  );
}
