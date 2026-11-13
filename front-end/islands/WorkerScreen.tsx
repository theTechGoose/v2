/**
 * REQ-143 — /worker: the worker's own phone screen. PUBLIC route; the worker
 * logs in by cell + 4-digit PIN (REQ-141) and gets the day's VISITS — one card
 * per subscription on one day — with its services as big check-off buttons, a
 * note for the office, a services panel (remove / put back / defer one / add),
 * and "Defer visit". A foreman sees their own visits first, then one section
 * per crew. `?date=` replays a past day; the list refreshes every 5 s while the
 * tab is visible and nothing is being typed, backing off to 60 s while idle; a
 * refresh reads only the tasks (REQ-605).
 *
 * REQ-785 (demo-loop dv1-d11) — a job of several days is on each of its days,
 * for its worker and its crew, as its own visit ("Day 2 of 3 · Nov 16 – Nov 18",
 * "With Pedro"); one check-off marks the whole job done; it is never deferred.
 *
 * Ported from a2z/web/trabajador.html (its <style> block lives here; the demo
 * driver was not ported). Strings: worker.* in lang/*.json via t().
 */
import { useEffect, useRef, useState } from "preact/hooks";
import {
  type TaskType,
  workerClient,
  type WorkerMe,
  type WorkerTaskView,
} from "../clients/field.ts";
import { ApiError } from "../lib/api.ts";
import { formatPhoneInput } from "../../shared/quote-flow/format-helpers.ts";
import { I, ICN } from "../lib/dash-icons.tsx";
import {
  fmtDay,
  rememberWorkerLangPick,
  shiftIso,
  todayIso,
  WORKER_OFFICE_FALLBACK,
  workerDayHref,
  workerDayNav,
  workerScreenLang,
} from "../lib/field.ts";
import { lockLabelKey, NOTE_SAVED_MS } from "../lib/field-batches.ts";
import {
  jobDayOf,
  jobRange,
  onJob,
  visitKey,
  workMates,
} from "../lib/field-job.ts";
import { WORKERS_PAGE_HREF } from "../lib/worker-view-link.ts";
import { workerTodayKey } from "../lib/worker-today.ts";
import { refreshTickDue } from "../lib/refresh-tick.ts";
import {
  startWorkerRefresh,
  WORKER_REFRESH_MS,
} from "../lib/worker-refresh.ts";
import { type Lang, langSignal, setLang, t } from "../lib/i18n.ts";
import WorkerClock from "../components/timeclock/WorkerClock.tsx";

const CELL_KEY = "pm:worker-cell";
const REFRESH_MS = WORKER_REFRESH_MS;

