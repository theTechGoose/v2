/**
 * REQ-839 — /field/services. The service catalogue: every task type with a name and
 * what it covers, where it is used, Edit, Archive / Restore and Delete (only when
 * nothing uses it). No price here — a price lives where the service is used.
 */
import Backdrop from "../components/Backdrop.tsx";
import { useEffect, useState } from "preact/hooks";
import { fieldClient, type TaskType } from "../clients/field.ts";
import FieldHead from "../components/FieldHead.tsx";
import { ApiError } from "../lib/api.ts";
import { I, ICN } from "../lib/dash-icons.tsx";
import { langSignal, t } from "../lib/i18n.ts";
import type { FieldServicesSeed } from "../lib/field-ssr.ts";

interface Form {
  editId: string | null;
  name: string;
  description: string;
  err: string | null;
  saving: boolean;
}

const blankForm = (): Form => ({
  editId: null,
  name: "",
  description: "",
  err: null,
  saving: false,
});

/** the server's refusal in the user's words: a stable code first (REQ-421), else its message */
function errMsg(err: unknown): string {
  if (err instanceof ApiError) {
    const b = err.body as {
      code?: unknown;
      error?: unknown;
      message?: unknown;
      detail?: {
        subscriptions?: unknown;
        checklists?: unknown;
        tasks?: unknown;
      };
    } | null;
    if (b && typeof b === "object") {
      if (b.code === "task_type_name_taken") return t("field.svc.nameTaken");
      if (b.code === "task_type_in_use") {
        return t("field.svc.inUse", {
          subs: Number(b.detail?.subscriptions ?? 0),
          ckls: Number(b.detail?.checklists ?? 0),
          tasks: Number(b.detail?.tasks ?? 0),
        });
      }
      if (typeof b.error === "string") return b.error;
      if (typeof b.message === "string") return b.message;
    }
  }
  if (err instanceof Error && err.message) return err.message;
  return t("field.common.error");
}

