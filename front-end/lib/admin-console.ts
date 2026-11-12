/**
 * REQ-301 (demo cycle 1, M18 + m35) — the /admin console's rules, pure.
 *
 *   - `lockFor`: a refused admin call (401/403), or any failure while the session is an
 *     impersonation, is not an error to print — the browser's session has become the
 *     customer's (another tab clicked Demo) or is gone. The page locks with a plain notice.
 *   - `displayName`: the sign-up placeholder ("New user" / "Nuevo usuario") is not a name.
 *   - `impersonateLabel` (REQ-426, demo cycle 2 p13-e): the impersonate option reads
 *     "Person · Business (when present) · phone" — the person always leads, so the live
 *     refresh never swaps the name for a business the user just set.
 *   - `refreshWhileVisible`: the users list stays live — a refresh when the tab comes back
 *     (focus, visibilitychange) and every ADMIN_REFRESH_MS while it is visible.
 */
import { ApiError } from "./api.ts";
import type { AdminUserView, WhoAmI } from "../clients/admin.ts";
import { fmtPhone } from "./format.ts";
import { isPlaceholderName } from "../../shared/quote-flow/outbound-identity.ts";

/** how often a visible /admin re-reads its users list */
export const ADMIN_REFRESH_MS = 5_000;

export type AdminLock =
  | { kind: "demo"; customer: string }
  | { kind: "session" };

/** the server refused the session (signed out, or not a super admin any more) */
export function isRefused(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 403);
}

/** what to call the customer in the lock notice: a real name, else the business, else the phone */
export function customerLabel(user: AdminUserView | undefined): string {
  if (!user) return "";
  if (!isPlaceholderName(user.name)) return user.name!.trim();
  if (!isPlaceholderName(user.businessName)) return user.businessName!.trim();
  return user.phoneNumber ?? "";
}

/** the lock a failed admin call puts the page under — null when it is an ordinary error */
export function lockFor(
  err: unknown,
  who: WhoAmI | null | undefined,
): AdminLock | null {
  if (who?.impersonating) {
    return { kind: "demo", customer: customerLabel(who.user) };
  }
  return isRefused(err) ? { kind: "session" } : null;
}

/** REQ-301 (m35) — a placeholder is never shown as a name */
export function displayName(
  name: string | undefined,
  noNameYet: string,
): string {
  return isPlaceholderName(name) ? noNameYet : name!.trim();
}

/** REQ-426 (demo cycle 2, p13-e) — one stable impersonate option label:
 *  person first, business when present, phone last. */
export function impersonateLabel(
  user: Pick<AdminUserView, "name" | "businessName" | "phoneNumber">,
  noNameYet: string,
): string {
  const business = user.businessName?.trim();
  return [
    displayName(user.name, noNameYet),
    business,
    fmtPhone(user.phoneNumber),
  ]
    .filter(Boolean)
    .join(" · ");
}

interface Target {
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
}
interface Doc extends Target {
  visibilityState: DocumentVisibilityState;
}

/** run `run` on focus, on becoming visible, and every `every` ms while visible; returns stop() */
export function refreshWhileVisible(
  run: () => void,
  opts: { every?: number; doc?: Doc; win?: Target } = {},
): () => void {
  const every = opts.every ?? ADMIN_REFRESH_MS;
  const doc = opts.doc ?? (globalThis.document as Doc);
  const win = opts.win ?? (globalThis as unknown as Target);
  const visible = () => doc.visibilityState === "visible";
  const tick = () => {
    if (visible()) run();
  };
  const onVisible = () => {
    if (visible()) run();
  };
  const onFocus = () => run();
  const timer = setInterval(tick, every);
  doc.addEventListener("visibilitychange", onVisible);
  win.addEventListener("focus", onFocus);
  return () => {
    clearInterval(timer);
    doc.removeEventListener("visibilitychange", onVisible);
    win.removeEventListener("focus", onFocus);
  };
}
