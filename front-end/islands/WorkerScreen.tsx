/**
 * REQ-143 — /worker: the worker's own phone screen. PUBLIC route; the worker
 * logs in by cell + 4-digit PIN (REQ-141) and gets the day's VISITS — one card
 * per subscription on one day — with its services as big check-off buttons, a
 * note for the office, a services panel (remove / put back / defer one / add),
 * and "Defer visit". A foreman sees their own visits first, then one section
 * per crew. `?date=` replays a past day; the list refreshes every 5 s while the
 * tab is visible and nothing is being typed.
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
import { I, ICN } from "../lib/dash-icons.tsx";
import { fmtDay, shiftIso, todayIso } from "../lib/field.ts";
import { type Lang, langSignal, setLang, t } from "../lib/i18n.ts";
import WorkerClock from "../components/timeclock/WorkerClock.tsx";

const CELL_KEY = "pm:worker-cell";
const REFRESH_MS = 5000;

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
  .pin { letter-spacing: .4em; text-align: center; font-family: var(--font-mono); }
  .pinwrap { position: relative; display: flex; }
  .pinwrap input { flex: 1; min-width: 0; padding-right: 52px; }
  .pinwrap .eye { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); width: 44px; height: 44px; border: 0; background: transparent; color: var(--fg-muted); border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
  .pinwrap .eye[aria-pressed="true"] { color: var(--brand-teal); }
  .pinwrap .eye:focus-visible { outline: 2px solid var(--brand-green); outline-offset: 1px; }
  .lang { margin-left: auto; display: flex; gap: 2px; background: var(--mint-100); border: 1px solid var(--border); border-radius: 999px; padding: 3px; }
  .lang button { border: 0; background: transparent; font-weight: 800; font-size: 13px; color: var(--fg-muted); padding: 10px 14px; border-radius: 999px; min-height: 44px; cursor: pointer; }
  .lang button.on { background: #fff; color: var(--brand-teal); box-shadow: 0 1px 3px rgba(20,72,82,.12); }

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
  .note { display: flex; gap: 6px; }
  .note input { flex: 1; padding: 10px 11px; border: 1px solid var(--border); border-radius: 9px; font: inherit; font-size: 15px; min-width: 0; }
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
  .wrap button[disabled] { opacity: .6; }
`;

/** a visit = one subscription on one day; its services are the tasks */
interface Visit {
  id: string;
  customerName: string;
  address: string;
  services: WorkerTaskView[];
}

function visitsOf(rows: WorkerTaskView[]): Visit[] {
  const m = new Map<string, Visit>();
  for (const x of rows) {
    let v = m.get(x.subscriptionId);
    if (!v) {
      v = {
        id: x.subscriptionId,
        customerName: x.customerName,
        address: x.address ?? "",
        services: [],
      };
      m.set(x.subscriptionId, v);
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
  { initialLang, initialDate, ssr }: {
    initialLang: Lang;
    initialDate?: string;
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

  useEffect(() => {
    setLang(initialLang);
  }, [initialLang]);

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
    try {
      // no worker session: the backend answers 200 with an empty body (Danet
      // serialises `null` as nothing), which the api helper hands back as ""
      const raw = await workerClient.me();
      const who = raw && typeof raw === "object" ? raw : null;
      setMe(who);
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

  // First load once the day is known; then a 5 s refresh while visible and idle.
  useEffect(() => {
    if (!date) return;
    if (primed.current) primed.current = false;
    else load();
    const id = setInterval(() => {
      if (
        meRef.current && document.visibilityState === "visible" &&
        busyRef.current.size === 0 &&
        Object.keys(draftsRef.current).length === 0 && !deferringRef.current
      ) load();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [date]);

  /** one in-flight request per control; failures become a toast, never silence */
  async function act(key: string, fn: () => Promise<unknown>) {
    if (busyRef.current.has(key)) return;
    setBusy((b) => new Set(b).add(key));
    try {
      await fn();
      await load();
    } catch (e) {
      showToast(t("worker.fail", { msg: friendly(e) }));
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
      setMe(null);
      setTasks([]);
      setOpen({});
      setDrafts({});
      setDeferring(null);
    });
  }

  function toggleOpen(vid: string, which: "note" | "services") {
    setOpen((o) => ({ ...o, [vid]: o[vid] === which ? null : which }));
  }

  function saveNote(v: Visit) {
    const first = live(v)[0] ?? v.services[0];
    if (!first) return;
    const note = drafts[v.id] ?? noteOf(v);
    act(`note:${v.id}`, async () => {
      await workerClient.note(first.id, note);
      setDrafts((d) => {
        const n = { ...d };
        delete n[v.id];
        return n;
      });
      setFlash((f) => ({ ...f, [v.id]: t("worker.saved") }));
      setTimeout(
        () =>
          setFlash((f) => {
            const n = { ...f };
            delete n[v.id];
            return n;
          }),
        1500,
      );
    });
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
    const locked = v.services.some((s) => s.locked);
    const onVisit = new Set(
      v.services.filter((s) => s.status !== "skipped").map((s) => s.taskTypeId),
    );
    const addable = types.filter((tt) => !onVisit.has(tt.id));
    const deferHere = deferring?.visit === v.id ? deferring : null;
    const panel = open[v.id] ?? null;
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
                s.locked ? " svc--locked" : ""
              }`}
              data-id={s.id}
            >
              <button
                type="button"
                class="svc__check"
                data-cy="w-check"
                aria-label={t("worker.done")}
                aria-pressed={s.status === "complete"}
                disabled={s.locked || busy.has(s.id)}
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
                    <span class="svc__lock">🔒 {t("worker.invoiced")}</span>
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
              {note ? " ·" : ""}
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
            {act_.some((s) => s.status === "assigned") && (
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
              <input
                data-cy="w-note"
                placeholder={t("worker.notePh")}
                value={drafts[v.id] ?? note}
                onInput={(e) =>
                  setDrafts((d) => ({
                    ...d,
                    [v.id]: (e.target as HTMLInputElement).value,
                  }))}
              />
              <button
                type="submit"
                data-cy="w-note-save"
                disabled={busy.has(`note:${v.id}`)}
              >
                {t("worker.save")}
              </button>
            </form>
            {flash[v.id] && <div class="saved">{flash[v.id]}</div>}
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
                      {s.status === "assigned" && (
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
    const mine = tasks.filter((x) => x.workerId === me.id);
    const others = tasks.filter((x) => x.workerId !== me.id);
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
              onClick={() => setLang(c)}
            >
              {c.toUpperCase()}
            </button>
          ))}
        </div>
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
                value={cell}
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
            {today && Math.abs(
                  (new Date(`${date}T00:00:00`).getTime() -
                    new Date(`${today}T00:00:00`).getTime()) / 86_400_000,
                ) > 1 &&
              (
                <div class="day">
                  <span>{t("worker.viewing")} {date}</span> ·{" "}
                  <a href="/worker">{t("worker.todayLink")} →</a>
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
                  {t("worker.today", { done, n: liveTasks.length })}
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
