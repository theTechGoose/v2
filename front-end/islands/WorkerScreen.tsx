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
import {
  fmtDay,
  rememberWorkerLangPick,
  todayIso,
  WORKER_OFFICE_FALLBACK,
  workerDayNav,
  workerScreenLang,
} from "../lib/field.ts";
import { lockLabelKey } from "../lib/field-batches.ts";
import { refreshTickDue } from "../lib/refresh-tick.ts";
import { type Lang, langSignal, setLang, t } from "../lib/i18n.ts";

const CELL_KEY = "pm:worker-cell";
const REFRESH_MS = 5000;

const css = `
  /* the worker's phone screen — one column, big tap targets, nothing else */
  body { display: block; }
  .wrap { max-width: 520px; margin: 0 auto; padding: 18px 16px 90px; min-height: 100dvh; display: flex; flex-direction: column; gap: 14px; }
  .top { display: flex; align-items: center; gap: 10px; }
  .top .brand { display: flex; align-items: center; gap: 8px; font-family: var(--font-heading); font-weight: 800; color: var(--brand-teal); flex: 1; }
  .top img { width: 34px; height: 34px; border-radius: 10px; }
  .greet { font-family: var(--font-heading); font-weight: 800; font-size: 26px; color: var(--brand-teal); line-height: 1.1; }
  .greet small { display: block; font-family: var(--font-body); font-weight: 500; font-size: 14px; color: var(--fg-muted); margin-top: 4px; }
  .login { background: #fff; border: 1px solid var(--border); border-radius: var(--radius-xl); padding: 22px; display: flex; flex-direction: column; gap: 14px; margin-top: 30px; }
  .login input, .login select { font-size: 18px; padding: 14px; }
  .pin { letter-spacing: .4em; text-align: center; font-family: var(--font-mono); }
  .pinwrap { position: relative; display: flex; }
  .pinwrap input { flex: 1; min-width: 0; padding-right: 52px; }
  .pinwrap .eye { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); width: 44px; height: 44px; border: 0; background: transparent; color: var(--fg-muted); border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
  .pinwrap .eye[aria-pressed="true"] { color: var(--brand-teal); }
  .pinwrap .eye:focus-visible { outline: 2px solid var(--brand-green); outline-offset: 1px; }
  .progress { height: 8px; background: var(--mint-300); border-radius: 999px; overflow: hidden; }
  .progress i { display: block; height: 100%; background: var(--brand-green); transition: width .3s; }
  .lang { margin-left: auto; display: flex; gap: 2px; background: var(--mint-100); border: 1px solid var(--border); border-radius: 999px; padding: 3px; }
  .lang button { border: 0; background: transparent; font-weight: 800; font-size: 13px; color: var(--fg-muted); padding: 10px 14px; border-radius: 999px; min-height: 44px; cursor: pointer; }
  .lang button.on { background: #fff; color: var(--brand-teal); box-shadow: 0 1px 3px rgba(20,72,82,.12); }
  /* REQ-353 (m23): on a phone the header wraps — the title and the EN/ES pill
     on the first row, "Volver a la oficina" and "Salir" on the next — instead
     of squeezing "Mis tareas" under the pill with Salir at the edge */
  @media (max-width: 480px) {
    .top { flex-wrap: wrap; row-gap: 8px; }
    .top .brand { flex: 1 0 auto; }
  }
  /* one card per visit, its services as check-offs, Note + Services on each */
  .crew { font-family: var(--font-heading); font-weight: 800; font-size: 15px; color: var(--brand-teal); display: flex; align-items: center; gap: 8px; margin-top: 6px; }
  .crew .count { font-size: 12px; background: var(--mint-100); border-radius: 999px; padding: 2px 8px; color: var(--fg-muted); font-weight: 700; }
  .visit { background: #fff; border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
  .visit--done { background: var(--green-50); border-color: var(--green-100); }
  .visit__client { font-family: var(--font-heading); font-weight: 800; font-size: 17px; color: var(--brand-teal); }
  .svc { display: flex; align-items: center; gap: 12px; padding: 4px 0; }
  .svc__check { width: 46px; height: 46px; border-radius: 12px; border: 2px solid var(--green-200); background: #fff; display: grid; place-items: center; color: var(--brand-green); cursor: pointer; font-size: 0; flex: none; }
  .svc__check svg { opacity: .18; }
  .svc--done .svc__check { background: var(--brand-green); color: #fff; border-color: var(--brand-green); }
  .svc--done .svc__check svg { opacity: 1; }
  .svc__check[disabled] { opacity: .5; cursor: default; }
  .svc--locked .svc__check { border-style: dashed; cursor: default; }
  .svc__name { font-weight: 700; font-size: 15px; color: var(--brand-teal); flex: 1; overflow-wrap: anywhere; }
  .svc--done .svc__name { color: var(--fg-muted); }
  .svc__extra { font-size: 11px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: var(--brand-teal); background: var(--mint-100); border-radius: 999px; padding: 2px 7px; }
  .svc__lock { font-size: 11px; color: var(--fg-muted); }
  .visit__btns { display: flex; gap: 8px; }
  .visit__btns button { flex: 1; padding: 10px; border: 1px solid var(--border); border-radius: 10px; background: #fff; font: inherit; font-weight: 700; color: var(--brand-teal); display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 44px; cursor: pointer; }
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
  .toast { position: fixed; left: 50%; bottom: 84px; transform: translateX(-50%); background: #c0392b; color: #fff; padding: 12px 18px; border-radius: 12px; font-weight: 700; font-size: 14px; box-shadow: 0 10px 24px -8px rgba(0,0,0,.4); z-index: 100; max-width: 90vw; }
  .toast--ok { background: var(--brand-green); }
  .day { font-size: 13px; color: var(--fg-muted); display: flex; gap: 10px; align-items: center; }
  .day a { color: var(--brand-teal); font-weight: 700; }
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
  return [...m.values()];
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

export default function WorkerScreen(
  {
    initialLang,
    initialDate,
    office,
    officeHref = WORKER_OFFICE_FALLBACK,
    langChosen = false,
    langPicked = false,
  }: {
    initialLang: Lang;
    initialDate?: string;
    /** REQ-282 — an owner session rode in: show the way back to the office */
    office?: boolean;
    /** REQ-417 (m44) — the office page the owner came from (route-resolved, allow-listed) */
    officeHref?: string;
    /** REQ-285 — the address chose the language (?lang=); the worker's own does not override it */
    langChosen?: boolean;
    /** REQ-494 (M43) — the EN/ES switch picked it on an earlier visit (pm_worker_lang) */
    langPicked?: boolean;
  },
) {
  const lang = langSignal.value;
  // `undefined` = not asked yet; `null` = asked, nobody is signed in
  const [me, setMe] = useState<WorkerMe | null | undefined>(undefined);
  const [tasks, setTasks] = useState<WorkerTaskView[]>([]);
  const [types, setTypes] = useState<TaskType[]>([]);
  const [date, setDate] = useState(initialDate ?? "");
  const [today, setToday] = useState(initialDate ?? "");
  const [cell, setCell] = useState("");
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
  /** REQ-285 — the person chose the language (the switch, or ?lang=): keep it over the worker's */
  const langChosenRef = useRef(langChosen || !!langPicked);
  /** REQ-416 — the page's own language (opened in, or picked on the switch); Salir returns to it */
  const pageLangRef = useRef<Lang>(initialLang);
  // REQ-508 (demo cycle 3, m20) — when the last load started; the 5 s tick skips a fresh one
  const lastLoadRef = useRef(0);

  useEffect(() => {
    pageLangRef.current = initialLang;
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
  }, [initialDate]);

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
    load();
    const id = setInterval(() => {
      if (
        meRef.current && document.visibilityState === "visible" &&
        busyRef.current.size === 0 &&
        Object.keys(draftsRef.current).length === 0 && !deferringRef.current &&
        refreshTickDue(lastLoadRef.current, Date.now(), REFRESH_MS) // REQ-508: not right after an act()'s reload
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
      langChosenRef.current = langChosen; // the next worker's language applies
      rememberWorkerLangPick(null); // REQ-494 — and on the next visit too
      // REQ-416 — the sign-in form is back in the page's own language
      setLang(pageLangRef.current, { persist: false });
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

  /** REQ-362 — the day navigator; a day after today is a read-only preview */
  // REQ-417 — a day change keeps the owner's way back to the office page they came from
  const nav = date && today
    ? workerDayNav(
      date,
      today,
      office && officeHref !== WORKER_OFFICE_FALLBACK ? officeHref : undefined,
    )
    : null;
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
    return (
      <div
        class={`visit${all ? " visit--done" : ""}`}
        data-cy="w-visit"
        data-id={v.id}
        key={v.id}
      >
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
          ? <div class="tasks">{visitsOf(rows).map(renderVisit)}</div>
          : <div class="panel hint">{t("worker.noneCrew")}</div>}
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
        ? <div class="tasks">{visitsOf(mine).map(renderVisit)}</div>
        : <div class="panel hint">{t("worker.none")}</div>;
    }
  }

  return (
    <div class="wrap">
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
              }}
            >
              {c.toUpperCase()}
            </button>
          ))}
        </div>
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
            <small>
              {dayLine()} · {t("worker.today", { done, n: liveTasks.length })}
            </small>
          </div>
          {nav && (
            <div class="day">
              <a href={nav.prev.href} data-cy="w-day-prev">
                ← {t(nav.prev.key)}
              </a>
              {nav.today && (
                <>
                  <span>{t("worker.viewing")} {date}</span>
                  <a href={nav.today} data-cy="w-day-today">
                    {t("worker.todayLink")}
                  </a>
                </>
              )}
              <a href={nav.next.href} data-cy="w-day-next">
                {t(nav.next.key)} →
              </a>
            </div>
          )}
          {preview && (
            <div class="hint" data-cy="w-preview">
              🔒 {t("worker.preview")}
            </div>
          )}
          <div
            class="progress"
            data-cy="w-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={liveTasks.length}
            aria-valuenow={done}
          >
            <i style={`width:${pct}%`}></i>
          </div>
          {liveTasks.length > 0 && done === liveTasks.length && (
            <div class="chip chip--green" style="align-self:flex-start">
              {t("worker.allDone")}
            </div>
          )}
          {body}
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
