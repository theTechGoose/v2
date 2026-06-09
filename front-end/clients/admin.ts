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

export interface AdminUserView {
  id: string;
  name?: string;
  phoneNumber: string;
  businessName?: string;
  superAdmin: boolean;
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
  impersonate: (id: string, opts: ApiOptions = {}) =>
    api.post<ImpersonationResponse>(
      `/admin/impersonate/${id}`,
      undefined,
      opts,
    ),
  stopImpersonating: (opts: ApiOptions = {}) =>
    api.post<ImpersonationResponse>(
      "/admin/stop-impersonating",
      undefined,
      opts,
    ),
  whoami: (opts: ApiOptions = {}) => api.get<WhoAmI>("/admin/whoami", opts),
};
