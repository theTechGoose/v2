/**
 * /admin data island — super-admin console.
 *
 * Search users by phone, grant/revoke super-admin, and impersonate. Every
 * action hits a server-guarded endpoint (clients/admin.ts → AdminController);
 * the page itself is also route-gated on the super-admin flag, so this island
 * only ever renders for an actual super admin.
 *
 * REQ-269 (demo i18n-formatting-m2): every string comes from the dictionaries
 * (`adminPage.*`) through t(), so the console follows the app language and the
 * topbar's EN/ES toggle like every other page.
 *
 * REQ-301 (demo cycle 1, M18 + m35): a refused call — or the overlay's word
 * that Demo made this browser the customer — LOCKS the page with a plain
 * notice (never api.ts's raw `GET … failed: 403`), and the users list stays
 * live: it re-reads on focus/visibility, every ADMIN_REFRESH_MS while visible
 * and right after a Demo opens; a placeholder name shows as "(no name yet)".
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { adminClient, type AdminUserView } from "../clients/admin.ts";
import {
  DEMO_OPENING_EVENT,
  DEMO_STARTED_EVENT,
  demoModeClient,
} from "../clients/demo-mode.ts";
import { fmtPhone } from "../lib/format.ts";
import { t } from "../lib/i18n.ts";
import { type FeatureKey, FEATURES } from "../../shared/features.ts";
import {
  adminEmptyText,
  type AdminLock,
  displayName,
  impersonateLabel,
  lockFor,
  onSelfRenamed,
  refreshWhileVisible,
} from "../lib/admin-console.ts";
import { onImpersonation } from "../lib/demo-mode/impersonation-signal.ts";
import { STAGE_PATH } from "../../shared/demo-mode/protocol.ts";

const wrap = "max-width:980px;margin:0 auto;padding:8px 4px 48px";
const card =
  "background:#fff;border:1px solid var(--border,#e2e6dd);border-radius:14px;padding:18px;margin-bottom:18px";
const inputStyle =
  "flex:1;min-width:0;box-sizing:border-box;padding:9px 12px;border:1px solid var(--border,#d8dcd5);border-radius:9px;font:inherit;font-size:14px;background:#fff;color:var(--fg)";
const btnPrimary =
  "padding:9px 16px;border-radius:9px;border:0;background:var(--brand-green,#519843);color:#fff;cursor:pointer;font:inherit;font-weight:700;white-space:nowrap";
const btnSecondary =
  "padding:7px 12px;border-radius:8px;border:1px solid var(--border,#d8dcd5);background:#fff;color:var(--fg);cursor:pointer;font:inherit;font-weight:600;white-space:nowrap";
const tabStyle = (on: boolean) =>
  `padding:8px 14px;border-radius:999px;border:1px solid ${
    on ? "var(--brand-green,#519843)" : "var(--border,#d8dcd5)"
  };background:${on ? "var(--brand-green,#519843)" : "#fff"};color:${
    on ? "#fff" : "var(--fg)"
  };cursor:pointer;font:inherit;font-weight:700`;
const btnDanger =
  "padding:7px 12px;border-radius:8px;border:1px solid #e3b7b7;background:#fff;color:#a83b3b;cursor:pointer;font:inherit;font-weight:600;white-space:nowrap";

/** A feature's label/hint in the app language; a feature added to shared/features.ts
 *  before its dictionary keys still shows its registry text, never a raw key. */
function featureText(key: string, fallback: string): string {
  const v = t(key);
  return v === key ? fallback : v;
}

/** REQ-227 (demo-lifecycle-p2): `selfId` — the signed-in admin's own id; their own row offers
 *  neither Impersonate nor Demo (a demo on yourself makes you the customer AND the presenter) */
