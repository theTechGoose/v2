import type { User } from "@users/dto/user.ts";
import type { Features } from "#features";

/**
 * AdminUserView — the safe, admin-facing projection of a user for the
 * /admin user table. Deliberately a small, fixed shape: id, name, phone,
 * businessName, and the superAdmin flag. No private aggregates leak through.
 */
export interface AdminUserView {
  id: string;
  name?: string;
  phoneNumber: string;
  businessName?: string;
  superAdmin: boolean;
  /** REQ-177 */
  features: Features;
  /** REQ-341 — the identity's own language: on whoami's `impersonator` it is the PRESENTER's,
   *  which the demo stage renders in (the resolved /me user is the customer under impersonation) */
  language?: "en" | "es";
}

/**
 * Project a User (+ optional business name pulled from the identity store)
 * into the admin-table row. Pure — the caller resolves `businessName`.
 */
export function projectAdminUser(
  user: User,
  businessName?: string | null,
): AdminUserView {
  return {
    id: user.id,
    name: user.name,
    phoneNumber: user.phoneNumber,
    businessName: businessName ?? undefined,
    superAdmin: user.superAdmin === true,
    features: user.features ?? {},
    language: user.language,
  };
}

/**
 * REQ-507 (demo-loop cycle 3, m25) — does a user match the /admin users search?
 * A blank query matches everyone (the table lists users). Otherwise the trimmed
 * query matches, case-blind, the name, the business or the email; and when it
 * carries digits, the phone's digits too ("(512) 555" finds +15125550102).
 * "abc!!" used to strip to "" and list everyone — it now matches nobody.
 */
export function adminSearchMatches(
  user: User,
  businessName: string | null | undefined,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const digits = q.replace(/\D/g, "");
  if (
    digits !== "" &&
    (user.phoneNumber ?? "").replace(/\D/g, "").includes(digits)
  ) {
    return true;
  }
  return [user.name, businessName, user.email].some((field) =>
    typeof field === "string" && field.toLowerCase().includes(q)
  );
}