const css = `
  /* REQ-196 — the worker's phone screen: one column, the day in one glance, big tap targets */
  body { display: block; }
  .wrap { max-width: 520px; margin: 0 auto; padding: 14px 16px 90px; min-height: 100dvh; display: flex; flex-direction: column; gap: 14px; }
  .top { display: flex; align-items: center; gap: 10px; }
  .top .brand { display: flex; align-items: center; gap: 8px; font-family: var(--font-heading); font-weight: 800; color: var(--brand-teal); flex: 1; }
  .top img { width: 34px; height: 34px; border-radius: 10px; }
  .greet { font-family: var(--font-heading); font-weight: 800; font-size: 24px; color: var(--brand-teal); line-height: 1.1; }
  .greet small { display: block; font-family: var(--font-body); font-weight: 500; font-size: 14px; color: var(--fg-muted); margin-top: 4px; }
  .login { background: #fff; border: 1px solid var(--border); border-radius: var(--radius-xl); padding: 22px; display: flex; flex-direction: column; gap: 14px; margin-top: 30px; box-shadow: 0 12px 32px -20px rgba(26,83,92,.35); }
  .login input, .login select { font-size: 18px; padding: 14px; }
  /* REQ-602 (M35): an owner on the sign-in card is told whose screen it is */
  .owner-note { background: var(--mint-100); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; font-size: 15px; color: var(--fg); margin-top: 18px; }
  .owner-note + .login { margin-top: 0; }
  .pin { letter-spacing: .4em; text-align: center; font-family: var(--font-mono); }
  .pinwrap { position: relative; display: flex; }
  .pinwrap input { flex: 1; min-width: 0; padding-right: 52px; }
  .pinwrap .eye { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); width: 44px; height: 44px; border: 0; background: transparent; color: var(--fg-muted); border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
  .pinwrap .eye[aria-pressed="true"] { color: var(--brand-teal); }
  .pinwrap .eye:focus-visible { outline: 2px solid var(--brand-green); outline-offset: 1px; }
  .lang { margin-left: auto; display: flex; gap: 2px; background: var(--mint-100); border: 1px solid var(--border); border-radius: 999px; padding: 3px; }
  .lang button { border: 0; background: transparent; font-weight: 800; font-size: 13px; color: var(--fg-muted); padding: 10px 14px; border-radius: 999px; min-height: 44px; cursor: pointer; }
  .lang button.on { background: #fff; color: var(--brand-teal); box-shadow: 0 1px 3px rgba(20,72,82,.12); }
  /* REQ-353 (m23): on a phone the header wraps — the title and the EN/ES pill
     on the first row, "Volver a la oficina" and "Salir" on the next — instead
     of squeezing "Mis tareas" under the pill with Salir at the edge */
  /* REQ-612 (cycle 4, p4-p8c): Back to office and Sign out are ONE flex item,
     so on a phone they drop to the next row together (not "Sign out" alone)
     and a label never breaks over two lines */
  .top__actions { display: flex; align-items: center; gap: 10px; }
  .top__actions .btn { white-space: nowrap; }
  @media (max-width: 480px) {
    .top { flex-wrap: wrap; row-gap: 8px; }
    .top .brand { flex: 1 0 auto; }
    .top__actions { flex-basis: 100%; justify-content: flex-end; }
  }

  /* the two tabs: a thumb slides under the chosen one */
  .tabs { position: relative; display: flex; gap: 4px; background: var(--mint-200); border: 1px solid var(--border); border-radius: 14px; padding: 4px; }
  .tabs__thumb { position: absolute; top: 4px; bottom: 4px; left: 4px; width: calc(50% - 6px); background: #fff; border-radius: 11px; box-shadow: 0 1px 3px rgba(20,72,82,.14); transition: transform var(--pm-dur-base) var(--pm-ease-emph); }
  .tabs[data-tab="clock"] .tabs__thumb { transform: translateX(calc(100% + 4px)); }
  .tabs button { position: relative; z-index: 1; flex: 1; border: 0; background: transparent; font: inherit; font-weight: 800; font-size: 15px; color: var(--fg-muted); padding: 10px 12px; min-height: 46px; border-radius: 11px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
  .tabs button.on { color: var(--brand-teal); }
  .tabs__n { font-size: 12px; background: var(--mint-200); color: var(--brand-teal); border-radius: 999px; padding: 1px 8px; transition: background-color var(--pm-dur-base); }
  .tabs button.on .tabs__n { background: var(--green-100); }
  .tabs__dot { width: 9px; height: 9px; border-radius: 50%; background: #c9ccc4; transition: background-color var(--pm-dur-base), box-shadow var(--pm-dur-base); }
  .tabs__dot--in { background: var(--brand-green); box-shadow: 0 0 0 3px var(--green-100); animation: pulse 2s var(--pm-ease-out) infinite; }
  @keyframes pulse { 0%, 100% { box-shadow: 0 0 0 3px var(--green-100); } 50% { box-shadow: 0 0 0 6px rgba(81,152,67,.18); } }
  .pane-tasks { display: flex; flex-direction: column; gap: 14px; }
  .pane-tasks[hidden] { display: none; }

  /* the three days, a thumb under the viewed one */
  .days { position: relative; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
  .days__thumb { position: absolute; top: 0; bottom: 0; left: 0; width: calc((100% - 12px) / 3); border-radius: 12px; background: var(--brand-teal); transition: transform var(--pm-dur-base) var(--pm-ease-emph), opacity var(--pm-dur-fast); }
  .days[data-sel="prev"] .days__thumb { transform: translateX(0); }
  .days[data-sel="today"] .days__thumb { transform: translateX(calc(100% + 6px)); }
  .days[data-sel="next"] .days__thumb { transform: translateX(calc(200% + 12px)); }
  .days[data-sel=""] .days__thumb { opacity: 0; }
  .days button { position: relative; z-index: 1; border: 1px solid var(--border); background: #fff; border-radius: 12px; padding: 8px 4px; min-height: 54px; font: inherit; color: var(--fg-muted); cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 2px; }
  .days button b { font-size: 14px; font-weight: 800; color: var(--fg); transition: color var(--pm-dur-base); }
  .days button small { font-size: 11px; transition: color var(--pm-dur-base); }
  .days button.on { border-color: transparent; background: transparent; }
  .days button.on b, .days button.on small { color: #fff; }
  .day { font-size: 13px; color: var(--fg-muted); display: flex; gap: 10px; align-items: center; }
  .day a { color: var(--brand-teal); font-weight: 700; }

  /* the day in one glance: a ring and a sentence */
  .summary { display: flex; align-items: center; gap: 14px; background: #fff; border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 12px 14px; }
  .ring { position: relative; width: 58px; height: 58px; flex: none; display: grid; place-items: center; }
  .ring svg { position: absolute; inset: 0; width: 100%; height: 100%; transform: rotate(-90deg); }
  .ring circle { fill: none; stroke-width: 3.4; }
  .ring__track { stroke: var(--mint-300); }
  .ring__bar { stroke: var(--brand-green); stroke-linecap: round; stroke-dasharray: var(--p, 0) 100; transition: stroke-dasharray var(--pm-dur-slow) var(--pm-ease-emph); }
  .ring b { font-family: var(--font-heading); font-size: 13px; font-weight: 800; color: var(--brand-teal); }
  .summary--done .ring__bar { stroke: var(--brand-green); }
  .summary--done { background: var(--green-50); border-color: var(--green-100); }
  .summary__text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .summary__text b { font-family: var(--font-heading); font-size: 16px; font-weight: 800; color: var(--brand-teal); }
  .summary__text small { font-size: 13px; color: var(--fg-muted); }

  /* one card per visit, its services as check-offs, Note + Services on each */
  .tasks { display: flex; flex-direction: column; gap: 12px; }
  .crew { font-family: var(--font-heading); font-weight: 800; font-size: 15px; color: var(--brand-teal); display: flex; align-items: center; gap: 8px; margin-top: 6px; }
  .crew .count { font-size: 12px; background: var(--mint-100); border-radius: 999px; padding: 2px 8px; color: var(--fg-muted); font-weight: 700; }
  .visit { background: #fff; border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 8px 24px -18px rgba(26,83,92,.35); transition: background-color var(--pm-dur-slow) var(--pm-ease-out), border-color var(--pm-dur-slow) var(--pm-ease-out), box-shadow var(--pm-dur-slow) var(--pm-ease-out); }
  .visit--done { background: var(--green-50); border-color: var(--green-100); box-shadow: none; }
  .visit__head { display: flex; align-items: flex-start; gap: 10px; }
  .visit__head > div { flex: 1; min-width: 0; }
  .visit__client { font-family: var(--font-heading); font-weight: 800; font-size: 17px; color: var(--brand-teal); }
  .visit__state { flex: none; font-size: 11px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; border-radius: 999px; padding: 4px 9px; background: var(--mint-200); color: var(--brand-teal); transition: background-color var(--pm-dur-base), color var(--pm-dur-base); }
  .visit--done .visit__state { background: var(--brand-green); color: #fff; }
  .svc { display: flex; align-items: center; gap: 12px; padding: 4px 0; }
  .svc__check { width: 46px; height: 46px; border-radius: 12px; border: 2px solid var(--green-200); background: #fff; display: grid; place-items: center; color: var(--brand-green); cursor: pointer; font-size: 0; flex: none; transition: background-color var(--pm-dur-base) var(--pm-ease-out), border-color var(--pm-dur-base) var(--pm-ease-out), transform var(--pm-dur-fast) var(--pm-ease-out); }
  .svc__check svg { opacity: .18; transition: opacity var(--pm-dur-base); }
  .svc--done .svc__check { background: var(--brand-green); color: #fff; border-color: var(--brand-green); }
  .svc--done .svc__check svg { opacity: 1; animation: pop var(--pm-dur-slow) var(--ease-bounce) both; }
  @keyframes pop { 0% { transform: scale(.4); } 60% { transform: scale(1.18); } 100% { transform: scale(1); } }
  .svc__check[disabled] { opacity: .5; cursor: default; }
  .svc--locked .svc__check { border-style: dashed; cursor: default; }
  .svc__name { font-weight: 700; font-size: 15px; color: var(--brand-teal); flex: 1; overflow-wrap: anywhere; transition: color var(--pm-dur-base); }
  .svc--done .svc__name { color: var(--fg-muted); }
  .svc__extra { font-size: 11px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: var(--brand-teal); background: var(--mint-100); border-radius: 999px; padding: 2px 7px; }
  .svc__lock { font-size: 11px; color: var(--fg-muted); }
  .visit__btns { display: flex; gap: 8px; }
  .visit__btns button { flex: 1; padding: 8px 4px; border: 1px solid var(--border); border-radius: 10px; background: #fff; font: inherit; font-size: 12px; font-weight: 700; color: var(--brand-teal); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-height: 54px; cursor: pointer; white-space: nowrap; }
  .visit__btns button.on { background: var(--mint-100); border-color: var(--brand-teal); }
  .visit__note-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--brand-teal); flex: none; }
  .note { display: flex; gap: 6px; align-items: flex-start; }
  .note textarea { flex: 1; padding: 10px 11px; border: 1px solid var(--border); border-radius: 9px; font: inherit; font-size: 15px; line-height: 1.35; min-width: 0; box-sizing: border-box; resize: none; overflow: hidden; }
  .note button, .add button { padding: 10px 14px; border: 0; border-radius: 9px; background: var(--brand-teal); color: #fff; font: inherit; font-weight: 700; min-height: 44px; cursor: pointer; }
  .services { border-top: 1px dashed var(--border); padding-top: 10px; display: flex; flex-direction: column; gap: 6px; }
  .services .row { display: flex; align-items: center; gap: 8px; font-size: 14px; color: var(--brand-teal); font-weight: 600; }
  .services .row.off span { color: var(--fg-muted); text-decoration: line-through; }
  .services .row span { flex: 1; overflow-wrap: anywhere; }
  .services .row button { border: 1px solid var(--border); background: #fff; border-radius: 8px; padding: 8px 10px; font: inherit; font-size: 13px; font-weight: 700; color: var(--brand-pink); min-height: 40px; cursor: pointer; }
  .services .row.off button { color: var(--brand-green); }
  .add { display: flex; gap: 6px; margin-top: 4px; }
  .add select { flex: 1; padding: 10px; border: 1px solid var(--border); border-radius: 9px; font: inherit; font-size: 15px; background: #fff; min-width: 0; }
  .saved { color: var(--green-700); font-size: 13px; }

  /* nothing on this day */
  .empty { background: #fff; border: 1px dashed var(--border-strong); border-radius: var(--radius-lg); padding: 28px 18px; display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; color: var(--fg-muted); }
  .empty svg { color: var(--green-300); }
  .empty p { margin: 0; font-weight: 600; }

  .wrap > .toast { position: fixed; left: 50%; bottom: 84px; transform: translateX(-50%); background: #c0392b; color: #fff; padding: 12px 18px; border-radius: 12px; font-weight: 700; font-size: 14px; box-shadow: 0 10px 24px -8px rgba(0,0,0,.4); z-index: 100; max-width: 90vw; animation: toast-in var(--pm-dur-slow) var(--pm-ease-ios) both; }
  .wrap > .toast--ok { background: var(--brand-green); }
  @keyframes toast-in { from { opacity: 0; transform: translate(-50%, 14px); } }
  /* REQ-528 (demo m51) — the viewed day written out, a native picker over it for any day */
  .day .pick { position: relative; cursor: pointer; }
  .day .pick b { color: var(--fg); text-decoration: underline dotted; }
  .day .pick input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; border: 0; padding: 0; }
  .wrap button[disabled] { opacity: .6; }
`;

