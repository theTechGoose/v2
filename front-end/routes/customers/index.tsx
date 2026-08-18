/**
 * `/customers` — the canonical URL for the client roster.
 *
 * The backend resource is `/customers` (CustomerCard DTO) and the sidebar
 * links here; `/clients` stays live as an alias so existing links (and the
 * onboarding "reach every core page" walk) keep resolving. Both render the
 * exact same route module — no redirect, no duplicated markup.
 */
export { default } from "../clients/index.tsx";
