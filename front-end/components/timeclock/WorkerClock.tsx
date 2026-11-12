/**
 * REQ-192 (AMENDMENT 2) — the worker's clock, as a slim bar above their visits, never a wall:
 * a state line (On the clock · a live timer / Off the clock · last out) and ONE button that reads
 * Clock in or Clock out; under it, today's and this week's totals on one line that opens the
 * week's shifts (Day · In · Out · Hours) on a tap. A press records a punch at the server's time.
 * Strings: clock.*.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import {
  fmtDuration,
  localWeek,
  type Shift,
  type StatusView,
  timeclockWorker,
} from "../../clients/timeclock.ts";
import { ApiError } from "../../lib/api.ts";
import { type Lang, langSignal, t } from "../../lib/i18n.ts";

const REFRESH_MS = 30_000;

const locale = (lang: Lang) => lang === "es" ? "es-MX" : "en-US";
const fmtTime = (iso: string, lang: Lang) =>
  new Date(iso).toLocaleTimeString(locale(lang), {
    hour: "numeric",
    minute: "2-digit",
  });
const fmtDayOf = (iso: string, lang: Lang) =>
  new Date(iso).toLocaleDateString(locale(lang), {
    weekday: "short",
    day: "numeric",
  });

/** the shift's length now: the server's figure for a closed one, the clock for the open one */
function lengthOf(s: Shift, now: number): number | null {
  if (s.open) return Math.max(0, now - new Date(s.start).getTime());
  return s.durationMs;
}

const css = `
  .clock { background:#fff; border:1px solid var(--border); border-radius: var(--radius-lg); padding: 12px 14px; display:flex; flex-direction:column; gap:8px; }
  .clock__row { display:flex; align-items:center; gap:12px; }
  .clock__state { flex:1; min-width:0; }
  .clock__line { display:flex; align-items:center; gap:8px; white-space:nowrap; font-family: var(--font-heading); font-weight:800; font-size:17px; color: var(--brand-teal); }
  .clock__dot { width:10px; height:10px; border-radius:50%; background:#c9ccc4; flex:none; }
  .clock--in .clock__dot { background: var(--brand-green); box-shadow: 0 0 0 4px var(--green-100); }
  .clock__timer { font-variant-numeric: tabular-nums; color: var(--brand-green); font-size: 15px; }
  .clock__since { font-size:13px; color: var(--fg-muted); margin-top:2px; }
  .clock__btn { min-height:52px; padding:0 22px; font-size:16px; font-weight:800; white-space:nowrap; flex:none; }
  .clock__totals { display:flex; justify-content:space-between; align-items:center; gap:10px; width:100%; border:0; background:transparent; padding:6px 0 0; margin:0; font: inherit; font-size:13px; color: var(--fg-muted); cursor:pointer; min-height:36px; text-align:left; }
  .clock__totals strong { color: var(--fg); }
  .clock__toggle { color: var(--brand-teal); font-weight:700; white-space:nowrap; }
  .clock__table { width:100%; border-collapse:collapse; font-size:13px; }
  .clock__table th { text-align:left; font-size:11px; letter-spacing:.05em; text-transform:uppercase; color: var(--fg-muted); font-weight:700; padding:6px 0 4px; border-bottom:1px solid var(--border); }
  .clock__table td { padding:7px 0; border-bottom:1px solid var(--mint-100); }
  .clock__table th:last-child, .clock__table td:last-child { text-align:right; }
  .clock__table tr:last-child td { border-bottom:0; }
  .clock__empty { font-size:13px; color: var(--fg-muted); padding:6px 0; }
`;

