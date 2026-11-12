/**
 * REQ-146 — /admins. The numbers the owner lets into the account: an invite
 * form (phone, optional name) and the list with Remove. An admin acting for
 * the account sees the list only — inviting and removing are the owner's.
 */
import { useEffect, useState } from "preact/hooks";
import {
  type AccountAdmin,
  adminsClient,
  isActing,
} from "../clients/admins.ts";
import FieldHead from "../components/FieldHead.tsx";
import { ApiError } from "../lib/api.ts";
import { I, ICN } from "../lib/dash-icons.tsx";
import { fmtCell } from "../lib/field.ts";
import { langSignal, t, tn } from "../lib/i18n.ts";

interface InviteForm {
  /** digits only, at most 10 */
  phone: string;
  name: string;
}
const BLANK: InviteForm = { phone: "", name: "" };

/** the server's stable error word → the dictionary; its message, else the house fallback */
function errMsg(err: unknown): string {
  if (err instanceof ApiError) {
    const b = err.body as { error?: unknown; message?: unknown } | null;
    if (b && typeof b === "object") {
      if (typeof b.error === "string") {
        const key = `admins.err.${b.error}`;
        const known = t(key);
        if (known !== key) return known;
        return b.error;
      }
      if (typeof b.message === "string") return b.message;
    }
  }
  if (err instanceof Error && err.message) return err.message;
  return t("field.common.error");
}

