/**
 * The sidebar avatar initials — REQ-502: the rule lives in
 * shared/identity/initials.ts so the front-end (public /q and /i sender
 * avatar, sidebar fallback) and the emails use the very same one.
 */
export { computeInitials } from "#identity/initials.ts";
