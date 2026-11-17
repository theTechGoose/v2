import {
  type EnvReader,
  onRealDeploy,
} from "@core/business/real-deploy/mod.ts";

/** Universal dev/CI sign-in code: on the fakes, any phone or email paired with it logs in
 *  (find-or-create + session) without a real OTP record. */
export const MASTER_OTP_CODE = "000000";

/**
 * REQ-286 (demo issue test-setup-claims-m1) — the master code is accepted only on the fakes, by
 * REQ-318's one real-vs-fake switch: DENO_DEPLOY set, or Deno Deploy's own DENO_DEPLOYMENT_ID,
 * and it is just a wrong code. (It used to check DENO_DEPLOYMENT_ID alone, so a DENO_DEPLOY run
 * off Deno Deploy had the real adapters AND a code that signs in as anyone.) Read per call, so
 * the env at the request decides. Pure: the env is a parameter.
 */
export function acceptsMasterCode(
  code: string,
  env: EnvReader = Deno.env,
): boolean {
  return code === MASTER_OTP_CODE && !onRealDeploy(env);
}
