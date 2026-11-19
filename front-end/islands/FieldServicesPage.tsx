/**
 * REQ-839 — /field/services. The service catalogue: every task type with a name and
 * what it covers, where it is used, Edit, Archive / Restore and Delete (only when
 * nothing uses it). No price here — a price lives where the service is used.
 * REQ-927 — Move to…: every record on a service moves to another as one move (a
 * segment) that the Moves list can undo, redo or send on to another service.
 */
import Backdrop from "../components/Backdrop.tsx";
import { useEffect, useState } from "preact/hooks";
import {
  fieldClient,
  type ServiceMigrationView,
  type TaskType,
} from "../clients/field.ts";
import FieldHead from "../components/FieldHead.tsx";
import { ApiError } from "../lib/api.ts";
import { I, ICN } from "../lib/dash-icons.tsx";
import { langSignal, t, tn } from "../lib/i18n.ts";
import type { FieldServicesSeed } from "../lib/field-ssr.ts";

interface Form {
  editId: string | null;
  name: string;
  description: string;
  err: string | null;
  saving: boolean;
}

/** REQ-927: Move to… — a whole service (`fromId`) or a move's records again (`segId`) */
interface MoveForm {
  fromId?: string;
  segId?: string;
  name: string;
  toId: string;
  deleteAfter: boolean;
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

/** REQ-927: "1 repeat visit · 2 tasks" — only what the move holds, each in its own number */
function moveCounts(m: ServiceMigrationView): string {
  const n = {
    subs: m.counts.subscriptions,
    ckls: m.counts.checklists,
    tasks: m.counts.tasks,
    crews: m.counts.crews,
  };
  const parts = (Object.keys(n) as (keyof typeof n)[])
    .filter((k) => n[k] > 0)
    .map((k) => tn(`field.svc.mc.${k}`, n[k]));
  return parts.length ? parts.join(" · ") : tn("field.svc.mc.subs", 0);
}

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
        crew?: unknown;
        name?: unknown;
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
      // REQ-927: the move's refusals
      const moveCodes: Record<string, string> = {
        same_service: "field.svc.err.same",
        nothing_to_migrate: "field.svc.err.nothing",
        target_archived: "field.svc.err.archived",
        migration_crew_conflict: "field.svc.err.crewConflict",
        segment_superseded: "field.svc.err.superseded",
        undo_name_taken: "field.svc.err.undoNameTaken",
        segment_not_applied: "field.svc.err.notApplied",
        segment_not_undone: "field.svc.err.notUndone",
      };
      if (typeof b.code === "string" && moveCodes[b.code]) {
        return t(moveCodes[b.code], {
          crew: String(b.detail?.crew ?? ""),
          name: String(b.detail?.name ?? ""),
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
  const [moves, setMoves] = useState<ServiceMigrationView[]>([]); // REQ-927
  const [moveForm, setMoveForm] = useState<MoveForm | null>(null);
  const [moveErr, setMoveErr] = useState<{ id: string; msg: string } | null>(
    null,
  );

  async function reloadMoves() {
    try {
      setMoves(await fieldClient.serviceMigrations());
    } catch { /* the list stays as it was */ }
  }

  async function reload() {
    try {
      setList(await fieldClient.allTaskTypes());
      void reloadMoves();
      setLoadErr(null);
    } catch (err) {
      setLoadErr(errMsg(err));
      setList((prev) => prev ?? []);
    }
  }

  useEffect(() => {
    void reloadMoves();
  }, []);

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

  /** REQ-927: run the move form — a service's records, or a move's records again */
  async function submitMove(e: Event) {
    e.preventDefault();
    if (!moveForm || moveForm.saving) return;
    if (!moveForm.toId) {
      setMoveForm({ ...moveForm, err: t("field.svc.movePick") });
      return;
    }
    setMoveForm({ ...moveForm, saving: true, err: null });
    try {
      if (moveForm.segId) {
        await fieldClient.moveServiceMigration(moveForm.segId, moveForm.toId);
      } else {
        await fieldClient.migrateTaskType(moveForm.fromId!, {
          toId: moveForm.toId,
          deleteAfter: moveForm.deleteAfter,
        });
      }
      setMoveForm(null);
      await reload();
    } catch (err) {
      setMoveForm((cur) =>
        cur ? { ...cur, saving: false, err: errMsg(err) } : cur
      );
    }
  }

  async function actMove(m: ServiceMigrationView, fn: () => Promise<unknown>) {
    setBusyId(m.id);
    setMoveErr(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      setMoveErr({ id: m.id, msg: errMsg(err) });
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
                    <span class="chip chip--plain" data-cy="svc-used-by">
                      {t("field.svc.usedByLine", {
                        list: [
                          tn(
                            "field.svc.mc.subs",
                            ty.usedBy?.subscriptions ?? 0,
                          ),
                          tn("field.svc.mc.ckls", ty.usedBy?.checklists ?? 0),
                        ].join(" · "),
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
                              data-cy="svc-migrate"
                              disabled={busy}
                              onClick={() => {
                                setConfirmId(null);
                                setMoveForm({
                                  fromId: ty.id,
                                  name: ty.name,
                                  toId: "",
                                  deleteAfter: true,
                                  err: null,
                                  saving: false,
                                });
                              }}
                            >
                              {t("field.svc.move")}
                            </button>
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

      {moves.length > 0 && (
        <section data-cy="svc-moves" style="margin-top:28px">
          <h2 style="margin:0 0 4px">{t("field.svc.moves")}</h2>
          <p class="hint" style="margin:0 0 12px">{t("field.svc.movesSub")}</p>
          <div class="subs">
            {moves.map((m) => {
              const busy = busyId === m.id;
              return (
                <div
                  class="sub"
                  data-cy="svc-move-row"
                  data-id={m.id}
                  data-state={m.state}
                  key={m.id}
                  style={m.state === "undone" ? "opacity:.65" : undefined}
                >
                  <div class="sub__client">
                    <span style="display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap">
                      <span data-cy="svc-move-from">{m.fromName}</span>
                      {m.fromDeleted && (
                        <span class="chip chip--muted">
                          {t("field.svc.moveDeleted")}
                        </span>
                      )}
                      <span aria-hidden="true">→</span>
                      <span data-cy="svc-move-to">{m.toName}</span>
                    </span>
                    {m.state === "undone" && (
                      <span class="chip chip--muted" data-cy="svc-move-undone">
                        {t("field.svc.moveUndone")}
                      </span>
                    )}
                  </div>
                  <div class="sub__addr" data-cy="svc-move-counts">
                    {moveCounts(m)}
                  </div>
                  {moveErr?.id === m.id && (
                    <p class="alert" style="margin:0" data-cy="svc-move-error">
                      {moveErr.msg}
                    </p>
                  )}
                  <div class="sub__foot">
                    <span />
                    <span style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
                      {m.state === "applied"
                        ? (
                          <button
                            type="button"
                            class="btn btn--ghost btn--sm"
                            data-cy="svc-move-undo"
                            disabled={busy}
                            onClick={() =>
                              actMove(
                                m,
                                () => fieldClient.undoServiceMigration(m.id),
                              )}
                          >
                            {t("field.svc.undo")}
                          </button>
                        )
                        : (
                          <button
                            type="button"
                            class="btn btn--ghost btn--sm"
                            data-cy="svc-move-redo"
                            disabled={busy}
                            onClick={() =>
                              actMove(
                                m,
                                () => fieldClient.redoServiceMigration(m.id),
                              )}
                          >
                            {t("field.svc.redo")}
                          </button>
                        )}
                      <button
                        type="button"
                        class="btn btn--ghost btn--sm"
                        data-cy="svc-move-again"
                        disabled={busy}
                        onClick={() => {
                          setMoveErr(null);
                          setMoveForm({
                            segId: m.id,
                            name: m.fromName,
                            toId: "",
                            deleteAfter: false,
                            err: null,
                            saving: false,
                          });
                        }}
                      >
                        {t("field.svc.move")}
                      </button>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {moveForm && (
        <Backdrop class="modal-bg" onClose={() => setMoveForm(null)}>
          <form class="modal" onSubmit={submitMove} data-cy="svc-move-form">
            <div class="modal__head">
              <h2>
                {moveForm.segId
                  ? t("field.svc.moveSegTitle", { from: moveForm.name })
                  : t("field.svc.moveTitle", { name: moveForm.name })}
              </h2>
            </div>
            <p class="hint" style="margin:0">
              {moveForm.segId
                ? t("field.svc.moveSegSub", { from: moveForm.name })
                : t("field.svc.moveSub", { name: moveForm.name })}
            </p>
            <label class="field">
              {t("field.svc.moveTo")}
              <select
                data-cy="svc-move-target"
                value={moveForm.toId}
                onChange={(e) => {
                  const toId = (e.currentTarget as HTMLSelectElement).value;
                  setMoveForm((f) => (f ? { ...f, toId, err: null } : f));
                }}
              >
                <option value="">{t("field.svc.movePick")}</option>
                {live
                  .filter((x) => x.id !== moveForm.fromId)
                  .map((x) => (
                    <option value={x.id} key={x.id}>{x.name}</option>
                  ))}
              </select>
            </label>
            {!moveForm.segId && (
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                <input
                  type="checkbox"
                  data-cy="svc-move-delete"
                  checked={moveForm.deleteAfter}
                  onChange={(e) => {
                    const deleteAfter =
                      (e.currentTarget as HTMLInputElement).checked;
                    setMoveForm((f) => (f ? { ...f, deleteAfter } : f));
                  }}
                />
                {t("field.svc.moveDelete", { name: moveForm.name })}
              </label>
            )}
            {moveForm.err && (
              <p class="alert" data-cy="svc-move-error">{moveForm.err}</p>
            )}
            <div class="modal__foot">
              <button
                type="button"
                class="btn--cancel"
                onClick={() => setMoveForm(null)}
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                class="btn--submit"
                data-cy="svc-move-submit"
                disabled={moveForm.saving}
              >
                {moveForm.saving
                  ? t("field.common.loading")
                  : t("field.svc.moveSubmit")}
              </button>
            </div>
          </form>
        </Backdrop>
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
