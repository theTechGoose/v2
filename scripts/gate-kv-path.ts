/**
 * gate-kv-path — where the gate's backend keeps its Deno KV file (REQ-049).
 *
 * Under the merge gate (WT_GATE=1) `serve.ts` and the e2e lane never talk to
 * each other: wt-gate hands `serve` a PORT and the lane a BASE_URL on that
 * same port. The lane's specs scrub users by phone through
 * `backend/scripts/dev-wipe-user.ts`, which opens the KV file `KV_PATH`
 * names — so both sides derive that file from the one thing they share,
 * the frontend port. `serve.ts` creates it empty at boot; the lane exports
 * it as `KV_PATH` to jest and cypress (whose `cy.exec` / `execFileSync`
 * children inherit it).
 */
export function gateKvDir(port: number): string {
  const tmp = (Deno.env.get("TMPDIR") ?? "/tmp").replace(/\/$/, "");
  return `${tmp}/wt-gate-kv-${port}`;
}

export function gateKvPath(port: number): string {
  return `${gateKvDir(port)}/kv.sqlite`;
}
