import { isPlaceholderName } from "@users/domain/business/placeholder-name/mod.ts";
import { fmtPhone } from "#identity/phone.ts";

/** REQ-355 — who guides a demo when the staff member never set a name: the brand
 *  ("DocuMonster is guiding you"), never the seeded "Nuevo usuario" / "New user". */
export const PRESENTER_FALLBACK_NAME = "DocuMonster";

/** REQ-355 — the name a presenter shows in a demo: their real name, else the brand. */
export function presenterNameOf(u: { name?: string } | undefined): string {
  const name = u?.name;
  return isPlaceholderName(name) ? PRESENTER_FALLBACK_NAME : name!.trim();
}

/** REQ-355 — the name the stage shows for the customer: their real name, else their phone;
 *  REQ-836 (demo-loop cycle dm2, m1) — the phone as the app writes it ("(512) 555-0400", as
 *  /admin does), never the E.164 "+15125550400". */
export function targetNameOf(
  u: { name?: string; phoneNumber: string },
): string {
  return isPlaceholderName(u.name) ? fmtPhone(u.phoneNumber) : u.name!.trim();
}