function fmtDate(iso: string, lang: "en" | "es"): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString(lang === "es" ? "es-US" : "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function AdminsPage() {
  const lang = langSignal.value;
  const [admins, setAdmins] = useState<AccountAdmin[] | null>(null);
  const [owner, setOwner] = useState<boolean>(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [form, setForm] = useState<InviteForm>(BLANK);
  const [inviting, setInviting] = useState(false);
  const [inviteErr, setInviteErr] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<{ id: string; msg: string } | null>(
    null,
  );

  useEffect(() => {
    let alive = true;
    Promise.all([
      adminsClient.list(),
      adminsClient.accounts().catch(() => null),
    ])
      .then(([list, accounts]) => {
        if (!alive) return;
        setAdmins(list);
        setOwner(!isActing(accounts));
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setLoadErr(errMsg(err));
        setAdmins([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const phoneOk = form.phone.length === 10;
  const canInvite = phoneOk && !inviting;

  async function submit(e: Event) {
    e.preventDefault();
    if (!canInvite) return;
    setInviting(true);
    setInviteErr(null);
    setSent(null);
    try {
      const made = await adminsClient.invite({
        phoneNumber: form.phone,
        name: form.name.trim() || undefined,
      });
      setForm(BLANK);
      setSent(fmtCell(made.phoneNumber));
      setAdmins((list) => [...(list ?? []), made]);
    } catch (err) {
      setInviteErr(errMsg(err));
    } finally {
      setInviting(false);
    }
  }

  async function remove(a: AccountAdmin) {
    setBusyId(a.id);
    setRowErr(null);
    try {
      await adminsClient.remove(a.id);
      setConfirmId(null);
      setAdmins((list) => (list ?? []).filter((x) => x.id !== a.id));
    } catch (err) {
      setRowErr({ id: a.id, msg: errMsg(err) });
    } finally {
      setBusyId(null);
    }
  }

  const list = admins ?? [];

  return (
    <>
      <FieldHead
        eyebrow={tn("admins.eyebrow", list.length)}
        title={t("admins.title")}
        sub={t("admins.sub")}
      />

      {loadErr && <p class="alert">{loadErr}</p>}

      {owner
        ? (
          <form class="panel" onSubmit={submit} data-cy="adm-form">
            <h2 class="panel__title">
              <I d={ICN.plus} size={14} sw={2.5} /> {t("admins.new")}
            </h2>
            <div class="row">
              <label class="field">
                {t("settings.phone")}
                <input
                  name="phone"
                  type="tel"
                  data-cy="adm-phone"
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
                      phone: (e.currentTarget as HTMLInputElement).value
                        .replace(/\D/g, "")
                        .slice(0, 10),
                    })}
                />
              </label>
              <label class="field">
                {t("admins.nameOptional")}
                <input
                  name="name"
                  data-cy="adm-name"
                  autocomplete="off"
                  maxlength={120}
                  value={form.name}
                  onInput={(e) =>
                    setForm({
                      ...form,
                      name: (e.currentTarget as HTMLInputElement).value,
                    })}
                />
              </label>
            </div>
            <div
              class="row"
              style="margin-top:10px;align-items:center;justify-content:flex-end"
            >
              <button
                type="submit"
                class="btn btn--pink"
                data-cy="adm-invite"
                disabled={!canInvite}
              >
                <I d={ICN.send} size={14} />{" "}
                {inviting ? t("admins.inviting") : t("admins.invite")}
              </button>
            </div>
            {inviteErr && <p class="alert" data-cy="adm-error">{inviteErr}</p>}
            {sent && (
              <p class="hint" data-cy="adm-sent" style="margin:8px 0 0">
                {t("admins.sent", { phone: sent })}
              </p>
            )}
          </form>
        )
        : (
          <p class="hint" data-cy="adm-only-owner" style="padding:4px">
            {t("admins.onlyOwner")}
          </p>
        )}

      {admins === null
        ? (
          <div class="hint" style="padding:12px 4px">
            {t("field.common.loading")}
          </div>
        )
        : list.length === 0
        ? (
          <div class="hint" data-cy="adm-empty" style="padding:12px 4px">
            {t("admins.empty")}
          </div>
        )
        : (
          <div class="subs" style="margin-top:14px">
            {list.map((a) => {
              const busy = busyId === a.id;
              const confirming = confirmId === a.id;
              const label = a.name?.trim() || fmtCell(a.phoneNumber);
              return (
                <div class="sub" data-cy="adm-row" data-id={a.id} key={a.id}>
                  <div class="sub__client">
                    <span style="display:inline-flex;align-items:center;gap:8px;min-width:0">
                      <span
                        aria-hidden="true"
                        style="display:inline-grid;place-items:center;width:32px;height:32px;border-radius:50%;background:var(--brand-green);color:#fff;font-size:12px;flex-shrink:0"
                      >
                        <I d={ICN.shield} size={16} />
                      </span>
                      <span data-cy="adm-row-name">{label}</span>
                    </span>
                  </div>
                  <div
                    class="sub__addr"
                    style="display:flex;align-items:center;gap:6px"
                  >
                    <I d={ICN.phone} size={12} />{" "}
                    <span data-cy="adm-row-phone">
                      {fmtCell(a.phoneNumber)}
                    </span>
                  </div>
                  <div class="sub__items">
                    <div>
                      <span>
                        {t("admins.invitedOn", {
                          date: fmtDate(a.createdAt, lang),
                        })}
                      </span>
                    </div>
                  </div>
                  {rowErr?.id === a.id && (
                    <p class="alert" style="margin:0" data-cy="adm-row-error">
                      {rowErr.msg}
                    </p>
                  )}
                  {owner && (
                    <div class="sub__foot">
                      {confirming
                        ? (
                          <>
                            <span>{t("admins.confirm", { name: label })}</span>
                            <span style="display:flex;gap:6px">
                              <button
                                type="button"
                                class="btn btn--danger btn--sm"
                                data-cy="adm-remove-confirm"
                                disabled={busy}
                                onClick={() => remove(a)}
                              >
                                {t("field.common.confirm")}
                              </button>
                              <button
                                type="button"
                                class="btn btn--ghost btn--sm"
                                data-cy="adm-remove-cancel"
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
                              class="btn btn--ghost btn--sm"
                              data-cy="adm-remove"
                              onClick={() => setConfirmId(a.id)}
                            >
                              <I d={ICN.trash} size={12} /> {t("admins.remove")}
                            </button>
                          </>
                        )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
    </>
  );
}