export default function WorkerClock(
  { hoursOpen = false, onState }: {
    hoursOpen?: boolean;
    onState?: (s: "in" | "out") => void;
  } = {},
) {
  const lang = langSignal.value;
  const [view, setView] = useState<StatusView | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [hours, setHours] = useState(hoursOpen);
  const [now, setNow] = useState(() => Date.now());
  const alive = useRef(true);

  async function load() {
    try {
      const v = await timeclockWorker.status(localWeek());
      if (alive.current) setView(v);
    } catch { /* the next refresh tries again; the button stays as it was */ }
  }

  useEffect(() => {
    alive.current = true;
    load();
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive.current = false;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, []);

  // the screen's tab shows a dot while on the clock
  useEffect(() => {
    if (view && onState) onState(view.status);
  }, [view?.status]);

  async function press() {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      const r = await timeclockWorker.punch(localWeek());
      setView(r.status);
    } catch (e) {
      const code = e instanceof ApiError && e.body && typeof e.body === "object"
        ? String((e.body as { code?: unknown }).code ?? "")
        : "";
      setErr(
        code === "already_in" || code === "not_in" || code === "retry"
          ? t("clock.err.flip")
          : t("clock.err.failed"),
      );
      await load();
    } finally {
      setBusy(false);
    }
  }

  const inNow = view?.status === "in";
  const open = view?.shifts.find((s) => s.open);
  const running = open ? Math.max(0, now - new Date(open.start).getTime()) : 0;
  const sinceAsOf = view && open
    ? Math.max(0, now - new Date(view.asOf).getTime())
    : 0;
  const liveToday = view
    ? view.todayTotalMs + (open && open.start >= view.from ? sinceAsOf : 0)
    : 0;
  const liveWeek = view ? view.weekTotalMs + sinceAsOf : 0;
  const shifts = view ? [...view.shifts].reverse() : [];

  return (
    <div class={`clock${inNow ? " clock--in" : ""}`} data-cy="clock-card">
      <style>{css}</style>
      <div class="clock__row">
        <div class="clock__state">
          <div class="clock__line">
            <span class="clock__dot" aria-hidden="true"></span>
            <span data-cy="clock-state">
              {!view ? "…" : inNow ? t("clock.on") : t("clock.off")}
            </span>
          </div>
          <div class="clock__since" data-cy="clock-since">
            {inNow && (
              <>
                <strong class="clock__timer" data-cy="clock-timer">
                  {fmtDuration(running)}
                </strong>{" "}
                ·{" "}
              </>
            )}
            {view && (view.since
              ? t(inNow ? "clock.onSince" : "clock.offSince", {
                time: fmtTime(view.since, lang),
              })
              : t("clock.never"))}
          </div>
        </div>
        <button
          type="button"
          data-cy="clock-button"
          data-state={view ? view.status : "loading"}
          class={`btn clock__btn ${inNow ? "btn--danger" : "btn--green"}`}
          disabled={busy || !view}
          onClick={press}
        >
          {!view ? "…" : inNow ? t("clock.out") : t("clock.in")}
        </button>
      </div>
      {err && <div class="chip chip--pink" data-cy="clock-error">{err}</div>}
      <button
        type="button"
        class="clock__totals"
        data-cy="clock-hours"
        aria-expanded={hours}
        onClick={() => setHours(!hours)}
      >
        <span>
          {t("clock.today")}{" "}
          <strong data-cy="clock-today">{fmtDuration(liveToday)}</strong> ·{" "}
          {t("clock.week")}{" "}
          <strong data-cy="clock-week">{fmtDuration(liveWeek)}</strong>
        </span>
        <span class="clock__toggle">
          {hours ? t("clock.hideHours") : t("clock.showHours")}{" "}
          {hours ? "▴" : "▾"}
        </span>
      </button>
      {hours && view && (shifts.length === 0
        ? <div class="clock__empty">{t("clock.noShifts")}</div>
        : (
          <table class="clock__table" data-cy="clock-shifts">
            <thead>
              <tr>
                <th>{t("clock.day")}</th>
                <th>{t("clock.colIn")}</th>
                <th>{t("clock.colOut")}</th>
                <th>{t("clock.hours")}</th>
              </tr>
            </thead>
            <tbody>
              {shifts.map((s) => {
                const len = lengthOf(s, now);
                return (
                  <tr
                    key={s.inPunchId}
                    data-cy="clock-shift"
                    data-open={s.open ? "1" : "0"}
                  >
                    <td>{fmtDayOf(s.start, lang)}</td>
                    <td>{fmtTime(s.start, lang)}</td>
                    <td>
                      {s.end
                        ? fmtTime(s.end, lang)
                        : s.open
                        ? t("clock.open")
                        : "—"}
                    </td>
                    <td>
                      <strong>{len === null ? "—" : fmtDuration(len)}</strong>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ))}
    </div>
  );
}