/** a visit = one subscription on one day; its services are the tasks. REQ-785: a one-off's
 *  visit is its customer's tasks with the same first and last day — a job of several days is its own */
interface Visit {
  id: string;
  customerName: string;
  address: string;
  services: WorkerTaskView[];
}

function visitsOf(rows: WorkerTaskView[]): Visit[] {
  const m = new Map<string, Visit>();
  for (const x of rows) {
    const key = visitKey(x);
    let v = m.get(key);
    if (!v) {
      v = {
        id: key,
        customerName: x.customerName,
        address: x.address ?? "",
        services: [],
      };
      m.set(key, v);
    }
    v.services.push(x);
  }
  // REQ-196 — a stable order: the server lists tasks in storage order, which moved a card the
  // moment one of its services was checked; here visits still in progress come first, A→Z, and
  // finished visits sink to the bottom in the same order
  const finished = (v: Visit) => {
    const act = live(v);
    return act.length > 0 && act.every((s) => s.status === "complete") ? 1 : 0;
  };
  return [...m.values()].sort((a, b) =>
    finished(a) - finished(b) || a.customerName.localeCompare(b.customerName)
  );
}

const isLive = (s: WorkerTaskView) =>
  s.status !== "skipped" && s.status !== "deferred";
const live = (v: Visit) => v.services.filter(isLive);

/** an API failure as the worker should read it */
function friendly(e: unknown): string {
  if (e instanceof ApiError) {
    const b = e.body as { error?: string; message?: string } | null;
    const msg = (b && typeof b === "object" &&
      (typeof b.error === "string"
        ? b.error
        : typeof b.message === "string"
        ? b.message
        : "")) || "";
    if (/outside/i.test(msg)) return t("worker.err.outside");
    if (/invoiced/i.test(msg)) return t("worker.err.invoiced");
    return msg || t("worker.err.conflict");
  }
  if (e instanceof TypeError) return t("worker.offline");
  return t("worker.err.conflict");
}

interface Deferring {
  visit: string;
  /** one service — or the whole visit when absent */
  task?: string;
  note: string;
}

