/**
 * HTTP client for account admins (REQ-146): the numbers the owner lets into
 * the account, and the accounts a session can act in.
 * Backend: backend/src/users/entrypoints/admins-controller/mod.ts (/me/admins)
 * and me-controller/mod.ts (/me/accounts, /me/switch-account).
 */
import { api, type ApiOptions } from "../lib/api.ts";

export interface AccountAdmin {
  id: string;
  /** the account (the owner's user id) */
  userId: string;
  /** E.164 */
  phoneNumber: string;
  name?: string;
  createdAt: string;
}

/** REQ-523 (demo m16): the invite's answer says whether the text went out */
export interface InvitedAdmin extends AccountAdmin {
  texted?: boolean;
  /** REQ-601 (cycle 4, M12): the sign-in address and the invite text, to share when it was not texted */
  signInUrl?: string;
  shareText?: string;
}

export interface AccountEntry {
  userId: string;
  label: string;
  role: "owner" | "admin";
}

export interface AccountsView {
  actor: { id: string; name?: string; phoneNumber: string };
  currentUserId: string;
  accounts: AccountEntry[];
}

export const adminsClient = {
  list: (opts: ApiOptions = {}) => api.get<AccountAdmin[]>("/me/admins", opts),
  invite: (
    input: { phoneNumber: string; name?: string },
    opts: ApiOptions = {},
  ) => api.post<InvitedAdmin>("/me/admins", input, opts),
  remove: (id: string, opts: ApiOptions = {}) =>
    api.delete<{ ok: true }>(`/me/admins/${id}`, opts),
  accounts: (opts: ApiOptions = {}) =>
    api.get<AccountsView>("/me/accounts", opts),
  switchTo: (userId: string, opts: ApiOptions = {}) =>
    api.post<{ ok: true; sessionId: string; userId: string }>(
      "/me/switch-account",
      { userId },
      opts,
    ),
};

/** true when the session acts for another person's account */
export function isActing(view: AccountsView | null): boolean {
  return !!view && view.currentUserId !== view.actor.id;
}
