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
import { ApiError } from "../lib/api.ts";
import { I, ICN } from "../lib/dash-icons.tsx";
import { fmtCell } from "../lib/field.ts";
import { langSignal, t } from "../lib/i18n.ts";

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

/** the server's message when it sent one (a 409 names the zones still covered); the house fallback otherwise */
function errMsg(err: unknown): string {
  if (err instanceof ApiError) {
    const b = err.body as { error?: unknown; message?: unknown } | null;
    if (b && typeof b === "object") {
      if (typeof b.error === "string") return b.error;
      if (typeof b.message === "string") return b.message;
    }
  }
  if (err instanceof Error && err.message) return err.message;
  return t("field.common.error");
}

/** "Zona 3" reads "Zone 3" in English (the server names zones in Spanish) */
function zoneName(name: string, lang: "en" | "es"): string {
  return lang === "en" ? name.replace(/^Zona /, "Zone ") : name;
}

export default function FieldWorkersPage() {
  const lang = langSignal.value;
  const [workers, setWorkers] = useState<FieldWorker[] | null>(null);
  const [regions, setRegions] = useState<RegionView[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [form, setForm] = useState<AddForm>(BLANK);
  const [adding, setAdding] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);
  /** REQ-151 — the last add: whether the worker was texted the link and the PIN */
  const [added, setAdded] = useState<{ name: string; texted: boolean } | null>(
    null,
  );
  /** the row whose Remove is waiting for its Confirm */
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<{ id: string; msg: string } | null>(
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
        setLoadErr(errMsg(err));
        setWorkers([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const phoneOk = form.phone.length === 10;
  const pinOk = /^\d{4}$/.test(form.pin);
  const canAdd = form.name.trim().length > 0 && phoneOk && pinOk && !adding;

  async function submit(e: Event) {
    e.preventDefault();
    if (!canAdd) return;
    setAdding(true);
    setAddErr(null);
    setAdded(null);
    try {
      const made = await fieldClient.createWorker({
        name: form.name.trim(),
        phoneNumber: form.phone,
        pin: form.pin,
        role: form.foreman ? "foreman" : "worker",
        language: form.language,
      });
      setAdded({ name: made.name, texted: made.texted === true });
      setForm(BLANK);
      await reload();
    } catch (err) {
      setAddErr(errMsg(err));
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
      setRowErr({ id: w.id, msg: errMsg(err) });
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
      setRowErr({ id: w.id, msg: errMsg(err) });
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
        <a class="btn btn--ghost" href="/worker" data-cy="wk-open">
          <I d={ICN.hardhat} size={14} /> {t("field.wk.open")}
        </a>
      </FieldHead>

      {loadErr && <p class="alert">{loadErr}</p>}

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
              value={form.name}
              onInput={(e) =>
                setForm({
                  ...form,
                  name: (e.currentTarget as HTMLInputElement).value,
                })}
            />
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
              placeholder="8435550201"
              maxlength={10}
              pattern="\d{10}"
              value={form.phone}
              onInput={(e) =>
                setForm({
                  ...form,
                  phone: (e.currentTarget as HTMLInputElement).value.replace(
                    /\D/g,
                    "",
                  ).slice(0, 10),
                })}
            />
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
              value={form.pin}
              onInput={(e) =>
                setForm({
                  ...form,
                  pin: (e.currentTarget as HTMLInputElement).value.replace(
                    /\D/g,
                    "",
                  ).slice(0, 4),
                })}
            />
          </label>
        </div>
        <div class="row" style="margin-top:10px">
          <label class="field" style="flex:1;min-width:200px">
            {t("field.wk.language")}
            <select
              name="language"
              data-cy="wk-language"
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
            <span class="hint" style="font-weight:400">
              {t("field.wk.langHint")}
            </span>
          </label>
        </div>
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
            disabled={!canAdd}
          >
            <I d={ICN.plus} size={14} sw={2.5} />{" "}
            {adding ? t("field.common.loading") : t("common.add")}
          </button>
        </div>
        {addErr && <p class="alert" data-cy="wk-error">{addErr}</p>}
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
                        {w.name.slice(0, 2).toUpperCase()}
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
                            <span class="hint">{t("field.wk.coversNone")}</span>
                          )}
                      </span>
                    </div>
                  </div>
                  {rowErr?.id === w.id && (
                    <p class="alert" style="margin:0" data-cy="wk-row-error">
                      {rowErr.msg}
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
                              onClick={() => setConfirmId(null)}
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