export default function AdminPage({ selfId }: { selfId?: string }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<AdminUserView[]>([]);
  /** REQ-507 — the query the shown rows came from (the empty state names it) */
  const [shownQ, setShownQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [impersonateId, setImpersonateId] = useState("");
  // REQ-177: Users (search / super-admin / impersonate) and Accounts (feature switches)
  const [tab, setTab] = useState<"users" | "accounts">("users");
  /** REQ-301 (M18) — this browser's session is not the admin's any more: the page is locked */
  const [lock, setLock] = useState<AdminLock | null>(null);
  const busyRef = useRef(false);
  const lockRef = useRef<AdminLock | null>(null);
  lockRef.current = lock;
  /** REQ-424 — stops the users-list refresh (once the page locks) */
  const stopRefreshRef = useRef<(() => void) | null>(null);
  const qRef = useRef(q);
  qRef.current = q;

  /** REQ-301 — a failed call: lock the page when the session is refused or an impersonation,
   *  else the dictionary's plain message (never api.ts's `GET … failed: 403`) */
  async function fail(err: unknown, fallbackKey: string) {
    const who = await adminClient.whoami().catch(() => null);
    const l = lockFor(err, who);
    if (l) setLock(l);
    else setError(t(fallbackKey));
  }

  /** `quiet`: a background refresh — no Searching… flicker, no error clobbered */
  async function search(e?: Event, quiet = false) {
    e?.preventDefault();
    if (lockRef.current) return;
    if (quiet && busyRef.current) return;
    busyRef.current = true;
    if (!quiet) {
      setLoading(true);
      setError(null);
    }
    try {
      const asked = qRef.current.trim();
      setRows(await adminClient.search(asked));
      setShownQ(asked);
    } catch (err) {
      await fail(err, "adminPage.err.search");
    } finally {
      busyRef.current = false;
      if (!quiet) setLoading(false);
    }
  }

  // List all users on first load (empty query → the server returns everyone,
  // capped). Searching then narrows it. REQ-301 (m35) — and keep it live: on
  // focus / visibility and every ADMIN_REFRESH_MS while the tab is visible.
  // REQ-301 (M18) — the overlay's word that Demo made this browser the customer
  // (this tab or any other of the same browser) locks the page at once.
  useEffect(() => {
    search();
    const stopRefresh = stopRefreshRef.current = refreshWhileVisible(() =>
      void search(undefined, true)
    );
    const stopSignal = onImpersonation((d) =>
      setLock({ kind: "demo", customer: d.targetName })
    );
    // REQ-606 (cycle 4, m20) — the staff name prompt's save renames this admin's own row at
    // once; not left to the refresh, which a locked (Demo) or idle page never makes
    const stopSelf = onSelfRenamed(selfId, setRows);
    return () => {
      stopRefresh();
      stopSignal();
      stopSelf();
    };
  }, []);
  // REQ-424 (cycle 2, p2) — a locked page (a demo made this browser the customer, or the
  // session is gone) has nothing to refresh: its timer and listeners stop for good.
  useEffect(() => {
    if (lock) stopRefreshRef.current?.();
  }, [lock]);

  async function toggleSuper(u: AdminUserView) {
    setBusyId(u.id);
    setError(null);
    try {
      const updated = u.superAdmin
        ? await adminClient.revoke(u.id)
        : await adminClient.grant(u.id);
      setRows((rs) => rs.map((r) => (r.id === u.id ? updated : r)));
    } catch (err) {
      await fail(err, "adminPage.err.update");
    } finally {
      setBusyId(null);
    }
  }

  // REQ-177: one switch per registered feature, per account
  async function setFeature(u: AdminUserView, key: FeatureKey, on: boolean) {
    setBusyId(u.id);
    setError(null);
    try {
      const updated = await adminClient.setFeature(u.id, key, on);
      setRows((rs) => rs.map((r) => (r.id === u.id ? updated : r)));
    } catch (err) {
      await fail(err, "adminPage.err.update");
    } finally {
      setBusyId(null);
    }
  }
  /** REQ-153 — demo mode: open the invitation for this user and stay here. The overlay
   *  (mounted in the shell) picks the demo up at once and waits in its pill; when the
   *  customer accepts, it impersonates them and opens the page they are on. */
  async function demo(id: string, targetName: string) {
    if (!id) return;
    setBusyId(id);
    setError(null);
    // REQ-179 — instant feedback: the button reads Opening… and the pill shows before any answer
    globalThis.dispatchEvent(
      new CustomEvent(DEMO_OPENING_EVENT, {
        detail: { targetUserId: id, targetName },
      }),
    );
    try {
      const started = await demoModeClient.start(id);
      globalThis.dispatchEvent(
        new CustomEvent(DEMO_STARTED_EVENT, {
          detail: { ...started, targetName },
        }),
      );
      // REQ-301 (m35) — the row is re-read the moment a demo opens
      void search(undefined, true);
    } catch (err) {
      await fail(err, "adminPage.err.demo");
      // no detail: the overlay asks the server and clears its Opening… pill
      globalThis.dispatchEvent(new Event(DEMO_STARTED_EVENT));
    } finally {
      setBusyId(null);
    }
  }

  async function impersonate(id: string) {
    if (!id) return;
    setBusyId(id);
    setError(null);
    try {
      await adminClient.impersonate(id);
      // The server swapped the pm_session cookie; reload as the target user.
      globalThis.location.href = "/dashboard";
    } catch (err) {
      await fail(err, "adminPage.err.impersonate");
      setBusyId(null);
    }
  }

  /** REQ-301 — every action is off while the page is locked */
  const frozen = busyId !== null || lock !== null;
  const noName = t("adminPage.noNameYet");

  return (
    <div style={wrap}>
      <div style="margin:6px 4px 18px">
        <h1 style="margin:0 0 4px;font-size:22px;font-weight:800;color:var(--fg)">
          {t("adminPage.title")}
        </h1>
        <p style="margin:0;color:var(--fg-muted,#6b7560);font-size:13.5px">
          {tab === "users"
            ? t("adminPage.lead.users")
            : t("adminPage.lead.accounts")}
        </p>
      </div>
      <div role="tablist" style="display:flex;gap:8px;margin:0 4px 14px">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "users"}
          data-cy="adm-tab-users"
          style={tabStyle(tab === "users")}
          onClick={() => setTab("users")}
        >
          {t("adminPage.tab.users")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "accounts"}
          data-cy="adm-tab-accounts"
          style={tabStyle(tab === "accounts")}
          onClick={() => setTab("accounts")}
        >
          {t("adminPage.tab.accounts")}
        </button>
      </div>

      <div style={card}>
        <form
          onSubmit={search}
          style="display:flex;gap:10px;align-items:center"
        >
          <input
            data-cy="adm-q"
            style={inputStyle}
            type="search"
            placeholder={t("adminPage.search.placeholder")}
            value={q}
            onInput={(e) => setQ((e.target as HTMLInputElement).value)}
            aria-label={t("adminPage.search.aria")}
          />
          <button
            type="submit"
            data-cy="adm-search"
            style={btnPrimary}
            disabled={loading || lock !== null}
          >
            {loading ? t("adminPage.searching") : t("adminPage.search")}
          </button>
        </form>
      </div>

      {lock && (
        <div
          role="alert"
          data-cy="adm-lock"
          style="background:#fff8e6;border:1px solid #e8d49a;color:#6b5412;border-radius:10px;padding:12px 14px;margin-bottom:14px;font-size:13.5px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"
        >
          <span style="flex:1;min-width:200px">
            {lock.kind === "demo"
              ? t("adminPage.lock.demo", { customer: lock.customer })
              : t("adminPage.lock.session")}
          </span>
          {lock.kind === "demo" && (
            <button
              type="button"
              data-cy="adm-lock-back"
              style={btnPrimary}
              onClick={() => globalThis.location.assign(STAGE_PATH)}
            >
              {t("adminPage.lock.back")}
            </button>
          )}
          <button
            type="button"
            data-cy="adm-lock-reload"
            style={btnSecondary}
            onClick={() => globalThis.location.reload()}
          >
            {t("adminPage.lock.reload")}
          </button>
        </div>
      )}

      {error && !lock && (
        <div
          role="alert"
          style="background:#fdecec;border:1px solid #e3b7b7;color:#a83b3b;border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:13.5px"
        >
          {error}
        </div>
      )}

      {tab === "accounts" && rows.length > 0 && (
        <div style={card} data-cy="adm-accounts">
          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:13.5px">
              <thead>
                <tr style="text-align:left;color:var(--fg-muted,#6b7560);font-size:11.5px;letter-spacing:.05em;text-transform:uppercase">
                  <th style="padding:8px 10px">{t("adminPage.col.account")}</th>
                  <th style="padding:8px 10px">{t("adminPage.col.phone")}</th>
                  {FEATURES.map((f) => (
                    <th
                      key={f.key}
                      style="padding:8px 10px"
                      title={featureText(
                        `adminPage.feature.${f.key}.hint`,
                        f.hint,
                      )}
                    >
                      {featureText(`adminPage.feature.${f.key}`, f.label)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr
                    key={u.id}
                    data-cy="adm-account"
                    data-user={u.id}
                    style="border-top:1px solid var(--border,#eef1ea)"
                  >
                    <td style="padding:10px">
                      <div style="font-weight:600">
                        {u.businessName || displayName(u.name, noName)}
                      </div>
                      {u.businessName && (
                        <div style="color:var(--fg-muted,#6b7560);font-size:12.5px">
                          {displayName(u.name, noName)}
                        </div>
                      )}
                    </td>
                    <td style="padding:10px;font-variant-numeric:tabular-nums">
                      {fmtPhone(u.phoneNumber)}
                    </td>
                    {FEATURES.map((f) => (
                      <td key={f.key} style="padding:10px">
                        <label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer">
                          <input
                            type="checkbox"
                            role="switch"
                            data-cy={`adm-feature-${f.key}`}
                            checked={u.features?.[f.key] === true}
                            disabled={frozen}
                            onChange={(e) =>
                              setFeature(
                                u,
                                f.key,
                                (e.target as HTMLInputElement).checked,
                              )}
                          />
                          <span style="font-size:12.5px;color:var(--fg-muted,#6b7560)">
                            {u.features?.[f.key] === true
                              ? t("adminPage.feature.on")
                              : t("adminPage.feature.off")}
                          </span>
                        </label>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {tab === "users" && rows.length > 0 && (
        <div style={card}>
          {
            /* Impersonate dropdown — pick any loaded user, then go. Mirrors
              the per-row Impersonate button for keyboard/quick selection. */
          }
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--border,#eef1ea)">
            <label
              style="font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--fg-muted,#6b7560)"
              for="impersonate-select"
            >
              {t("adminPage.impersonate")}
            </label>
            <select
              id="impersonate-select"
              style="flex:1;min-width:180px;padding:8px 10px;border:1px solid var(--border,#d8dcd5);border-radius:9px;font:inherit;font-size:13.5px;background:#fff;color:var(--fg)"
              value={impersonateId}
              onChange={(e) =>
                setImpersonateId((e.target as HTMLSelectElement).value)}
            >
              <option value="">{t("adminPage.selectUser")}</option>
              {rows.map((u) => (
                <option key={u.id} value={u.id}>
                  {impersonateLabel(u, noName)}
                </option>
              ))}
            </select>
            <button
              type="button"
              style={btnSecondary}
              disabled={!impersonateId || frozen}
              onClick={() => impersonate(impersonateId)}
            >
              {t("adminPage.go")}
            </button>
          </div>

          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:13.5px">
              <thead>
                <tr style="text-align:left;color:var(--fg-muted,#6b7560);font-size:11.5px;letter-spacing:.05em;text-transform:uppercase">
                  <th style="padding:8px 10px">{t("adminPage.col.name")}</th>
                  <th style="padding:8px 10px">{t("adminPage.col.phone")}</th>
                  <th style="padding:8px 10px">
                    {t("adminPage.col.business")}
                  </th>
                  <th style="padding:8px 10px">{t("adminPage.col.admin")}</th>
                  <th style="padding:8px 10px;text-align:right">
                    {t("adminPage.col.actions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr
                    key={u.id}
                    style="border-top:1px solid var(--border,#eef1ea)"
                  >
                    <td style="padding:10px;font-weight:600" data-cy="adm-name">
                      {displayName(u.name, noName)}
                    </td>
                    <td style="padding:10px;font-variant-numeric:tabular-nums">
                      {fmtPhone(u.phoneNumber)}
                    </td>
                    <td
                      style="padding:10px;color:var(--fg-muted,#6b7560)"
                      data-cy="adm-business"
                    >
                      {u.businessName || "—"}
                    </td>
                    <td style="padding:10px">
                      {u.superAdmin
                        ? (
                          <span style="display:inline-block;padding:2px 8px;border-radius:999px;background:#e7f3e3;color:#2f6d29;font-size:11.5px;font-weight:700">
                            {t("adminPage.yes")}
                          </span>
                        )
                        : (
                          <span style="color:var(--fg-muted,#9aa394)">
                            {t("adminPage.no")}
                          </span>
                        )}
                    </td>
                    <td style="padding:10px;text-align:right;white-space:nowrap">
                      <button
                        type="button"
                        style={u.superAdmin ? btnDanger : btnSecondary}
                        disabled={frozen}
                        onClick={() => toggleSuper(u)}
                      >
                        {busyId === u.id
                          ? "…"
                          : u.superAdmin
                          ? t("adminPage.revoke")
                          : t("adminPage.grant")}
                      </button>
                      {u.id !== selfId && (
                        <>
                          <button
                            type="button"
                            style={btnSecondary + ";margin-left:8px"}
                            disabled={frozen}
                            onClick={() => impersonate(u.id)}
                          >
                            {t("adminPage.impersonate")}
                          </button>
                          <button
                            type="button"
                            data-cy="adm-demo"
                            title={t("adminPage.demo.title")}
                            style={btnSecondary + ";margin-left:8px" +
                              (busyId === u.id
                                ? ";opacity:.65;cursor:wait"
                                : "")}
                            disabled={frozen}
                            onClick={() =>
                              demo(
                                u.id,
                                displayName(u.name, u.phoneNumber),
                              )}
                          >
                            {busyId === u.id
                              ? t("adminPage.opening")
                              : t("adminPage.demo")}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {loading && rows.length === 0 && (
        <div style="text-align:center;color:var(--fg-muted,#9aa394);font-size:13.5px;padding:24px">
          {t("adminPage.loading")}
        </div>
      )}
      {!loading && rows.length === 0 && (
        <div style="text-align:center;color:var(--fg-muted,#9aa394);font-size:13.5px;padding:24px">
          {adminEmptyText(t, shownQ)}
        </div>
      )}
    </div>
  );
}
