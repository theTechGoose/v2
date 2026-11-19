/**
 * REQ-138/143 — /field/workers. The crew: each worker with their own login
 * (cell + 4-digit PIN), the zones they cover, and an add form. Ported from the
 * a2z demo's trabajadores.html; the data comes from clients/field.ts.
 * REQ-840 — the Crews panel: a crew is a foreman + members + the services it does;
 * each worker row picks its crew. REQ-842 — Away: who is out, when, and what happens
 * to their work (cover / defer / skip), set now or ahead of time.
 */
import Backdrop from "../components/Backdrop.tsx";
import { useEffect, useState } from "preact/hooks";
import {
  type AbsenceDisposition,
  type AbsenceInput,
  type AbsenceView,
  type CrewView,
  fieldClient,
  type FieldWorker,
  type RegionView,
  type TaskType,
} from "../clients/field.ts";
import FieldHead from "../components/FieldHead.tsx";
import { initialsOf } from "../lib/clients-display.ts";
import { I, ICN } from "../lib/dash-icons.tsx";
import { fmtCell, PHONE_PLACEHOLDER, todayIso } from "../lib/field.ts";
import { timesheetHref } from "../lib/timesheet-filter.ts";
import {
  type AddFormField,
  addFormProblems,
  type WorkerErr,
  workerError,
  zoneName,
} from "../lib/field-worker-errors.ts";
import { langSignal, t } from "../lib/i18n.ts";
import {
  copyShareText,
  type InviteShare,
  inviteShare,
  type NotTextedReason,
  notTextedReason,
} from "../lib/invite-share.ts";
import type { FieldWorkersSeed } from "../lib/field-ssr.ts";

interface AddForm {
  name: string;
  /** digits only, at most 10 */
  phone: string;
  /** digits only, at most 4 */
  pin: string;
  foreman: boolean;
  /**
   * REQ-155 — the language the worker is texted in and sees /worker in. REQ-774: null until
   * picked, which means the app's language (an English account → English), never a hard Spanish.
   */
  language: "en" | "es" | null;
}

const BLANK: AddForm = {
  name: "",
  phone: "",
  pin: "",
  foreman: false,
  language: null,
};

/** REQ-421 (demo m42) — the server's refusal code, worded in the page's language (never its English) */
function errMsg(err: WorkerErr): string {
  return t(err.key, err.vars);
}

/** REQ-840 — the crew form */
interface CrewForm {
  editId: string | null;
  name: string;
  color: string;
  memberIds: string[];
  foremanId: string;
  taskTypeIds: string[];
  coversAll: boolean;
  err: WorkerErr | null;
  saving: boolean;
}

const CREW_COLORS = [
  "#2f6f4e",
  "#c0392b",
  "#2471a3",
  "#b9770e",
  "#7d3c98",
  "#148f77",
  "#d35400",
  "#5d6d7e",
];

/** REQ-842 — the absence form, for a worker or a crew */
interface AwayForm {
  workerId?: string;
  crewId?: string;
  name: string;
  from: string;
  to: string;
  disposition: AbsenceDisposition;
  /** "crew:<id>" | "worker:<id>" | "" */
  cover: string;
  note: string;
  err: WorkerErr | null;
  saving: boolean;
}

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