export default function FieldServicesPage(
  { seed }: { seed?: FieldServicesSeed | null } = {},
) {
  const _lang = langSignal.value; // re-render on a language flip
  const [list, setList] = useState<TaskType[] | null>(seed?.types ?? null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cardErr, setCardErr] = useState<{ id: string; msg: string } | null>(
    null,
  );

  async function reload() {
    try {
      setList(await fieldClient.allTaskTypes());
      setLoadErr(null);
    } catch (err) {
      setLoadErr(errMsg(err));
      setList((prev) => prev ?? []);
    }
  }

  useEffect(() => {
    if (seed) return;
    let alive = true;
    fieldClient.allTaskTypes().then((l) => {
      if (alive) setList(l);
    }).catch((err: unknown) => {
      if (!alive) return;
      setLoadErr(errMsg(err));
      setList([]);
    });
    return () => {
      alive = false;
    };
  }, []);

  function patch(p: Partial<Form>) {
    setForm((f) => (f ? { ...f, ...p } : f));
  }

  async function submit(e: Event) {
    e.preventDefault();
    if (!form || form.saving) return;
    if (!form.name.trim()) {
      setForm({ ...form, err: t("field.svc.nameRequired") });
      return;
    }
    setForm({ ...form, saving: true, err: null });
    try {
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || null,
      };
      if (form.editId) await fieldClient.updateTaskType(form.editId, body);
      else await fieldClient.createTaskType(body);
      setForm(null);
      await reload();
    } catch (err) {
      setForm((
        cur,
      ) => (cur ? { ...cur, saving: false, err: errMsg(err) } : cur));
    }
  }

  async function act(ty: TaskType, fn: () => Promise<unknown>) {
    setBusyId(ty.id);
    setCardErr(null);
    try {
      await fn();
      setConfirmId(null);
      await reload();
    } catch (err) {
      setConfirmId(null);
      setCardErr({ id: ty.id, msg: errMsg(err) });
    } finally {
      setBusyId(null);
    }
  }

  const all = list ?? [];
  const live = all.filter((x) => !x.archived);
  const cards = showArchived ? all : live;

  return (
    <>
      <FieldHead
        eyebrow={t("field.svc.eyebrow", { n: live.length })}
        title={t("field.svc.title")}
        sub={t("field.svc.sub")}
      >
        <label
          class="btn btn--ghost"
          style="display:inline-flex;align-items:center;gap:6px;cursor:pointer"
        >
          <input
            type="checkbox"
            data-cy="svc-show-archived"
            checked={showArchived}
            onChange={(e) =>
              setShowArchived((e.currentTarget as HTMLInputElement).checked)}
          />
          {t("field.svc.showArchived")}
        </label>
        <button
          type="button"
          class="btn btn--pink"
          data-cy="svc-new"
          onClick={() => {
            setConfirmId(null);
            setForm(blankForm());
          }}
        >
          <I d={ICN.plus} size={14} sw={2.5} /> {t("field.svc.new")}
        </button>
      </FieldHead>

      {loadErr && <p class="alert">{loadErr}</p>}

      {list === null
        ? (
          <div class="hint" style="padding:12px 4px">
            {t("field.common.loading")}
          </div>
        )
        : (
          <div class="subs">
            {cards.map((ty) => {
              const busy = busyId === ty.id;
              const confirming = confirmId === ty.id;
              return (
                <div
                  class="sub"
                  data-cy="svc-card"
                  data-id={ty.id}
                  data-archived={ty.archived ? "true" : undefined}
                  key={ty.id}
                  style={ty.archived ? "opacity:.65" : undefined}
                >
                  <div class="sub__client">
                    <span style="display:inline-flex;align-items:center;gap:6px">
                      <I d={ICN.wrench} size={14} />{" "}
                      <span data-cy="svc-card-name">{ty.name}</span>
                      {ty.archived && (
                        <span class="chip chip--muted" data-cy="svc-archived">
                          {t("field.svc.archived")}
                        </span>
                      )}
                    </span>
                    <span class="chip" data-cy="svc-used-by">
                      {t("field.svc.usedBy", {
                        subs: ty.usedBy?.subscriptions ?? 0,
                        ckls: ty.usedBy?.checklists ?? 0,
                      })}
                    </span>
                  </div>
                  {ty.description && (
                    <div class="sub__addr" data-cy="svc-card-description">
                      {ty.description}
                    </div>
                  )}
                  {cardErr?.id === ty.id && (
                    <p class="alert" style="margin:0" data-cy="svc-card-error">
                      {cardErr.msg}
                    </p>
                  )}
                  <div class="sub__foot">
                    <span />
                    <span style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
                      {confirming
                        ? (
                          <>
                            <span class="hint" style="align-self:center">
                              {t("field.svc.confirmDelete")}
                            </span>
                            <button
                              type="button"
                              class="btn btn--danger btn--sm"
                              data-cy="svc-delete-confirm"
                              disabled={busy}
                              onClick={() =>
                                act(
                                  ty,
                                  () => fieldClient.deleteTaskType(ty.id),
                                )}
                            >
                              {t("field.common.confirm")}
                            </button>
                            <button
                              type="button"
                              class="btn btn--ghost btn--sm"
                              data-cy="svc-delete-cancel"
                              disabled={busy}
                              onClick={() => setConfirmId(null)}
                            >
                              {t("field.common.cancel")}
                            </button>
                          </>
                        )
                        : (
                          <>
                            <button
                              type="button"
                              class="btn btn--ghost btn--sm"
                              data-cy="svc-edit"
                              disabled={busy}
                              onClick={() => {
                                setConfirmId(null);
                                setForm({
                                  ...blankForm(),
                                  editId: ty.id,
                                  name: ty.name,
                                  description: ty.description ?? "",
                                });
                              }}
                            >
                              {t("field.subs.edit")}
                            </button>
                            <button
                              type="button"
                              class="btn btn--ghost btn--sm"
                              data-cy={ty.archived
                                ? "svc-restore"
                                : "svc-archive"}
                              disabled={busy}
                              onClick={() =>
                                act(
                                  ty,
                                  () =>
                                    fieldClient.updateTaskType(ty.id, {
                                      archived: !ty.archived,
                                    }),
                                )}
                            >
                              {ty.archived
                                ? t("field.svc.restore")
                                : t("field.svc.archive")}
                            </button>
                            <button
                              type="button"
                              class="btn btn--danger btn--sm"
                              data-cy="svc-delete"
                              disabled={busy}
                              onClick={() => {
                                setCardErr(null);
                                setConfirmId(ty.id);
                              }}
                            >
                              {t("field.svc.delete")}
                            </button>
                          </>
                        )}
                    </span>
                  </div>
                </div>
              );
            })}
            {cards.length === 0 && (
              <div class="hint" style="padding:12px 4px" data-cy="svc-empty">
                {t("field.svc.empty")}
              </div>
            )}
          </div>
        )}

      {form && (
        <Backdrop class="modal-bg" onClose={() => setForm(null)}>
          <form class="modal" onSubmit={submit} data-cy="svc-form">
            <div class="modal__head">
              <h2>
                {form.editId ? t("field.svc.editTitle") : t("field.svc.new")}
              </h2>
            </div>
            <label class="field">
              {t("field.svc.name")}
              <input
                data-cy="svc-name"
                placeholder={t("field.svc.namePh")}
                maxLength={80}
                value={form.name}
                onInput={(e) =>
                  patch({ name: (e.currentTarget as HTMLInputElement).value })}
              />
            </label>
            <label class="field">
              {t("field.svc.description")}
              <textarea
                data-cy="svc-description"
                placeholder={t("field.svc.descriptionPh")}
                maxLength={300}
                rows={3}
                value={form.description}
                onInput={(e) =>
                  patch({
                    description: (e.currentTarget as HTMLTextAreaElement).value,
                  })}
              />
            </label>
            {form.err && <p class="alert" data-cy="svc-error">{form.err}</p>}
            <div class="modal__foot">
              <button
                type="button"
                class="btn--cancel"
                onClick={() => setForm(null)}
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                class="btn--submit"
                data-cy="svc-submit"
                disabled={form.saving}
              >
                {form.saving
                  ? t("field.common.loading")
                  : form.editId
                  ? t("field.common.save")
                  : t("common.add")}
              </button>
            </div>
          </form>
        </Backdrop>
      )}
    </>
  );
}
