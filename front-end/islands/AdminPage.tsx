/**
 * /admin data island — super-admin console.
 *
 * Search users by phone, grant/revoke super-admin, and impersonate. Every
 * action hits a server-guarded endpoint (clients/admin.ts → AdminController);
 * the page itself is also route-gated on the super-admin flag, so this island
 * only ever renders for an actual super admin.
 *
 * Copy here is intentionally English-only (internal operator tool) — it
 * deliberately doesn't touch the i18n dictionaries.
 */
import { useEffect, useState } from "preact/hooks";
import { adminClient, type AdminUserView } from "../clients/admin.ts";
import { fmtPhone } from "../lib/format.ts";

const wrap = "max-width:980px;margin:0 auto;padding:8px 4px 48px";
const card =
  "background:#fff;border:1px solid var(--border,#e2e6dd);border-radius:14px;padding:18px;margin-bottom:18px";
const inputStyle =
  "flex:1;min-width:0;box-sizing:border-box;padding:9px 12px;border:1px solid var(--border,#d8dcd5);border-radius:9px;font:inherit;font-size:14px;background:#fff;color:var(--fg)";
const btnPrimary =
  "padding:9px 16px;border-radius:9px;border:0;background:var(--brand-green,#519843);color:#fff;cursor:pointer;font:inherit;font-weight:700;white-space:nowrap";
const btnSecondary =
  "padding:7px 12px;border-radius:8px;border:1px solid var(--border,#d8dcd5);background:#fff;color:var(--fg);cursor:pointer;font:inherit;font-weight:600;white-space:nowrap";
const btnDanger =
  "padding:7px 12px;border-radius:8px;border:1px solid #e3b7b7;background:#fff;color:#a83b3b;cursor:pointer;font:inherit;font-weight:600;white-space:nowrap";

export default function AdminPage() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<AdminUserView[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [impersonateId, setImpersonateId] = useState("");

  async function search(e?: Event) {
    e?.preventDefault();
    setLoading(true);
    setError(null);
    try {
      setRows(await adminClient.search(q.trim()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  // List all users on first load (empty query → the server returns everyone,
  // capped). Searching then narrows it.
  useEffect(() => {
    search();
  }, []);

  async function toggleSuper(u: AdminUserView) {
    setBusyId(u.id);
    setError(null);
    try {
      const updated = u.superAdmin
        ? await adminClient.revoke(u.id)
        : await adminClient.grant(u.id);
      setRows((rs) => rs.map((r) => (r.id === u.id ? updated : r)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
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
      setError(err instanceof Error ? err.message : "Impersonate failed");
      setBusyId(null);
    }
  }

  return (
    <div style={wrap}>
      <div style="margin:6px 4px 18px">
        <h1 style="margin:0 0 4px;font-size:22px;font-weight:800;color:var(--fg)">
          Admin
        </h1>
        <p style="margin:0;color:var(--fg-muted,#6b7560);font-size:13.5px">
          Search users, grant or revoke super-admin, and impersonate.
        </p>
      </div>

      <div style={card}>
        <form
          onSubmit={search}
          style="display:flex;gap:10px;align-items:center"
        >
          <input
            style={inputStyle}
            type="search"
            inputMode="tel"
            placeholder="Search by phone (e.g. 512 555 or +1512)"
            value={q}
            onInput={(e) => setQ((e.target as HTMLInputElement).value)}
            aria-label="Search users by phone number"
          />
          <button type="submit" style={btnPrimary} disabled={loading}>
            {loading ? "Searching…" : "Search"}
          </button>
        </form>
      </div>

      {error && (
        <div
          role="alert"
          style="background:#fdecec;border:1px solid #e3b7b7;color:#a83b3b;border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:13.5px"
        >
          {error}
        </div>
      )}

      {rows.length > 0 && (
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
              Impersonate
            </label>
            <select
              id="impersonate-select"
              style="flex:1;min-width:180px;padding:8px 10px;border:1px solid var(--border,#d8dcd5);border-radius:9px;font:inherit;font-size:13.5px;background:#fff;color:var(--fg)"
              value={impersonateId}
              onChange={(e) =>
                setImpersonateId((e.target as HTMLSelectElement).value)}
            >
              <option value="">Select a user…</option>
              {rows.map((u) => (
                <option key={u.id} value={u.id}>
                  {(u.name || u.businessName || "Unnamed") + " · " +
                    fmtPhone(u.phoneNumber)}
                </option>
              ))}
            </select>
            <button
              type="button"
              style={btnSecondary}
              disabled={!impersonateId || busyId !== null}
              onClick={() => impersonate(impersonateId)}
            >
              Go
            </button>
          </div>

          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:13.5px">
              <thead>
                <tr style="text-align:left;color:var(--fg-muted,#6b7560);font-size:11.5px;letter-spacing:.05em;text-transform:uppercase">
                  <th style="padding:8px 10px">Name</th>
                  <th style="padding:8px 10px">Phone</th>
                  <th style="padding:8px 10px">Business</th>
                  <th style="padding:8px 10px">Super</th>
                  <th style="padding:8px 10px;text-align:right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr
                    key={u.id}
                    style="border-top:1px solid var(--border,#eef1ea)"
                  >
                    <td style="padding:10px;font-weight:600">
                      {u.name || "—"}
                    </td>
                    <td style="padding:10px;font-variant-numeric:tabular-nums">
                      {fmtPhone(u.phoneNumber)}
                    </td>
                    <td style="padding:10px;color:var(--fg-muted,#6b7560)">
                      {u.businessName || "—"}
                    </td>
                    <td style="padding:10px">
                      {u.superAdmin
                        ? (
                          <span style="display:inline-block;padding:2px 8px;border-radius:999px;background:#e7f3e3;color:#2f6d29;font-size:11.5px;font-weight:700">
                            yes
                          </span>
                        )
                        : <span style="color:var(--fg-muted,#9aa394)">no</span>}
                    </td>
                    <td style="padding:10px;text-align:right;white-space:nowrap">
                      <button
                        type="button"
                        style={u.superAdmin ? btnDanger : btnSecondary}
                        disabled={busyId !== null}
                        onClick={() => toggleSuper(u)}
                      >
                        {busyId === u.id
                          ? "…"
                          : u.superAdmin
                          ? "Revoke"
                          : "Grant"}
                      </button>
                      <button
                        type="button"
                        style={btnSecondary + ";margin-left:8px"}
                        disabled={busyId !== null}
                        onClick={() => impersonate(u.id)}
                      >
                        Impersonate
                      </button>
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
          Loading users…
        </div>
      )}
      {!loading && rows.length === 0 && (
        <div style="text-align:center;color:var(--fg-muted,#9aa394);font-size:13.5px;padding:24px">
          No users found.
        </div>
      )}
    </div>
  );
}