/** REQ-730 (demo c2-p13-p) — `seed`: the lists read by the route on the SSR side; the first HTML then carries the rows, not "Loading…" */
export default function FieldWorkersPage(
  { seed }: { seed?: FieldWorkersSeed | null } = {},
) {
  const lang = langSignal.value;
  const [workers, setWorkers] = useState<FieldWorker[] | null>(
    seed?.workers ?? null,
  );
  const [regions, setRegions] = useState<RegionView[]>(seed?.regions ?? []);
  // REQ-840/842
  const [crews, setCrews] = useState<CrewView[]>(seed?.crews ?? []);
  const [absences, setAbsences] = useState<AbsenceView[]>(
    seed?.absences ?? [],
  );
  const [types, setTypes] = useState<TaskType[]>(seed?.types ?? []);
  const [crewForm, setCrewForm] = useState<CrewForm | null>(null);
  const [crewConfirmId, setCrewConfirmId] = useState<string | null>(null);
  const [crewErr, setCrewErr] = useState<{ id: string; err: WorkerErr } | null>(
    null,
  );
  const [away, setAway] = useState<AwayForm | null>(null);
  const [awayErr, setAwayErr] = useState<WorkerErr | null>(null);
  const [loadErr, setLoadErr] = useState<WorkerErr | null>(null);
  const [form, setForm] = useState<AddForm>(BLANK);
  const [adding, setAdding] = useState(false);
  /** REQ-520 — boxes the owner has left (blurred), and whether Add was pressed: only then a box's problem shows */
  const [touched, setTouched] = useState<Set<AddFormField>>(new Set());
  const [tried, setTried] = useState(false);
  /** REQ-421 — a refusal with the box it belongs under (worded at render, so a language flip re-words it) */
  const [addErr, setAddErr] = useState<WorkerErr | null>(null);
  /**
   * REQ-151 — the last add: whether the worker was texted the link and the PIN.
   * REQ-601 (cycle 4, M12) — when not, the link + the welcome text to share, and the PIN just typed
   * (kept here, since the form is reset after the add).
   */
  const [added, setAdded] = useState<
    {
      name: string;
      texted: boolean;
      pin: string;
      share: InviteShare | null;
      /** REQ-998 — the cell as typed, and why the text did not go (null: the plain line) */
      phone: string;
      smsFailureCode: NotTextedReason | null;
    } | null
  >(null);
  /** REQ-601 — the Copy link + PIN outcome: null until pressed */
  const [copied, setCopied] = useState<boolean | null>(null);
  /** the row whose Remove is waiting for its Confirm */
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<{ id: string; err: WorkerErr } | null>(
    null,
  );

  const readAll = () =>
    Promise.all([
      fieldClient.workers(),
      fieldClient.regions().catch(() => [] as RegionView[]),
      fieldClient.crews().catch(() => [] as CrewView[]),
      fieldClient.absences().catch(() => [] as AbsenceView[]),
      fieldClient.taskTypes().catch(() => [] as TaskType[]),
    ]);

  async function reload() {
    const [w, r, c, a, ty] = await readAll();
    setWorkers(w);
    setRegions(r);
    setCrews(c);
    setAbsences(a);
    setTypes(ty);
    setLoadErr(null);
  }

  // REQ-940 — "out today" starts on the business's day (the server's), not the UTC date: after
  // 7 pm in New York the UTC date is already tomorrow and today's round was left untouched
  const [bizToday, setBizToday] = useState<string | null>(null);
  useEffect(() => {
    fieldClient.today().then((r) => setBizToday(r.date)).catch(() => {});
  }, []);

  useEffect(() => {
    // REQ-730 — seeded on the server: no client fetch on mount
    if (seed) return;
    let alive = true;
    readAll()
      .then(([w, r, c, a, ty]) => {
        if (!alive) return;
        setWorkers(w);
        setRegions(r);
        setCrews(c);
        setAbsences(a);
        setTypes(ty);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setLoadErr(workerError(err, langSignal.value));
        setWorkers([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  /** REQ-520 (demo m19) — Add stays enabled; a bad box says why, under itself, once touched or on Add */
  const problems = addFormProblems(form);
  const touch = (f: AddFormField) =>
    setTouched((s) => s.has(f) ? s : new Set(s).add(f));
  /** the box's message key: the server's refusal first, else its own problem once shown */
  function boxErr(f: AddFormField): string | null {
    if (addErr?.field === f) return errMsg(addErr);
    const k = problems[f];
    return k && (tried || touched.has(f)) ? t(k) : null;
  }
  const nameErr = boxErr("name");
  const phoneErr = boxErr("phone");
  const pinErr = boxErr("pin");

  /** REQ-774 — the language the picker shows and the add sends: the picked one, else the app's */
  const pickedLang: "en" | "es" = form.language ?? langSignal.value;

  async function submit(e: Event) {
    e.preventDefault();
    if (adding) return;
    if (Object.keys(problems).length > 0) {
      setTried(true);
      return;
    }
    setAdding(true);
    setAddErr(null);
    setAdded(null);
    setCopied(null);
    try {
      const made = await fieldClient.createWorker({
        name: form.name.trim(),
        phoneNumber: form.phone,
        pin: form.pin,
        role: form.foreman ? "foreman" : "worker",
        language: pickedLang,
      });
      setAdded({
        name: made.name,
        texted: made.texted === true,
        pin: form.pin,
        share: inviteShare(made),
        phone: fmtCell(made.phoneNumber),
        smsFailureCode: made.texted === true
          ? null
          : notTextedReason(made.smsFailureCode),
      });
      setForm(BLANK);
      setTouched(new Set());
      setTried(false);
      await reload();
    } catch (err) {
      setAddErr(workerError(err, langSignal.value));
    } finally {
      setAdding(false);
    }
  }

  /** REQ-155 — the row's switch: the worker's language, saved on the spot */
  async function setLanguage(w: FieldWorker, language: "en" | "es") {
    if ((w.language ?? "es") === language) return;
    setBusyId(w.id);
    setRowErr(null);
    try {
      const saved = await fieldClient.setWorkerLanguage(w.id, language);
      setWorkers((list) =>
        (list ?? []).map((x) =>
          x.id === w.id ? { ...x, language: saved.language } : x
        )
      );
    } catch (err) {
      setRowErr({ id: w.id, err: workerError(err, langSignal.value) });
    } finally {
      setBusyId(null);
    }
  }

  /** REQ-840 — the row's crew select, saved on the spot */
  async function setCrew(w: FieldWorker, crewId: string | null) {
    if ((w.crewId ?? null) === crewId) return;
    setBusyId(w.id);
    setRowErr(null);
    try {
      await fieldClient.setWorkerCrew(w.id, crewId);
      await reload();
    } catch (err) {
      setRowErr({ id: w.id, err: workerError(err, langSignal.value) });
    } finally {
      setBusyId(null);
    }
  }

  /** REQ-840 — the crew form, blank or from a crew */
  function openCrew(c?: CrewView) {
    setCrewConfirmId(null);
    setCrewErr(null);
    setCrewForm({
      editId: c?.id ?? null,
      name: c?.name ?? "",
      color: c?.color ??
        CREW_COLORS.find((x) => !crews.some((k) => k.color === x)) ??
        CREW_COLORS[crews.length % CREW_COLORS.length],
      memberIds: c?.members.map((m) => m.id) ?? [],
      foremanId: c?.foremanId ?? "",
      taskTypeIds: c?.taskTypeIds ?? [],
      coversAll: c?.coversAll === true,
      err: null,
      saving: false,
    });
  }

  function patchCrew(p: Partial<CrewForm>) {
    setCrewForm((f) => (f ? { ...f, ...p } : f));
  }

  async function submitCrew(e: Event) {
    e.preventDefault();
    if (!crewForm || crewForm.saving) return;
    if (!crewForm.name.trim()) {
      patchCrew({ err: { key: "field.wk.err.nameRequired", field: null } });
      return;
    }
    patchCrew({ saving: true, err: null });
    const body = {
      name: crewForm.name.trim(),
      color: crewForm.color,
      memberIds: crewForm.memberIds,
      foremanId: crewForm.foremanId || null,
      taskTypeIds: crewForm.taskTypeIds,
      coversAll: crewForm.coversAll,
    };
    try {
      if (crewForm.editId) await fieldClient.updateCrew(crewForm.editId, body);
      else await fieldClient.createCrew(body);
      setCrewForm(null);
      await reload();
    } catch (err) {
      patchCrew({ saving: false, err: workerError(err, langSignal.value) });
    }
  }

  async function removeCrew(c: CrewView) {
    setBusyId(c.id);
    setCrewErr(null);
    try {
      await fieldClient.deleteCrew(c.id);
      setCrewConfirmId(null);
      await reload();
    } catch (err) {
      setCrewConfirmId(null);
      setCrewErr({ id: c.id, err: workerError(err, langSignal.value) });
    } finally {
      setBusyId(null);
    }
  }

  /** REQ-842 — mark a worker or a crew out */
  function openAway(who: { workerId?: string; crewId?: string; name: string }) {
    setAwayErr(null);
    const day = bizToday ?? todayIso();
    setAway({
      ...who,
      from: day,
      to: day,
      disposition: "cover",
      cover: "",
      note: "",
      err: null,
      saving: false,
    });
  }

  function patchAway(p: Partial<AwayForm>) {
    setAway((f) => (f ? { ...f, ...p } : f));
  }

  async function submitAway(e: Event) {
    e.preventDefault();
    if (!away || away.saving) return;
    if (!away.from || !away.to || away.to < away.from) {
      patchAway({ err: { key: "field.away.badDates", field: null } });
      return;
    }
    if (away.disposition === "cover" && !away.cover) {
      patchAway({ err: { key: "field.away.coverRequired", field: null } });
      return;
    }
    patchAway({ saving: true, err: null });
    const body: AbsenceInput = {
      workerId: away.workerId,
      crewId: away.crewId,
      from: away.from,
      to: away.to,
      disposition: away.disposition,
      note: away.note.trim() || undefined,
    };
    if (away.disposition === "cover") {
      const [kind, id] = away.cover.split(":");
      if (kind === "crew") body.coverCrewId = id;
      else body.coverWorkerId = id;
    }
    try {
      await fieldClient.createAbsence(body);
      setAway(null);
      await reload();
    } catch (err) {
      patchAway({ saving: false, err: workerError(err, langSignal.value) });
    }
  }

  async function removeAway(a: AbsenceView) {
    setBusyId(a.id);
    setAwayErr(null);
    try {
      await fieldClient.deleteAbsence(a.id);
      await reload();
    } catch (err) {
      setAwayErr(workerError(err, langSignal.value));
    } finally {
      setBusyId(null);
    }
  }

  /**
   * REQ-1015 — Remove access. The row already knows the zones this worker covers, so a
   * worker who still covers any is refused here, in the server's own words, instead of
   * after a "Remove {name}'s access?" confirm and DELETE's 409 (which stays the backstop).
   */
  function askRemove(w: FieldWorker, mine: RegionView[]) {
    if (mine.length) {
      setConfirmId(null);
      setRowErr({
        id: w.id,
        err: {
          key: "field.wk.err.coversZones",
          field: null,
          vars: { zones: mine.map((r) => zoneName(r.name, lang)).join(", ") },
        },
      });
      return;
    }
    setConfirmId(w.id);
    setRowErr(null);
  }

  async function remove(w: FieldWorker) {
    setBusyId(w.id);
    setRowErr(null);
    try {
      await fieldClient.deleteWorker(w.id);
      setConfirmId(null);
      setWorkers((list) => (list ?? []).filter((x) => x.id !== w.id));
    } catch (err) {
      // a 409 — the worker still covers zones; the server says which
      setRowErr({ id: w.id, err: workerError(err, langSignal.value) });
    } finally {
      setBusyId(null);
    }
  }

  const list = workers ?? [];
  const crewColor = (id?: string) =>
    crews.find((c) => c.id === id)?.color ?? "var(--brand-green)";
  /** REQ-842 — a member of a crew with others only leaves that day's crew */
  const workerCrewHasOthers = (workerId: string) => {
    const w = list.find((x) => x.id === workerId);
    const c = w?.crewId ? crews.find((k) => k.id === w.crewId) : null;
    return !!c && c.members.length > 1;
  };

  return (
    <>
      <FieldHead
        eyebrow={t("field.wk.eyebrow", { n: list.length })}
        title={t("field.wk.title")}
        sub={t("field.wk.sub")}
      >
        <a
          class="btn btn--ghost"
          href="/worker?from=%2Ffield%2Fworkers"
          data-cy="wk-open"
        >
          <I d={ICN.hardhat} size={14} /> {t("field.wk.open")}
        </a>
      </FieldHead>

      {loadErr && <p class="alert">{errMsg(loadErr)}</p>}

      {/* REQ-708 (cycle 5, c1-setup-m15): novalidate — REQ-520's in-app messages, not the browser's bubble */}
      <form class="panel" noValidate onSubmit={submit} data-cy="wk-form">
        <h2 class="panel__title">
          <I d={ICN.plus} size={14} sw={2.5} /> {t("field.wk.new")}
        </h2>
        <div class="row">
          <label class="field">
            {t("settings.name")}
            <input
              name="name"
              data-cy="wk-name"
              required
              autocomplete="off"
              aria-invalid={nameErr ? "true" : undefined}
              onBlur={() => touch("name")}
              value={form.name}
              onInput={(e) =>
                setForm({
                  ...form,
                  name: (e.currentTarget as HTMLInputElement).value,
                })}
            />
            {nameErr && (
              <span class="field-error" role="alert" data-cy="wk-name-error">
                {nameErr}
              </span>
            )}
          </label>
          <label class="field">
            {t("settings.phone")}
            <input
              name="phone"
              type="tel"
              data-cy="wk-phone"
              required
              inputMode="numeric"
              autocomplete="off"
              placeholder={PHONE_PLACEHOLDER}
              maxlength={10}
              pattern="\d{10}"
              aria-invalid={phoneErr ? "true" : undefined}
              aria-describedby={phoneErr ? "wk-phone-error" : undefined}
              onBlur={() => touch("phone")}
              value={form.phone}
              onInput={(e) => {
                setForm({
                  ...form,
                  phone: (e.currentTarget as HTMLInputElement).value.replace(
                    /\D/g,
                    "",
                  ).slice(0, 10),
                });
                // a new number clears the refusal of the old one
                if (addErr?.field === "phone") setAddErr(null);
              }}
            />
            {phoneErr && (
              <span
                id="wk-phone-error"
                class="field-error"
                role="alert"
                data-cy="wk-phone-error"
              >
                {phoneErr}
              </span>
            )}
          </label>
          <label class="field" style="flex:0 0 140px;min-width:120px">
            {t("field.wk.pin")}
            <input
              name="pin"
              type="password"
              data-cy="wk-pin"
              required
              inputMode="numeric"
              autocomplete="new-password"
              maxlength={4}
              pattern="\d{4}"
              aria-invalid={pinErr ? "true" : undefined}
              aria-describedby={pinErr ? "wk-pin-error" : undefined}
              onBlur={() => touch("pin")}
              value={form.pin}
              onInput={(e) => {
                setForm({
                  ...form,
                  pin: (e.currentTarget as HTMLInputElement).value.replace(
                    /\D/g,
                    "",
                  ).slice(0, 4),
                });
                if (addErr?.field === "pin") setAddErr(null);
              }}
            />
            {pinErr && (
              <span
                id="wk-pin-error"
                class="field-error"
                role="alert"
                data-cy="wk-pin-error"
              >
                {pinErr}
              </span>
            )}
          </label>
          <label class="field" style="flex:0 0 150px;min-width:130px">
            {t("field.wk.language")}
            <select
              name="language"
              data-cy="wk-language"
              title={t("field.wk.langHint")}
              value={pickedLang}
              onChange={(e) =>
                setForm({
                  ...form,
                  language:
                    (e.currentTarget as HTMLSelectElement).value === "en"
                      ? "en"
                      : "es",
                })}
            >
              <option value="es">{t("field.wk.langEs")}</option>
              <option value="en">{t("field.wk.langEn")}</option>
            </select>
          </label>
        </div>
        <p class="hint" style="margin:6px 0 0" data-cy="wk-lang-note">
          {t("field.wk.langNote")}
        </p>
        <div
          class="row"
          style="margin-top:10px;align-items:center;justify-content:space-between"
        >
          <label
            class="field"
            style="flex-direction:row;align-items:center;gap:8px;flex:1;min-width:200px;cursor:pointer"
          >
            <input
              type="checkbox"
              name="foreman"
              data-cy="wk-foreman"
              checked={form.foreman}
              style="width:18px;height:18px;accent-color:var(--brand-green)"
              onChange={(e) =>
                setForm({
                  ...form,
                  foreman: (e.currentTarget as HTMLInputElement).checked,
                })}
            />
            <span>{t("field.wk.foreman")}</span>
          </label>
          <button
            type="submit"
            class="btn btn--pink"
            data-cy="wk-add"
            disabled={adding}
          >
            <I d={ICN.plus} size={14} sw={2.5} />{" "}
            {adding ? t("field.common.loading") : t("common.add")}
          </button>
        </div>
        {addErr && addErr.field === null && (
          <p class="alert" data-cy="wk-error">{errMsg(addErr)}</p>
        )}
        {added && (
          <p
            class={added.texted ? "hint" : "alert"}
            data-cy="wk-texted"
            data-texted={added.texted ? "true" : "false"}
          >
            {t(
              added.texted
                ? "field.wk.texted"
                : added.smsFailureCode
                ? `field.wk.notTexted.${added.smsFailureCode}` // REQ-998 — why: a reserved test number, a landline, …
                : "field.wk.notTexted",
              { name: added.name, phone: added.phone },
            )}
          </p>
        )}
        {added && !added.texted && added.share && (
          <div class="panel" data-cy="wk-share" style="margin:8px 0 0">
            <p style="margin:0 0 4px">
              {t("field.wk.shareLink")}:{" "}
              <a
                class="link"
                href={added.share.url}
                target="_blank"
                rel="noopener"
                data-cy="wk-share-url"
                style="word-break:break-all"
              >
                {added.share.url}
              </a>
            </p>
            <p style="margin:0 0 8px" data-cy="wk-share-pin">
              PIN: <strong>{added.pin}</strong>
            </p>
            <textarea
              readOnly
              rows={3}
              class="share-text"
              data-cy="wk-share-text"
              style="width:100%;resize:vertical"
              value={added.share.text}
              onFocus={(e) =>
                (e.currentTarget as HTMLTextAreaElement).select()}
            />
            <div
              class="row"
              style="margin-top:6px;align-items:center;gap:8px"
            >
              <button
                type="button"
                class="btn btn--ghost"
                data-cy="wk-share-copy"
                data-copied={copied === true ? "true" : undefined}
                onClick={async () => {
                  const share = added.share;
                  if (share) {
                    setCopied(await copyShareText(share.text));
                  }
                }}
              >
                {t("field.wk.copyShare")}
              </button>
              {copied !== null && (
                <span class="hint" role="status" data-cy="wk-share-copied">
                  {t(
                    copied
                      ? "field.wk.shareCopied"
                      : "field.wk.shareCopyFailed",
                  )}
                </span>
              )}
            </div>
          </div>
        )}
      </form>

      {/* REQ-840 — the crews */}
      <section class="panel" style="margin-top:14px" data-cy="crew-panel">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
          <h2 class="panel__title" style="margin:0">
            <I d={ICN.hardhat} size={14} /> {t("field.crew.title")}
          </h2>
          <button
            type="button"
            class="btn btn--pink btn--sm"
            data-cy="crew-new"
            onClick={() => openCrew()}
          >
            <I d={ICN.plus} size={14} sw={2.5} /> {t("field.crew.new")}
          </button>
        </div>
        <p class="hint" style="margin:6px 0 10px">{t("field.crew.sub")}</p>
        {crews.length === 0
          ? (
            <div class="hint" style="padding:4px" data-cy="crew-empty">
              {t("field.crew.empty")}
            </div>
          )
          : (
            <div class="subs">
              {crews.map((c) => {
                const busy = busyId === c.id;
                const confirming = crewConfirmId === c.id;
                return (
                  <div
                    class="sub"
                    data-cy="crew-card"
                    data-id={c.id}
                    key={c.id}
                  >
                    <div class="sub__client">
                      <span style="display:inline-flex;align-items:center;gap:8px">
                        <span
                          aria-hidden="true"
                          style={`width:14px;height:14px;border-radius:50%;background:${c.color};flex-shrink:0`}
                        />
                        <span data-cy="crew-card-name">{c.name}</span>
                        {c.coversAll && (
                          <span
                            class="chip chip--amber"
                            data-cy="crew-covers-all"
                          >
                            {t("field.crew.coversAll")}
                          </span>
                        )}
                      </span>
                      <span class="chip" data-cy="crew-zones">
                        {c.zones === 1
                          ? t("field.crew.zones.one")
                          : t("field.crew.zones.other", { n: c.zones })}
                      </span>
                    </div>
                    <div class="sub__addr" data-cy="crew-foreman">
                      {c.foremanName
                        ? t("field.crew.leads", { name: c.foremanName })
                        : t("field.crew.foremanNone")}
                    </div>
                    <div class="sub__items">
                      <div>
                        <span>{t("field.crew.members")}</span>
                        <span
                          data-cy="crew-members"
                          style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end"
                        >
                          {c.members.length
                            ? c.members.map((m) => (
                              <span class="chip" key={m.id}>{m.name}</span>
                            ))
                            : (
                              <span class="hint">
                                {t("field.crew.membersNone")}
                              </span>
                            )}
                        </span>
                      </div>
                      <div>
                        <span>{t("field.crew.services")}</span>
                        <span
                          data-cy="crew-services"
                          style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end"
                        >
                          {c.taskTypeNames.length
                            ? c.taskTypeNames.map((n) => (
                              <span class="chip" key={n}>{n}</span>
                            ))
                            : (
                              <span class="hint">
                                {t("field.crew.anyService")}
                              </span>
                            )}
                        </span>
                      </div>
                    </div>
                    {crewErr?.id === c.id && (
                      <p
                        class="alert"
                        style="margin:0"
                        data-cy="crew-card-error"
                      >
                        {errMsg(crewErr.err)}
                      </p>
                    )}
                    <div class="sub__foot">
                      {confirming
                        ? (
                          <>
                            <span>{t("field.crew.confirmDelete")}</span>
                            <span style="display:flex;gap:6px">
                              <button
                                type="button"
                                class="btn btn--danger btn--sm"
                                data-cy="crew-delete-confirm"
                                disabled={busy}
                                onClick={() => removeCrew(c)}
                              >
                                {t("field.common.confirm")}
                              </button>
                              <button
                                type="button"
                                class="btn btn--ghost btn--sm"
                                data-cy="crew-delete-cancel"
                                disabled={busy}
                                onClick={() => setCrewConfirmId(null)}
                              >
                                {t("field.common.cancel")}
                              </button>
                            </span>
                          </>
                        )
                        : (
                          <>
                            <span style="display:flex;gap:6px">
                              <button
                                type="button"
                                class="btn btn--ghost btn--sm"
                                data-cy="crew-edit"
                                disabled={busy}
                                onClick={() => openCrew(c)}
                              >
                                {t("field.subs.edit")}
                              </button>
                              <button
                                type="button"
                                class="btn btn--ghost btn--sm"
                                data-cy="crew-away"
                                disabled={busy}
                                onClick={() =>
                                  openAway({ crewId: c.id, name: c.name })}
                              >
                                <I d={ICN.cal} size={12} />{" "}
                                {t("field.away.markOut")}
                              </button>
                            </span>
                            <button
                              type="button"
                              class="btn btn--danger btn--sm"
                              data-cy="crew-delete"
                              disabled={busy}
                              onClick={() => {
                                setCrewErr(null);
                                setCrewConfirmId(c.id);
                              }}
                            >
                              <I d={ICN.trash} size={12} />{" "}
                              {t("field.crew.delete")}
                            </button>
                          </>
                        )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
      </section>

      {/* REQ-842 — who is out */}
      <section class="panel" style="margin-top:14px" data-cy="away-panel">
        <h2 class="panel__title" style="margin:0">
          <I d={ICN.cal} size={14} /> {t("field.away.title")}
        </h2>
        <p class="hint" style="margin:6px 0 10px">{t("field.away.sub")}</p>
        {awayErr && <p class="alert">{errMsg(awayErr)}</p>}
        {absences.length === 0
          ? (
            <div class="hint" style="padding:4px" data-cy="away-empty">
              {t("field.away.empty")}
            </div>
          )
          : (
            <div style="display:flex;flex-direction:column;gap:6px">
              {absences.map((a) => (
                <div
                  key={a.id}
                  data-cy="away-row"
                  data-id={a.id}
                  style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:6px 8px;border:1px solid var(--border);border-radius:8px"
                >
                  <strong data-cy="away-row-name">{a.name}</strong>
                  <span class="hint" data-cy="away-row-dates">
                    {a.from === a.to ? a.from : `${a.from} → ${a.to}`}
                  </span>
                  <span class="chip" data-cy="away-row-disposition">
                    {a.disposition === "cover"
                      ? t("field.away.dispCover", { name: a.coverName ?? "" })
                      : a.disposition === "defer"
                      ? t("field.away.dispDefer")
                      : t("field.away.dispSkip")}
                  </span>
                  {a.note && <span class="hint">{a.note}</span>}
                  <button
                    type="button"
                    class="btn btn--ghost btn--sm"
                    data-cy="away-remove"
                    disabled={busyId === a.id}
                    style="margin-left:auto"
                    onClick={() => removeAway(a)}
                  >
                    {t("field.away.remove")}
                  </button>
                </div>
              ))}
            </div>
          )}
      </section>

      {workers === null
        ? (
          <div class="hint" style="padding:12px 4px">
            {t("field.common.loading")}
          </div>
        )
        : (
          <div class="subs" style="margin-top:14px">
            {list.map((w) => {
              const mine = regions.filter((r) => r.workerId === w.id);
              const busy = busyId === w.id;
              const confirming = confirmId === w.id;
              return (
                <div class="sub" data-cy="wk-row" data-id={w.id} key={w.id}>
                  <div class="sub__client">
                    <span style="display:inline-flex;align-items:center;gap:8px;min-width:0">
                      <span
                        aria-hidden="true"
                        style="display:inline-grid;place-items:center;width:32px;height:32px;border-radius:50%;background:var(--brand-green);color:#fff;font-size:12px;flex-shrink:0"
                      >
                        {initialsOf(w.name)}
                      </span>
                      <span data-cy="wk-row-name">{w.name}</span>
                      {w.role === "foreman" && (
                        <span class="chip chip--amber">
                          {t("field.wk.foremanBadge")}
                        </span>
                      )}
                      {w.crewName && (
                        <span
                          class="chip"
                          data-cy="wk-row-crew"
                          style={`background:${crewColor(w.crewId)}22;color:${
                            crewColor(w.crewId)
                          }`}
                        >
                          {w.crewName}
                        </span>
                      )}
                    </span>
                  </div>
                  <div
                    class="sub__addr"
                    style="display:flex;align-items:center;gap:6px"
                  >
                    <I d={ICN.phone} size={12} />{" "}
                    <span data-cy="wk-row-phone">{fmtCell(w.phoneNumber)}</span>
                    {/* REQ-155 — the language switch: ES | EN, the worker's own */}
                    <span
                      data-cy="wk-row-lang"
                      data-lang={w.language ?? "es"}
                      role="group"
                      aria-label={t("field.wk.language")}
                      style="margin-left:auto;display:inline-flex;gap:2px;border:1px solid var(--border);border-radius:999px;padding:2px"
                    >
                      {(["es", "en"] as const).map((l) => {
                        const on = (w.language ?? "es") === l;
                        return (
                          <button
                            type="button"
                            key={l}
                            data-set={l}
                            aria-pressed={on}
                            disabled={busy}
                            title={l === "es"
                              ? t("field.wk.langEs")
                              : t("field.wk.langEn")}
                            style={`border:0;border-radius:999px;padding:3px 9px;font-weight:800;font-size:11px;cursor:pointer;background:${
                              on ? "var(--brand-green)" : "transparent"
                            };color:${on ? "#fff" : "var(--fg-muted)"}`}
                            onClick={() => setLanguage(w, l)}
                          >
                            {l.toUpperCase()}
                          </button>
                        );
                      })}
                    </span>
                  </div>
                  <div class="sub__items">
                    <div>
                      <span>{t("field.wk.covers")}</span>
                      <span style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">
                        {mine.length
                          ? mine.map((r) => (
                            <span
                              class="chip"
                              key={r.id}
                              style={`background:${r.color}22;color:${r.color}`}
                            >
                              {zoneName(r.name, lang)} ·{" "}
                              {r.subscriptions.length}
                            </span>
                          ))
                          : (
                            // REQ-361 (demo M36): Assignments is in the Field folder, Workers in
                            // Roles — the hint is the way across
                            <a
                              class="hint"
                              href="/field/assignments"
                              data-cy="wk-covers-none"
                            >
                              {t("field.wk.coversNone")}
                            </a>
                          )}
                      </span>
                    </div>
                    {/* REQ-840 — the worker's crew, picked here */}
                    <div>
                      <span>{t("field.crew.select")}</span>
                      <select
                        data-cy="wk-row-crew-select"
                        disabled={busy}
                        value={w.crewId ?? ""}
                        onChange={(e) =>
                          setCrew(
                            w,
                            (e.currentTarget as HTMLSelectElement).value ||
                              null,
                          )}
                      >
                        <option value="">{t("field.crew.none")}</option>
                        {crews.map((c) => (
                          <option value={c.id} key={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {rowErr?.id === w.id && (
                    <p class="alert" style="margin:0" data-cy="wk-row-error">
                      {errMsg(rowErr.err)}
                    </p>
                  )}
                  <div class="sub__foot">
                    {confirming
                      ? (
                        <>
                          <span>{t("field.wk.confirm", { name: w.name })}</span>
                          <span style="display:flex;gap:6px">
                            <button
                              type="button"
                              class="btn btn--danger btn--sm"
                              data-cy="wk-delete-confirm"
                              disabled={busy}
                              onClick={() => remove(w)}
                            >
                              {t("field.common.confirm")}
                            </button>
                            <button
                              type="button"
                              class="btn btn--ghost btn--sm"
                              data-cy="wk-delete-cancel"
                              disabled={busy}
                              onClick={() =>
                                setConfirmId(null)}
                            >
                              {t("field.common.cancel")}
                            </button>
                          </span>
                        </>
                      )
                      : (
                        <>
                          {/* REQ-786 (demo dv1) — this worker's hours, on the timesheet */}
                          <a
                            class="btn btn--ghost btn--sm"
                            data-cy="wk-hours"
                            href={timesheetHref(w.id)}
                          >
                            <I d={ICN.clock} size={12} /> {t("field.wk.hours")}
                          </a>
                          {/* REQ-842 — this worker is out */}
                          <button
                            type="button"
                            class="btn btn--ghost btn--sm"
                            data-cy="wk-away"
                            disabled={busy}
                            onClick={() =>
                              openAway({ workerId: w.id, name: w.name })}
                          >
                            <I d={ICN.cal} size={12} />{" "}
                            {t("field.away.markOut")}
                          </button>
                          <button
                            type="button"
                            class="btn btn--danger btn--sm"
                            data-cy="wk-delete"
                            disabled={busy}
                            onClick={() => askRemove(w, mine)}
                          >
                            <I d={ICN.trash} size={12} /> {t("field.wk.delete")}
                          </button>
                        </>
                      )}
                  </div>
                </div>
              );
            })}
            {list.length === 0 && (
              <div class="hint" style="padding:12px 4px">
                {t("field.wk.empty")}
              </div>
            )}
          </div>
        )}

      {/* REQ-840 — the crew form */}
      {crewForm && (
        <Backdrop class="modal-bg" onClose={() => setCrewForm(null)}>
          <form class="modal" onSubmit={submitCrew} data-cy="crew-form">
            <div class="modal__head">
              <h2>
                {crewForm.editId
                  ? t("field.crew.editTitle")
                  : t("field.crew.new")}
              </h2>
            </div>
            <div class="row">
              <label class="field" style="flex:1">
                {t("field.crew.name")}
                <input
                  data-cy="crew-name"
                  placeholder={t("field.crew.namePh")}
                  maxLength={80}
                  value={crewForm.name}
                  onInput={(e) =>
                    patchCrew({
                      name: (e.currentTarget as HTMLInputElement).value,
                    })}
                />
              </label>
              <label class="field" style="flex:0 0 90px">
                {t("field.crew.color")}
                <input
                  type="color"
                  data-cy="crew-color"
                  value={crewForm.color}
                  onInput={(e) =>
                    patchCrew({
                      color: (e.currentTarget as HTMLInputElement).value,
                    })}
                />
              </label>
            </div>
            <div class="field">
              <span>{t("field.crew.members")}</span>
              <div
                data-cy="crew-member-picks"
                style="display:flex;gap:6px;flex-wrap:wrap"
              >
                {list.map((w) => {
                  const on = crewForm.memberIds.includes(w.id);
                  const elsewhere = w.crewId && w.crewId !== crewForm.editId
                    ? crews.find((c) => c.id === w.crewId)?.name
                    : null;
                  return (
                    <label
                      key={w.id}
                      class={`chip${on ? " chip--on" : ""}`}
                      style="cursor:pointer;display:inline-flex;align-items:center;gap:4px"
                      title={elsewhere ?? undefined}
                    >
                      <input
                        type="checkbox"
                        data-cy="crew-member"
                        data-id={w.id}
                        checked={on}
                        onChange={() => {
                          const memberIds = toggle(crewForm.memberIds, w.id);
                          patchCrew({
                            memberIds,
                            foremanId: memberIds.includes(crewForm.foremanId)
                              ? crewForm.foremanId
                              : "",
                          });
                        }}
                      />
                      {w.name}
                      {elsewhere && <span class="hint">· {elsewhere}</span>}
                    </label>
                  );
                })}
                {list.length === 0 && (
                  <span class="hint">{t("field.wk.empty")}</span>
                )}
              </div>
            </div>
            <label class="field">
              {t("field.crew.foreman")}
              <select
                data-cy="crew-foreman"
                value={crewForm.foremanId}
                onChange={(e) =>
                  patchCrew({
                    foremanId: (e.currentTarget as HTMLSelectElement).value,
                  })}
              >
                <option value="">{t("field.crew.foremanNone")}</option>
                {list.filter((w) => crewForm.memberIds.includes(w.id)).map((
                  w,
                ) => <option value={w.id} key={w.id}>{w.name}</option>)}
              </select>
            </label>
            <div class="field">
              <span>{t("field.crew.services")}</span>
              <div
                data-cy="crew-service-picks"
                style="display:flex;gap:6px;flex-wrap:wrap"
              >
                {types.map((ty) => {
                  const on = crewForm.taskTypeIds.includes(ty.id);
                  return (
                    <label
                      key={ty.id}
                      class={`chip${on ? " chip--on" : ""}`}
                      style="cursor:pointer;display:inline-flex;align-items:center;gap:4px"
                    >
                      <input
                        type="checkbox"
                        data-cy="crew-service"
                        data-id={ty.id}
                        checked={on}
                        onChange={() =>
                          patchCrew({
                            taskTypeIds: toggle(crewForm.taskTypeIds, ty.id),
                          })}
                      />
                      {ty.name}
                    </label>
                  );
                })}
                {types.length === 0 && (
                  <a class="hint" href="/field/services">
                    {t("field.svc.empty")}
                  </a>
                )}
              </div>
              <span class="hint">{t("field.crew.servicesHint")}</span>
            </div>
            <label
              class="field"
              style="flex-direction:row;align-items:center;gap:8px;cursor:pointer"
            >
              <input
                type="checkbox"
                data-cy="crew-covers-all-pick"
                checked={crewForm.coversAll}
                style="width:18px;height:18px;accent-color:var(--brand-green)"
                onChange={(e) => patchCrew({
                  coversAll: (e.currentTarget as HTMLInputElement).checked,
                })}
              />
              <span>
                {t("field.crew.coversAll")}{" "}
                <span class="hint">{t("field.crew.coversAllHint")}</span>
              </span>
            </label>
            {crewForm.err && (
              <p class="alert" data-cy="crew-error">{errMsg(crewForm.err)}</p>
            )}
            <div class="modal__foot">
              <button
                type="button"
                class="btn--cancel"
                onClick={() => setCrewForm(null)}
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                class="btn--submit"
                data-cy="crew-submit"
                disabled={crewForm.saving}
              >
                {crewForm.saving
                  ? t("field.common.loading")
                  : crewForm.editId
                  ? t("field.common.save")
                  : t("common.add")}
              </button>
            </div>
          </form>
        </Backdrop>
      )}

      {/* REQ-842 — mark out */}
      {away && (
        <Backdrop class="modal-bg" onClose={() => setAway(null)}>
          <form class="modal" onSubmit={submitAway} data-cy="away-form">
            <div class="modal__head">
              <h2>{t("field.away.outTitle", { name: away.name })}</h2>
            </div>
            <div class="row">
              <label class="field">
                {t("field.away.from")}
                <input
                  type="date"
                  data-cy="away-from"
                  value={away.from}
                  onInput={(e) => {
                    const from = (e.currentTarget as HTMLInputElement).value;
                    patchAway({
                      from,
                      to: away.to < from ? from : away.to,
                    });
                  }}
                />
              </label>
              <label class="field">
                {t("field.away.to")}
                <input
                  type="date"
                  data-cy="away-to"
                  min={away.from}
                  value={away.to}
                  onInput={(e) =>
                    patchAway({
                      to: (e.currentTarget as HTMLInputElement).value,
                    })}
                />
              </label>
            </div>
            <div class="field">
              <span>{t("field.away.what")}</span>
              {away.workerId && workerCrewHasOthers(away.workerId) && (
                <span class="hint">{t("field.away.memberHint")}</span>
              )}
              {(["cover", "defer", "skip"] as const).map((d) => (
                <label
                  key={d}
                  style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:4px 0"
                >
                  <input
                    type="radio"
                    name="disposition"
                    data-cy={`away-disp-${d}`}
                    checked={away.disposition === d}
                    onChange={() => patchAway({ disposition: d })}
                  />
                  {t(
                    d === "cover"
                      ? "field.away.cover"
                      : d === "defer"
                      ? "field.away.defer"
                      : "field.away.skip",
                  )}
                </label>
              ))}
            </div>
            {away.disposition === "cover" && (
              <label class="field">
                {t("field.away.coverBy")}
                <select
                  data-cy="away-cover"
                  value={away.cover}
                  onChange={(e) =>
                    patchAway({
                      cover: (e.currentTarget as HTMLSelectElement).value,
                    })}
                >
                  <option value="">{t("field.away.coverPick")}</option>
                  {crews.filter((c) => c.id !== away.crewId).map((c) => (
                    <option value={`crew:${c.id}`} key={c.id}>
                      {t("field.crew.select")}: {c.name}
                    </option>
                  ))}
                  {list.filter((w) => w.id !== away.workerId).map((w) => (
                    <option value={`worker:${w.id}`} key={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label class="field">
              {t("field.away.note")}
              <input
                data-cy="away-note"
                placeholder={t("field.away.notePh")}
                maxLength={200}
                value={away.note}
                onInput={(e) =>
                  patchAway({
                    note: (e.currentTarget as HTMLInputElement).value,
                  })}
              />
            </label>
            {away.err && (
              <p class="alert" data-cy="away-error">{errMsg(away.err)}</p>
            )}
            <div class="modal__foot">
              <button
                type="button"
                class="btn--cancel"
                onClick={() => setAway(null)}
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                class="btn--submit"
                data-cy="away-submit"
                disabled={away.saving}
              >
                {away.saving ? t("field.common.loading") : t("common.add")}
              </button>
            </div>
          </form>
        </Backdrop>
      )}
    </>
  );
}
