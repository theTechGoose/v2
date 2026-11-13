/**
 * REQ-355 — a saved profile change, told to every island on the page.
 * The topbar greeting is server-rendered; without this event a rename in
 * Settings (or the staff name prompt) left it greeting the old name until a
 * reload.
 */
export const PROFILE_UPDATED = "pm:profile-updated";

export interface ProfileUpdatedDetail {
  name?: string;
  /** REQ-737 (cycle 5, p12) — a business rename saved in Settings, so the
   *  sidebar's brand/footer follows it without a reload. */
  businessName?: string;
}

/** Announce the user's saved profile fields (only the ones that changed). */
export function announceProfile(detail: ProfileUpdatedDetail): void {
  globalThis.dispatchEvent(
    new CustomEvent<ProfileUpdatedDetail>(PROFILE_UPDATED, { detail }),
  );
}
