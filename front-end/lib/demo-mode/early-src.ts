/**
 * REQ-648 (demo-loop cycle 5, M3 + c4-m28) — where the customer's early demo script (demo-early.ts)
 * is served, for `_app.tsx`'s head. This file is the stand-in: front-end/vite-demo-early.ts
 * replaces it on the server's side — in dev with the script's own source as Vite serves it, in a
 * build with the chunk it was built to. null: no early script (the overlay island opens the page's
 * demo link, as before).
 * REQ-892 — and the session-less page's rejoin script (demo-rejoin.ts), served the same way.
 */
export const DEMO_EARLY_SRC: string | null = null;
export const DEMO_REJOIN_SRC: string | null = null;
