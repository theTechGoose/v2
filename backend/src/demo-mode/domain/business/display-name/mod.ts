import { isPlaceholderName } from "@users/domain/business/placeholder-name/mod.ts";

/** REQ-355 — who guides a demo when the staff member never set a name: the brand
 *  ("DocuMonster is guiding you"), never the seeded "Nuevo usuario" / "New user". */
export const PRESENTER_FALLBACK_NAME = "DocuMonster";

/** REQ-355 — the name a presenter shows in a demo: their real name, else the brand. */
export function presenterNameOf(u: { name?: string } | undefined): string {
  const name = u?.name;
  return isPlaceholderName(name) ? PRESENTER_FALLBACK_NAME : name!.trim();
}

/** REQ-355 — the name the stage shows for the customer: their real name, else their phone. */
export function targetNameOf(
  u: { name?: string; phoneNumber: string },
): string {
  return isPlaceholderName(u.name) ? u.phoneNumber : u.name!.trim();
}
