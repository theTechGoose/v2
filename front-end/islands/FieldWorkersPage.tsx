/**
 * REQ-138/143 — /field/workers. The crew: each worker with their own login
 * (cell + 4-digit PIN), the zones they cover, and an add form. Ported from the
 * a2z demo's trabajadores.html; the data comes from clients/field.ts.
 */
import { useEffect, useState } from "preact/hooks";
import {
  fieldClient,
  type FieldWorker,
  type RegionView,
} from "../clients/field.ts";
import FieldHead from "../components/FieldHead.tsx";
import { initialsOf } from "../lib/clients-display.ts";
import { I, ICN } from "../lib/dash-icons.tsx";
import { fmtCell, PHONE_PLACEHOLDER } from "../lib/field.ts";
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
} from "../lib/invite-share.ts";
import type { FieldWorkersSeed } from "../lib/field-ssr.ts";

interface AddForm {
  name: string;
  /** digits only, at most 10 */
  phone: string;
  /** digits only, at most 4 */
  pin: string;
  foreman: boolean;
  /** REQ-155 — the language the worker is texted in; Spanish by default */
  language: "en" | "es";
}

const BLANK: AddForm = {
  name: "",
  phone: "",
  pin: "",
  foreman: false,
  language: "es",
};

/** REQ-421 (demo m42) — the server's refusal code, worded in the page's language (never its English) */
function errMsg(err: WorkerErr): string {
  return t(err.key, err.vars);
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

  async function reload() {
    const [w, r] = await Promise.all([
      fieldClient.workers(),
      fieldClient.regions().catch(() => [] as RegionView[]),
    ]);
    setWorkers(w);
    setRegions(r);
    setLoadErr(null);
  }

  useEffect(() => {
    // REQ-730 — seeded on the server: no client fetch on mount
    if (seed) return;
    let alive = true;
    Promise.all([
      fieldClient.workers(),
      fieldClient.regions().catch(() => [] as RegionView[]),
    ])
      .then(([w, r]) => {
        if (!alive) return;
        setWorkers(w);
        setRegions(r);
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
        language: form.language,
      });
      setAdded({
        name: made.name,
        texted: made.texted === true,
        pin: form.pin,
        share: inviteShare(made),
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

      <form class="panel" onSubmit={submit} data-cy="wk-form">
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
              value={form.language}
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
            {t(added.texted ? "field.wk.texted" : "field.wk.notTexted", {
              name: added.name,
            })}
          </p>
        )}
        {added && !added.texted && added.share && (
          <div class="panel" data-cy="wk-share" style="margin:8px 0 0">
            <p style="margin:0 0 4px">
              {t("field.wk.shareLink")}:{" "}
              <a
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
                          <span />
                          <button
                            type="button"
                            class="btn btn--danger btn--sm"
                            data-cy="wk-delete"
                            disabled={busy}
                            onClick={() => {
                              setRowErr(null);
                              setConfirmId(w.id);
                            }}
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
    </>
  );
}
