/**
 * HTTP client for the /admin (super-admin) surface.
 *
 * Backend reference: users/entrypoints/admin-controller/mod.ts
 *   GET  /admin/users?q=<phone>        → AdminUserView[]   (super-admin)
 *   POST /admin/users/:id/grant        → AdminUserView     (super-admin)
 *   POST /admin/users/:id/revoke       → AdminUserView     (super-admin)
 *   POST /admin/impersonate/:id        → { sessionId, user }  (super-admin)
 *   POST /admin/stop-impersonating     → { sessionId, user }
 *   GET  /admin/whoami                 → WhoAmI            (any session)
 *
 * Every guarded call is enforced server-side; the client gating is cosmetic.
 */
import { api, type ApiOptions } from "../lib/api.ts";
import { clearDashCache } from "../lib/dash-cache.ts";
import type { FeatureKey, Features } from "../../shared/features.ts";

export interface AdminUserView {
  id: string;
  name?: string;
  phoneNumber: string;
  businessName?: string;
  superAdmin: boolean;
  /** REQ-177: the account's feature flags */
  features?: Features;
  /** REQ-341: the identity's own language (whoami's `impersonator.language` is the presenter's) */
  language?: "en" | "es";
}

export interface ImpersonationResponse {
  ok: true;
  sessionId: string;
  user: AdminUserView;
}

export interface WhoAmI {
  authenticated: boolean;
  user?: AdminUserView;
  superAdmin?: boolean;
  impersonating?: boolean;
  impersonator?: AdminUserView | null;
}

export const adminClient = {
  search: (q: string, opts: ApiOptions = {}) =>
    api.get<AdminUserView[]>("/admin/users", { ...opts, query: { q } }),
  grant: (id: string, opts: ApiOptions = {}) =>
    api.post<AdminUserView>(`/admin/users/${id}/grant`, undefined, opts),
  revoke: (id: string, opts: ApiOptions = {}) =>
    api.post<AdminUserView>(`/admin/users/${id}/revoke`, undefined, opts),
  // REQ-908 (dm7, m4) — the tab's dash cache (REQ-624) is the last person's profile: cleared when
  // an impersonation starts or ends, so the next page is the next person's from its first paint
  impersonate: (id: string, opts: ApiOptions = {}) =>
    api.post<ImpersonationResponse>(
      `/admin/impersonate/${id}`,
      undefined,
      opts,
    ).then((r) => {
      clearDashCache();
      return r;
    }),
  stopImpersonating: (opts: ApiOptions = {}) =>
    api.post<ImpersonationResponse>(
      "/admin/stop-impersonating",
      undefined,
      opts,
    ).then((r) => {
      clearDashCache();
      return r;
    }),
  /** REQ-177 */
  setFeature: (
    id: string,
    key: FeatureKey,
    on: boolean,
    opts: ApiOptions = {},
  ) => api.put<AdminUserView>(`/admin/users/${id}/features`, { key, on }, opts),
  whoami: (opts: ApiOptions = {}) => api.get<WhoAmI>("/admin/whoami", opts),
};
