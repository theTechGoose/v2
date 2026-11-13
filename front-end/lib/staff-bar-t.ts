/**
 * REQ-723 (demo-loop cycle 5, issue p18-7d) — the impersonation bar is staff
 * chrome, so it speaks the IMPERSONATOR's own language. While a staff member
 * acts as a customer, the page seeds langSignal from the customer's profile, so
 * the global t read "Suplantando a Priya Nair (como Alex) · Volver a tu cuenta"
 * to an English staff member. GET /admin/whoami carries the staff's language on
 * `impersonator.language` (REQ-341); the bar takes it from there. A staff
 * profile with no language falls back to the live app language (langSignal,
 * REQ-269), so the bar still renders and still follows a toggle.
 * Same pattern as REQ-544's demoChromeT for the demo pill.
 */
import { type Lang, langSignal, tFor, type Vars } from "./i18n.ts";

interface StaffWho {
  impersonator?: { language?: string } | null;
}

/** The staff member's language: whoami's impersonator's, else the live app language. */
export function staffBarLang(
  who: StaffWho | null | undefined,
  live: Lang,
): Lang {
  const own = who?.impersonator?.language;
  return own === "en" || own === "es" ? own : live;
}

/** A t bound to the staff member's language (reads langSignal only for the fallback). */
export function staffBarT(
  who: StaffWho | null | undefined,
): (key: string, vars?: Vars) => string {
  return (key, vars) => tFor(staffBarLang(who, langSignal.value), key, vars);
}
