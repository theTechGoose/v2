import type { User } from "@users/dto/user.ts";

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
  };
}