/** REQ-417 (p13-q) — the note textarea grows to fit its text (rows=2 is the floor) */
function growNote(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight + 2}px`;
}

interface Toast {
  msg: string;
  ok: boolean;
}

/** REQ-197 — what the server already loaded, so the first paint is the final screen */
export interface WorkerSsr {
  me: WorkerMe | null;
  tasks: WorkerTaskView[];
  types: TaskType[];
  /** the day those tasks are for (the field's time zone) */
  date: string;
}

export default function WorkerScreen(
  {
    initialLang,
    pageLang,
    initialDate,
    office,
    officeHref = WORKER_OFFICE_FALLBACK,
    langChosen = false,
    langPicked = false,
    ssr,
  }: {
    initialLang: Lang;
    /** REQ-714 (m58) — the page's own language when initialLang is the signed-in worker's (SSR); Salir returns to it */
    pageLang?: Lang;
    initialDate?: string;
    /** REQ-282 — an owner session rode in: show the way back to the office */
    office?: boolean;
    /** REQ-417 (m44) — the office page the owner came from (route-resolved, allow-listed) */
    officeHref?: string;
    /** REQ-285 — the address chose the language (?lang=); the worker's own does not override it */
    langChosen?: boolean;
    /** REQ-494 (M43) — the EN/ES switch picked it on an earlier visit (pm_worker_lang) */
    langPicked?: boolean;
    /** REQ-197 — the server-rendered worker and day (the first paint is the final screen) */
    ssr?: WorkerSsr;
  },
) {
  const lang = langSignal.value;
  // `undefined` = not asked yet; `null` = asked, nobody is signed in
  const [me, setMe] = useState<WorkerMe | null | undefined>(
    ssr ? ssr.me : undefined,
  );
  const [tasks, setTasks] = useState<WorkerTaskView[]>(ssr?.tasks ?? []);
  const [types, setTypes] = useState<TaskType[]>(ssr?.types ?? []);
  const [date, setDate] = useState(initialDate ?? ssr?.date ?? "");
  const [today, setToday] = useState(ssr?.date ?? initialDate ?? "");
  /** the server's data is on screen already: the first load effect must not fetch it again */
  const primed = useRef(Boolean(ssr && ssr.me));
  const [cell, setCell] = useState("");
  /** REQ-193 — Tasks | Time clock, one at a time; the clock stays mounted (its state dots the tab) */
  const [tab, setTab] = useState<"tasks" | "clock">("tasks");
  const [clockState, setClockState] = useState<"in" | "out" | null>(null);
  const [pin, setPin] = useState("");
  /** REQ-150 — the eye: the PIN shows while pressed, hidden when the page opens */
  const [showPin, setShowPin] = useState(false);
  const [bad, setBad] = useState("");
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<Toast | null>(null);
  const [open, setOpen] = useState<Record<string, "note" | "services" | null>>(
    {},
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState<Record<string, string>>({});
  const [deferring, setDeferring] = useState<Deferring | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  /** REQ-608 — one "Note saved" timer per visit; a newer save restarts it */
  const flashTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {},
  );
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const deferringRef = useRef(deferring);
  deferringRef.current = deferring;
  const meRef = useRef(me);
  meRef.current = me;
  const dateRef = useRef(date);
  dateRef.current = date;
  /** REQ-285 — the person chose the language (the switch, or ?lang=): keep it over the worker's */
  const langChosenRef = useRef(langChosen || !!langPicked);
  /** REQ-416 — the page's own language (opened in, or picked on the switch); Salir returns to it */
  const pageLangRef = useRef<Lang>(pageLang ?? initialLang);
  // REQ-508 (demo cycle 3, m20) — when the last load started; the 5 s tick skips a fresh one
  const lastLoadRef = useRef(0);

  useEffect(() => {
    const page = pageLang ?? initialLang;
    pageLangRef.current = page;
    // REQ-714 (m58) — opened in the worker's language (SSR): shown, never
    // written into the browser's pm_lang (REQ-416)
    setLang(initialLang, { persist: initialLang === page });
  }, [initialLang, pageLang]);

  // Browser-side facts: the real day, the remembered cell.
  useEffect(() => {
    const now = todayIso();
    setToday(now);
    if (!initialDate) setDate(now);
    try {
      setCell(localStorage.getItem(CELL_KEY) ?? "");
    } catch { /* storage disabled */ }
    if (new URLSearchParams(location.search).get("tab") === "clock") {
      setTab("clock");
    }
  }, [initialDate]);

  /** REQ-194 — yesterday | today | tomorrow, switched in place (the loader follows `date`) */
  function pickDay(iso: string) {
    setDate(iso);
    const u = new URL(location.href);
    if (iso === today) u.searchParams.delete("date");
    else u.searchParams.set("date", iso);
    history.replaceState(null, "", u);
  }

  function pickTab(next: "tasks" | "clock") {
    setTab(next);
    const u = new URL(location.href);
    if (next === "clock") u.searchParams.set("tab", "clock");
    else u.searchParams.delete("tab");
    history.replaceState(null, "", u);
  }

  function showToast(msg: string, ok = false) {
    setToast({ msg, ok });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }

  async function load() {
    const d = dateRef.current;
    if (!d) return;
    lastLoadRef.current = Date.now();
    try {
      // no worker session: the backend answers 200 with an empty body (Danet
      // serialises `null` as nothing), which the api helper hands back as ""
      const raw = await workerClient.me();
      const who = raw && typeof raw === "object" ? raw : null;
      setMe(who);
      // REQ-285 — signed in: the screen takes the worker's language;
      // REQ-416 — for this session only, never over the browser's own pm_lang
      const wl = workerScreenLang(who, langChosenRef.current);
      if (wl) setLang(wl, { persist: false });
      meRef.current = who;
      if (who) {
        const [rows, tt] = await Promise.all([
          workerClient.tasks(d, who.role === "foreman"),
          workerClient.taskTypes(),
        ]);
        setTasks(rows);
        setTypes(tt);
      } else {
        setTasks([]);
      }
    } catch (e) {
      if (meRef.current === undefined) setMe(null);
      showToast(t("worker.fail", { msg: friendly(e) }));
    }
  }

  /** REQ-605 — the poll's read: the day's tasks only (me and task types rarely change) */
  async function loadTasks() {
    const d = dateRef.current;
    const who = meRef.current;
    if (!d || !who) return;
    lastLoadRef.current = Date.now();
    try {
      setTasks(await workerClient.tasks(d, who.role === "foreman"));
    } catch (e) {
      // the session ended elsewhere: a full read puts the sign-in form back
      if (e instanceof ApiError && e.status === 401) return load();
      showToast(t("worker.fail", { msg: friendly(e) }));
    }
  }

  // First (full) load once the day is known; then REQ-605: a tasks-only refresh every 5 s
  // while visible and in use, backing off to 60 s while idle, and a full read on the
  // catch-up after the tab was hidden.
  useEffect(() => {
    if (!date) return;
    // REQ-197: the server's data is on screen already — the first run skips the fetch
    if (primed.current) primed.current = false;
    else load();
    return startWorkerRefresh({
      full: load,
      tasks: loadTasks,
      due: () =>
        !!meRef.current && busyRef.current.size === 0 &&
        Object.keys(draftsRef.current).length === 0 && !deferringRef.current &&
        refreshTickDue(lastLoadRef.current, Date.now(), REFRESH_MS), // REQ-508: not right after an act()'s reload
    });
  }, [date]);

  /**
   * one in-flight request per control; failures become a toast, never silence.
   * Resolves true once the action AND its reload are done (REQ-608).
   */
  async function act(
    key: string,
    fn: () => Promise<unknown>,
    after: () => Promise<unknown> = loadTasks, // REQ-605: an action changes tasks only
  ): Promise<boolean> {
    if (busyRef.current.has(key)) return false;
    setBusy((b) => new Set(b).add(key));
    try {
      await fn();
      await after();
      return true;
    } catch (e) {
      showToast(t("worker.fail", { msg: friendly(e) }));
      return false;
    } finally {
      setBusy((b) => {
        const n = new Set(b);
        n.delete(key);
        return n;
      });
    }
  }

  function login(e: Event) {
    e.preventDefault();
    const digits = cell.replace(/\D/g, "");
    if (busyRef.current.has("login")) return;
    setBusy((b) => new Set(b).add("login"));
    workerClient.login(digits, pin).then(() => {
      setBad("");
      setPin("");
      try {
        localStorage.setItem(CELL_KEY, digits);
      } catch { /* storage disabled */ }
      return load();
    }).catch((err) => {
      if (err instanceof ApiError && err.status === 429) {
        setBad(t("worker.locked"));
      } else if (err instanceof ApiError && err.status === 401) {
        setBad(t("worker.bad"));
      } else setBad(friendly(err));
    }).finally(() =>
      setBusy((b) => {
        const n = new Set(b);
        n.delete("login");
        return n;
      })
    );
  }

  function logout() {
    act("logout", async () => {
      await workerClient.logout();
      langChosenRef.current = langChosen; // the next worker's language applies
      rememberWorkerLangPick(null); // REQ-494 — and on the next visit too
      // REQ-416 — the sign-in form is back in the page's own language
      setLang(pageLangRef.current, { persist: false });
      setMe(null);
      setTasks([]);
      setOpen({});
      setDrafts({});
      setDeferring(null);
    }, load);
  }

  function toggleOpen(vid: string, which: "note" | "services") {
    setOpen((o) => ({ ...o, [vid]: o[vid] === which ? null : which }));
  }

  /** REQ-608 — drop a visit's "Note saved" line (its timer ran out, or the note was edited) */
  function clearFlash(vid: string) {
    clearTimeout(flashTimers.current[vid]);
    delete flashTimers.current[vid];
    setFlash((f) => {
      if (!(vid in f)) return f;
      const n = { ...f };
      delete n[vid];
      return n;
    });
  }

  async function saveNote(v: Visit) {
    const first = live(v)[0] ?? v.services[0];
    if (!first) return;
    const note = drafts[v.id] ?? noteOf(v);
    const ok = await act(`note:${v.id}`, async () => {
      await workerClient.note(first.id, note);
      setDrafts((d) => {
        const n = { ...d };
        delete n[v.id];
        return n;
      });
    });
    if (!ok) return;
    // REQ-608 (demo m47): shown once the reload is done, and held until the note is
    // edited again or NOTE_SAVED_MS passes — 1.5 s from before the reload was unseen
    clearTimeout(flashTimers.current[v.id]);
    setFlash((f) => ({ ...f, [v.id]: t("worker.saved") }));
    flashTimers.current[v.id] = setTimeout(
      () => clearFlash(v.id),
      NOTE_SAVED_MS,
    );
  }

  function deferGo(v: Visit) {
    if (!deferring || deferring.visit !== v.id) return;
    const ids = deferring.task
      ? [deferring.task]
      : live(v).filter((s) => s.status === "assigned").map((s) => s.id);
    const note = deferring.note;
    act(`defer:${v.id}`, async () => {
      for (const id of ids) await workerClient.defer(id, note);
      setDeferring(null);
    });
  }

  function addService(v: Visit) {
    const taskTypeId = pick[v.id];
    if (!taskTypeId) return;
    act(`add:${v.id}`, async () => {
      await workerClient.addService(v.id, { taskTypeId, date });
      setPick((p) => ({ ...p, [v.id]: "" }));
    });
  }

  const noteOf = (v: Visit) =>
    v.services.map((s) => s.note).find(Boolean) ?? "";

  /** REQ-362 — the day navigator; a day after today is a read-only preview */
  // REQ-417 — a day change keeps the owner's way back to the office page they came from
  const navFrom = office && officeHref !== WORKER_OFFICE_FALLBACK
    ? officeHref
    : undefined;
  const nav = date && today ? workerDayNav(date, today, navFrom) : null;
  /** REQ-528 (demo m51) — the date picker jumps to any day (the REQ-194 strip
   *  switches yesterday / today / tomorrow in place; the picker opens any other) */
  const jumpToDay = (iso: string) => {
    const href = workerDayHref(iso, navFrom);
    if (href && iso !== date) location.assign(href);
  };
  const preview = !!nav?.preview;

  const dayLine = () => {
    if (!date) return "";
    const s = fmtDay(date, lang);
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  function renderVisit(v: Visit) {
    const act_ = live(v);
    const done = act_.filter((s) => s.status === "complete").length;
    const all = act_.length > 0 && done === act_.length;
    const note = noteOf(v);
    const locked = preview || v.services.some((s) => s.locked);
    const onVisit = new Set(
      v.services.filter((s) => s.status !== "skipped").map((s) => s.taskTypeId),
    );
    const addable = types.filter((tt) => !onVisit.has(tt.id));
    const deferHere = deferring?.visit === v.id ? deferring : null;
    const panel = open[v.id] ?? null;
    // REQ-785 — a job of several days: which of its days this is, and who else is on it
    const first = v.services[0];
    const span = first ? jobDayOf(first, date) : null;
    const mates = first && me ? workMates(first, me.id) : [];
    /** a subscription's visit takes services from the worker; a one-off's does not (no subscription to add to) */
    const subscribed = v.services.some((s) => !!s.subscriptionId);
    return (
      <div
        class={`visit${all ? " visit--done" : ""}`}
        data-cy="w-visit"
        data-id={v.id}
        key={v.id}
      >
        <div class="visit__head">
          <div>
            <div class="visit__client">{v.customerName}</div>
            {v.address && (
              <a
                class="task__addr"
                href={`https://maps.google.com/?q=${
                  encodeURIComponent(v.address)
                }`}
                target="_blank"
                rel="noopener"
                style="display:inline-flex;align-items:center;gap:4px"
              >
                <I d={ICN.pin} size={12} />
                {v.address}
              </a>
            )}
            {span && first && (
              <div
                class="hint"
                data-cy="w-job-span"
                data-n={span.n}
                data-of={span.of}
                style="display:flex;align-items:center;gap:4px;margin-top:4px"
              >
                <I d={ICN.cal} size={12} /> {t("worker.jobDay", {
                  n: span.n,
                  total: span.of,
                  range: jobRange(first, lang),
                })}
              </div>
            )}
            {mates.length > 0 && (
              <div class="hint" data-cy="w-crew">
                {t("worker.crewWith", { names: mates.join(", ") })}
              </div>
            )}
          </div>
          <span class="visit__state" data-cy="w-visit-state">
            {all ? t("worker.visitDone") : `${done}/${act_.length}`}
          </span>
        </div>
        <div>
          {act_.map((s) => (
            <div
              key={s.id}
              class={`svc${s.status === "complete" ? " svc--done" : ""}${
                s.locked || preview ? " svc--locked" : ""
              }`}
              data-id={s.id}
            >
              <button
                type="button"
                class="svc__check"
                data-cy="w-check"
                aria-label={t("worker.done")}
                aria-pressed={s.status === "complete"}
                disabled={s.locked || preview || busy.has(s.id)}
                onClick={() =>
                  act(
                    s.id,
                    () =>
                      s.status === "complete"
                        ? workerClient.uncomplete(s.id)
                        : workerClient.complete(s.id),
                  )}
              >
                <I d={ICN.check} size={24} sw={3} />
              </button>
              <div class="svc__name">
                {s.taskTypeName}
                {s.addedBy === "worker" && (
                  <>
                    {" "}
                    <span class="svc__extra">
                      {s.addedByName && me && s.addedByName !== me.name
                        ? t("worker.addedBy", { name: s.addedByName })
                        : t("worker.added")}
                    </span>
                  </>
                )}
                {s.deferredFrom && (
                  <>
                    {" "}
                    <span class="svc__extra">
                      {t("worker.fromYesterday", {
                        date: s.deferredFrom.slice(5),
                      })}
                    </span>
                  </>
                )}
                {s.locked && (
                  <>
                    {" "}
                    <span class="svc__lock">
                      🔒 {t(lockLabelKey(s.lockState))}
                    </span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
        {v.services.filter((s) => s.status === "deferred").map((s) => (
          <div class="hint" key={s.id}>
            ⏭ {s.taskTypeName} · {t("worker.deferred")}
            {s.note ? ` — ${s.note}` : ""}
          </div>
        ))}
        {!locked && (
          <div class="visit__btns">
            <button
              type="button"
              data-cy="w-note-btn"
              class={panel === "note" ? "on" : ""}
              onClick={() => toggleOpen(v.id, "note")}
            >
              <I d={ICN.msg} size={14} />
              {t("worker.note")}
              {note && (
                <span
                  class="visit__note-dot"
                  data-cy="w-note-dot"
                  role="img"
                  aria-label={t("worker.hasNote")}
                  title={t("worker.hasNote")}
                />
              )}
            </button>
            <button
              type="button"
              data-cy="w-services-btn"
              class={panel === "services" ? "on" : ""}
              onClick={() => toggleOpen(v.id, "services")}
            >
              <I d={ICN.plus} size={14} sw={2.5} />
              {t("worker.services")}
            </button>
            {act_.some((s) => s.status === "assigned") && !span && (
              <button
                type="button"
                data-cy="w-defer-visit"
                class={deferHere && !deferHere.task ? "on" : ""}
                onClick={() =>
                  setDeferring((d) =>
                    d && d.visit === v.id && !d.task
                      ? null
                      : { visit: v.id, note: "" }
                  )}
              >
                ⏭ {t("worker.deferVisit")}
              </button>
            )}
          </div>
        )}
        {deferHere && (
          <form
            class="note"
            onSubmit={(e) => {
              e.preventDefault();
              deferGo(v);
            }}
          >
            <input
              data-cy="w-defer-note"
              placeholder={t("worker.deferPh")}
              value={deferHere.note}
              autoFocus
              onInput={(e) =>
                setDeferring((d) =>
                  d ? { ...d, note: (e.target as HTMLInputElement).value } : d
                )}
            />
            <button
              type="submit"
              data-cy="w-defer-go"
              disabled={busy.has(`defer:${v.id}`)}
            >
              {t("worker.deferGo")}
            </button>
          </form>
        )}
        {locked && note && <div class="hint">💬 {note}</div>}
        {!locked && panel === "note" && (
          <>
            <form
              class="note"
              onSubmit={(e) => {
                e.preventDefault();
                saveNote(v);
              }}
            >
              {
                /* REQ-417 (p13-q): a textarea, so the placeholder wraps at 390 px
                 instead of being cut; it grows with the text */
              }
              <textarea
                data-cy="w-note"
                rows={2}
                placeholder={t("worker.notePh")}
                value={drafts[v.id] ?? note}
                ref={growNote}
                onInput={(e) => {
                  const el = e.target as HTMLTextAreaElement;
                  growNote(el);
                  setDrafts((d) => ({ ...d, [v.id]: el.value }));
                  clearFlash(v.id); // REQ-608 — an edit is no longer "saved"
                }}
              />
              <button
                type="submit"
                data-cy="w-note-save"
                disabled={busy.has(`note:${v.id}`)}
              >
                {t("worker.save")}
              </button>
            </form>
            {flash[v.id] && (
              <div class="saved" data-cy="w-note-saved" role="status">
                {flash[v.id]}
              </div>
            )}
          </>
        )}
        {!locked && panel === "services" && (
          <div class="services">
            {v.services.map((s) => (
              <div
                key={s.id}
                class={`row${s.status === "skipped" ? " off" : ""}`}
                data-id={s.id}
              >
                <span>
                  {s.taskTypeName}
                  {s.status === "skipped" ? ` (${t("worker.skipped")})` : ""}
                </span>
                {s.locked ? null : s.status === "skipped"
                  ? (
                    <button
                      type="button"
                      data-cy="w-restore"
                      disabled={busy.has(s.id)}
                      onClick={() =>
                        act(s.id, () => workerClient.restore(s.id))}
                    >
                      {t("worker.restore")}
                    </button>
                  )
                  : s.status === "deferred"
                  ? <span class="hint">⏭ {t("worker.deferred")}</span>
                  : (
                    <>
                      <button
                        type="button"
                        data-cy="w-skip"
                        disabled={busy.has(s.id)}
                        onClick={() => act(s.id, () => workerClient.skip(s.id))}
                      >
                        × {t("worker.remove")}
                      </button>
                      {s.status === "assigned" && !jobDayOf(s, date) && (
                        <button
                          type="button"
                          data-cy="w-defer"
                          onClick={() =>
                            setDeferring({ visit: v.id, task: s.id, note: "" })}
                        >
                          ⏭ {t("worker.defer")}
                        </button>
                      )}
                    </>
                  )}
              </div>
            ))}
            {subscribed && (
              <div class="add">
                <select
                  data-cy="w-add-type"
                  value={pick[v.id] ?? ""}
                  onChange={(e) =>
                    setPick((p) => ({
                      ...p,
                      [v.id]: (e.target as HTMLSelectElement).value,
                    }))}
                >
                  <option value="">{t("worker.pick")}</option>
                  {addable.map((tt) => (
                    <option key={tt.id} value={tt.id}>{tt.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  data-cy="w-add"
                  disabled={busy.has(`add:${v.id}`) || !pick[v.id]}
                  onClick={() => addService(v)}
                >
                  {t("worker.add")}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  function renderSection(rows: WorkerTaskView[], title: string, key: string) {
    const liveRows = rows.filter(isLive);
    return (
      <div key={key}>
        <div class="crew">
          <I d={ICN.hardhat} size={16} />
          {title}
          <span class="count">
            {liveRows.filter((x) => x.status === "complete").length}/
            {liveRows.length}
          </span>
        </div>
        {rows.length
          ? (
            <div class="tasks" data-stagger key={`${key}:${date}`}>
              {visitsOf(rows).map(renderVisit)}
            </div>
          )
          : (
            <div class="empty">
              <p>{t("worker.noneCrew")}</p>
            </div>
          )}
      </div>
    );
  }

  const liveTasks = tasks.filter(isLive);
  const done = liveTasks.filter((x) => x.status === "complete").length;
  const pct = liveTasks.length ? (done / liveTasks.length) * 100 : 0;

  let body = null;
  if (me) {
    // REQ-785 — a job the worker is on the crew of is theirs too
    const mine = tasks.filter((x) => onJob(me.id, x));
    const others = tasks.filter((x) => !onJob(me.id, x));
    if (me.role === "foreman") {
      const byWorker = new Map<string, WorkerTaskView[]>();
      for (const x of others) {
        const k = x.workerName || x.workerId;
        if (!byWorker.has(k)) byWorker.set(k, []);
        byWorker.get(k)!.push(x);
      }
      body = (
        <>
          {renderSection(mine, t("worker.mine"), "mine")}
          {[...byWorker.entries()].map(([name, rows]) =>
            renderSection(rows, t("worker.crew", { name }), `crew:${name}`)
          )}
        </>
      );
    } else {
      body = mine.length
        ? (
          <div class="tasks" data-stagger key={date}>
            {visitsOf(mine).map(renderVisit)}
          </div>
        )
        : (
          <div class="empty" data-cy="w-empty">
            <I d={ICN.sparkle} size={28} />
            <p>{t("worker.none")}</p>
          </div>
        );
    }
  }

  return (
    <div class="wrap" data-stagger>
      <style>{css}</style>
      <div class="top">
        <div class="brand">
          <img src="/logo-monster-card.png" alt="" />
          {t("worker.title")}
        </div>
        <div class="lang" role="group" aria-label="Language">
          {(["en", "es"] as Lang[]).map((c) => (
            <button
              type="button"
              key={c}
              class={lang === c ? "on" : ""}
              aria-pressed={lang === c}
              onClick={() => {
                pageLangRef.current = c;
                langChosenRef.current = true;
                setLang(c);
                rememberWorkerLangPick(c); // REQ-494 — survives re-entry
                if (meRef.current) load(); // REQ-605: a language pick re-reads me + task types
              }}
            >
              {c.toUpperCase()}
            </button>
          ))}
        </div>
        {(office || me) && (
          <div class="top__actions">
            {office && (
              <a
                href={officeHref}
                class="btn btn--ghost btn--sm"
                data-cy="w-office"
                style="min-height:44px"
              >
                {t("worker.backToOffice")}
              </a>
            )}
            {me && (
              <button
                type="button"
                class="btn btn--ghost btn--sm"
                data-cy="w-logout"
                style="min-height:44px"
                disabled={busy.has("logout")}
                onClick={logout}
              >
                {t("worker.logout")}
              </button>
            )}
          </div>
        )}
      </div>

      {me === undefined && (
        <div class="greet">
          {t("worker.title")}
          <small>{t("field.common.loading")}</small>
        </div>
      )}

      {me === null && (
        <>
          <div class="greet">
            {t("worker.title")}
            <small>{dayLine()}</small>
          </div>
          {
            /* REQ-602 (M35): the owner (office session, no worker signed in)
            has no cell + PIN here — say whose screen this is and where
            workers are added. */
          }
          {office && (
            <div class="owner-note" data-cy="w-owner-note">
              <span>{t("worker.ownerNote")}</span>
              <a
                href={WORKERS_PAGE_HREF}
                class="btn btn--ghost btn--sm"
                data-cy="w-owner-workers"
                style="min-height:44px;align-self:flex-start"
              >
                {t("worker.ownerManage")}
              </a>
            </div>
          )}
          <form class="login" onSubmit={login}>
            <label class="field">
              {t("worker.cell")}
              <input
                type="tel"
                name="cell"
                data-cy="w-cell"
                inputMode="tel"
                autoComplete="tel"
                placeholder={t("worker.cellPh")}
                value={formatPhoneInput(cell)} /* REQ-593 */
                required
                onInput={(e) => setCell((e.target as HTMLInputElement).value)}
              />
            </label>
            <label class="field">
              {t("worker.pin")}
              <span class="pinwrap">
                <input
                  class="pin"
                  type={showPin ? "text" : "password"}
                  name="pin"
                  data-cy="w-pin"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={4}
                  pattern="[0-9]{4}"
                  placeholder="••••"
                  value={pin}
                  required
                  onInput={(e) => setPin((e.target as HTMLInputElement).value)}
                />
                <button
                  type="button"
                  class="eye"
                  data-cy="w-pin-eye"
                  aria-pressed={showPin}
                  aria-label={showPin
                    ? t("worker.hidePin")
                    : t("worker.showPin")}
                  title={showPin ? t("worker.hidePin") : t("worker.showPin")}
                  onClick={() => setShowPin((v) => !v)}
                >
                  <I d={ICN.eye} size={20} />
                </button>
              </span>
            </label>
            {bad && <p class="alert" data-cy="w-error">{bad}</p>}
            <button
              type="submit"
              class="btn btn--green"
              data-cy="w-login"
              style="justify-content:center;padding:14px"
              disabled={busy.has("login")}
            >
              {t("worker.login")}
            </button>
          </form>
        </>
      )}

      {me && (
        <>
          <div class="greet">
            {t("worker.hello", { name: me.name })}
            {me.role === "foreman" && (
              <>
                {" "}
                <span class="chip chip--amber">{t("worker.foreman")}</span>
              </>
            )}
            <small>{dayLine()}</small>
          </div>
          {/* REQ-193 — the two tabs: the day's tasks, the time clock */}
          <div class="tabs" role="tablist" data-cy="w-tabs" data-tab={tab}>
            <span class="tabs__thumb" aria-hidden="true"></span>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "tasks"}
              class={tab === "tasks" ? "on" : ""}
              data-cy="w-tab-tasks"
              onClick={() => pickTab("tasks")}
            >
              {t("worker.tabTasks")}
              {liveTasks.length > 0 && (
                <span class="tabs__n">{done}/{liveTasks.length}</span>
              )}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "clock"}
              class={tab === "clock" ? "on" : ""}
              data-cy="w-tab-clock"
              onClick={() => pickTab("clock")}
            >
              {clockState && (
                <span
                  class={`tabs__dot${
                    clockState === "in" ? " tabs__dot--in" : ""
                  }`}
                  data-cy="w-tab-clock-dot"
                  data-state={clockState}
                  aria-hidden="true"
                >
                </span>
              )}
              {t("worker.tabClock")}
            </button>
          </div>
          {/* REQ-192 — the clock: one button, this week's shifts; mounted always, shown on its tab */}
          <div hidden={tab !== "clock"} data-cy="w-pane-clock" data-pane>
            <WorkerClock hoursOpen onState={setClockState} />
          </div>
          <div
            hidden={tab !== "tasks"}
            data-cy="w-pane-tasks"
            class="pane-tasks"
            data-pane
          >
            {/* REQ-194 — the three days a worker lives in, one tap each */}
            {today && (
              <div
                class="days"
                role="tablist"
                data-cy="w-days"
                data-sel={date === today
                  ? "today"
                  : date === shiftIso(today, -1)
                  ? "prev"
                  : date === shiftIso(today, 1)
                  ? "next"
                  : ""}
              >
                <span class="days__thumb" aria-hidden="true"></span>
                {([-1, 0, 1] as const).map((off) => {
                  const iso = shiftIso(today, off);
                  const id = off === -1 ? "prev" : off === 0 ? "today" : "next";
                  const key = off === -1
                    ? "worker.yesterday"
                    : off === 0
                    ? "worker.todayLink"
                    : "worker.tomorrow";
                  return (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={date === iso}
                      class={date === iso ? "on" : ""}
                      data-cy={`w-day-${id}`}
                      data-date={iso}
                      onClick={() => pickDay(iso)}
                    >
                      <b>{t(key)}</b>
                      <small>{fmtDay(iso, lang)}</small>
                    </button>
                  );
                })}
              </div>
            )}
            {/* REQ-528 (demo m51) — the day written out, and a native picker for any day */}
            {nav && (
              <div class="day">
                <label class="pick" data-cy="w-day-label">
                  {t("worker.viewing")} <b>{fmtDay(date, lang)}</b>
                  <input
                    type="date"
                    data-cy="w-day-pick"
                    aria-label={t("worker.pickDay")}
                    value={date}
                    onChange={(e) => jumpToDay(e.currentTarget.value)}
                    onClick={(e) => {
                      try {
                        e.currentTarget.showPicker?.();
                      } catch {
                        /* not allowed here — the native control still works */
                      }
                    }}
                  />
                </label>
              </div>
            )}
            {/* REQ-362 — a day after today is a read-only preview */}
            {preview && (
              <div class="hint" data-cy="w-preview">
                🔒 {t("worker.preview")}
              </div>
            )}
            {/* REQ-196 — the day in one glance */}
            <div
              class={`summary${
                liveTasks.length > 0 && done === liveTasks.length
                  ? " summary--done"
                  : ""
              }`}
              data-cy="w-summary"
            >
              <div
                class="ring"
                data-cy="w-progress"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={liveTasks.length}
                aria-valuenow={done}
                style={`--p:${pct}`}
              >
                <svg viewBox="0 0 36 36" aria-hidden="true">
                  <circle class="ring__track" cx="18" cy="18" r="15.5" />
                  <circle
                    class="ring__bar"
                    cx="18"
                    cy="18"
                    r="15.5"
                    pathLength={100}
                  />
                </svg>
                <b>{Math.round(pct)}%</b>
              </div>
              <div class="summary__text">
                <b data-cy="w-count">
                  {t(workerTodayKey(liveTasks.length), {
                    done,
                    n: liveTasks.length,
                  })}
                </b>
                <small>
                  {liveTasks.length === 0
                    ? t("worker.freeDay")
                    : done === liveTasks.length
                    ? t("worker.allDone")
                    : t("worker.left", { n: liveTasks.length - done })}
                </small>
              </div>
            </div>
            {body}
          </div>
        </>
      )}

      {toast && (
        <div class={`toast${toast.ok ? " toast--ok" : ""}`} role="status">
          {toast.msg}
        </div>
      )}
    </div>
  );
}
